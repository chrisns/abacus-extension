const DEFAULTS = { hideTimer: true, limitWrongAnswers: true, playAgainButton: true };
const ids = Object.keys(DEFAULTS);

chrome.storage.sync.get(DEFAULTS, (settings) => {
  for (const id of ids) document.getElementById(id).checked = settings[id];
});

for (const id of ids) {
  document.getElementById(id).addEventListener('change', (e) => {
    chrome.storage.sync.set({ [id]: e.target.checked });
  });
}
