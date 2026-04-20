/**
 * ui/report.js
 *
 * Creates and manages the analysis report section that appears below the
 * interactive heatmap canvas after inference completes.
 *
 * The report presents findings in narrative order:
 *   1. Primary finding — duration tabs + hero canvas + rule-of-thirds breakdown + first-fixation note
 *   2. Duration comparison strip — thumbnail canvases for all three viewing durations
 *   3. Eye movement sequence — per-duration fixation sequence thumbnails
 *   4. Attention zones — per-duration zone band thumbnails
 *   5. Attention shift (centroid trajectory) — cross-duration trajectory canvas (once ≥2 results ready)
 *   6. Methodology note — what the model is, what it isn't, links to docs
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

import { drawFixationSequence, drawCentroidTrajectory } from '../render/saliency-canvas.js';

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
 * Composite image + heatmap + one overlay type into a thumbnail canvas.
 *
 * Renders the base at thumbnail size (via compositeThumb), then draws
 * scaled overlay markers directly onto the result. Working at thumbnail
 * size rather than full resolution keeps marker sizes readable — the
 * draw functions scale their glyphs relative to the canvas dimensions.
 *
 * @param {HTMLImageElement|HTMLCanvasElement|ImageBitmap} image
 * @param {any} result - duration result object with heatmapCanvas, fixationSequence, attentionZoneCanvas
 * @param {'fixation'|'zones'} overlayType
 * @param {number} [maxW=400] Maximum output width in pixels.
 * @returns {HTMLCanvasElement}
 */
function compositeOverlayThumb(image, result, overlayType, maxW = 400) {
  const srcW = /** @type {any} */ (image).naturalWidth || /** @type {any} */ (image).width;

  // Start with the image + heatmap composite at thumbnail size.
  const thumb = compositeThumb(image, result.heatmapCanvas, maxW);
  const scale = thumb.width / srcW;

  const ctx = thumb.getContext('2d');
  // why: jsdom returns null for getContext; return the blank thumb rather
  // than throwing so unit tests exercise DOM structure without pixel content.
  // The secondary guard (ctx.canvas) handles jsdom stubs that set getContext
  // to a partial mock without the canvas back-reference.
  if (!ctx || !ctx.canvas) return thumb;

  if (overlayType === 'fixation' && result.fixationSequence?.length) {
    // Scale coordinates to thumbnail space so markers render at the right size.
    const scaled = result.fixationSequence.map(
      /** @param {{x:number, y:number}} p */
      (p) => ({ x: p.x * scale, y: p.y * scale }),
    );
    drawFixationSequence(ctx, scaled);
  } else if (overlayType === 'zones' && result.attentionZoneCanvas) {
    // Zone canvas lives in source coordinate space — drawImage scales it.
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(result.attentionZoneCanvas, 0, 0, thumb.width, thumb.height);
    ctx.restore();
  }

  return thumb;
}

/**
 * Composite a centroid trajectory over the plain image as a thumbnail.
 *
 * Uses the plain image (no heatmap) so no single duration's heatmap is
 * privileged — the trajectory path is the main visual. Coordinates are
 * scaled from source space to thumbnail space before drawing.
 *
 * @param {HTMLImageElement|HTMLCanvasElement|ImageBitmap} image
 * @param {Array<{x: number, y: number}>} trajectory - Centroid points (1s → 3s → 7s).
 * @param {string[]} labels - Duration labels parallel to trajectory.
 * @param {number} [maxW=600] Maximum output width in pixels.
 * @returns {HTMLCanvasElement}
 */
function compositeTrajectoryThumb(image, trajectory, labels, maxW = 600) {
  const srcW = /** @type {any} */ (image).naturalWidth || /** @type {any} */ (image).width;
  const srcH = /** @type {any} */ (image).naturalHeight || /** @type {any} */ (image).height;
  const scale = Math.min(1, maxW / srcW);
  const w = Math.round(srcW * scale);
  const h = Math.round(srcH * scale);

  const thumb = document.createElement('canvas');
  thumb.width  = w;
  thumb.height = h;

  const ctx = thumb.getContext('2d');
  if (!ctx || !ctx.canvas) return thumb;

  // Plain image only — trajectory is the focus, no duration-specific heatmap.
  ctx.drawImage(image, 0, 0, w, h);

  const scaled = trajectory.map(
    /** @param {{x:number, y:number}} p */
    (p) => ({ x: p.x * scale, y: p.y * scale }),
  );
  drawCentroidTrajectory(ctx, scaled, labels);

  return thumb;
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
 * Each cell is tinted on a heat scale (dark → warm orange → bright) proportional
 * to its share of attention, so the grid reads as a mini intensity map.
 * Text labels are always present so the distinction is not colour-only (WCAG 1.4.1).
 * The highest cell also gets a distinct aria-label for screen readers.
 *
 * @param {HTMLElement} container
 * @param {number[]} rot Nine-value row-major array (0–100 integers summing to 100).
 */
export function renderRotGrid(container, rot) {
  const maxVal = Math.max(...rot);
  container.textContent = '';

  // Heat ramp: 0% → dark surface → warm amber → hot orange-red at max.
  // Three-stop interpolation: stop0 → stop1 at t=0.5 → stop2 at t=1.
  const stop0 = [25,  33,  52];   // near --fc-surface-container (dark navy)
  const stop1 = [160, 90,  10];   // warm amber mid-tone
  const stop2 = [230, 60,   0];   // hot orange-red

  for (let i = 0; i < 9; i++) {
    const pct  = rot[i];
    const cell = document.createElement('div');
    cell.className = 'fc-report__rot-cell';

    // t = intensity relative to the max cell (0–1).
    const t = maxVal > 0 ? pct / maxVal : 0;

    // Two-segment linear interpolation through the three stops.
    let r, g, b;
    if (t <= 0.5) {
      const u = t / 0.5;
      r = Math.round(stop0[0] + u * (stop1[0] - stop0[0]));
      g = Math.round(stop0[1] + u * (stop1[1] - stop0[1]));
      b = Math.round(stop0[2] + u * (stop1[2] - stop0[2]));
    } else {
      const u = (t - 0.5) / 0.5;
      r = Math.round(stop1[0] + u * (stop2[0] - stop1[0]));
      g = Math.round(stop1[1] + u * (stop2[1] - stop1[1]));
      b = Math.round(stop1[2] + u * (stop2[2] - stop1[2]));
    }

    cell.style.background = `rgb(${r},${g},${b})`;

    // Flip text to dark on bright cells so contrast is maintained.
    // Perceived brightness (ITU-R BT.601): (R*299+G*587+B*114)/1000.
    const brightness = (r * 299 + g * 587 + b * 114) / 1000;
    cell.style.color = brightness > 110 ? 'rgba(10,15,30,0.9)' : '';

    if (pct >= maxVal) {
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
  // Sections 3 & 4 — Per-duration overlay strips (fixation sequence, attention zones)
  //
  // Each section uses the same stable-slot pattern as the duration strip:
  // DOM shells created once, canvas nodes replaced in-place each update().
  // =========================================================================

  /**
   * Build a three-column overlay strip section.
   * Returns the section element, slot Map, and a stable canvas-wrap Map.
   *
   * @param {string} heading - Section heading text.
   * @param {string} description - Short description for sighted readers.
   * @param {string} sectionClass - Extra BEM modifier class.
   * @returns {{ el: HTMLElement, slots: Map<string, { canvasWrap: HTMLElement }> }}
   */
  function createOverlaySection(heading, description, sectionClass) {
    const el = document.createElement('div');
    el.className = `fc-report__section fc-report__section--overlay ${sectionClass}`;

    const h = document.createElement('h3');
    h.className = 'fc-report__section-heading';
    h.textContent = heading;
    el.appendChild(h);

    const p = document.createElement('p');
    p.className = 'fc-report__overlay-note';
    p.textContent = description;
    el.appendChild(p);

    const grid = document.createElement('div');
    grid.className = 'fc-report__strip';
    el.appendChild(grid);

    /** @type {Map<string, { canvasWrap: HTMLElement }>} */
    const slots = new Map();

    for (const dur of DURATIONS) {
      const figure = document.createElement('figure');
      figure.className = 'fc-report__dur-item';
      figure.dataset.duration = dur;

      const canvasWrap = document.createElement('div');
      canvasWrap.className = 'fc-report__dur-canvas';
      figure.appendChild(canvasWrap);

      const initial = document.createElement('div');
      initial.className = 'fc-report__dur-placeholder';
      initial.setAttribute('aria-label', 'Not yet loaded');
      canvasWrap.appendChild(initial);

      const figcaption = document.createElement('figcaption');
      figcaption.className = 'fc-report__dur-label';
      figcaption.textContent = DURATION_LABELS[dur] ?? dur;
      figure.appendChild(figcaption);

      grid.appendChild(figure);
      slots.set(dur, { canvasWrap });
    }

    return { el, slots };
  }

  const { el: fixationSection, slots: fixationSlots } = createOverlaySection(
    'Eye movement sequence',
    'Predicted order in which attention scans the image, modelled using inhibition-of-return (IoR). ' +
    'Numbers show fixation order; earlier numbers indicate higher priority regions.',
    'fc-report__section--fixation',
  );
  section.appendChild(fixationSection);

  const { el: zonesSection, slots: zoneSlots } = createOverlaySection(
    'Attention zones',
    'Concentric contour bands showing the hottest 10%, 25%, and 50% attention regions. ' +
    'Tighter contours indicate more concentrated attention.',
    'fc-report__section--zones',
  );
  section.appendChild(zonesSection);

  // =========================================================================
  // Section 5 — Centroid trajectory (cross-duration, appears once ≥2 results ready)
  // =========================================================================
  const trajectorySection = document.createElement('div');
  trajectorySection.className = 'fc-report__section fc-report__section--trajectory';
  // why: hidden until at least 2 duration results have fixation data; update() reveals it.
  trajectorySection.hidden = true;

  const trajHeading = document.createElement('h3');
  trajHeading.className = 'fc-report__section-heading';
  trajHeading.textContent = 'Attention shift';
  trajectorySection.appendChild(trajHeading);

  const trajNote = document.createElement('p');
  trajNote.className = 'fc-report__overlay-note';
  trajNote.textContent =
    'How the predicted centre of attention moves from the first glance to sustained viewing. ' +
    'Each dot marks the attention centroid at that viewing duration.';
  trajectorySection.appendChild(trajNote);

  const trajectoryCanvasWrap = document.createElement('div');
  trajectoryCanvasWrap.className = 'fc-report__trajectory-wrap';
  trajectorySection.appendChild(trajectoryCanvasWrap);
  section.appendChild(trajectorySection);

  // =========================================================================
  // Section 6 — Methodology note
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

    if (!hero) {
      // why: even when no hero is available (no results at all), the trajectory
      // section must hide — it could have been visible from a prior image.
      trajectorySection.hidden = true;
      trajectoryCanvasWrap.textContent = '';
      return;
    }

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

    // ----- Fixation sequence slots -----------------------------------------
    for (const dur of DURATIONS) {
      const slot = fixationSlots.get(dur);
      if (!slot) continue;

      const result = durationResults[dur];
      slot.canvasWrap.textContent = '';

      if (result && result !== 'loading' && result !== 'failed' && result.fixationSequence?.length) {
        const thumb = compositeOverlayThumb(image, result, 'fixation', 400);
        thumb.setAttribute('role', 'img');
        thumb.setAttribute('aria-label', `${DURATION_LABELS[dur] ?? dur} fixation sequence`);
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

    // ----- Attention zones slots -------------------------------------------
    for (const dur of DURATIONS) {
      const slot = zoneSlots.get(dur);
      if (!slot) continue;

      const result = durationResults[dur];
      slot.canvasWrap.textContent = '';

      if (result && result !== 'loading' && result !== 'failed' && result.attentionZoneCanvas) {
        const thumb = compositeOverlayThumb(image, result, 'zones', 400);
        thumb.setAttribute('role', 'img');
        thumb.setAttribute('aria-label', `${DURATION_LABELS[dur] ?? dur} attention zones`);
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

    // ----- Centroid trajectory (cross-duration) ----------------------------
    // why: must re-evaluate visibility on every update() — a new image resets
    // all results, so the section must hide again even after being visible.
    const TRAJ_DURATIONS = /** @type {const} */ (['1s', '3s', '7s']);
    const trajPoints = [];
    const trajLabels = [];
    for (const d of TRAJ_DURATIONS) {
      const r = durationResults[d];
      if (r && r !== 'loading' && r !== 'failed' && r.fixation) {
        trajPoints.push(r.fixation);
        trajLabels.push(DURATION_LABELS[d] ?? d);
      }
    }

    trajectoryCanvasWrap.textContent = '';
    if (trajPoints.length >= 2) {
      trajectorySection.hidden = false;
      const trajCanvas = compositeTrajectoryThumb(image, trajPoints, trajLabels, 600);
      trajCanvas.setAttribute('role', 'img');
      trajCanvas.setAttribute(
        'aria-label',
        'Attention shift trajectory showing centroid movement across viewing durations',
      );
      trajectoryCanvasWrap.appendChild(trajCanvas);
    } else {
      trajectorySection.hidden = true;
    }
  }

  return { update };
}
