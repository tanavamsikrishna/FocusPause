/**
 * Pauses HTML media in one frame and resumes only what this session paused.
 *
 * Uses HTMLMediaElement.pause() / play(), not tab mute and not playbackRate = 0.
 * A paused element stays marked while the frame is denied, even if the page
 * also calls pause(), so returning to the tab can resume it. A pause while the
 * frame is allowed is treated as the user's (or the player's) own pause and is
 * not resumed.
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

  function createMediaSession(collectMedia) {
    const pausedByUs = new WeakSet();
    const tracked = new Set();
    const pausing = new Set();
    let allowed = false;

    function note(el) {
      if (isMedia(el)) tracked.add(el);
    }

    function elements() {
      const seen = new Set();
      const list = [];
      const collected = typeof collectMedia === 'function' ? collectMedia() : [];
      for (const el of tracked) {
        if (!isMedia(el)) tracked.delete(el);
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
      for (const el of elements()) {
        if (!pausedByUs.has(el)) continue;
        if (el.ended || !el.paused) {
          pausedByUs.delete(el);
          continue;
        }
        pausedByUs.delete(el);
        try {
          const result = el.play();
          if (result && typeof result.then === 'function') {
            pending.push(
              result.catch(() => {
                pausedByUs.add(el);
              }),
            );
          }
        } catch {
          pausedByUs.add(el);
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
