// Saliency-map post-processing.
//
// The raw output of UNISAL is a `[inputH × inputW]` Float32 tensor of
// **log-probabilities**: one log-softmax value per input-resolution
// pixel. Before this map is useful for an overlay, we apply four steps:
//
//   1. Convert log-probabilities to probabilities via `exp`. The raw
//      output range of about `[-23, -8]` is consistent with log-softmax
//      over the 288×384 grid; applying `exp(y - y.max())` recovers the
//      proper probability-like saliency map without numerical overflow.
//      (V1's MSI-Net emitted 0–255 intensity directly and did not need
//      this step — that is the only pipeline-math difference between
//      V1 and V2.)
//   2. Bilinearly upsample to the original screenshot's dimensions so
//      each saliency value aligns with a real-world pixel on the user's
//      canvas.
//   3. Apply a Gaussian blur with σ ≈ 20–40 px at 1× resolution, which
//      smooths out the staircase edges introduced by the upsample and
//      produces visually-pleasant contour lines after the heatmap.js
//      colour ramp is applied.
//   4. Rescale to [0, 1] so the heatmap library's default colour ramp
//      has consistent dynamic range regardless of the absolute values.
//
// All functions here are pure — they take and return typed arrays,
// never touch a canvas — so they unit-test cleanly under jsdom or node.

/**
 * Bilinearly upsample (or downsample) a single-channel saliency map.
 *
 * Uses the "align corners = false" convention (pixel-centre offsets), the
 * same as `toInputTensorData`'s resize. Keeping the same convention on
 * both ends of the pipeline means the saliency mass stays centred over
 * the feature that caused it.
 *
 * @param {Float32Array} raw - Length `srcH * srcW`, row-major.
 * @param {[number, number]} srcDims - `[srcH, srcW]`.
 * @param {[number, number]} targetDims - `[dstH, dstW]`.
 * @returns {Float32Array} Length `dstH * dstW`.
 */
export function upsampleBilinear(raw, srcDims, targetDims) {
  const [srcH, srcW] = srcDims;
  const [dstH, dstW] = targetDims;
  const out = new Float32Array(dstH * dstW);

  if (srcW === 1 && srcH === 1) {
    out.fill(raw[0]);
    return out;
  }

  const scaleY = srcH / dstH;
  const scaleX = srcW / dstW;

  for (let y = 0; y < dstH; y++) {
    const srcY = (y + 0.5) * scaleY - 0.5;
    const y0 = Math.floor(srcY);
    const y1 = y0 + 1;
    const wy = srcY - y0;
    const y0c = y0 < 0 ? 0 : y0 >= srcH ? srcH - 1 : y0;
    const y1c = y1 < 0 ? 0 : y1 >= srcH ? srcH - 1 : y1;

    for (let x = 0; x < dstW; x++) {
      const srcX = (x + 0.5) * scaleX - 0.5;
      const x0 = Math.floor(srcX);
      const x1 = x0 + 1;
      const wx = srcX - x0;
      const x0c = x0 < 0 ? 0 : x0 >= srcW ? srcW - 1 : x0;
      const x1c = x1 < 0 ? 0 : x1 >= srcW ? srcW - 1 : x1;

      const v00 = raw[y0c * srcW + x0c];
      const v01 = raw[y0c * srcW + x1c];
      const v10 = raw[y1c * srcW + x0c];
      const v11 = raw[y1c * srcW + x1c];

      const top = v00 + (v01 - v00) * wx;
      const bot = v10 + (v11 - v10) * wx;
      out[y * dstW + x] = top + (bot - top) * wy;
    }
  }
  return out;
}

/**
 * Separable 1D Gaussian blur. Allocates and returns a new Float32Array;
 * the input `data` is not mutated.
 *
 * Edge handling: "replicate" (clamp-to-edge). This matches the behaviour
 * of most image libraries and avoids dimming the bright spots that sit
 * near the screenshot edges - a zero-padded convolution would pull values
 * at the border toward zero, which is visually jarring and distorts the
 * top-10% centroid computed downstream.
 *
 * @param {Float32Array} data - Length `h * w`.
 * @param {[number, number]} dims - `[h, w]`.
 * @param {number} sigmaPx - Standard deviation in pixels. Must be > 0.
 * @returns {Float32Array} A new blurred array, length `h * w`.
 */
export function gaussianBlur(data, dims, sigmaPx) {
  if (!(sigmaPx > 0)) {
    // A non-positive sigma is a degenerate request for no blur. Return a
    // copy so callers can always treat the result as independent storage.
    return new Float32Array(data);
  }

  const [h, w] = dims;

  // Kernel radius = 3σ captures ~99.7% of the Gaussian's energy. Kernel
  // width = 2r + 1 odd so we have a centre tap.
  const radius = Math.max(1, Math.ceil(3 * sigmaPx));
  const kernel = new Float32Array(radius * 2 + 1);
  const twoSigmaSq = 2 * sigmaPx * sigmaPx;
  let ksum = 0;
  for (let i = -radius; i <= radius; i++) {
    const v = Math.exp(-(i * i) / twoSigmaSq);
    kernel[i + radius] = v;
    ksum += v;
  }
  // Normalise so the kernel sums to 1 - this is the "energy preservation"
  // property tested below: convolving a delta preserves its total mass.
  for (let i = 0; i < kernel.length; i++) kernel[i] /= ksum;

  // Horizontal pass into a temp buffer.
  const tmp = new Float32Array(h * w);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++) {
        let sx = x + k;
        if (sx < 0) sx = 0;
        else if (sx >= w) sx = w - 1;
        acc += data[y * w + sx] * kernel[k + radius];
      }
      tmp[y * w + x] = acc;
    }
  }

  // Vertical pass into the output.
  const out = new Float32Array(h * w);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++) {
        let sy = y + k;
        if (sy < 0) sy = 0;
        else if (sy >= h) sy = h - 1;
        acc += tmp[sy * w + x] * kernel[k + radius];
      }
      out[y * w + x] = acc;
    }
  }

  return out;
}

/**
 * Rescale an array so `min -> 0` and `max -> 1`. Returns a new
 * Float32Array; input is not mutated.
 *
 * If the input is constant (max == min, within floating-point tolerance),
 * returns a zero-filled array — a "flat" saliency map has no meaningful
 * ordering, and dividing by zero would poison the overlay with NaNs.
 *
 * @param {Float32Array} data
 * @returns {Float32Array}
 */
export function normaliseToUnit(data) {
  const out = new Float32Array(data.length);
  if (data.length === 0) return out;

  let min = data[0];
  let max = data[0];
  for (let i = 1; i < data.length; i++) {
    const v = data[i];
    if (v < min) min = v;
    else if (v > max) max = v;
  }

  const range = max - min;
  if (range <= 0) {
    // Already filled with zeros by the Float32Array constructor.
    return out;
  }
  const inv = 1 / range;
  for (let i = 0; i < data.length; i++) {
    out[i] = (data[i] - min) * inv;
  }
  return out;
}

/**
 * Convert a log-probability saliency map into a probability-like map
 * via a numerically-stable `exp(y - max(y))`. Subtracting the max
 * before `exp` keeps the result in `[0, 1]` and prevents `Infinity`
 * for log-probs close to zero (which should not happen for UNISAL
 * output, but cheap to guard against).
 *
 * Returns a NEW Float32Array; the input is not mutated. If the input
 * is empty, returns an empty array rather than erroring.
 *
 * @param {Float32Array} data - Log-probability saliency map.
 * @returns {Float32Array}
 */
export function logProbsToProbabilities(data) {
  const out = new Float32Array(data.length);
  if (data.length === 0) return out;
  let max = data[0];
  for (let i = 1; i < data.length; i++) {
    if (data[i] > max) max = data[i];
  }
  for (let i = 0; i < data.length; i++) {
    out[i] = Math.exp(data[i] - max);
  }
  return out;
}

/**
 * Full post-processing pipeline: upsample → blur → normalise.
 *
 * V3 MSI-Net outputs saliency already in [0, 1] (min-max normalised
 * inside the ONNX graph), so there is no log-probability exp step.
 * The pipeline is: upsample to the user's screenshot resolution →
 * Gaussian blur for smooth contours → normalise to [0, 1].
 *
 * Default `sigmaPx = 28` sits in the middle of the PRD's specified
 * 20–40 px range. 28 gives a visibly smooth contour without washing
 * out the location of the attention peak.
 *
 * @param {Float32Array} raw - Model output, length `srcH * srcW`, values in [0, 1].
 * @param {[number, number]} srcDims - Model output dims `[srcH, srcW]`.
 * @param {[number, number]} targetDims - Final dims `[h, w]` to upsample to.
 * @param {number} [sigmaPx=28] - Gaussian sigma in target-space pixels.
 * @returns {Float32Array} Length `targetH * targetW`, values in `[0, 1]`.
 */
export function postprocess(raw, srcDims, targetDims, sigmaPx = 28) {
  // V3: raw is already [0, 1], no logProbsToProbabilities needed.
  const upsampled = upsampleBilinear(raw, srcDims, targetDims);
  const blurred = gaussianBlur(upsampled, targetDims, sigmaPx);
  return normaliseToUnit(blurred);
}
