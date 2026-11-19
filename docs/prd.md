# FocusPause

Pause HTML video and audio everywhere except the active tab of the focused Chrome window. Resume only the media this extension paused.

## Playback

A tab may play only when a Chrome window is focused, the tab is in that window, and the tab is the active tab.

Pause every other tab:

- Unfocused tabs in the focused window.
- Every tab in every other window, including the active tab of an unfocused window.
- Every tab when Chrome itself is unfocused.

Picture-in-Picture follows its tab. There is no whitelist or per-site setting.

Switching between Chrome windows must not pause the newly focused window. A brief report of no focused window during that switch is not a real unfocus.

## Pause and resume

Pause means the media element stops. It is not a tab mute, and it is not a zero playback rate. A zero rate leaves the element in the playing state and can keep buffering and decoding.

Resume only media this extension stopped or blocked. Media the user or the page had already paused stays paused. A pause while the tab is allowed is the user's or the player's own pause and is not resumed. A pause while the tab is denied does not cancel the resume, because players echo pause after ours.

If resume is rejected for lack of user activation (`NotAllowedError`), retry on the next click or keypress in that frame. Other rejections (for example `AbortError` or `NotSupportedError`) are not retried.

While a tab is denied, a later `play()` from the page must not start playback. Players such as YouTube call `play()` again from their pause handler. That blocked media resumes when the tab is allowed again.

## Out of scope

- Tab mute, and pausing by setting playback rate to 0.
- Audio that never uses a `<video>` or `<audio>` element.
- Pages Chrome will not inject into: `chrome://`, the Chrome Web Store, other extensions, and some built-in viewers.
- Store publishing.
- Firefox.

## Acceptance

The three pause situations hold. Already-paused media is not resumed. A pause echo while denied is still resumed. A rejected resume is retried on the next click or key. A blocked play that never started is resumed when the tab is allowed again.

Check two windows, an unfocused tab, and Chrome itself unfocused.
