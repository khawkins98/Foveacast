// Controls: duration picker, opacity slider, view toggle, download button.
//
// This module owns *only* the controls that live alongside the output
// — the dropzone, status banner, and mobile guard are separate
// modules glued together in main.js. Every input element gets a
// proper <label for="…"> pairing so screen readers announce them
// correctly, and every handler fires with a normalised value shape
// so the caller never has to sniff event.target.

import { DURATIONS, DURATION_LABELS, DEFAULT_DURATION } from '../model/loader.js';
import { iconTimer, iconTune, iconLayers, iconDownload } from './icons.js';

/**
 * @typedef {'overlay'|'original'|'sidebyside'} ViewMode
 */

/**
 * @typedef {import('../model/loader.js').Duration} Duration
 */

const VIEW_CHOICES = /** @type {const} */ ([
  { value: 'overlay', label: 'Heatmap overlay' },
  { value: 'original', label: 'Original screenshot' },
  { value: 'sidebyside', label: 'Side-by-side' },
]);

/**
 * Monotonically increasing counter so multiple `createControls`
 * instances on the same page (tests, future comparison UI) produce
 * unique element IDs and their label/for pairings do not collide.
 */
let instanceCount = 0;

/**
 * @typedef {Object} ControlsOptions
 * @property {(duration: Duration) => void} [onDurationChange]
 * @property {(opacity: number) => void} [onOpacityChange]
 * @property {(view: ViewMode) => void} [onViewChange]
 * @property {() => void} [onDownload]
 */

/**
 * @typedef {Object} ControlsController
 * @property {HTMLElement} element
 * @property {(duration: Duration) => void} setDuration
 * @property {(view: ViewMode) => void} setView
 * @property {(value: number) => void} setOpacity
 * @property {(disabled: boolean) => void} setDisabled
 * @property {(visible: boolean) => void} setVisible
 * @property {(loading: boolean) => void} setDurationLoading
 * @property {(duration: Duration, status: 'idle' | 'loading' | 'ready' | 'failed') => void} setDurationStatus
 */

/**
 * Build the controls panel.
 *
 * WHY this takes all callbacks at once rather than exposing an
 * EventTarget: the caller (main.js) needs to coordinate changes, and
 * keeping the plumbing as plain function refs keeps the wiring in
 * one visible place.
 *
 * @param {ControlsOptions} [options]
 * @returns {ControlsController}
 */
export function createControls(options = {}) {
  const { onDurationChange, onOpacityChange, onViewChange, onDownload } = options;

  const id = ++instanceCount;
  const prefix = `fc-ctl-${id}`;

  const root = document.createElement('section');
  root.className = 'fc-controls';
  root.setAttribute('aria-label', 'Heatmap controls');

  // --- Duration picker -------------------------------------------------
  //
  // Three viewing-window options. Radio buttons (not a select) because
  // the user will likely compare results across durations and keeping
  // all options visible reduces the click cost of switching.

  const durationWrap = document.createElement('fieldset');
  durationWrap.className = 'fc-controls__field fc-controls__field--group fc-controls__duration';

  const durationLegend = document.createElement('legend');
  const durationIcon = document.createElement('span');
  durationIcon.className = 'fc-controls__icon';
  durationIcon.setAttribute('aria-hidden', 'true');
  durationIcon.innerHTML = iconTimer;
  durationLegend.appendChild(durationIcon);
  durationLegend.appendChild(document.createTextNode('Viewing duration'));
  durationWrap.appendChild(durationLegend);

  /** @type {HTMLInputElement[]} */
  const durationInputs = [];
  /** @type {Map<string, HTMLElement>} */
  const durationOptionEls = new Map();
  const durationGroupName = `${prefix}-duration`;

  for (const dur of DURATIONS) {
    const option = document.createElement('label');
    option.className = 'fc-controls__radio';
    // Store a reference to each duration label so setDurationStatus can
    // add a data-status attribute for the loading/ready/failed indicators.
    durationOptionEls.set(dur, option);

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = durationGroupName;
    radio.value = dur;
    radio.id = `${prefix}-dur-${dur}`;
    if (dur === DEFAULT_DURATION) radio.checked = true;
    radio.addEventListener('change', () => {
      if (radio.checked && onDurationChange) {
        onDurationChange(/** @type {Duration} */ (radio.value));
      }
    });
    durationInputs.push(radio);

    option.appendChild(radio);
    option.appendChild(document.createTextNode(` ${DURATION_LABELS[dur]}`));
    durationWrap.appendChild(option);
  }

  // Loading indicator shown while a new model is downloading.
  // why: we toggle textContent rather than the hidden attribute so the
  // element stays in the accessibility tree — screen readers only
  // announce aria-live changes on elements they can see, and hidden
  // removes the element entirely.
  const durationLoadingHint = document.createElement('span');
  durationLoadingHint.className = 'fc-controls__duration-loading';
  durationLoadingHint.textContent = '';
  durationLoadingHint.setAttribute('aria-live', 'polite');
  durationWrap.appendChild(durationLoadingHint);

  root.appendChild(durationWrap);

  // --- Opacity slider ------------------------------------------------
  //
  // Range inputs live on 0–100 because browsers render integer ticks
  // more cleanly than arbitrary floats. We convert to 0–1 before
  // firing the callback so the render layer never has to remember the
  // scale.

  const opacityWrap = document.createElement('div');
  opacityWrap.className = 'fc-controls__field';

  const opacityLabel = document.createElement('label');
  opacityLabel.htmlFor = `${prefix}-opacity`;
  const opacityIcon = document.createElement('span');
  opacityIcon.className = 'fc-controls__icon';
  opacityIcon.setAttribute('aria-hidden', 'true');
  opacityIcon.innerHTML = iconTune;
  opacityLabel.appendChild(opacityIcon);
  // Verb-first labels: the user is acting on the heatmap, not
  // contemplating a property. Nudges the controls from "settings
  // panel" feel toward "live controls" feel.
  opacityLabel.appendChild(document.createTextNode('Adjust overlay strength'));
  opacityWrap.appendChild(opacityLabel);

  const opacityInput = document.createElement('input');
  opacityInput.type = 'range';
  opacityInput.min = '0';
  opacityInput.max = '100';
  opacityInput.value = '60';
  opacityInput.step = '1';
  opacityInput.id = `${prefix}-opacity`;
  opacityInput.className = 'fc-controls__slider';
  // Announce the live value to screen readers via aria-valuetext so
  // the percentage is read out instead of the raw 0–100 integer.
  opacityInput.setAttribute('aria-valuetext', '60%');
  opacityWrap.appendChild(opacityInput);

  const opacityReadout = document.createElement('span');
  opacityReadout.className = 'fc-controls__readout';
  opacityReadout.setAttribute('aria-hidden', 'true');
  opacityReadout.textContent = '60%';
  opacityWrap.appendChild(opacityReadout);

  opacityInput.addEventListener('input', () => {
    const pct = Number(opacityInput.value);
    opacityReadout.textContent = `${pct}%`;
    opacityInput.setAttribute('aria-valuetext', `${pct}%`);
    if (onOpacityChange) onOpacityChange(pct / 100);
  });

  root.appendChild(opacityWrap);

  // --- View toggle (radio group) ------------------------------------
  //
  // Radio buttons rather than a select because the three options
  // benefit from being permanently visible — the user is likely to
  // cycle between them while reviewing.

  const viewWrap = document.createElement('fieldset');
  viewWrap.className = 'fc-controls__field fc-controls__field--group';
  const viewLegend = document.createElement('legend');
  const viewIcon = document.createElement('span');
  viewIcon.className = 'fc-controls__icon';
  viewIcon.setAttribute('aria-hidden', 'true');
  viewIcon.innerHTML = iconLayers;
  viewLegend.appendChild(viewIcon);
  viewLegend.appendChild(document.createTextNode('Show'));
  viewWrap.appendChild(viewLegend);

  /** @type {HTMLInputElement[]} */
  const viewInputs = [];
  const viewGroupName = `${prefix}-view`;

  for (const choice of VIEW_CHOICES) {
    const option = document.createElement('label');
    option.className = 'fc-controls__radio';

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = viewGroupName;
    radio.value = choice.value;
    radio.id = `${prefix}-view-${choice.value}`;
    if (choice.value === 'overlay') radio.checked = true;
    radio.addEventListener('change', () => {
      if (radio.checked && onViewChange) {
        onViewChange(/** @type {ViewMode} */ (radio.value));
      }
    });
    viewInputs.push(radio);

    option.appendChild(radio);
    option.appendChild(document.createTextNode(` ${choice.label}`));
    viewWrap.appendChild(option);
  }

  root.appendChild(viewWrap);

  // --- Download button ----------------------------------------------

  const downloadBtn = document.createElement('button');
  downloadBtn.type = 'button';
  downloadBtn.className = 'fc-controls__download';
  downloadBtn.setAttribute('aria-label', 'Download heatmap as PNG');
  const dlIcon = document.createElement('span');
  dlIcon.setAttribute('aria-hidden', 'true');
  dlIcon.innerHTML = iconDownload;
  downloadBtn.appendChild(dlIcon);
  downloadBtn.appendChild(document.createTextNode('Download PNG'));
  downloadBtn.addEventListener('click', () => {
    if (onDownload) onDownload();
  });
  root.appendChild(downloadBtn);

  // --- Controller API -----------------------------------------------

  /** @param {Duration} duration */
  function setDuration(duration) {
    for (const input of durationInputs) {
      input.checked = input.value === duration;
    }
  }

  /** @param {ViewMode} view */
  function setView(view) {
    for (const input of viewInputs) {
      input.checked = input.value === view;
    }
  }

  /** @param {number} value - Opacity in `[0, 1]`. */
  function setOpacity(value) {
    const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
    opacityInput.value = String(pct);
    opacityReadout.textContent = `${pct}%`;
    opacityInput.setAttribute('aria-valuetext', `${pct}%`);
  }

  /** @param {boolean} disabled */
  function setDisabled(disabled) {
    const d = !!disabled;
    opacityInput.disabled = d;
    downloadBtn.disabled = d;
    for (const input of viewInputs) input.disabled = d;
    for (const input of durationInputs) input.disabled = d;
    root.classList.toggle('fc-controls--disabled', d);
  }

  /**
   * Show or hide the whole controls panel. Used for progressive
   * disclosure: before there is anything to control (no dropped file,
   * no demo render), these controls are noise. We toggle the `hidden`
   * attribute rather than `display:none` so the accessibility tree
   * honours the change without CSS-only tricks.
   *
   * @param {boolean} visible
   */
  function setVisible(visible) {
    root.hidden = !visible;
  }

  /**
   * Show or hide the "Loading model…" hint next to the duration picker.
   * Communicates that a model switch is in progress without disabling
   * the entire controls panel.
   *
   * @param {boolean} loading
   */
  function setDurationLoading(loading) {
    durationLoadingHint.textContent = loading ? 'Loading model…' : '';
  }

  /**
   * Set the status indicator for a specific duration option.
   * Used by the background-loading path to signal which durations have
   * cached results available without a model reload.
   *
   * @param {Duration} duration
   * @param {'idle' | 'loading' | 'ready' | 'failed'} statusValue
   */
  function setDurationStatus(duration, statusValue) {
    const el = durationOptionEls.get(duration);
    if (!el) return;
    // Setting via dataset lets CSS use [data-status="…"] attribute selectors
    // to show/hide the spinner or checkmark pseudo-element.
    el.dataset.status = statusValue;
  }

  return {
    element: root,
    setDuration,
    setView,
    setOpacity,
    setDisabled,
    setVisible,
    setDurationLoading,
    setDurationStatus,
  };
}
