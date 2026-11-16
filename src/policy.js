/**
 * Decides which single Chrome tab may keep playing media.
 *
 * Only the active tab of the focused Chrome window may play. Every other tab
 * pauses, including tabs in other windows and every tab when Chrome itself
 * is unfocused. This module has no Chrome API calls so the rules can be tested
 * without a browser.
 */

export const WINDOW_ID_NONE = -1;

/** Brief Chrome-window switches often emit this before the next window id. */
export const UNFOCUSED_DEBOUNCE_MS = 150;

/**
 * @param {{ id?: number, windowId?: number }} tab
 * @param {number | null | undefined} focusedWindowId
 * @param {number | null | undefined} activeTabId
 * @returns {boolean}
 */
export function mayPlay(tab, focusedWindowId, activeTabId) {
  if (focusedWindowId == null || focusedWindowId === WINDOW_ID_NONE) return false;
  if (activeTabId == null) return false;
  if (tab == null || tab.windowId !== focusedWindowId) return false;
  return tab.id === activeTabId;
}

/**
 * Applies a focused window id immediately. Applies "no window" only after
 * delayMs, and cancels that if a real window id arrives first.
 *
 * @param {(windowId: number) => void} apply
 * @param {number} delayMs
 * @param {{ setTimeout: Function, clearTimeout: Function }} [timers]
 */
export function createFocusScheduler(apply, delayMs, timers = globalThis) {
  let timer = null;

  function clear() {
    if (timer == null) return;
    timers.clearTimeout(timer);
    timer = null;
  }

  return {
    push(windowId) {
      if (windowId === WINDOW_ID_NONE) {
        if (timer != null) return;
        timer = timers.setTimeout(() => {
          timer = null;
          apply(WINDOW_ID_NONE);
        }, delayMs);
        return;
      }
      clear();
      apply(windowId);
    },
    cancel: clear,
  };
}
