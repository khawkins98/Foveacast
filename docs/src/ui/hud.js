/**
 * ui/hud.js
 *
 * HUD (Heads-Up Display) stats panel shown in the analysis workspace
 * header. Displays real post-inference data: inference latency, active
 * model duration, image resolution, and an attention spread metric.
 *
 * WHY a separate module: the HUD is an optional overlay that only
 * carries meaning after a real inference run. Keeping it isolated from
 * main.js prevents this display concern from cluttering the bootstrap
 * and inference logic.
 *
 * DEMO MODE NOTE: The HUD element is created on boot but its data
 * cells are left empty until `updateHud` is called. `main.js` only
 * calls `updateHud` on real inference (not demo mode), so demo users
 * never see misleading placeholder numbers.
 */

/**
 * @typedef {Object} HudData
 * @property {number}  inferenceMs  - Inference time in milliseconds.
 * @property {string}  duration     - Active model duration label (e.g. "3s").
 * @property {string}  spreadLevel  - 'Low' | 'Medium' | 'High'.
 * @property {number}  width        - Source image width (px).
 * @property {number}  height       - Source image height (px).
 */

/**
 * Build the HUD stats panel element. The element is populated with
 * empty/dash values and is updated by calling `updateHud`.
 *
 * @returns {HTMLElement} A `<div class="fc-hud">` element ready to mount.
 */
export function createHud() {
  const el = document.createElement('div');
  el.className = 'fc-hud';
  el.setAttribute('aria-label', 'Analysis statistics');
  el.hidden = true; // shown only after first real inference

  el.appendChild(makeCard('fc-hud__inference', 'Inference', '\u2014'));
  el.appendChild(makeCard('fc-hud__duration',  'Duration',  '\u2014'));
  el.appendChild(makeCard('fc-hud__spread',    'Attention Spread', '\u2014'));
  el.appendChild(makeCard('fc-hud__resolution','Resolution', '\u2014'));

  return el;
}

/**
 * Populate the HUD with real inference data and reveal it.
 *
 * Idempotent: safe to call on every inference run (re-renders in place).
 *
 * @param {HTMLElement} el      - The element returned by `createHud`.
 * @param {HudData}     data
 */
export function updateHud(el, { inferenceMs, duration, spreadLevel, width, height }) {
  el.hidden = false;

  setCard(el, 'fc-hud__inference', `${inferenceMs}\u202Fms`);
  setCard(el, 'fc-hud__duration',  duration);
  setCard(el, 'fc-hud__spread',    spreadLevel);
  setCard(el, 'fc-hud__resolution', `${width}\u202F\u00D7\u202F${height}`);
}

// -- Helpers ------------------------------------------------------------------

/**
 * Build a single `<div class="fc-hud__card …">` with a label and a
 * value element. Returns the card element.
 *
 * @param {string} extraClass
 * @param {string} labelText
 * @param {string} valueText
 * @returns {HTMLElement}
 */
function makeCard(extraClass, labelText, valueText) {
  const card = document.createElement('div');
  card.className = `fc-hud__card ${extraClass}`;

  const label = document.createElement('span');
  label.className = 'fc-hud__label';
  label.textContent = labelText;

  const value = document.createElement('span');
  value.className = 'fc-hud__value';
  value.textContent = valueText;

  card.appendChild(label);
  card.appendChild(value);
  return card;
}

/**
 * Update the value span inside a specific HUD card.
 *
 * @param {HTMLElement} hudEl
 * @param {string}      cardClass
 * @param {string}      text
 */
function setCard(hudEl, cardClass, text) {
  const card = hudEl.querySelector(`.${cardClass}`);
  if (!card) return;
  const value = card.querySelector('.fc-hud__value');
  if (value) value.textContent = text;
}
