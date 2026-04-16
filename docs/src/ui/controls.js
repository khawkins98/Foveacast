// Controls: opacity slider, view toggle, preset picker, download.
//
// This module owns *only* the controls that live alongside the output
// — the dropzone, status banner, and mobile guard are separate modules
// glued together in main.js (Phase D). Every input element gets a
// proper <label for="…"> pairing so screen readers announce them
// correctly, and every handler fires with a normalised value shape
// so the caller never has to sniff event.target.

/**
 * @typedef {'overlay'|'original'|'sidebyside'} ViewMode
 */

/**
 * @typedef {'very_low'|'low'|'medium'|'high'|'very_high'} Preset
 */

/** Human-readable preset labels, ordered fastest → slowest. */
const PRESET_CHOICES = /** @type {const} */ ([
  { value: 'very_low', label: 'Fast (very low)' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Standard' },
  { value: 'high', label: 'High' },
  { value: 'very_high', label: 'Very high (slowest)' },
]);

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
 * @property {(preset: Preset) => void} [onPresetChange]
 * @property {() => void} [onDownload]
 */

/**
 * @typedef {Object} ControlsController
 * @property {HTMLElement} element
 * @property {(preset: Preset) => void} setPreset
 * @property {(view: ViewMode) => void} setView
 * @property {(value: number) => void} setOpacity
 * @property {(disabled: boolean) => void} setDisabled
 * @property {(visible: boolean) => void} setVisible
 */

/**
 * Build the controls panel.
 *
 * WHY this takes all four callbacks at once rather than exposing an
 * EventTarget: the caller (main.js) needs to coordinate changes —
 * e.g. a new preset invalidates the current inference result — and
 * keeping the plumbing as plain function refs keeps the wiring in
 * Phase D's integration code visible in one place.
 *
 * @param {ControlsOptions} [options]
 * @returns {ControlsController}
 */
export function createControls(options = {}) {
  const {
    onOpacityChange,
    onViewChange,
    onPresetChange,
    onDownload,
  } = options;

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
  opacityWrap.className = 'fc-controls__field';

  const opacityLabel = document.createElement('label');
  opacityLabel.htmlFor = `${prefix}-opacity`;
  opacityLabel.textContent = 'Overlay opacity';
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
  viewLegend.textContent = 'View';
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

  // --- Preset picker -------------------------------------------------

  const presetWrap = document.createElement('div');
  presetWrap.className = 'fc-controls__field';

  const presetLabel = document.createElement('label');
  presetLabel.htmlFor = `${prefix}-preset`;
  presetLabel.textContent = 'Quality preset';
  presetWrap.appendChild(presetLabel);

  const presetSelect = document.createElement('select');
  presetSelect.id = `${prefix}-preset`;
  presetSelect.className = 'fc-controls__select';
  for (const choice of PRESET_CHOICES) {
    const opt = document.createElement('option');
    opt.value = choice.value;
    opt.textContent = choice.label;
    presetSelect.appendChild(opt);
  }
  // Default to `medium` — "Standard" in the human label — matching
  // the PRD's §Quality presets table.
  presetSelect.value = 'medium';
  presetSelect.addEventListener('change', () => {
    if (onPresetChange) onPresetChange(/** @type {Preset} */ (presetSelect.value));
  });
  presetWrap.appendChild(presetSelect);

  root.appendChild(presetWrap);

  // --- Download button ----------------------------------------------

  const downloadBtn = document.createElement('button');
  downloadBtn.type = 'button';
  downloadBtn.className = 'fc-controls__download';
  downloadBtn.textContent = 'Download PNG';
  downloadBtn.setAttribute('aria-label', 'Download heatmap as PNG');
  downloadBtn.addEventListener('click', () => {
    if (onDownload) onDownload();
  });
  root.appendChild(downloadBtn);

  // --- Controller API -----------------------------------------------

  /** @param {Preset} preset */
  function setPreset(preset) {
    if (PRESET_CHOICES.some((c) => c.value === preset)) {
      presetSelect.value = preset;
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
    presetSelect.disabled = d;
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

  return {
    element: root,
    setPreset,
    setView,
    setOpacity,
    setDisabled,
    setVisible,
  };
}
