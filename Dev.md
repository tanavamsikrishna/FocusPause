# Development Setup

## Scripts

- `nu scripts/test.nu` — unit tests.
- `nu scripts/build.nu` — write `dist/FocusPause-<version>.zip`.

There is no deploy script.

## Load extension

Allow local extension files once. The scripts do not do this.

1. Open `chrome://extensions`.
2. Turn on Developer mode.
3. Load unpacked, and select this repo.

After code changes, reload the extension card on that page.
