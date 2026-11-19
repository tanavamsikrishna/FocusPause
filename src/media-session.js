/**
 * Pauses HTML media in one frame and resumes only what this session paused.
 *
 * Uses HTMLMediaElement.pause() / play(), not tab mute and not playbackRate = 0.
 * A paused element stays marked while the frame is denied, even if the page
 * also calls pause(), so returning to the tab can resume it. A pause while the
 * frame is allowed is treated as the user's (or the player's) own pause and is
 * not resumed. Tracked media is dropped when it ends or is discarded from the
 * DOM, resume is retried only for NotAllowedError, and detached media
 * (new Audio()) is re-attached to the holder before resuming, because a
 * direct play() here bypasses the page hook's play() wrapper.
 *
 * Classic script: content.js depends on globalThis.FocusPauseMedia. No exports,
 * because content scripts cannot be ES modules.
 */
(function (root) {
  'use strict';

  function isMedia(node) {
    return (
      node != null &&
      typeof node.pause === 'function' &&
      typeof node.play === 'function' &&
      typeof node.paused === 'boolean'
    );
  }

  function isHolderChild(el) {
    const parent = el.parentNode;
    if (!parent) return false;
    try {
      if (typeof parent.hasAttribute === 'function' && parent.hasAttribute('data-focuspause-holder')) {
        return true;
      }
      if (typeof parent.getAttribute === 'function' && parent.getAttribute('data-focuspause-holder') != null) {
        return true;
      }
    } catch {
      return false;
    }
    return false;
  }

  // Only a missing user gesture can succeed on a later click/key. AbortError
  // (removed / src changed) and NotSupportedError (no supported source) will
  // not, so retrying them on every pointerdown/keydown would loop forever.
  function isRetryable(err) {
    if (!err) return false;
    if (typeof err === 'string') return err.includes('NotAllowedError');
    if (err.name === 'NotAllowedError') return true;
    return typeof err.message === 'string' && err.message.includes('NotAllowedError');
  }

  function createMediaSession(collectMedia) {
    const pausedByUs = new WeakSet();
    const tracked = new Set();
    const pausing = new Set();
    // Detached media first seen disconnected or in the page hook's holder:
    // eligible to be re-attached before a direct play(). Media first seen as
    // ordinary DOM media is not, so a discarded element is dropped instead
    // of being resurrected into the holder.
    const reattachable = new WeakSet();
    const domSeen = new WeakSet();
    const endedWatched = new WeakSet();
    let allowed = false;

    function drop(el) {
      tracked.delete(el);
      pausedByUs.delete(el);
    }

    function isGone(el) {
      if (el.ended) return true;
      // A disconnected element that is still playing is audible detached
      // media and must stay pausable; once paused, a non-reattachable one
      // has been discarded and can be forgotten. Elements without an
      // isConnected flag (tests) are never pruned on this ground.
      return el.isConnected === false && el.paused && !reattachable.has(el);
    }

    function note(el) {
      if (!isMedia(el)) return;
      tracked.add(el);
      if (isHolderChild(el)) {
        reattachable.add(el);
      } else if (el.isConnected === false) {
        if (!domSeen.has(el)) reattachable.add(el);
      } else if (el.isConnected === true) {
        domSeen.add(el);
      }
      if (!endedWatched.has(el)) {
        endedWatched.add(el);
        if (typeof el.addEventListener === 'function') {
          try {
            el.addEventListener('ended', () => drop(el), { once: true });
          } catch {
            // Ignore exotic elements that reject listeners.
          }
        }
      }
    }

    function reattach(el) {
      if (el.isConnected !== false || !reattachable.has(el)) return;
      const doc = el.ownerDocument;
      if (!doc || typeof doc.createElement !== 'function') return;
      try {
        let holder = null;
        if (typeof doc.querySelector === 'function') {
          holder = doc.querySelector('[data-focuspause-holder]');
        }
        if (!holder) {
          holder = doc.createElement('div');
          holder.hidden = true;
          if (typeof holder.setAttribute === 'function') {
            holder.setAttribute('data-focuspause-holder', '');
          }
          if (typeof holder.addEventListener === 'function') {
            holder.addEventListener(
              'pause',
              (event) => {
                const src = event && event.target;
                if (src && src.parentNode === holder && typeof holder.removeChild === 'function') {
                  holder.removeChild(src);
                }
              },
              true,
            );
          }
          const parent = doc.head || doc.documentElement;
          if (!parent || typeof parent.appendChild !== 'function') return;
          parent.appendChild(holder);
        }
        if (holder && typeof holder.appendChild === 'function') holder.appendChild(el);
      } catch {
        // Fall through: play() below still runs on a disconnected element.
      }
    }

    function elements() {
      const seen = new Set();
      const list = [];
      const collected = typeof collectMedia === 'function' ? collectMedia() : [];
      // Collected media is DOM media by definition (the scan only sees
      // connected elements, holder children aside), so a later disconnect
      // means discarded, not detached Audio.
      for (const el of collected) {
        if (!isMedia(el)) continue;
        if (isHolderChild(el)) reattachable.add(el);
        else domSeen.add(el);
      }
      for (const el of tracked) {
        if (!isMedia(el) || isGone(el)) drop(el);
      }
      for (const el of [...tracked, ...collected]) {
        if (!isMedia(el) || seen.has(el)) continue;
        seen.add(el);
        list.push(el);
      }
      return list;
    }

    function pauseElement(el) {
      if (!isMedia(el) || el.paused || el.ended) return;
      note(el);
      if (pausing.has(el)) return;
      pausedByUs.add(el);
      pausing.add(el);
      try {
        el.pause();
      } finally {
        pausing.delete(el);
      }
    }

    function deny() {
      allowed = false;
      for (const el of elements()) pauseElement(el);
    }

    function allow() {
      allowed = true;
      const pending = [];
      // Resume only from the tracked set, never collectMedia(): every
      // element in pausedByUs was note()d before being added, so it is
      // already tracked. collectMedia() is a full-document scan and
      // allow() runs on every keydown/pointerdown for resume retry —
      // scanning there cost ~150ms per 100 keydowns in Speedometer.
      for (const el of [...tracked]) {
        if (!isMedia(el) || isGone(el)) {
          drop(el);
          continue;
        }
        if (!pausedByUs.has(el)) continue;
        if (el.ended || !el.paused) {
          pausedByUs.delete(el);
          continue;
        }
        pausedByUs.delete(el);
        reattach(el);
        try {
          const result = el.play();
          if (result && typeof result.then === 'function') {
            pending.push(
              result.catch((err) => {
                if (isRetryable(err)) pausedByUs.add(el);
              }),
            );
          }
        } catch (err) {
          if (isRetryable(err)) pausedByUs.add(el);
        }
      }
      return Promise.all(pending);
    }

    function markForResume(el) {
      if (allowed || !isMedia(el) || el.ended) return;
      note(el);
      pausedByUs.add(el);
      if (!el.paused) pauseElement(el);
    }

    function onPlay(event) {
      const el = event && event.target;
      if (!isMedia(el)) return;
      note(el);
      if (allowed) return;
      pauseElement(el);
    }

    function onPause(event) {
      const el = event && event.target;
      if (!isMedia(el) || pausing.has(el)) return;
      // While denied, keep the mark. The page often echoes pause() after ours.
      if (!allowed) return;
      pausedByUs.delete(el);
    }

    function setAllowed(next) {
      return next ? allow() : (deny(), Promise.resolve());
    }

    return {
      setAllowed,
      onPlay,
      onPause,
      markForResume,
      isAllowed: () => allowed,
      wasPausedByUs: (el) => pausedByUs.has(el),
    };
  }

  root.FocusPauseMedia = { createMediaSession, isMedia };
})(globalThis);
