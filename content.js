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
  // Cache of hosts already probed: calling chrome.dom.openOrClosedShadowRoot()
  // on every node on every mutation is a known performance cliff (per-node
  // browser round-trip, worse on nodes with children). Probe each host once.
  const probedHosts = new WeakSet();
  const shadowByHost = new WeakMap();

  function shadowRootOf(el, force = false) {
    if (!el || typeof el !== 'object') return null;
    if (el.shadowRoot) return el.shadowRoot;
    if (shadowByHost.has(el)) return shadowByHost.get(el);
    // force (used by collectMedia on allow/deny, a rare event) re-probes
    // custom-element hosts so a shadow attached after the mutation scan
    // is still found when it matters.
    if (probedHosts.has(el) && !force) return null;
    // Only custom elements can host a (closed) shadow root in practice.
    // Skipping all other elements avoids the per-node API call entirely on
    // ordinary pages; their tag names never gain a '-' later.
    if (typeof el.tagName !== 'string' || !el.tagName.includes('-')) {
      probedHosts.add(el);
      return null;
    }
    try {
      const root = chrome.dom?.openOrClosedShadowRoot?.(el) ?? null;
      if (root) {
        shadowByHost.set(el, root);
        return root;
      }
    } catch {
      // Fall through: treat as no shadow root.
    }
    probedHosts.add(el);
    return null;
  }

  function collectMedia() {
    const found = [];
    const roots = new Set();

    function walk(root) {
      if (!root || roots.has(root) || typeof root.querySelectorAll !== 'function') return;
      roots.add(root);
      for (const el of root.querySelectorAll('video, audio')) found.push(el);
      for (const el of root.querySelectorAll('*')) {
        const shadow = shadowRootOf(el, true);
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

  // Scan one root (document, shadow root, or a newly added subtree) and
  // bind any shadow roots found. Each host is probed at most once thanks
  // to probedHosts / shadowByHost, so re-scanning a visited host is cheap.
  // Walk childNodes directly instead of querySelectorAll('*'): frameworks
  // that insert items one-by-one produce one added node per item, and a
  // selector query per node costs ~1ms each in a large document — that
  // alone was ~135ms per Adding100Items batch in Speedometer.
  function scanRoot(root) {
    if (!root || typeof root !== 'object') return;
    const stack = [root];
    while (stack.length) {
      const node = stack.pop();
      if (!node || typeof node !== 'object') continue;
      if (node.nodeType === 1) {
        const shadow = shadowRootOf(node);
        if (shadow && !boundShadows.has(shadow)) {
          boundShadows.add(shadow);
          bind(shadow);
          observeShadow(shadow);
          stack.push(shadow);
        }
      }
      const children = node.childNodes;
      if (!children) continue;
      for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
    }
  }

  function scanNode(node) {
    if (!node || node.nodeType === 1) {
      scanRoot(node);
      return;
    }
    if (node.nodeType === 9 || node.nodeType === 11) scanRoot(node);
  }

  function handleMutations(mutations) {
    for (const mutation of mutations) {
      // Scan only what was added, not the whole document per mutation.
      for (const node of mutation.addedNodes || []) scanNode(node);
    }
  }

  function observeShadow(shadow) {
    // Content inserted inside a shadow root never reaches the document
    // observer, so each bound shadow root gets its own observer.
    new MutationObserver(handleMutations).observe(shadow, {
      childList: true,
      subtree: true,
    });
  }

  bind(document);

  function armObserver() {
    const root = document.documentElement;
    if (!root) return;
    scanRoot(document);
    new MutationObserver(handleMutations).observe(root, {
      childList: true,
      subtree: true,
    });
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
