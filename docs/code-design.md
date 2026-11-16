# FocusPause code design

## Components

| File                   | Role                                                                                                                                                 |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/policy.js`        | Which tab may play, and the unfocus debounce. No Chrome APIs.                                                                                        |
| `background.js`        | Service worker. Turns window and tab events into allow or deny for every tab.                                                                        |
| `src/media-session.js` | Per-frame pause and resume set. Classic script. Exposes `globalThis.FocusPauseMedia`.                                                                |
| `content.js`           | Isolated world. Finds `video` and `audio`, including open and closed shadow roots and subframes, and applies allow or deny.                          |
| `page-hook.js`         | Main world. Blocks `play()` while denied. Attaches disconnected media (`new Audio()`) to a hidden div so it can be paused, then removes it on pause. |

`src/media-session.js` is not an ES module. Content scripts cannot `import`. `background.js` is a module and imports `src/policy.js`.

## Focus signal

`chrome.windows.onFocusChanged` uses the event's window id. A real window id applies immediately and cancels a pending unfocus. `WINDOW_ID_NONE` waits 150ms, so a brief gap while switching Chrome windows does not pause the newly focused window.

On install, browser startup, tab activation, a tab becoming audible, and the focused window closing, the service worker reads the last focused window again. If that window is not focused, no tab may play. Otherwise the active tab of that window may play.

## Per frame

Each frame starts denied. It asks the service worker whether its tab may play, and also accepts a pushed allow or deny.

Deny sets `data-focuspause="deny"` on `document.documentElement` before pausing. A player that calls `play()` from a pause handler is blocked instead of restarting.

Allow resumes the content-script set first, then sets `data-focuspause="allow"`. The page hook then resumes media it blocked. The content script is already allowed, so that resume is not paused again.

Until the attribute is `allow`, the page hook treats the frame as denied. A missing attribute is denied.

## Messages

- Content to service worker: `{ type: "focuspause-query" }`. Response: `{ allow: boolean }`.
- Service worker to every frame: `{ type: "focuspause", allow: boolean }`.
- Page hook to content script: bubbling `focuspause-wants-play` on the element, while the element is still connected.

`chrome.tabs.sendMessage` failing is normal for `chrome://` pages and tabs with no content script. Ignore it.

## Permissions

`host_permissions` is `<all_urls>`, so the service worker can message ordinary web tabs. Content scripts use `all_frames`, `match_origin_as_fallback`, and `run_at: document_start`. The page hook runs in `MAIN`.

No other permissions. No popup, options page, or storage.

## Tests

`src/policy.js` and `src/media-session.js` are tested in Node. The service worker and DOM integration are not. The manual checks are the acceptance section of `docs/prd.md`.
