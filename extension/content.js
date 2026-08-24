// ponytail: everything runs off one MutationObserver plus the input event
// it's already wired to, including the wrong-answer colour hint - no need
// to intercept the submit itself, just show red/green before they press Enter.

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

function onUnitPathChange() {
  const path = location.pathname;
  if (path === lastUnitPath) return;
  lastUnitPath = path;
  currentUnitIsListening = false;
  refreshUnitsToday();
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

// After 2 wrong answers in a unit, colour what they're typing red/green
// against the correct answer, live, so they see it before they submit.
// No interception of the submit itself - the site's own handling still
// decides what happens when they press Enter.
function applyWrongAnswerHint() {
  const input = document.querySelector('input.answer-field');
  if (!input) return;
  if (!settings.limitWrongAnswers) {
    if (input.style.color) input.style.color = '';
    return;
  }

  // The pager pre-colours not-yet-reached questions using last attempt's
  // result, so only questions before the current one reflect this attempt.
  const pagerButtons = Array.from(document.querySelectorAll('.pager-button'));
  const activeIndex = pagerButtons.findIndex((b) => b.classList.contains('active'));
  const answered = activeIndex === -1 ? pagerButtons : pagerButtons.slice(0, activeIndex);
  const wrongCount = answered.filter((b) => b.classList.contains('wrong')).length;

  const correct = getCorrectAnswer();
  const typed = Number(input.value);
  const isCorrect = !Number.isNaN(typed) && roundTo3(typed) === correct;
  const shouldHint = wrongCount >= 2 && correct !== null && input.value.trim() !== '';
  const color = shouldHint ? (isCorrect ? 'green' : 'red') : '';
  if (input.style.color !== color) input.style.color = color;
}

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
  if (!currentUnitIsListening) return;
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

// Replaces the language selector in the navbar with a count of units
// finished today, read from the same API the site's own profile page uses.
let unitsToday = null;

function localDateStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function refreshUnitsToday() {
  const appEl = document.getElementById('app');
  const vm = appEl && appEl.__vue__;
  const token = vm && vm.$store && vm.$store.state.account && vm.$store.state.account.access_token;
  if (!token) return;
  try {
    const res = await fetch('https://api.abacusmentalmath.com/profile/units-finished/week/0', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return;
    const json = await res.json();
    const today = localDateStr();
    const entry = (json.data || []).find((d) => d.day === today);
    unitsToday = entry ? entry.amount : 0;
    applyUnitsTodayDisplay();
  } catch (e) {
    // offline, or the API shape changed - leave whatever was last shown
  }
}

// The language toggle's BootstrapVue-generated id isn't stable across
// renders, so find it by the locale-code text on its toggle span instead.
function findLanguageToggleWrapper() {
  const span = Array.from(document.querySelectorAll('span[title]')).find(
    (s) => /^[a-z]{2}-[A-Z]{2}$/.test(s.getAttribute('title')) && s.closest('[role="button"]'),
  );
  return span ? span.closest('.b-dropdown') : null;
}

function applyUnitsTodayDisplay() {
  // Re-hide every pass, in case Vue ever re-creates the dropdown fresh -
  // guarded so this is a no-op once it's already hidden.
  const wrapper = findLanguageToggleWrapper();
  if (wrapper && wrapper.style.display !== 'none') wrapper.style.display = 'none';

  let display = document.getElementById('abacus-ext-units-today');
  if (!display) {
    if (!wrapper) return; // wait until the toggle exists so we can anchor next to it
    display = document.createElement('span');
    display.id = 'abacus-ext-units-today';
    display.style.cssText = 'font-family:poppins,sans-serif;font-weight:500;padding:0 0.75rem;white-space:nowrap;';
    wrapper.insertAdjacentElement('afterend', display);
  }

  const text = unitsToday === null ? '' : `Units today: ${unitsToday}`;
  if (display.textContent !== text) display.textContent = text;
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
  applyWrongAnswerHint();
  applyPlayAgainButton();
  applySpeedMemory();
  applyUnitsTodayDisplay();
}

chrome.storage.sync.get(DEFAULTS, (stored) => {
  settings = { ...DEFAULTS, ...stored };
  applyAll();
  refreshUnitsToday();
});

chrome.storage.onChanged.addListener((changes) => {
  for (const [key, { newValue }] of Object.entries(changes)) {
    if (key in settings) settings[key] = newValue;
  }
  applyAll();
});

new MutationObserver(applyAll).observe(document.body, { childList: true, subtree: true, characterData: true });
document.addEventListener('input', applyAll, true);
