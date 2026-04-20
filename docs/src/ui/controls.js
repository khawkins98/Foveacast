// Controls: opacity slider, view toggle, download button.
//
// Duration selection lives in the report section (duration tabs above the
// hero canvas). Overlay visualizations (fixation sequence, attention zones,
// centroid trajectory) are shown as static sections in the report rather
// than as interactive checkboxes here. This module owns the interactive
// canvas controls only.
//
// Every input element gets a proper <label for="…"> pairing so screen readers
// announce them correctly, and every handler fires with a normalised value
// shape so the caller never has to sniff event.target.

import { iconTune, iconLayers, iconDownload } from './icons.js';

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
 * @property {(opacity: number) => void} [onOpacityChange]
 * @property {(view: ViewMode) => void} [onViewChange]
 * @property {() => void} [onDownload]
 */

/**
 * @typedef {Object} ControlsController
 * @property {HTMLElement} element
 * @property {(duration: Duration) => void} setDuration        - No-op; duration tabs moved to report.
 * @property {(view: ViewMode) => void} setView
 * @property {(value: number) => void} setOpacity
 * @property {(disabled: boolean) => void} setDisabled
 * @property {(visible: boolean) => void} setVisible
 * @property {(loading: boolean) => void} setDurationLoading   - No-op; duration tabs moved to report.
 * @property {(duration: Duration, status: 'idle' | 'loading' | 'ready' | 'failed') => void} setDurationStatus - No-op; duration tabs moved to report.
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
  const { onOpacityChange, onViewChange, onDownload } = options;

  const id = ++instanceCount;
  const prefix = `fc-ctl-${id}`;

  const root = document.createElement('section');
  root.className = 'fc-controls';
  root.setAttribute('aria-label', 'Heatmap controls');

  // --- Opacity slider ------------------------------------------------
  //
  // Range inputs live on 0–100 because browsers render integer ticks
  // more cleanly than arbitrary floats. We convert to 0–1 before
  // firing the callback so the render layer never has to remember the
  // scale.

  const opacityWrap = document.createElement('div');
  opacityWrap.className = 'fc-controls__field fc-controls__field--opacity';

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

  // --- View toggle (radio group) ------------------------------------
  //
  // Moved before the opacity slider so the two most-used comparison
  // controls (duration + view mode) sit adjacent at the top. Opacity
  // and blend are shown/hidden based on whether the overlay is active
  // — they are only relevant when a heatmap is composited on screen.

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
      if (radio.checked) {
        updateOverlayControlVisibility(/** @type {ViewMode} */ (radio.value));
        if (onViewChange) onViewChange(/** @type {ViewMode} */ (radio.value));
      }
    });
    viewInputs.push(radio);

    option.appendChild(radio);
    option.appendChild(document.createTextNode(` ${choice.label}`));
    viewWrap.appendChild(option);
  }

  root.appendChild(viewWrap);

  // --- Opacity/blend visibility helper --------------------------------
  //
  // Opacity and blend mode only affect the composited heatmap overlay.
  // When the user switches to "Original screenshot" there is nothing
  // to compose, so these controls are hidden to reduce noise.
  // "Side-by-side" still renders a composited canvas on the right,
  // so opacity and blend remain available there.

  /**
   * Show/hide opacity and blend controls based on the active view.
   * @param {ViewMode} view
   */
  function updateOverlayControlVisibility(view) {
    const hidden = view === 'original';
    opacityWrap.hidden = hidden;
  }

  root.appendChild(opacityWrap);

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
  function setDuration(_duration) {} // no-op: duration tabs moved to report section

  /** @param {ViewMode} view */
  function setView(view) {
    for (const input of viewInputs) {
      input.checked = input.value === view;
    }
    updateOverlayControlVisibility(view);
  }

  /** @param {number} value - Opacity in `[0, 1]`. */
  function setOpacity(value) {
    const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
    opacityInput.value = String(pct);
    opacityReadout.textContent = `${pct}%`;
    opacityInput.setAttribute('aria-valuetext', `${pct}%`);
  }

  /** @param {string} _mode - no-op: blend mode removed. */
  function setBlendMode(_mode) {}

  /** @param {boolean} disabled */
  function setDisabled(disabled) {
    const d = !!disabled;
    opacityInput.disabled = d;
    downloadBtn.disabled = d;
    for (const input of viewInputs) input.disabled = d;
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

  function setDurationLoading(_loading) {} // no-op: duration tabs moved to report section

  /**
   * @param {Duration} _duration
   * @param {'idle' | 'loading' | 'ready' | 'failed'} _status
   */
  function setDurationStatus(_duration, _status) {} // no-op: duration tabs moved to report section

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
