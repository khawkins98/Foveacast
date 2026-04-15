// heatmap.js wrapper + Canvas compositor.
//
// `heatmap.js` by Patrick Wied is a small MIT-licensed library that
// renders a heatmap onto an internal canvas from `(x, y, value)` data
// points. We load it via a CDN <script> in index.html; it exposes
// itself as `globalThis.h337` (the library's historical global name —
// yes, really).
//
// The library's API is quirky in a few ways that directly shape the
// code below; leaving notes inline rather than burying them in README
// prose:
//
//   1. `h337.create({ container })` requires an actual DOM element as
//      its container and mutates that element by appending a canvas.
//      There is no "offscreen" mode — we construct a detached <div>,
//      size it explicitly, and extract the canvas after creation.
//
//   2. `setData({ max, min, data })` expects `data` as an array of
//      `{ x, y, value }` objects (one per sampled pixel). Passing the
//      full float map at every pixel is wasteful and makes h337's
//      internal rasteriser slow; we stride by roughly width/160 so the
//      largest preset still submits only a few thousand points.
//
//   3. The library normalises colour mapping against `max`. Since
//      `normalisedMap` is already in `[0, 1]`, `max` is always 1.
//
//   4. The output canvas dimensions equal the container dimensions we
//      configured, not the source image's dimensions. Compositing then
//      requires a second canvas so the heatmap can be drawn at
//      `globalAlpha` without permanently burning opacity into the
//      heatmap canvas (which a later download would capture).

/**
 * Render a normalised saliency map to a canvas via heatmap.js.
 *
 * WHY a detached container: `h337.create` requires a container
 * element and appends its canvas into it. We do not want the canvas
 * attached to the live document — callers receive the canvas and
 * place it wherever they like (or composite it into a bigger canvas
 * and throw this one away). The container stays detached and will be
 * garbage-collected along with the canvas once the caller releases
 * their reference.
 *
 * @param {Float32Array} normalisedMap - Row-major, values in `[0, 1]`.
 * @param {number} width - Map width in pixels. Must match `normalisedMap.length / height`.
 * @param {number} height - Map height in pixels.
 * @param {{ radius?: number, blur?: number, opacity?: number }} [options]
 *   - `radius`: point radius in the heatmap rasteriser. 40 px is a
 *     reasonable default at screenshot resolution; larger values smear
 *     the field, smaller values expose the sampling stride.
 *   - `blur`: heatmap.js's internal blur factor `[0, 1]`. 0.85 matches
 *     the library's own demo-site default.
 *   - `opacity`: baseline opacity for the rendered heatmap (0–1).
 *     The compositor applies its own `globalAlpha` on top of this, so
 *     leave this relatively high to let the compositor own the final
 *     blend.
 * @returns {HTMLCanvasElement} The canvas rasterised by heatmap.js.
 */
export function renderHeatmapCanvas(normalisedMap, width, height, options = {}) {
  const { radius = 40, blur = 0.85, opacity = 0.6 } = options;

  const h337 = /** @type {any} */ (globalThis).h337;
  if (!h337 || typeof h337.create !== 'function') {
    throw new Error(
      'heatmap.js is not available on globalThis. Ensure the heatmap.js CDN script is loaded before calling renderHeatmapCanvas().'
    );
  }

  if (normalisedMap.length !== width * height) {
    throw new Error(
      `normalisedMap length ${normalisedMap.length} does not match width*height ${width * height}`
    );
  }

  // Detached container — h337 mutates it but the DOM tree never sees it.
  const container = typeof document !== 'undefined' ? document.createElement('div') : null;
  if (!container) {
    throw new Error('renderHeatmapCanvas requires a DOM (document) to host the heatmap container.');
  }
  container.style.width = `${width}px`;
  container.style.height = `${height}px`;
  // Position off-screen defensively; in practice the container is
  // never attached to the document, but belt-and-braces protects
  // against surprises if a caller ever appends it for debugging.
  container.style.position = 'absolute';
  container.style.left = '-99999px';
  container.style.top = '-99999px';

  const heatmapInstance = h337.create({
    container,
    radius,
    blur,
    maxOpacity: opacity,
    minOpacity: 0,
  });

  // Stride sampling. At preset `very_high` (240×320) we would submit
  // 76 800 points without striding — enough to make h337 stutter on
  // low-end machines. The divisor 160 is tuned to keep the sampled
  // grid roughly constant in absolute terms regardless of input size.
  const stride = Math.max(1, Math.floor(width / 160));

  const data = [];
  for (let y = 0; y < height; y += stride) {
    const row = y * width;
    for (let x = 0; x < width; x += stride) {
      const value = normalisedMap[row + x];
      // Skip near-zero samples — they contribute nothing visually and
      // blow up h337's point count for no gain.
      if (value <= 0.001) continue;
      data.push({ x, y, value });
    }
  }

  heatmapInstance.setData({ max: 1, min: 0, data });

  // h337 exposes its canvas via a private `_renderer.canvas` field.
  // The library has no stable public accessor, so we pluck it here and
  // pray nobody ships a major version that renames it. Documented as a
  // known fragility in LEARNINGS.md.
  const canvas =
    (heatmapInstance._renderer && heatmapInstance._renderer.canvas) ||
    (typeof heatmapInstance.getCanvas === 'function' && heatmapInstance.getCanvas());

  if (!canvas) {
    throw new Error('heatmap.js did not expose a canvas on the instance.');
  }

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
 *   showFixation?: boolean,
 *   fixation?: { x: number, y: number } | null,
 * }} [options]
 * @returns {HTMLCanvasElement}
 */
export function compositeImageAndHeatmap(imageSource, heatmapCanvas, options = {}) {
  const { opacity = 0.6, showFixation = true, fixation = null } = options;

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

  // 2. Heatmap on top at user-controlled opacity. `source-over` is the
  //    default but we set it explicitly to make intent obvious and to
  //    document that the compositor does not rely on any obscure mode.
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
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

  return canvas;
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
