// ponytail: one MutationObserver drives DOM-shape features; the wrong-answer
// check hooks the keyboard directly since it must run before the site's own
// submit handler, not after the DOM has already changed.

const DEFAULTS = {
  hideTimer: true,
  limitWrongAnswers: true,
  playAgainButton: true,
  voiceSpeed: null,
  timeoutSpeed: null,
};
let settings = { ...DEFAULTS };

// Latched per-unit: set true whenever the "Listen and Answer" heading is seen
// during the current unit, so the end-of-unit screen knows whether to offer
// Play again. Covers Listening Abacus and Listening Anzan, which share this
// heading and component; Reading Abacus does not use it.
let currentUnitIsListening = false;
let lastUnitPath = null;
let unitWrongAttempts = 0;

function onUnitPathChange() {
  const path = location.pathname;
  if (path === lastUnitPath) return;
  lastUnitPath = path;
  currentUnitIsListening = false;
  unitWrongAttempts = 0;
}

// Remembers which unit-number button was last clicked on the topic list, so
// Play again can re-select the same unit. A direct SPA route change back to
// the same unit URL leaves the exercise half-rendered - re-clicking through
// the real UI is what reliably works.
let lastChosenUnit = null;
document.addEventListener(
  'click',
  (e) => {
    const btn = e.target.closest('div[id^="collapsed-"] button');
    if (!btn || !/^\d+$/.test(btn.textContent.trim())) return;
    const panel = btn.closest('div[id^="collapsed-"]');
    lastChosenUnit = { topicId: panel.id.replace('collapsed-', ''), unitNumber: btn.textContent.trim() };
  },
  true,
);

function applyTimerVisibility() {
  const hide = settings.hideTimer;
  document.querySelectorAll('.time').forEach((el) => {
    el.style.visibility = hide ? 'hidden' : '';
  });
  // The end-of-unit summary shows "Your time: <b>00:00:00</b>" as plain text,
  // no dedicated class, so match on the label text instead.
  document.querySelectorAll('p').forEach((p) => {
    if (p.textContent.trim().startsWith('Your time:')) {
      const b = p.querySelector('b');
      if (b) b.style.visibility = hide ? 'hidden' : '';
    }
  });
}

// The correct answer for a listening/Anzan question is the sum of
// currentParticle.value (each entry is a signed number dictated in turn) -
// read straight from the page's Vuex store, exposed on the #app element.
// Only "add" type units are supported; anything else returns null and the
// keyboard hook lets the site's own handling proceed untouched.
function getCorrectAnswer() {
  const appEl = document.getElementById('app');
  const vm = appEl && appEl.__vue__;
  const particles = vm && vm.$store && vm.$store.state && vm.$store.state.particles;
  if (!particles || particles.topicOperation !== 'add') return null;
  const cp = particles.currentParticle;
  if (!cp || !Array.isArray(cp.value)) return null;
  const sum = cp.value.reduce((acc, v) => acc + Number(v), 0);
  return roundTo3(sum);
}

function roundTo3(n) {
  return Math.round(n * 1000) / 1000;
}

// Set by handleEnterKeydown for the current Enter press, then consulted by
// the keyup listener so a wrong answer is blocked on whichever of the two
// events the site actually listens to - without double-counting the attempt.
let blockCurrentEnter = false;

function handleEnterKeydown(e) {
  blockCurrentEnter = false;
  if (e.key !== 'Enter') return;
  const input = e.target;
  if (!input.classList || !input.classList.contains('answer-field')) return;
  if (!settings.limitWrongAnswers || input.disabled) return;

  const correct = getCorrectAnswer();
  if (correct === null) return; // can't validate this question type - let the site handle it

  const typed = Number(input.value);
  const isCorrect = !Number.isNaN(typed) && roundTo3(typed) === correct;
  if (isCorrect) return;

  blockCurrentEnter = true;
  e.preventDefault();
  e.stopImmediatePropagation();

  unitWrongAttempts += 1;
  if (unitWrongAttempts > 2) {
    input.disabled = true;
    input.blur();
  } else {
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

function handleEnterKeyupOrPress(e) {
  if (e.key !== 'Enter' || !blockCurrentEnter) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (e.type === 'keyup') blockCurrentEnter = false;
}

document.addEventListener('keydown', handleEnterKeydown, true);
document.addEventListener('keypress', handleEnterKeyupOrPress, true);
document.addEventListener('keyup', handleEnterKeyupOrPress, true);

function trackListeningHeading() {
  const heading = document.querySelector('.exercise-card h2, .exercise-card h5');
  if (heading && heading.textContent.trim() === 'Listen and Answer') {
    currentUnitIsListening = true;
  }
}

// The replay button is always present in the DOM as either "Listen" (fresh
// question) or "Next question" (after answering), one hidden via inline
// style. While there is no typed answer, show it as "Listen again" so a
// child who didn't hear the numbers can always replay them; once they've
// answered correctly and the site reveals "Next question" with something
// typed, leave it alone.
function applyListenAgainButton() {
  const input = document.querySelector('input.answer-field');
  if (!input) return;
  const buttons = Array.from(document.querySelectorAll('.exercise-card button'));
  const listenBtn = buttons.find((b) => ['Listen', 'Listen again'].includes(b.textContent.trim()));
  const nextBtn = buttons.find((b) => b.textContent.trim() === 'Next question');
  if (!listenBtn) return;

  // Guard every write: textContent/style writes fire the MutationObserver
  // that calls this function, so an unconditional write loops forever.
  if (input.value.trim() === '') {
    if (listenBtn.textContent.trim() !== 'Listen again') listenBtn.textContent = 'Listen again';
    if (listenBtn.style.display !== '') listenBtn.style.display = '';
    if (nextBtn && nextBtn.style.display !== 'none') nextBtn.style.display = 'none';
  } else if (listenBtn.textContent.trim() !== 'Listen') {
    listenBtn.textContent = 'Listen';
  }
}

function waitFor(check, timeoutMs = 5000, intervalMs = 150) {
  return new Promise((resolve) => {
    const start = Date.now();
    (function tick() {
      const result = check();
      if (result) return resolve(result);
      if (Date.now() - start > timeoutMs) return resolve(null);
      setTimeout(tick, intervalMs);
    })();
  });
}

function findButtonByText(root, text) {
  return Array.from(root.querySelectorAll('button')).find((b) => b.textContent.trim() === text);
}

// Remembers the two speed sliders in the Start dialog (voice speed, timeout
// speed) across page loads. The site itself keeps them for the rest of the
// current tab session but forgets them on the next visit.
const rangeValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
let speedDialogHandled = false;

function getSpeedSliders() {
  const sliders = Array.from(document.querySelectorAll('input[type="range"]'));
  return sliders.length >= 2 ? [sliders[0], sliders[1]] : null;
}

function setSliderValue(slider, value) {
  if (!value || slider.value === value) return;
  rangeValueSetter.call(slider, value);
  slider.dispatchEvent(new Event('input', { bubbles: true }));
  slider.dispatchEvent(new Event('change', { bubbles: true }));
}

// Vue may still be applying its own fetched defaults right as the dialog
// opens, which would clobber a value set too early - so re-apply a couple
// of times over the first half second rather than trusting a single pass.
async function applySpeedMemory() {
  if (!getSpeedSliders()) {
    speedDialogHandled = false;
    return;
  }
  if (speedDialogHandled) return;
  speedDialogHandled = true;

  for (const delay of [0, 200, 400]) {
    if (delay) await new Promise((r) => setTimeout(r, delay));
    const sliders = getSpeedSliders();
    if (!sliders) return;
    setSliderValue(sliders[0], settings.voiceSpeed);
    setSliderValue(sliders[1], settings.timeoutSpeed);
  }
}

// The DOM value stays in sync with Vue's state either way (dragging or the
// +/- buttons), so reading it at the moment START is pressed is enough -
// no need to reach into the Vue component for it.
document.addEventListener(
  'click',
  (e) => {
    const btn = e.target.closest('button');
    if (!btn || btn.textContent.trim() !== 'START') return;
    const sliders = getSpeedSliders();
    if (!sliders) return;
    chrome.storage.sync.set({ voiceSpeed: sliders[0].value, timeoutSpeed: sliders[1].value });
  },
  true,
);

async function restartCurrentUnit() {
  if (!lastChosenUnit) {
    location.reload();
    return;
  }
  const { topicId, unitNumber } = lastChosenUnit;

  const toList = findButtonByText(document, 'To list');
  if (toList) toList.click();

  // Wait for the unit button itself, not just the panel: the panel container
  // mounts before its unit buttons are fetched and rendered.
  const unitBtn = await waitFor(() => {
    const panel = document.getElementById(`collapsed-${topicId}`);
    return panel ? findButtonByText(panel, unitNumber) : null;
  });
  if (!unitBtn) return;
  unitBtn.click();

  const startBtn = await waitFor(() => {
    const b = findButtonByText(document, 'Start');
    return b && !b.disabled ? b : null;
  });
  if (!startBtn) return;
  startBtn.click();

  const startModalBtn = await waitFor(() => findButtonByText(document, 'START'));
  if (startModalBtn) startModalBtn.click();
}

function applyPlayAgainButton() {
  if (document.getElementById('abacus-ext-play-again')) return;
  if (!settings.playAgainButton || !currentUnitIsListening) return;

  const buttons = Array.from(document.querySelectorAll('.exercise-card button'));
  const toList = buttons.find((b) => b.textContent.trim() === 'To list');
  if (!toList || !toList.parentElement) return;

  const btn = document.createElement('button');
  btn.id = 'abacus-ext-play-again';
  btn.type = 'button';
  btn.className = toList.className;
  btn.textContent = 'Play again';
  btn.addEventListener('click', restartCurrentUnit);
  toList.parentElement.insertBefore(btn, toList);
}

function applyAll() {
  onUnitPathChange();
  applyTimerVisibility();
  trackListeningHeading();
  applyListenAgainButton();
  applyPlayAgainButton();
  applySpeedMemory();
}

chrome.storage.sync.get(DEFAULTS, (stored) => {
  settings = { ...DEFAULTS, ...stored };
  applyAll();
});

chrome.storage.onChanged.addListener((changes) => {
  for (const [key, { newValue }] of Object.entries(changes)) {
    if (key in settings) settings[key] = newValue;
  }
  applyAll();
});

new MutationObserver(applyAll).observe(document.body, { childList: true, subtree: true, characterData: true });
document.addEventListener('input', applyAll, true);
