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

  el.appendChild(makeCard(
    'fc-hud__inference',
    'Inference',
    '\u2014',
    'Time taken to run the saliency model on your image, in milliseconds.',
  ));
  el.appendChild(makeCard('fc-hud__duration',  'Duration',  '\u2014'));
  el.appendChild(makeCard(
    'fc-hud__spread',
    'Attention Spread',
    '\u2014',
    'How widely distributed predicted attention is across the image. Low = focused on one spot; High = spread across many areas.',
  ));
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

/**
 * Build or update a rule-of-thirds grid display below the HUD cards.
 *
 * Renders a 3×3 table where each cell shows the percentage of predicted
 * attention mass that falls in that grid region. Uses `<details>` +
 * `<summary>` so it is opt-in and does not push the HUD to an unwieldy
 * height. Re-calls are idempotent — the existing `<details>` element is
 * updated in place if found.
 *
 * @param {HTMLElement} hudEl - The element returned by `createHud`.
 * @param {number[]} cells    - Nine integers summing to 100, row-major
 *   (top-left = cells[0], bottom-right = cells[8]).
 */
export function updateHudRuleOfThirds(hudEl, cells) {
  if (!cells || cells.length !== 9) return;

  let details = /** @type {HTMLDetailsElement|null} */ (
    hudEl.querySelector('.fc-hud__thirds')
  );

  if (!details) {
    details = /** @type {HTMLDetailsElement} */ (document.createElement('details'));
    details.className = 'fc-hud__thirds';

    const summary = document.createElement('summary');
    summary.textContent = 'Rule of thirds';
    details.appendChild(summary);

    // 3×3 grid of cells.
    const grid = document.createElement('div');
    grid.className = 'fc-hud__thirds-grid';
    grid.setAttribute('aria-label', 'Rule-of-thirds attention grid');
    details.appendChild(grid);

    hudEl.appendChild(details);
  }

  const grid = /** @type {HTMLElement} */ (details.querySelector('.fc-hud__thirds-grid'));

  // Update or create the 9 cell divs.
  for (let i = 0; i < 9; i++) {
    let cell = /** @type {HTMLElement|null} */ (grid.children[i]);
    if (!cell) {
      cell = document.createElement('div');
      cell.className = 'fc-hud__thirds-cell';
      grid.appendChild(cell);
    }

    const pct = cells[i];
    cell.textContent = `${pct}%`;
    // Scale background opacity 0–1 proportional to cell value for a
    // quick heat-at-a-glance. Max expected single-cell value ≈ 40 %.
    const opacity = Math.min(1, pct / 35);
    cell.style.setProperty('--cell-heat', String(opacity));
    cell.setAttribute('aria-label', `${ROT_REGION_LABELS[i]}: ${pct}%`);
  }
}

/** @type {string[]} Human-readable labels for the 9 rule-of-thirds regions. */
const ROT_REGION_LABELS = [
  'Top-left', 'Top-centre', 'Top-right',
  'Middle-left', 'Centre', 'Middle-right',
  'Bottom-left', 'Bottom-centre', 'Bottom-right',
];

/**
 * Build a single `<div class="fc-hud__card …">` with a label and a
 * value element. Returns the card element.
 *
 * @param {string} extraClass
 * @param {string} labelText
 * @param {string} valueText
 * @param {string} [tooltip]  - Optional tooltip shown on hover.
 * @returns {HTMLElement}
 */
function makeCard(extraClass, labelText, valueText, tooltip) {
  const card = document.createElement('div');
  card.className = `fc-hud__card ${extraClass}`;
  if (tooltip) {
    card.dataset.tooltip = tooltip;
  }

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
