// Direct saliency-to-canvas renderer.
//
// Replaces heatmap.js for V3. Maps each pixel of a normalised saliency
// map directly to a colour via the inferno colormap, then composites
// over the source image. No radius spreading, no stride sampling, no
// external library dependency — pixel-accurate rendering that matches
// the benchmark comparison images from foveacast-training.
//
// Why inferno: it's perceptually uniform, works for colour-blind viewers,
// and is what the benchmark renders used. The rainbow gradient from
// heatmap.js was misleading because its radius + blur made low-saliency
// areas look larger and more significant than the raw model data
// warranted.

// Inferno colormap: 16 key stops from matplotlib's inferno, sampled at
// evenly spaced t values in [0, 1]. Each entry is [R, G, B] in 0–255.
// Linear interpolation between stops gives a smooth-enough gradient for
// saliency overlay at screenshot resolution.
const INFERNO = [
  [0, 0, 4],
  [11, 7, 36],
  [32, 12, 74],
  [57, 15, 110],
  [82, 21, 130],
  [109, 26, 136],
  [135, 34, 132],
  [161, 48, 118],
  [186, 64, 97],
  [208, 85, 72],
  [226, 111, 48],
  [239, 140, 28],
  [248, 173, 16],
  [250, 207, 28],
  [245, 239, 80],
  [252, 255, 164],
];

/**
 * Map a normalised saliency value (0–1) to an [R, G, B] triple via
 * the inferno colormap.
 * @param {number} t - Value in [0, 1].
 * @returns {[number, number, number]}
 */
function infernoColor(t) {
  if (t <= 0) return INFERNO[0];
  if (t >= 1) return INFERNO[INFERNO.length - 1];
  const f = t * (INFERNO.length - 1);
  const i = Math.floor(f);
  const w = f - i;
  const a = INFERNO[i];
  const b = INFERNO[Math.min(i + 1, INFERNO.length - 1)];
  return [
    Math.round(a[0] + (b[0] - a[0]) * w),
    Math.round(a[1] + (b[1] - a[1]) * w),
    Math.round(a[2] + (b[2] - a[2]) * w),
  ];
}

/**
 * Render a normalised saliency map to a canvas via direct pixel
 * colormap lookup. No heatmap.js, no radius spreading, no stride
 * sampling — each pixel gets exactly the colour its saliency value
 * maps to.
 *
 * @param {Float32Array} normalisedMap - Row-major, values in [0, 1].
 * @param {number} width
 * @param {number} height
 * @returns {HTMLCanvasElement}
 */
export function renderSaliencyCanvas(normalisedMap, width, height) {
  if (normalisedMap.length !== width * height) {
    throw new Error(
      `normalisedMap length ${normalisedMap.length} does not match width*height ${width * height}`
    );
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get 2D context for saliency canvas.');

  const imageData = ctx.createImageData(width, height);
  const pixels = imageData.data;

  for (let i = 0; i < normalisedMap.length; i++) {
    const [r, g, b] = infernoColor(normalisedMap[i]);
    const off = i * 4;
    pixels[off] = r;
    pixels[off + 1] = g;
    pixels[off + 2] = b;
    pixels[off + 3] = 255; // fully opaque — alpha handled by compositor
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

/**
 * Composite a source image and a heatmap canvas into a single canvas,
 * optionally marking the first-fixation point.
 *
 * The returned canvas has the dimensions of the source image — the
 * heatmap canvas is drawn into it with an explicit `globalAlpha`, so
 * the heatmap's own opacity setting controls colour ramping and this
 * opacity value controls blend strength. Keeping the two concerns
 * separate makes the opacity slider feel linear.
 *
 * @param {HTMLImageElement|HTMLCanvasElement|ImageBitmap} imageSource
 * @param {HTMLCanvasElement} heatmapCanvas
 * @param {{
 *   opacity?: number,
 *   blendMode?: string,
 *   showFixation?: boolean,
 *   fixation?: { x: number, y: number } | null,
 *   watermark?: { text: string } | null,
 *   fixationSequence?: Array<{x: number, y: number}> | null,
 *   attentionZoneCanvas?: HTMLCanvasElement | null,
 *   centroidTrajectory?: Array<{x: number, y: number}> | null,
 *   centroidLabels?: string[] | null,
 * }} [options]
 * @returns {HTMLCanvasElement}
 */
export function compositeImageAndHeatmap(imageSource, heatmapCanvas, options = {}) {
  const {
    opacity = 0.6,
    blendMode = 'source-over',
    showFixation = true,
    fixation = null,
    watermark = null,
    fixationSequence = null,
    attentionZoneCanvas = null,
    centroidTrajectory = null,
    centroidLabels = null,
  } = options;

  if (typeof document === 'undefined') {
    throw new Error('compositeImageAndHeatmap requires a DOM (document).');
  }

  // `naturalWidth`/`naturalHeight` for <img>, plain `width`/`height`
  // for Canvas/ImageBitmap. Fall through so all three input types
  // produce sensible dimensions.
  const width =
    /** @type {any} */ (imageSource).naturalWidth ||
    /** @type {any} */ (imageSource).width;
  const height =
    /** @type {any} */ (imageSource).naturalHeight ||
    /** @type {any} */ (imageSource).height;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to acquire 2D context for composite canvas.');
  }

  // 1. Source image underneath.
  ctx.drawImage(imageSource, 0, 0, width, height);

  // 2. Heatmap on top at user-controlled opacity with user-chosen blend mode.
  //    Canvas 2D globalCompositeOperation accepts all the standard CSS blend
  //    modes (multiply, screen, overlay, etc.) as well as compositing modes.
  //    We default to 'source-over' (normal) and let the caller opt into
  //    creative modes via the blendMode option.
  ctx.save();
  ctx.globalCompositeOperation = /** @type {GlobalCompositeOperation} */ (blendMode);
  ctx.globalAlpha = Math.max(0, Math.min(1, opacity));
  ctx.drawImage(heatmapCanvas, 0, 0, width, height);
  ctx.restore();

  // 3. Attention zone canvas overlay (semi-transparent contour bands).
  //    Drawn before the fixation crosshair so fixation markers sit on top.
  if (attentionZoneCanvas) {
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(attentionZoneCanvas, 0, 0, width, height);
    ctx.restore();
  }

  // 4. First-fixation crosshair. White outline around a black disc +
  //    two short perpendicular lines. The PRD (§Accessibility) is
  //    explicit that colour alone must not carry the fixation
  //    information, so the shape must be unambiguous at any heatmap
  //    colour.
  if (showFixation && fixation && Number.isFinite(fixation.x) && Number.isFinite(fixation.y)) {
    drawFixationCrosshair(ctx, fixation.x, fixation.y);
  }

  // 5. Fixation sequence: numbered circles with saccade lines.
  //    Only drawn when `fixationSequence` array has ≥ 2 entries.
  if (fixationSequence && fixationSequence.length >= 1) {
    const markers = drawFixationSequence(ctx, fixationSequence);
    // Attach hit-test data to the canvas element so the UI layer can
    // show hover tooltips without re-computing the rendered radius.
    /** @type {any} */ (canvas)._fixationMarkers = markers;
  }

  // 6. Centroid trajectory: a dotted line connecting centroids for each
  //    duration that has been processed, with duration labels.
  if (centroidTrajectory && centroidTrajectory.length >= 2) {
    drawCentroidTrajectory(ctx, centroidTrajectory, centroidLabels || []);
  }

  // 7. Optional watermark. Only the demo path passes one in — normal
  //    inference renders clean. The watermark is drawn last so it sits
  //    above both the heatmap and the crosshair; this is deliberate,
  //    because the watermark's job is to be visible on any crop.
  if (watermark && watermark.text) {
    drawDiagonalWatermark(ctx, width, height, watermark.text);
  }

  return canvas;
}

/**
 * Draw a tiled diagonal watermark across the canvas.
 *
 * Design rationale:
 *   - Text is rotated ~20° and repeated on a diagonal grid so that any
 *     reasonable crop still contains at least one legible copy. A
 *     single corner-pinned watermark would be trivially cropped out
 *     and defeat the point (UX review P0 #3).
 *   - Black stroke under white fill gives legibility over any heatmap
 *     colour and any underlying screenshot content.
 *   - Global alpha ~0.55 keeps the output readable as a heatmap while
 *     keeping the watermark assertive enough to notice.
 *   - Font size scales with the canvas min-dimension so the mark stays
 *     proportional across preset resolutions.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} width
 * @param {number} height
 * @param {string} text
 */
function drawDiagonalWatermark(ctx, width, height, text) {
  ctx.save();

  const minDim = Math.min(width, height);
  const fontSize = Math.max(14, Math.round(minDim * 0.035));
  ctx.font = `600 ${fontSize}px system-ui, -apple-system, Segoe UI, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = Math.max(2, Math.round(fontSize * 0.12));

  // Tile on a diagonal grid. Angle is shallow enough that the text
  // stays readable horizontally at a glance.
  const angleRad = (-20 * Math.PI) / 180;
  const stepX = Math.max(220, Math.round(width * 0.32));
  const stepY = Math.max(140, Math.round(height * 0.22));

  // Rotate the whole space, then stamp in a grid covering a rectangle
  // larger than the canvas so rotation doesn't leave corners bare.
  ctx.translate(width / 2, height / 2);
  ctx.rotate(angleRad);
  const extent = Math.max(width, height) * 1.2;

  for (let y = -extent; y <= extent; y += stepY) {
    // Alternate rows get offset so the pattern doesn't look gridded.
    const rowOffset = (Math.round(y / stepY) % 2) * (stepX / 2);
    for (let x = -extent; x <= extent; x += stepX) {
      ctx.strokeStyle = 'black';
      ctx.strokeText(text, x + rowOffset, y);
      ctx.fillStyle = 'white';
      ctx.fillText(text, x + rowOffset, y);
    }
  }

  ctx.restore();
}

/**
 * Draw a high-contrast crosshair at (x, y). Private helper.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 */
function drawFixationCrosshair(ctx, x, y) {
  const radius = 14; // px — large enough to be visible over heat, small enough not to dominate.
  const tick = 10; // length of each perpendicular tick beyond the circle.

  ctx.save();

  // White halo first (drawn as a slightly thicker black-then-white pair).
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'white';
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.stroke();

  ctx.lineWidth = 2;
  ctx.strokeStyle = 'black';
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.stroke();

  // Filled centre dot.
  ctx.fillStyle = 'black';
  ctx.beginPath();
  ctx.arc(x, y, 3, 0, Math.PI * 2);
  ctx.fill();

  // Perpendicular tick marks. White underlay + black overlay so they
  // are legible on both dark and light heatmap regions.
  const drawTicks = (colour, lineWidth) => {
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = colour;
    ctx.beginPath();
    ctx.moveTo(x - radius - tick, y);
    ctx.lineTo(x - radius, y);
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + radius + tick, y);
    ctx.moveTo(x, y - radius - tick);
    ctx.lineTo(x, y - radius);
    ctx.moveTo(x, y + radius);
    ctx.lineTo(x, y + radius + tick);
    ctx.stroke();
  };
  drawTicks('white', 4);
  drawTicks('black', 2);

  ctx.restore();
}

/**
 * Render a transparent attention-zone overlay canvas from a normalised
 * saliency map and pre-computed zone thresholds.
 *
 * Three concentric zone bands are drawn (hot → warm → tepid), each as
 * a semi-transparent colour fill. The caller should composite this
 * canvas on top of the source image before drawing marker overlays.
 *
 * @param {Float32Array} normalisedMap - Row-major, values in [0, 1],
 *   length `width * height`.
 * @param {number} width
 * @param {number} height
 * @param {number[]} thresholds - Threshold values in descending order
 *   of heat (innermost zone first). Typically the output of
 *   `computeZoneThresholds(map, [0.10, 0.25, 0.50])`.
 * @returns {HTMLCanvasElement}
 */
export function renderAttentionZoneCanvas(normalisedMap, width, height, thresholds) {
  if (typeof document === 'undefined') {
    throw new Error('renderAttentionZoneCanvas requires a DOM (document).');
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to acquire 2D context for zone canvas.');

  const imageData = ctx.createImageData(width, height);
  const data = imageData.data;

  // Zone colours (RGBA). From innermost (hottest) to outermost (tepid).
  // Red → yellow → white, each at a low alpha so zones can stack legibly.
  const zoneColours = [
    [255, 60, 0, 180],   // hot core — orange-red
    [255, 200, 0, 120],  // warm zone — amber
    [255, 255, 255, 60], // tepid zone — white wash
  ];

  const [t0, t1, t2] = thresholds;

  for (let i = 0; i < normalisedMap.length; i++) {
    const v = normalisedMap[i];
    let colour = null;
    if (t0 !== undefined && v >= t0) colour = zoneColours[0];
    else if (t1 !== undefined && v >= t1) colour = zoneColours[1];
    else if (t2 !== undefined && v >= t2) colour = zoneColours[2];

    if (colour) {
      const p = i * 4;
      data[p]     = colour[0];
      data[p + 1] = colour[1];
      data[p + 2] = colour[2];
      data[p + 3] = colour[3];
    }
    // Pixels below all thresholds remain transparent (alpha = 0).
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

/**
 * Draw a numbered fixation-sequence scanpath on an existing context.
 * Lines connect successive fixation points; each point is labelled with
 * its ordinal number so the sequence is conveyed without relying on
 * colour alone (WCAG 2.1 SC 1.4.1).
 *
 * Returns an array of hit-test records for each marker so callers can
 * implement interactive hover behaviour (e.g. canvas tooltips).
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<{x: number, y: number}>} fixations - Ordered sequence.
 * @returns {Array<{x: number, y: number, r: number, ordinal: number}>}
 */
function drawFixationSequence(ctx, fixations) {
  if (fixations.length === 0) return [];
  ctx.save();

  // Scale markers to canvas size so they're legible on large screenshots.
  // Floor at 16 px so they're always readable on small canvases too.
  const shortSide = Math.min(ctx.canvas.width, ctx.canvas.height);
  const circleR = Math.max(16, Math.round(shortSide * 0.035));
  const fontSize = Math.round(circleR * 0.85);
  const lineW = Math.max(2, Math.round(shortSide * 0.003));

  // Draw connecting saccade lines first so circles sit on top.
  if (fixations.length > 1) {
    // Shadow line in black for legibility over bright backgrounds.
    ctx.lineWidth = lineW * 2.5;
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.setLineDash([circleR * 0.45, circleR * 0.3]);
    ctx.beginPath();
    ctx.moveTo(fixations[0].x, fixations[0].y);
    for (let i = 1; i < fixations.length; i++) {
      ctx.lineTo(fixations[i].x, fixations[i].y);
    }
    ctx.stroke();

    // White dash over the top.
    ctx.lineWidth = lineW * 1.5;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.setLineDash([circleR * 0.45, circleR * 0.3]);
    ctx.beginPath();
    ctx.moveTo(fixations[0].x, fixations[0].y);
    for (let i = 1; i < fixations.length; i++) {
      ctx.lineTo(fixations[i].x, fixations[i].y);
    }
    ctx.stroke();
  }

  ctx.setLineDash([]);

  // Draw numbered circles.
  ctx.font = `bold ${fontSize}px system-ui, -apple-system, Segoe UI, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (let i = 0; i < fixations.length; i++) {
    const { x, y } = fixations[i];
    const label = String(i + 1);

    // Black halo.
    ctx.beginPath();
    ctx.arc(x, y, circleR + lineW * 1.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fill();

    // Filled circle — white for first fixation, semi-transparent for rest.
    ctx.beginPath();
    ctx.arc(x, y, circleR, 0, Math.PI * 2);
    ctx.fillStyle = i === 0 ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.70)';
    ctx.fill();

    // Number.
    ctx.fillStyle = 'black';
    ctx.fillText(label, x, y);
  }

  ctx.restore();

  // Return hit-test data so callers can show hover tooltips on the
  // canvas element without needing to know the internally-computed radius.
  return fixations.map((f, i) => ({ x: f.x, y: f.y, r: circleR, ordinal: i + 1 }));
}

/**
 * Draw a dotted trajectory line connecting per-duration fixation
 * centroids. Used to show how predicted attention shifts with longer
 * viewing time.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<{x: number, y: number}>} trajectory - Ordered by
 *   duration (e.g. 1 s → 3 s → 7 s).
 * @param {string[]} labels - Duration labels parallel to `trajectory`
 *   (e.g. ['1s', '3s', '7s']).
 */
function drawCentroidTrajectory(ctx, trajectory, labels) {
  if (trajectory.length < 2) return;
  ctx.save();

  // Scale to canvas size so dots and labels are legible on large screenshots.
  // Floor at 8 px (dot) / 11 px (font) for small canvases.
  const shortSide = Math.min(ctx.canvas.width, ctx.canvas.height);
  const dotR    = Math.max(8,  Math.round(shortSide * 0.014));
  const fontSize = Math.max(11, Math.round(shortSide * 0.022));
  const lineW   = Math.max(2,  Math.round(shortSide * 0.003));

  // Dashed trajectory line.
  ctx.setLineDash([dotR * 1.0, dotR * 0.6]);
  ctx.lineWidth = lineW * 2;
  ctx.strokeStyle = 'rgba(100,200,255,0.85)';
  ctx.beginPath();
  ctx.moveTo(trajectory[0].x, trajectory[0].y);
  for (let i = 1; i < trajectory.length; i++) {
    ctx.lineTo(trajectory[i].x, trajectory[i].y);
  }
  ctx.stroke();

  ctx.setLineDash([]);
  ctx.font = `bold ${fontSize}px system-ui, -apple-system, Segoe UI, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  for (let i = 0; i < trajectory.length; i++) {
    const { x, y } = trajectory[i];
    const label = labels[i] || String(i + 1);

    // Dot.
    ctx.beginPath();
    ctx.arc(x, y, dotR + 1, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(x, y, dotR, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(100,200,255,0.9)';
    ctx.fill();

    // Label below the dot.
    const labelY = y + dotR + 3;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillText(label, x + 1, labelY + 1);
    ctx.fillStyle = 'white';
    ctx.fillText(label, x, labelY);
  }

  ctx.restore();
}
