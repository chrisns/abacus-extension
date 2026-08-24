# Abacus Mental Math Helper

A Tampermonkey userscript for `client.abacusmentalmath.com`. Once installed it runs on every page automatically:

- **Hides the timer** — during a unit and on the end-of-unit summary.
- **Colours the answer red or green** — after 2 wrong answers in a unit, the text they're typing turns red or green against the correct answer, live, before they press Enter. The site's own submit handling is untouched.
- **Always offers a "Listen again" button** — on Listening Abacus and Listening Anzan units, so a child who didn't hear the numbers can replay them at any point, not just before answering.
- **Remembers the voice/timeout speed** — the two sliders in the Start dialog keep the last values used, on every future unit and every future visit.
- **Adds a "Play again" button** — on the end-of-unit screen for Listening Abacus and Listening Anzan, to restart the same unit in one click.
- **Shows units completed today** — in place of the language dropdown at the top of every page.

Each of the first three is a checkbox in the extension's toolbar popup in the old Chrome-extension version of this project; here they're Tampermonkey menu commands (see below).

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) from the Chrome Web Store, if it isn't already installed.
2. Open this link: [abacus-mental-math-helper.user.js](https://raw.githubusercontent.com/chrisns/abacus-extension/main/abacus-mental-math-helper.user.js).
3. Tampermonkey shows an install screen. Click **Install**.

That's it — the script now runs automatically on `client.abacusmentalmath.com`.

## Turning a feature on or off

Click the Tampermonkey icon in the toolbar while on the site. The script's menu commands are listed there:

- ✅/⬜ Hide the timer
- ✅/⬜ Colour the answer red/green after 2 wrong
- ✅/⬜ Add a play-again button

Clicking one flips it and reloads the page.

## Updating

Tampermonkey checks the script's `@updateURL` periodically and offers an update when this file changes. To update immediately, open Tampermonkey's dashboard, find the script, and click **Check for userscript updates**.
