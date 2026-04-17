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
// This file is deliberately framework-agnostic: `toInputTensorData`
// takes a plain `ImageData` and returns a `Float32Array`. No
// `onnxruntime-web` dependency, so the bilinear resize is
// unit-testable under jsdom without a GPU or browser WASM context.

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

  // Degenerate 1×1 source — fill every output pixel with the same value.
  if (srcW === 1 && srcH === 1) {
    const r = src[0];
    const g = src[1];
    const b = src[2];
    for (let i = 0; i < plane; i++) {
      out[i] = r;
      out[plane + i] = g;
      out[2 * plane + i] = b;
    }
    return out;
  }

  // Pre-compute scale factors. "align corners = false" maps destination
  // pixel centres to source pixel centres via (dst + 0.5) * (src/dst) - 0.5.
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

      const i00 = (y0c * srcW + x0c) * 4;
      const i01 = (y0c * srcW + x1c) * 4;
      const i10 = (y1c * srcW + x0c) * 4;
      const i11 = (y1c * srcW + x1c) * 4;

      // Bilinear interpolate each RGB channel (alpha dropped).
      const r = lerp2(src[i00], src[i01], src[i10], src[i11], wx, wy);
      const g = lerp2(src[i00 + 1], src[i01 + 1], src[i10 + 1], src[i11 + 1], wx, wy);
      const b = lerp2(src[i00 + 2], src[i01 + 2], src[i10 + 2], src[i11 + 2], wx, wy);

      const off = y * dstW + x;
      // Raw 0–255 float values — no normalisation. The ONNX graph
      // handles mean subtraction internally.
      out[off] = clamp255(r);
      out[plane + off] = clamp255(g);
      out[2 * plane + off] = clamp255(b);
    }
  }

  return out;
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

/**
 * Higher-level convenience: take any `CanvasImageSource` (e.g. `<img>`,
 * `<canvas>`, `ImageBitmap`) and produce the preprocessed input data
 * plus the source's natural dimensions (which the post-processing
 * stage needs in order to upsample the saliency map back to the
 * original screenshot's resolution).
 *
 * This *does* depend on a canvas being available, so it is kept
 * separate from `toInputTensorData` to keep that function pure and
 * trivially testable without a DOM.
 *
 * @param {CanvasImageSource & { naturalWidth?: number, width?: number, naturalHeight?: number, height?: number }} source
 * @param {[number, number]} inputDims
 * @returns {{ data: Float32Array, sourceWidth: number, sourceHeight: number }}
 */
export function imageSourceToInputData(source, inputDims) {
  const sourceWidth =
    /** @type {any} */ (source).naturalWidth ||
    /** @type {any} */ (source).width ||
    0;
  const sourceHeight =
    /** @type {any} */ (source).naturalHeight ||
    /** @type {any} */ (source).height ||
    0;

  if (!sourceWidth || !sourceHeight) {
    throw new Error('imageSourceToInputData: source has zero width or height');
  }

  // Draw the source to an offscreen canvas at its *natural* size so we
  // can read pixels. Do NOT let the canvas do the input-dim resize —
  // the deterministic JS bilinear path in `toInputTensorData` owns that.
  const canvas = document.createElement('canvas');
  canvas.width = sourceWidth;
  canvas.height = sourceHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('imageSourceToInputData: could not get 2D context');
  }
  ctx.drawImage(source, 0, 0, sourceWidth, sourceHeight);
  const imageData = ctx.getImageData(0, 0, sourceWidth, sourceHeight);

  const data = toInputTensorData(imageData, inputDims);
  return { data, sourceWidth, sourceHeight };
}

/**
 * Downsample a source to at most `maxWidth` pixels wide, preserving
 * aspect ratio. Always returns an `HTMLCanvasElement` — even if no
 * downsampling is needed — so callers have a uniform type to pass on
 * to the preprocessing pipeline.
 *
 * Why this exists: the PRD §Memory and System Requirements rules that
 * images wider than 2560px get downsampled to 2560px *before*
 * preprocessing, regardless of which model version is in use, to
 * avoid OOM on large retina screenshots. Canvas `imageSmoothingEnabled
 * = true` gives us a "good enough" bilinear resample; quality at this
 * stage is not load-bearing because the input tensor is a tiny 288
 * rows tall anyway.
 *
 * @param {CanvasImageSource & { naturalWidth?: number, width?: number, naturalHeight?: number, height?: number }} source
 * @param {number} [maxWidth=2560]
 * @returns {HTMLCanvasElement}
 */
export function downsampleIfLarge(source, maxWidth = 2560) {
  const srcW =
    /** @type {any} */ (source).naturalWidth ||
    /** @type {any} */ (source).width ||
    0;
  const srcH =
    /** @type {any} */ (source).naturalHeight ||
    /** @type {any} */ (source).height ||
    0;

  if (!srcW || !srcH) {
    throw new Error('downsampleIfLarge: source has zero width or height');
  }

  if (srcW <= maxWidth) {
    const canvas = document.createElement('canvas');
    canvas.width = srcW;
    canvas.height = srcH;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.drawImage(source, 0, 0, srcW, srcH);
    return canvas;
  }

  const scale = maxWidth / srcW;
  const dstW = maxWidth;
  const dstH = Math.round(srcH * scale);

  const canvas = document.createElement('canvas');
  canvas.width = dstW;
  canvas.height = dstH;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.imageSmoothingEnabled = true;
    if ('imageSmoothingQuality' in ctx) {
      /** @type {any} */ (ctx).imageSmoothingQuality = 'high';
    }
    ctx.drawImage(source, 0, 0, dstW, dstH);
  }
  return canvas;
}
