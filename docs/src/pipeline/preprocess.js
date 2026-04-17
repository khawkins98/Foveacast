// Image preprocessing for the V3 MSI-Net saliency model.
//
// V3 is MSI-Net (Kroner et al. 2020) fine-tuned on UEyes (Jiang et al.
// 2023) and exported as an ONNX graph from foveacast-training
// (https://github.com/khawkins98/foveacast-training). Its preprocessing
// contract:
//
//   1. Channel order is **RGB**. The VGG-era BGR convention from V1 is
//      gone — the PyTorch port and the ONNX export both use RGB.
//
//   2. Pixels are fed in **0–255 float range**. No ImageNet mean/std
//      normalisation here — the per-channel mean subtraction is baked
//      into the ONNX graph at export time (see msinet.py in
//      foveacast-training). Normalising here would double-apply it.
//
//   3. Layout is **NCHW** (`[1, 3, H, W]`). The ONNX graph was
//      exported with a fixed `[1, 3, 240, 320]` input — this module
//      produces the flat float array in NCHW order; the
//      `model/inference.js` layer wraps it as an ort.Tensor.
//
// This file is pure JS — no DOM, no browser APIs, no library imports.
// `toInputTensorData` takes a plain `ImageData` and returns a
// `Float32Array`, so it is unit-testable under jsdom without a GPU or
// browser WASM context. DOM-touching entry points live in their correct
// layers: `imageSourceToInputData` in `model/image-source.js` (model
// input adapter) and `downsampleIfLarge` in `ui/image-resize.js` (ui
// helper called from main.js/demo.js).

/**
 * V3 MSI-Net input size as `[H, W]`. 240 high, 320 wide — the
 * SALICON-native resolution the model was fine-tuned and exported at.
 * See ARCHITECTURE.md in foveacast-training for the contract.
 *
 * @type {readonly [number, number]}
 */
export const MODEL_INPUT_DIMS = /** @type {const} */ ([240, 320]);

/**
 * Bilinear-resize an `ImageData` to the given target dimensions and
 * return an NCHW-flattened `Float32Array` in RGB order, values in
 * [0, 255].
 *
 * Output layout: channel-plane-major. The red channel fills the first
 * `H * W` slots, green the next `H * W`, blue the last `H * W`.
 * Caller wraps as `[1, 3, H, W]` (NCHW) on the ORT side.
 *
 * No normalisation is applied — the V3 ONNX graph handles mean
 * subtraction internally. Feeding 0–1 or ImageNet-normalised values
 * would double-apply the preprocessing and silently degrade output.
 *
 * Why implement bilinear resize by hand instead of leaning on canvas
 * resampling? Two reasons carry over unchanged from V1:
 *   - Testability. A pure function that takes `ImageData` in and a
 *     typed array out can be asserted on without touching the DOM.
 *   - Determinism. Canvas resampling quality varies across browsers
 *     (see `imageSmoothingQuality`). A bespoke bilinear filter gives
 *     us the same arithmetic everywhere.
 *
 * "align corners = false" convention (sample centres map to
 * `(x + 0.5) * srcW / dstW - 0.5`), matching PyTorch's default
 * `F.interpolate(mode='bilinear', align_corners=False)`.
 *
 * @param {ImageData} imageData - Pixels from `ctx.getImageData(...)`.
 * @param {[number, number]} inputDims - Target `[H, W]`.
 * @returns {Float32Array} Length `3 * H * W`, NCHW, RGB, 0–255.
 */
export function toInputTensorData(imageData, inputDims) {
  const [dstH, dstW] = inputDims;
  const srcW = imageData.width;
  const srcH = imageData.height;
  const src = imageData.data; // Uint8ClampedArray, RGBA

  const plane = dstH * dstW;
  const out = new Float32Array(plane * 3);

  // why: V3 MSI-Net was fine-tuned with aspect-ratio-preserving resize +
  // constant-126 padding (Kroner's convention, matching UEyesDataset in
  // foveacast-training). Stretching the image to fill 240×320 without
  // padding distorts the input away from the training distribution and
  // produces noticeably worse saliency predictions. The padding value
  // 126 is mid-grey — the same value Kroner used and UEyesDataset uses.
  const PAD_VALUE = 126;

  // Compute the scaled dimensions that fit within the target while
  // preserving aspect ratio.
  const scale = Math.min(dstH / srcH, dstW / srcW);
  const scaledH = Math.max(1, Math.round(srcH * scale));
  const scaledW = Math.max(1, Math.round(srcW * scale));

  // Padding offsets (centred). Extra pixel goes bottom/right.
  const padTop = Math.floor((dstH - scaledH) / 2);
  const padLeft = Math.floor((dstW - scaledW) / 2);

  // Fill entire output with the pad value first (all three planes).
  for (let i = 0; i < plane * 3; i++) {
    out[i] = PAD_VALUE;
  }

  // Degenerate 1×1 source — fill the scaled region with the single pixel.
  if (srcW === 1 && srcH === 1) {
    const r = src[0];
    const g = src[1];
    const b = src[2];
    for (let y = 0; y < scaledH; y++) {
      for (let x = 0; x < scaledW; x++) {
        const off = (padTop + y) * dstW + (padLeft + x);
        out[off] = r;
        out[plane + off] = g;
        out[2 * plane + off] = b;
      }
    }
    return out;
  }

  // Pre-compute scale factors for the bilinear resize into the scaled
  // (non-padded) region. "align corners = false": (dst + 0.5) * (src/dst) - 0.5.
  const scaleY = srcH / scaledH;
  const scaleX = srcW / scaledW;

  // Bilinear-resize the source into the scaled region (not the full
  // dstH × dstW frame — the padding stays at PAD_VALUE).
  for (let y = 0; y < scaledH; y++) {
    const srcY = (y + 0.5) * scaleY - 0.5;
    const y0 = Math.floor(srcY);
    const y1 = y0 + 1;
    const wy = srcY - y0;
    const y0c = y0 < 0 ? 0 : y0 >= srcH ? srcH - 1 : y0;
    const y1c = y1 < 0 ? 0 : y1 >= srcH ? srcH - 1 : y1;

    for (let x = 0; x < scaledW; x++) {
      const srcX = (x + 0.5) * scaleX - 0.5;
      const x0 = Math.floor(srcX);
      const x1 = x0 + 1;
      const wx = srcX - x0;
      const x0c = x0 < 0 ? 0 : x0 >= srcW ? srcW - 1 : x0;
      const x1c = x1 < 0 ? 0 : x1 >= srcW ? srcW - 1 : x1;

      const i00 = (y0c * srcW + x0c) * 4;
      const i01 = (y0c * srcW + x1c) * 4;
      const i10 = (y1c * srcW + x0c) * 4;
      const i11 = (y1c * srcW + x1c) * 4;

      // Bilinear interpolate each RGB channel (alpha dropped).
      const r = lerp2(src[i00], src[i01], src[i10], src[i11], wx, wy);
      const g = lerp2(src[i00 + 1], src[i01 + 1], src[i10 + 1], src[i11 + 1], wx, wy);
      const b = lerp2(src[i00 + 2], src[i01 + 2], src[i10 + 2], src[i11 + 2], wx, wy);

      // Write into the padded position within the full dstH × dstW frame.
      const off = (padTop + y) * dstW + (padLeft + x);
      out[off] = clamp255(r);
      out[plane + off] = clamp255(g);
      out[2 * plane + off] = clamp255(b);
    }
  }

  return out;
}

/** Clamp a float to the 0–255 pixel range. @private */
function clamp255(v) {
  if (v < 0) return 0;
  if (v > 255) return 255;
  return v;
}

/**
 * Two-axis linear interpolation: blends 4 neighbours by weights `wx`, `wy`.
 * @private
 */
function lerp2(v00, v01, v10, v11, wx, wy) {
  const top = v00 + (v01 - v00) * wx;
  const bot = v10 + (v11 - v10) * wx;
  return top + (bot - top) * wy;
}
