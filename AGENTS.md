# AGENTS.md

Chrome extension that pauses HTML video and audio except in the active tab of the focused window. Product contract: `docs/prd.md`. Implementation: `docs/code-design.md`. One-time unpacked load is manual; see `README.md`.

## Commands

- `nu scripts/test.nu` — unit tests for the pause rules and the resume set.
- `nu scripts/build.nu` — syntax-check extension files and write `dist/FocusPause-<version>.zip`.
- `node --test` — same tests, without Nushell.

No deploy script. Do not automate Developer mode, Load unpacked, or Chrome Web Store publishing.

## Conventions

- No popup, options page, whitelist, or storage unless asked.
- `src/media-session.js` stays a classic script. Content scripts cannot import modules.
- File-level comment states purpose, not a walkthrough.
