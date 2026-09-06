// ==UserScript==
// @name         Abacus Mental Math Helper
// @namespace    https://github.com/chrisns/abacus-extension
// @version      1.8.0
// @description  Hide the timer, colour and double-check wrong answers, remember speed settings, add a play-again button, and show units done today, on client.abacusmentalmath.com
// @author       Chris Nesbitt-Smith
// @match        https://client.abacusmentalmath.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/chrisns/abacus-extension/main/abacus-mental-math-helper.user.js
// @updateURL    https://raw.githubusercontent.com/chrisns/abacus-extension/main/abacus-mental-math-helper.user.js
// ==/UserScript==

// ponytail: everything runs off one MutationObserver plus the input event
// it's already wired to, including the wrong-answer colour hint that shows
// amber/red/green before they press Enter. The only thing intercepted is the
// Enter key itself, and only to make a wrong answer take a second press.

(function () {
  'use strict';

  const DEFAULTS = {
    hideTimer: true,
    limitWrongAnswers: true,
    // How many wrong answers they're allowing themselves in a unit before the
    // hints start. Set in the navbar, so it can be changed between units.
    wrongAllowance: 1,
    playAgainButton: true,
    voiceSpeed: null,
    timeoutSpeed: null,
  };

  const settings = {};
  for (const key of Object.keys(DEFAULTS)) {
    settings[key] = GM_getValue(key, DEFAULTS[key]);
  }
  // A stored allowance from an older version, or a hand-edited one, still has
  // to be a whole number the comparisons below can trust.
  settings.wrongAllowance = clampAllowance(settings.wrongAllowance);

  // Toolbar popup checkboxes become Tampermonkey menu commands instead -
  // click the Tampermonkey icon to see them. Labels reflect current state,
  // so a toggle reloads the page to pick the new label back up.
  const TOGGLES = [
    ['hideTimer', 'Hide the timer'],
    ['limitWrongAnswers', 'Answer hints: colour and double Enter'],
    ['playAgainButton', 'Add a play-again button'],
  ];
  for (const [key, label] of TOGGLES) {
    const mark = settings[key] ? '✅' : '⬜';
    GM_registerMenuCommand(`${mark} ${label}`, () => {
      GM_setValue(key, !settings[key]);
      location.reload();
    });
  }

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
    resetEnterGuard();
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

  // The end-of-unit summary shows "Your time: <b>00:00:00</b>" as plain text,
  // no dedicated class, so match on the label text instead. Doubles as the
  // marker for "the unit just finished".
  function summaryTimeParagraphs() {
    return Array.from(document.querySelectorAll('p')).filter((p) => p.textContent.trim().startsWith('Your time:'));
  }

  function applyTimerVisibility() {
    const hide = settings.hideTimer;
    document.querySelectorAll('.time').forEach((el) => {
      el.style.visibility = hide ? 'hidden' : '';
    });
    summaryTimeParagraphs().forEach((p) => {
      const b = p.querySelector('b');
      if (b) b.style.visibility = hide ? 'hidden' : '';
    });
  }

  // The correct answer for a listening/Anzan question is the sum of
  // currentParticle.value (each entry is a signed number dictated in turn) -
  // read straight from the page's Vuex store, exposed on the #app element.
  // Only "add" type units are supported; anything else returns null and the
  // hint is skipped, leaving the site's own handling untouched.
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

  // Amber is the first nudge, red the escalation: once they've used up the
  // wrong answers they allowed themselves, a wrong entry shows amber, and
  // every wrong answer past the allowance shows red. A correct entry is green
  // either way.
  const HINT_AMBER = '#e69500';

  // A hex colour doesn't round-trip through style.color, so the guard that
  // stops a write re-triggering the MutationObserver can't compare against it.
  // Remember what was last written on the element instead - a plain property,
  // so no DOM mutation, and it's gone if Vue swaps in a fresh input. Still
  // re-write when the colour was cleared underneath us.
  function setHintColor(input, color) {
    if (input._abacusHintColor === color && (color === '' || input.style.color !== '')) return;
    input.style.color = color;
    input._abacusHintColor = color;
  }

  // What's typed, how many they've got wrong so far, and whether the hint is
  // live for this question. Read in one place so the colour and the Enter
  // guard below can never disagree about it.
  function readHintState(input) {
    // The pager pre-colours not-yet-reached questions using last attempt's
    // result, so only questions before the current one reflect this attempt.
    // With no active question nothing counts as answered: the whole pager is
    // pre-coloured from the last attempt, and counting it would open the hint
    // on question 1 of a re-run before anything had been got wrong.
    const pagerButtons = Array.from(document.querySelectorAll('.pager-button'));
    const activeIndex = pagerButtons.findIndex((b) => b.classList.contains('active'));
    const answered = activeIndex === -1 ? [] : pagerButtons.slice(0, activeIndex);
    const wrongCount = answered.filter((b) => b.classList.contains('wrong')).length;

    const correct = getCorrectAnswer();
    const typed = Number(input.value);
    return {
      wrongCount,
      hasValue: input.value.trim() !== '',
      isCorrect: !Number.isNaN(typed) && roundTo3(typed) === correct,
      // Nothing is live until the allowance is used up, and nothing is live on
      // a unit whose answer can't be read from the store.
      hintsLive: wrongCount >= settings.wrongAllowance && correct !== null,
    };
  }

  // Once the allowance is used up, colour what they're typing against the
  // correct answer, live, so they see it before they submit. The site's own
  // handling still decides what happens once the answer is submitted.
  function applyWrongAnswerHint() {
    const input = document.querySelector('input.answer-field');
    if (!input) return;
    if (!settings.limitWrongAnswers) {
      setHintColor(input, '');
      return;
    }

    const state = readHintState(input);

    // An empty field is a question not yet answered: nothing typed, nothing armed.
    if (!state.hasValue) resetEnterGuard();

    const shouldHint = state.hintsLive && state.hasValue;
    const wrongColor = state.wrongCount > settings.wrongAllowance ? 'red' : HINT_AMBER;
    const color = shouldHint ? (state.isCorrect ? 'green' : wrongColor) : '';
    setHintColor(input, color);
  }

  // Once the hint is live, submitting a wrong answer takes two presses of
  // Enter: the first is swallowed and the field shakes, so a hurried press
  // doesn't spend the attempt before they've looked at the amber or red
  // they're typing. A correct answer, or a unit whose answer can't be read,
  // submits on the first press as it always did.
  let enterArmed = false;
  // The site leaves the submitted answer sitting in the field afterwards, and
  // Enter then means "on to the next question" rather than "submit this" - so
  // the guard only applies to something typed since the last submit, or moving
  // on would cost two presses and a shake of its own.
  let typedSinceSubmit = false;
  let swallowingEnterPress = false;

  function resetEnterGuard() {
    enterArmed = false;
    typedSinceSubmit = false;
  }

  document.addEventListener(
    'input',
    (e) => {
      if (!e.target || !e.target.classList || !e.target.classList.contains('answer-field')) return;
      // Freshly typed, even if it's the same digits as last time: arm again.
      typedSinceSubmit = true;
      enterArmed = false;
    },
    true,
  );

  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Enter') return;

      // Auto-repeat from a held key is the same press, so it can never be the
      // second one - it would otherwise submit half a second into one press.
      if (e.repeat) {
        if (swallowingEnterPress) {
          e.preventDefault();
          e.stopPropagation();
        }
        return;
      }

      // Any fresh press clears the flag, in case the keyup that normally clears
      // it never arrived (the window lost focus while Enter was held); a stale
      // flag would eat the next Enter anywhere on the site.
      swallowingEnterPress = false;
      if (!settings.limitWrongAnswers) return;
      const input = document.querySelector('input.answer-field');
      if (!input || e.target !== input) return;

      const state = readHintState(input);
      const needsSecondPress = typedSinceSubmit && state.hintsLive && state.hasValue && !state.isCorrect;
      if (!needsSecondPress || enterArmed) {
        // This press goes through, so whatever it leaves in the field is the
        // site's now, not a typed answer waiting to be submitted.
        resetEnterGuard();
        return;
      }

      enterArmed = true;
      swallowingEnterPress = true;
      e.preventDefault();
      e.stopPropagation();
      shakeInput(input);
    },
    true,
  );

  // Vue may be listening on keypress or keyup rather than keydown, and
  // preventDefault on keydown doesn't stop either of those - so swallow the
  // rest of the same key press too.
  for (const type of ['keypress', 'keyup']) {
    document.addEventListener(
      type,
      (e) => {
        if (e.key !== 'Enter' || !swallowingEnterPress) return;
        if (type === 'keyup') swallowingEnterPress = false;
        e.preventDefault();
        e.stopPropagation();
      },
      true,
    );
  }

  const SHAKE_STYLE_ID = 'abacus-ext-shake-style';

  function shakeInput(input) {
    if (!document.getElementById(SHAKE_STYLE_ID)) {
      const style = document.createElement('style');
      style.id = SHAKE_STYLE_ID;
      style.textContent =
        '@keyframes abacus-ext-shake{10%,90%{transform:translateX(-3px)}30%,70%{transform:translateX(5px)}50%{transform:translateX(-5px)}}' +
        '.abacus-ext-shake{animation:abacus-ext-shake 0.3s ease-in-out;}';
      (document.head || document.documentElement).appendChild(style);
    }
    // Restart the animation rather than ignore a second press mid-shake.
    input.classList.remove('abacus-ext-shake');
    void input.offsetWidth;
    input.classList.add('abacus-ext-shake');
    input.addEventListener('animationend', () => input.classList.remove('abacus-ext-shake'), { once: true });
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
      settings.voiceSpeed = sliders[0].value;
      settings.timeoutSpeed = sliders[1].value;
      GM_setValue('voiceSpeed', settings.voiceSpeed);
      GM_setValue('timeoutSpeed', settings.timeoutSpeed);
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

  // Finishing a unit doesn't change the route - the summary renders on the
  // same URL - so the path-change refresh alone leaves a stale count sitting
  // there for the rest of the session. Refresh when the summary appears, and
  // poll as well so a unit finished in another tab shows up too.
  const UNITS_POLL_MS = 60000;
  let summaryWasVisible = false;

  function watchForUnitFinish() {
    const visible = summaryTimeParagraphs().length > 0;
    if (visible && !summaryWasVisible) {
      refreshUnitsToday();
      // The server may not have counted the finish yet when the summary
      // paints, so ask once more a moment later.
      setTimeout(refreshUnitsToday, 2500);
    }
    summaryWasVisible = visible;
  }

  function localDateStr(d = new Date()) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  // The finish-time refresh, its retry and the poll can be in flight together,
  // and a slow earlier reply landing last would put the stale count back up -
  // so only the newest request is allowed to write the count.
  let unitsRequestId = 0;

  async function refreshUnitsToday() {
    const appEl = document.getElementById('app');
    const vm = appEl && appEl.__vue__;
    const token = vm && vm.$store && vm.$store.state.account && vm.$store.state.account.access_token;
    if (!token) return;
    const requestId = ++unitsRequestId;
    try {
      const res = await fetch('https://api.abacusmentalmath.com/profile/units-finished/week/0', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const json = await res.json();
      if (requestId !== unitsRequestId) return;
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

  // The allowance lives in the navbar next to the logo rather than in the
  // Tampermonkey menu, so it can be changed between units - the point is to
  // pick a target for the next unit ("no wrong answers this time") and see the
  // hints arrive when it's spent.
  const ALLOWANCE_ID = 'abacus-ext-allowance';

  function clampAllowance(value) {
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.min(n, 99);
  }

  // The navbar brand is the logo; the units-today span is the fallback anchor
  // so the box still turns up if that markup ever changes.
  function findAllowanceAnchor() {
    return document.querySelector('.navbar-brand') || document.getElementById('abacus-ext-units-today');
  }

  function applyAllowanceControl() {
    const existing = document.getElementById(ALLOWANCE_ID);
    if (!settings.limitWrongAnswers) {
      if (existing) existing.remove();
      return;
    }
    if (existing) {
      // Don't overwrite what they're part-way through typing; the stored
      // setting is what the hint reads either way.
      const field = existing.querySelector('input');
      const stored = String(settings.wrongAllowance);
      if (document.activeElement !== field && field.value !== stored) field.value = stored;
      return;
    }

    const anchor = findAllowanceAnchor();
    if (!anchor) return;

    const wrap = document.createElement('span');
    wrap.id = ALLOWANCE_ID;
    wrap.style.cssText =
      'display:inline-flex;align-items:center;gap:0.4rem;font-family:poppins,sans-serif;font-weight:500;padding:0 0.75rem;white-space:nowrap;';

    const label = document.createElement('label');
    label.setAttribute('for', `${ALLOWANCE_ID}-input`);
    label.textContent = 'Wrong answers allowed:';
    label.style.cssText = 'margin:0;';

    const field = document.createElement('input');
    field.id = `${ALLOWANCE_ID}-input`;
    field.type = 'number';
    field.min = '0';
    field.max = '99';
    field.step = '1';
    field.value = String(settings.wrongAllowance);
    field.style.cssText =
      'width:3.5rem;padding:0.1rem 0.3rem;border:1px solid #ccc;border-radius:4px;background:#fff;color:#333;font:inherit;';

    field.addEventListener('input', () => {
      settings.wrongAllowance = clampAllowance(field.value);
      GM_setValue('wrongAllowance', settings.wrongAllowance);
      applyWrongAnswerHint();
    });
    // Tidy a blank or out-of-range box up once they're done with it, rather
    // than yanking the value around mid-keystroke.
    field.addEventListener('blur', () => {
      field.value = String(settings.wrongAllowance);
    });

    wrap.append(label, field);
    anchor.insertAdjacentElement('afterend', wrap);
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
    watchForUnitFinish();
    applyUnitsTodayDisplay();
    applyAllowanceControl();
  }

  applyAll();
  refreshUnitsToday();
  setInterval(refreshUnitsToday, UNITS_POLL_MS);

  new MutationObserver(applyAll).observe(document.body, { childList: true, subtree: true, characterData: true });
  document.addEventListener('input', applyAll, true);
})();
