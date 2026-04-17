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

// Re-export compositeImageAndHeatmap and drawFixationCrosshair from
// the original heatmap.js module since the compositor is still useful.
// Only the RENDERING function changed — the compositing logic
// (source image + heatmap at alpha + crosshair + watermark) stays.
export { compositeImageAndHeatmap } from './heatmap.js';
