# Abacus Mental Math Helper

A Chrome extension for `client.abacusmentalmath.com`. It adds three toggles, all set from the toolbar icon:

- **Hide the timer** — hides the clock during a unit and on the end-of-unit summary.
- **Stop after 2 wrong answers** — checks the typed answer before it is submitted. A wrong answer never advances the question, so the child can keep retrying. After the third wrong try in a unit, the answer box locks.
- **Add a play-again button** — adds a "Play again" button on the end-of-unit screen for Listening Abacus and Listening Anzan units, so the same unit can be restarted with one click.

## Install from a release (recommended)

1. Go to the [Releases page](../../releases) and download `abacus-mental-math-helper.zip` from the latest release.
2. Unzip it. You get a folder with `manifest.json` inside.
3. In Chrome, go to `chrome://extensions`.
4. Turn on **Developer mode** (top right).
5. Click **Load unpacked** and select the unzipped folder.

The extension icon appears in the toolbar. Click it to turn any of the three options on or off.

## Install from source

1. Clone this repository.
2. In Chrome, go to `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and select the `extension` folder.

No build step is needed — the extension runs the files in `extension/` directly.

## Updating

To pull in a change, click the refresh icon on the extension's card in `chrome://extensions` (source install), or repeat the install steps with a newer release zip.
