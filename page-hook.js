/**
 * Page-world hook for media the isolated content script cannot catch in time.
 *
 * Disconnected elements (new Audio()) are attached while playing so they can be
 * paused. While this frame is not allowed to play, HTMLMediaElement.play() is
 * intercepted before playback starts — players such as YouTube call play() again
 * as soon as they see pause(). Those elements are resumed only if this hook
 * blocked them. Connected players are otherwise left to the content script.
 *
 * The detached-element attachment follows NDevTK/AutoPause (MIT).
 */
(function () {
  'use strict';

  if (window.__focusPauseHooked) return;
  if (typeof HTMLMediaElement === 'undefined') return;
  window.__focusPauseHooked = true;

  const play = HTMLMediaElement.prototype.play;
  const wanted = new Set();
  const gating = new Set();
  let holder = null;

  function allowed() {
    const root = document.documentElement;
    return Boolean(root && root.getAttribute('data-focuspause') === 'allow');
  }

  function bin() {
    if (holder && holder.isConnected) return holder;
    holder = document.createElement('div');
    holder.hidden = true;
    holder.setAttribute('data-focuspause-holder', '');
    const parent = document.head || document.documentElement;
    if (!parent) return null;
    parent.appendChild(holder);
    holder.addEventListener(
      'pause',
      (event) => {
        const src = event.target;
        if (src instanceof HTMLMediaElement && src.parentNode === holder) {
          holder.removeChild(src);
        }
      },
      true,
    );
    return holder;
  }

  function remember(el) {
    if (!(el instanceof HTMLMediaElement) || el.ended) return;
    wanted.add(el);
    if (el.paused || gating.has(el)) return;
    gating.add(el);
    try {
      el.pause();
    } finally {
      gating.delete(el);
    }
  }

  function resumeWanted() {
    if (!allowed()) return;
    for (const el of [...wanted]) {
      wanted.delete(el);
      if (!(el instanceof HTMLMediaElement) || el.ended || !el.paused) continue;
      try {
        if (!el.isConnected) {
          const target = bin();
          if (target) target.appendChild(el);
        }
        const result = play.call(el);
        if (result && typeof result.catch === 'function') {
          result.catch(() => wanted.add(el));
        }
      } catch {
        wanted.add(el);
      }
    }
  }

  HTMLMediaElement.prototype.play = function focusPausePlay() {
    try {
      if (!allowed()) {
        if (this instanceof HTMLMediaElement && !this.isConnected) {
          const target = bin();
          if (target) target.appendChild(this);
        }
        // Dispatch while the element is still connected. pause() below detaches it.
        this.dispatchEvent(new Event('focuspause-wants-play', { bubbles: true, composed: true }));
        remember(this);
        return Promise.resolve();
      }
      if (this instanceof HTMLMediaElement && !this.isConnected) {
        const target = bin();
        if (target) target.appendChild(this);
      }
    } catch {
      // A hook failure must not break the page's own play().
    }
    return play.apply(this, arguments);
  };

  function watch(root) {
    if (!root || root.nodeType !== Node.ELEMENT_NODE) return;
    new MutationObserver(() => {
      if (allowed()) resumeWanted();
    }).observe(root, { attributes: true, attributeFilter: ['data-focuspause'] });
  }

  function catchUp() {
    watch(document.documentElement);
    if (allowed()) resumeWanted();
  }

  if (document.documentElement) watch(document.documentElement);
  document.addEventListener('DOMContentLoaded', catchUp, { once: true });
  document.addEventListener('pointerdown', () => allowed() && resumeWanted(), true);
  document.addEventListener('keydown', () => allowed() && resumeWanted(), true);
})();
