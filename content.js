/**
 * Applies the background's allow/deny decision to media in this frame.
 *
 * Injected into every frame, including cross-origin iframes. Default is deny
 * until the service worker answers, so a background frame cannot start playback
 * in the gap before the first message. Resume retries after a click or key
 * because Chrome may reject play() with no user activation.
 */
(function () {
  'use strict';

  const session = globalThis.FocusPauseMedia.createMediaSession(collectMedia);
  const boundShadows = new WeakSet();

  function shadowRootOf(el) {
    if (el.shadowRoot) return el.shadowRoot;
    try {
      return chrome.dom?.openOrClosedShadowRoot?.(el) ?? null;
    } catch {
      return null;
    }
  }

  function collectMedia() {
    const found = [];
    const roots = new Set();

    function walk(root) {
      if (!root || roots.has(root) || typeof root.querySelectorAll !== 'function') return;
      roots.add(root);
      for (const el of root.querySelectorAll('video, audio')) found.push(el);
      for (const el of root.querySelectorAll('*')) {
        const shadow = shadowRootOf(el);
        if (shadow) walk(shadow);
      }
    }

    walk(document);
    return found;
  }

  function bind(root) {
    root.addEventListener('play', session.onPlay, true);
    root.addEventListener('playing', session.onPlay, true);
    root.addEventListener('pause', session.onPause, true);
  }

  function bindShadows(root) {
    if (!root || typeof root.querySelectorAll !== 'function') return;
    for (const el of root.querySelectorAll('*')) {
      const shadow = shadowRootOf(el);
      if (!shadow || boundShadows.has(shadow)) continue;
      boundShadows.add(shadow);
      bind(shadow);
      bindShadows(shadow);
    }
  }

  bind(document);

  function armObserver() {
    const root = document.documentElement;
    if (!root) return;
    bindShadows(root);
    const observer = new MutationObserver(() => bindShadows(document));
    observer.observe(root, { childList: true, subtree: true });
  }

  if (document.documentElement) armObserver();
  else document.addEventListener('DOMContentLoaded', armObserver, { once: true });

  let lastAllow = false;
  let waitingForRoot = false;

  function publish(allow) {
    const root = document.documentElement;
    if (!root) return false;
    root.setAttribute('data-focuspause', allow ? 'allow' : 'deny');
    return true;
  }

  function ensurePublished() {
    if (publish(lastAllow) || waitingForRoot) return;
    waitingForRoot = true;
    document.addEventListener(
      'DOMContentLoaded',
      () => {
        waitingForRoot = false;
        publish(lastAllow);
      },
      { once: true },
    );
  }

  function apply(allow) {
    lastAllow = allow;
    if (!allow) {
      // Deny before pausing so a player that calls play() from its pause
      // handler is blocked by the page hook instead of restarting.
      ensurePublished();
      session.setAllowed(false);
      return;
    }
    // Allow before publishing so a page-hook resume is not treated as a denied play.
    session.setAllowed(true);
    ensurePublished();
  }

  document.addEventListener(
    'focuspause-wants-play',
    (event) => session.markForResume(event.target),
    true,
  );

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'focuspause') apply(Boolean(msg.allow));
  });

  chrome.runtime.sendMessage({ type: 'focuspause-query' }, (res) => {
    if (chrome.runtime.lastError) return;
    apply(Boolean(res?.allow));
  });

  function retryResume() {
    if (session.isAllowed()) session.setAllowed(true);
  }

  document.addEventListener('pointerdown', retryResume, true);
  document.addEventListener('keydown', retryResume, true);
})();
