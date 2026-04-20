/**
 * ui/report.js
 *
 * Creates and manages the analysis report section that appears below the
 * interactive heatmap canvas after inference completes.
 *
 * The report presents findings in narrative order:
 *   1. Primary finding — duration tabs + hero canvas + rule-of-thirds breakdown + first-fixation note
 *   2. Duration comparison strip — thumbnail canvases for all three viewing durations
 *   3. Methodology note — what the model is, what it isn't, links to docs
 *
 * The DOM shell is created once and slots are updated in-place on each
 * `update()` call, avoiding layout shift and focus churn as background
 * duration results arrive.
 *
 * The duration tabs drive both the hero canvas and the main interactive
 * output canvas (via `onDurationChange`). State ownership lives in main.js
 * — the report only receives the resolved `activeDuration` on each update.
 *
 * Exports:
 *   createReport({ mountEl, onDurationChange }) → { update }
 */

/** Duration labels shared with the main app. */
const DURATION_LABELS = Object.freeze({
  '1s': 'First glance (1 second)',
  '3s': 'Quick scan (3 seconds)',
  '7s': 'Full viewing (7 seconds)',
});

/** All durations in presentation order. */
const DURATIONS = /** @type {const} */ (['1s', '3s', '7s']);

/**
 * Human-readable position names for the nine rule-of-thirds cells.
 * Row-major order: top row left→right, then middle, then bottom.
 * Index 0 = top-left, index 4 = center, index 8 = bottom-right.
 *
 * @type {string[]}
 */
const POSITION_NAMES = [
  'top-left', 'top', 'top-right',
  'left',     'center', 'right',
  'bottom-left', 'bottom', 'bottom-right',
];

/**
 * Composite image + heatmap directly into a canvas capped at `maxW` pixels
 * wide. Drawing at thumbnail resolution avoids creating a full-size canvas
 * only to display it small — important for screenshots larger than 1080p.
 *
 * @param {HTMLImageElement|HTMLCanvasElement|ImageBitmap} image
 * @param {HTMLCanvasElement} heatmapCanvas
 * @param {number} [maxW=480] Maximum output width in pixels.
 * @returns {HTMLCanvasElement}
 */
function compositeThumb(image, heatmapCanvas, maxW = 480) {
  const srcW = /** @type {any} */ (image).naturalWidth  || /** @type {any} */ (image).width;
  const srcH = /** @type {any} */ (image).naturalHeight || /** @type {any} */ (image).height;
  const scale = Math.min(1, maxW / srcW);
  const w = Math.round(srcW * scale);
  const h = Math.round(srcH * scale);

  const canvas = document.createElement('canvas');
  canvas.width  = w;
  canvas.height = h;

  const ctx = canvas.getContext('2d');
  // why: jsdom doesn't implement getContext; return a blank canvas rather
  // than throwing, so unit tests can exercise everything except pixel content.
  if (!ctx) return canvas;

  ctx.drawImage(image, 0, 0, w, h);
  ctx.save();
  ctx.globalAlpha = 0.6;
  ctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(heatmapCanvas, 0, 0, w, h);
  ctx.restore();

  return canvas;
}

/**
 * Generate a one-line summary headline from the rule-of-thirds array.
 * Detects near-ties (second value ≥ 90% of best) and returns softer copy
 * to avoid overclaiming when two regions are roughly equal.
 *
 * @param {number[]} rot Nine-value row-major array (0–100 integers summing to 100).
 * @returns {string}
 */
export function rotHeadline(rot) {
  const indexed = rot.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => b.v - a.v);
  const best   = indexed[0];
  const second = indexed[1];
  // why: values are already integer percentages (0–100); no multiplication needed.
  const pct    = best.v;

  if (second.v >= best.v * 0.9) {
    const pct2 = second.v;
    return (
      `Attention is split between the ${POSITION_NAMES[best.i]} (${pct}%) ` +
      `and ${POSITION_NAMES[second.i]} (${pct2}%) of the image.`
    );
  }
  return `Most attention falls in the ${POSITION_NAMES[best.i]} of the image (${pct}%).`;
}

/**
 * Populate a 3×3 rule-of-thirds grid container.
 * The cell with maximum attention receives a distinct class AND a descriptive
 * aria-label — so the distinction is not conveyed by colour alone.
 *
 * @param {HTMLElement} container
 * @param {number[]} rot Nine-value row-major array (0–100 integers summing to 100).
 */
export function renderRotGrid(container, rot) {
  const maxVal = Math.max(...rot);
  container.textContent = '';

  for (let i = 0; i < 9; i++) {
    // why: values are already integer percentages (0–100); no multiplication needed.
    const pct  = rot[i];
    const cell = document.createElement('div');
    cell.className = 'fc-report__rot-cell';

    if (rot[i] >= maxVal) {
      cell.classList.add('fc-report__rot-cell--max');
      cell.setAttribute('aria-label', `${POSITION_NAMES[i]}: ${pct}% — highest attention area`);
    } else {
      cell.setAttribute('aria-label', `${POSITION_NAMES[i]}: ${pct}%`);
    }

    cell.textContent = `${pct}%`;
    container.appendChild(cell);
  }
}

/**
 * Choose the best available duration result for the hero section.
 * Preference: 3s (most informative for at-a-glance) → 1s → 7s.
 *
 * @param {Record<string, any>} durationResults
 * @returns {{ dur: string, result: any } | null}
 */
function pickHero(durationResults) {
  for (const dur of /** @type {string[]} */ (['3s', '1s', '7s'])) {
    const r = durationResults[dur];
    if (r && r !== 'loading' && r !== 'failed') return { dur, result: r };
  }
  return null;
}

/**
 * Creates and manages the analysis report section.
 *
 * @param {{ mountEl: HTMLElement, onDurationChange?: (duration: string) => void }} opts
 * @returns {{ update: (data: { image: any, durationResults: Record<string, any>, activeDuration?: string }) => void }}
 */
export function createReport({ mountEl, onDurationChange }) {
  // --- Root section --------------------------------------------------------
  const section = document.createElement('section');
  section.className = 'fc-report';
  section.setAttribute('aria-label', 'Analysis report');
  section.hidden = true;

  // --- Report header -------------------------------------------------------
  const header = document.createElement('div');
  header.className = 'fc-report__header';
  const heading = document.createElement('h2');
  heading.className = 'fc-report__heading';
  heading.textContent = 'Analysis Report';
  header.appendChild(heading);
  section.appendChild(header);

  // =========================================================================
  // Section 1 — Primary finding
  // =========================================================================
  const primarySection = document.createElement('div');
  primarySection.className = 'fc-report__section fc-report__section--primary';

  // --- Duration tab bar -----------------------------------------------
  //
  // Tabs drive which result is shown in both the hero canvas here and the
  // interactive #fc-output canvas (via onDurationChange). Clicking a tab
  // calls onDurationChange so main.js owns the resolved activeDuration —
  // the report does not maintain its own selection state.
  //
  // Accessibility: full WAI-ARIA Tabs pattern.
  //   - tablist contains tab elements with aria-selected and tabindex
  //   - roving tabindex: active tab is tabindex=0, others are tabindex=-1
  //   - Arrow keys move focus among enabled tabs; Home/End jump to ends
  //   - Disabled tabs (result not yet loaded) are aria-disabled="true"
  //     and excluded from keyboard cycling

  const heroTabs = document.createElement('div');
  heroTabs.className = 'fc-report__hero-tabs';
  heroTabs.setAttribute('role', 'tablist');
  heroTabs.setAttribute('aria-label', 'Viewing duration');

  /** @type {Map<string, HTMLButtonElement>} */
  const tabButtons = new Map();

  for (const dur of DURATIONS) {
    const btn = document.createElement('button');
    btn.className = 'fc-report__hero-tab';
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', dur === '3s' ? 'true' : 'false');
    btn.setAttribute('tabindex', dur === '3s' ? '0' : '-1');
    btn.setAttribute('aria-disabled', 'true'); // enabled as results arrive
    btn.textContent = DURATION_LABELS[dur] ?? dur;
    btn.dataset.duration = dur;

    btn.addEventListener('click', () => {
      if (btn.getAttribute('aria-disabled') === 'true') return;
      if (onDurationChange) onDurationChange(dur);
    });

    heroTabs.appendChild(btn);
    tabButtons.set(dur, btn);
  }

  // Keyboard navigation: Arrow keys cycle through enabled tabs; Home/End
  // jump to the first/last. Focus follows the active tab (roving tabindex).
  heroTabs.addEventListener('keydown', (e) => {
    const enabled = DURATIONS.map((d) => tabButtons.get(d)).filter(
      (b) => b?.getAttribute('aria-disabled') !== 'true',
    );
    if (enabled.length === 0) return;

    const current = enabled.findIndex((b) => b === document.activeElement);
    let next = -1;
    if (e.key === 'ArrowRight') next = (current + 1) % enabled.length;
    else if (e.key === 'ArrowLeft') next = (current - 1 + enabled.length) % enabled.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = enabled.length - 1;

    if (next >= 0 && enabled[next]) {
      e.preventDefault();
      enabled[next].focus();
      const dur = enabled[next].dataset.duration;
      if (dur && onDurationChange) onDurationChange(dur);
    }
  });

  primarySection.appendChild(heroTabs);

  // Hero figure: image canvas with a figcaption label below.
  const heroFigure = document.createElement('figure');
  heroFigure.className = 'fc-report__hero';

  const heroCanvasWrap = document.createElement('div');
  heroCanvasWrap.className = 'fc-report__hero-canvas';
  heroFigure.appendChild(heroCanvasWrap);

  primarySection.appendChild(heroFigure);

  // Findings panel: headline text + first-fixation note + rule-of-thirds grid.
  const findingsPanel = document.createElement('div');
  findingsPanel.className = 'fc-report__findings';

  const headlineEl = document.createElement('p');
  headlineEl.className = 'fc-report__headline';
  findingsPanel.appendChild(headlineEl);

  const fixationNote = document.createElement('p');
  fixationNote.className = 'fc-report__fixation-note';
  findingsPanel.appendChild(fixationNote);

  const rotWrap = document.createElement('div');
  rotWrap.className = 'fc-report__rot-wrap';

  const rotLabel = document.createElement('p');
  rotLabel.className = 'fc-report__rot-label';
  rotLabel.textContent = 'Attention by image region';
  rotWrap.appendChild(rotLabel);

  // Explainer: users often don't know what these percentages mean.
  const rotHint = document.createElement('p');
  rotHint.className = 'fc-report__rot-hint';
  rotHint.textContent = 'Share of all predicted attention in each region — values sum to 100%.';
  rotWrap.appendChild(rotHint);

  const rotGrid = document.createElement('div');
  rotGrid.className = 'fc-report__rot-grid';
  // why: role="img" on the grid turns the grid into a single AT entity;
  // individual cell aria-labels combine into a meaningful description.
  rotGrid.setAttribute('role', 'img');
  rotWrap.appendChild(rotGrid);
  findingsPanel.appendChild(rotWrap);

  const sourceLabel = document.createElement('p');
  sourceLabel.className = 'fc-report__source-label';
  findingsPanel.appendChild(sourceLabel);

  primarySection.appendChild(findingsPanel);
  section.appendChild(primarySection);

  // =========================================================================
  // Section 2 — Duration comparison strip
  // =========================================================================
  const durationSection = document.createElement('div');
  durationSection.className = 'fc-report__section fc-report__section--durations';

  const durHeading = document.createElement('h3');
  durHeading.className = 'fc-report__section-heading';
  durHeading.textContent = 'Attention across viewing durations';
  durationSection.appendChild(durHeading);

  const durNote = document.createElement('p');
  durNote.className = 'fc-report__duration-note';
  durNote.textContent =
    'Attention shifts as viewing time increases. Earlier durations show ' +
    'more focused first-fixation areas; longer durations show a broader spread.';
  durationSection.appendChild(durNote);

  const strip = document.createElement('div');
  strip.className = 'fc-report__strip';

  // Create a stable slot for each duration — updated in-place so the strip
  // does not reflow or jump as background results arrive.
  /** @type {Map<string, { canvasWrap: HTMLElement }>} */
  const durSlots = new Map();

  for (const dur of DURATIONS) {
    const figure = document.createElement('figure');
    figure.className = 'fc-report__dur-item';
    figure.dataset.duration = dur;

    const canvasWrap = document.createElement('div');
    canvasWrap.className = 'fc-report__dur-canvas';
    figure.appendChild(canvasWrap);

    // Show a placeholder in the canvas slot on first render.
    const initialPlaceholder = document.createElement('div');
    initialPlaceholder.className = 'fc-report__dur-placeholder';
    initialPlaceholder.setAttribute('aria-label', 'Not yet loaded');
    canvasWrap.appendChild(initialPlaceholder);

    const figcaption = document.createElement('figcaption');
    figcaption.className = 'fc-report__dur-label';
    figcaption.textContent = DURATION_LABELS[dur] ?? dur;
    figure.appendChild(figcaption);

    strip.appendChild(figure);
    durSlots.set(dur, { canvasWrap });
  }

  durationSection.appendChild(strip);
  section.appendChild(durationSection);

  // =========================================================================
  // Section 3 — Methodology note
  // =========================================================================
  const methodSection = document.createElement('div');
  methodSection.className = 'fc-report__section fc-report__section--methodology';

  const methodHeading = document.createElement('h3');
  methodHeading.className = 'fc-report__section-heading';
  methodHeading.textContent = 'About this analysis';
  methodSection.appendChild(methodHeading);

  const methodBody = document.createElement('p');
  methodBody.className = 'fc-report__method-body';
  methodBody.textContent =
    'This prediction uses MSI-Net, a saliency model trained on eye-tracking data ' +
    'from real users viewing web pages. It models population-average free-viewing ' +
    'behavior — where most people tend to look first on a screen like this. ' +
    'Individual attention varies; treat this as directional guidance, not a ' +
    'substitute for real user research.';
  methodSection.appendChild(methodBody);

  const methodLinks = document.createElement('nav');
  methodLinks.className = 'fc-report__method-links';
  methodLinks.setAttribute('aria-label', 'Further reading');

  for (const { text, href } of [
    {
      text: 'How to read results',
      href: 'https://github.com/khawkins98/Foveacast/blob/main/docs/reading-your-results.md',
    },
    {
      text: 'Methodology',
      href: 'https://github.com/khawkins98/Foveacast/blob/main/docs/methodology.md',
    },
  ]) {
    const a = document.createElement('a');
    a.href     = href;
    a.textContent = text;
    a.rel      = 'noopener noreferrer';
    a.target   = '_blank';
    a.className = 'fc-report__method-link';
    a.setAttribute('aria-label', `${text} (opens in new tab)`);
    methodLinks.appendChild(a);
  }
  methodSection.appendChild(methodLinks);
  section.appendChild(methodSection);

  mountEl.appendChild(section);

  // =========================================================================
  // update() — called after primary inference and after each background
  // duration result arrives.
  // =========================================================================

  /**
   * Populate or refresh report slots with the latest inference data.
   * The shell DOM is stable; only canvas and text nodes are replaced.
   *
   * @param {{ image: any, durationResults: Record<string, any>, activeDuration?: string }} data
   */
  function update({ image, durationResults, activeDuration }) {
    // Update tab states first, before deciding what the hero shows.
    // A tab is enabled once its result is available (not loading or failed).
    for (const dur of DURATIONS) {
      const btn = tabButtons.get(dur);
      if (!btn) continue;
      const result = durationResults[dur];
      const ready = result && result !== 'loading' && result !== 'failed';
      btn.setAttribute('aria-disabled', ready ? 'false' : 'true');
    }

    // Determine which duration to show in the hero.
    // Prefer the caller-supplied activeDuration if its result is available,
    // otherwise fall back to pickHero so the report isn't blank while the
    // user's preferred duration is still loading.
    const activeResult = activeDuration ? durationResults[activeDuration] : null;
    const heroReady = activeResult && activeResult !== 'loading' && activeResult !== 'failed';
    const hero = heroReady
      ? { dur: activeDuration, result: activeResult }
      : pickHero(durationResults);

    if (!hero) return;

    section.hidden = false;

    // Sync tab selection to the resolved hero duration.
    for (const dur of DURATIONS) {
      const btn = tabButtons.get(dur);
      if (!btn) continue;
      const selected = dur === hero.dur;
      btn.setAttribute('aria-selected', selected ? 'true' : 'false');
      btn.setAttribute('tabindex', selected ? '0' : '-1');
    }

    // ----- Hero section ------------------------------------------------
    const { dur: heroDur, result: heroResult } = hero;

    heroCanvasWrap.textContent = '';
    const heroCanvas = compositeThumb(image, heroResult.heatmapCanvas, 800);
    heroCanvas.setAttribute('role', 'img');
    heroCanvas.setAttribute(
      'aria-label',
      `Predicted attention heatmap — ${DURATION_LABELS[heroDur] ?? heroDur}`,
    );
    heroCanvasWrap.appendChild(heroCanvas);

    if (heroResult.ruleOfThirds) {
      const headline = rotHeadline(heroResult.ruleOfThirds);
      headlineEl.textContent = headline;
      renderRotGrid(rotGrid, heroResult.ruleOfThirds);
      rotGrid.setAttribute('aria-label', `Rule-of-thirds grid. ${headline}`);
    } else {
      headlineEl.textContent = '';
      rotGrid.textContent = '';
    }

    if (heroResult.fixation && heroResult.origDims) {
      const [h, w] = heroResult.origDims;
      const xPct = Math.round((heroResult.fixation.x / w) * 100);
      const yPct = Math.round((heroResult.fixation.y / h) * 100);
      fixationNote.textContent =
        `Eyes are predicted to land first at ${xPct}% across and ${yPct}% down from the top-left.`;
    } else {
      fixationNote.textContent = '';
    }

    sourceLabel.textContent = `Based on the ${DURATION_LABELS[heroDur] ?? heroDur} model.`;

    // ----- Duration strip slots ----------------------------------------
    for (const dur of DURATIONS) {
      const slot = durSlots.get(dur);
      if (!slot) continue;

      const result = durationResults[dur];
      slot.canvasWrap.textContent = '';

      if (result && result !== 'loading' && result !== 'failed') {
        const thumb = compositeThumb(image, result.heatmapCanvas, 400);
        thumb.setAttribute('role', 'img');
        thumb.setAttribute('aria-label', `${DURATION_LABELS[dur] ?? dur} attention heatmap`);
        slot.canvasWrap.appendChild(thumb);
        slot.canvasWrap.removeAttribute('aria-busy');
      } else {
        const placeholder = document.createElement('div');
        placeholder.className = 'fc-report__dur-placeholder';

        if (result === 'loading') {
          placeholder.setAttribute('aria-label', 'Loading…');
          slot.canvasWrap.setAttribute('aria-busy', 'true');
        } else if (result === 'failed') {
          placeholder.classList.add('fc-report__dur-placeholder--failed');
          placeholder.setAttribute('aria-label', 'Unavailable');
          slot.canvasWrap.removeAttribute('aria-busy');
        } else {
          placeholder.setAttribute('aria-label', 'Not yet loaded');
          slot.canvasWrap.removeAttribute('aria-busy');
        }

        slot.canvasWrap.appendChild(placeholder);
      }
    }
  }

  return { update };
}
