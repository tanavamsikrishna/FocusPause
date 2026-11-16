/**
 * Tells every tab whether it is the one focused Chrome tab.
 *
 * The active tab of the focused window may play. All other tabs, including
 * every tab in unfocused windows and every tab when Chrome itself is
 * unfocused, are told to pause. A short debounce applies only to "no window",
 * because Chrome often reports that for a moment while switching its own windows.
 */

import {
  UNFOCUSED_DEBOUNCE_MS,
  WINDOW_ID_NONE,
  createFocusScheduler,
  mayPlay,
} from './src/policy.js';

let generation = 0;
let focusedWindowId = WINDOW_ID_NONE;

function send(tabId, allow) {
  if (tabId == null) return Promise.resolve();
  return chrome.tabs.sendMessage(tabId, { type: 'focuspause', allow }).catch(() => {});
}

async function broadcast(state) {
  const token = ++generation;
  const tabs = await chrome.tabs.query({});
  if (token !== generation) return;
  await Promise.all(
    tabs.map((tab) => send(tab.id, mayPlay(tab, state.focusedWindowId, state.activeTabId))),
  );
}

async function applyWindow(windowId) {
  if (windowId !== WINDOW_ID_NONE) scheduler.cancel();
  focusedWindowId = windowId;
  if (windowId === WINDOW_ID_NONE) {
    await broadcast({ focusedWindowId: WINDOW_ID_NONE, activeTabId: null });
    return;
  }
  const [tab] = await chrome.tabs.query({ active: true, windowId });
  await broadcast({ focusedWindowId: windowId, activeTabId: tab?.id ?? null });
}

async function reconcileFromChrome() {
  const win = await chrome.windows.getLastFocused();
  if (!win?.focused) {
    await applyWindow(WINDOW_ID_NONE);
    return;
  }
  await applyWindow(win.id);
}

const scheduler = createFocusScheduler((windowId) => {
  applyWindow(windowId);
}, UNFOCUSED_DEBOUNCE_MS);

chrome.windows.onFocusChanged.addListener((windowId) => {
  scheduler.push(windowId);
});

chrome.tabs.onActivated.addListener(() => {
  reconcileFromChrome();
});

chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (changeInfo.audible === true) reconcileFromChrome();
});

chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === focusedWindowId) reconcileFromChrome();
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== 'focuspause-query') return;
  chrome.windows
    .getLastFocused()
    .then(async (win) => {
      if (!win?.focused || !sender.tab) {
        sendResponse({ allow: false });
        return;
      }
      const [active] = await chrome.tabs.query({ active: true, windowId: win.id });
      focusedWindowId = win.id;
      sendResponse({
        allow: mayPlay(sender.tab, win.id, active?.id ?? null),
      });
    })
    .catch(() => sendResponse({ allow: false }));
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  reconcileFromChrome();
});

chrome.runtime.onStartup.addListener(() => {
  reconcileFromChrome();
});

reconcileFromChrome();
