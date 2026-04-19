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
 * }} [options]
 * @returns {HTMLCanvasElement}
 */
export function compositeImageAndHeatmap(imageSource, heatmapCanvas, options = {}) {
  const { opacity = 0.6, blendMode = 'source-over', showFixation = true, fixation = null, watermark = null } = options;

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

  // 3. First-fixation crosshair. White outline around a black disc +
  //    two short perpendicular lines. The PRD (§Accessibility) is
  //    explicit that colour alone must not carry the fixation
  //    information, so the shape must be unambiguous at any heatmap
  //    colour.
  if (showFixation && fixation && Number.isFinite(fixation.x) && Number.isFinite(fixation.y)) {
    drawFixationCrosshair(ctx, fixation.x, fixation.y);
  }

  // 4. Optional watermark. Only the demo path passes one in — normal
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
