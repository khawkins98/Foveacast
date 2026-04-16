// Image preprocessing for UNISAL input tensors.
//
// UNISAL (Droste, Jiao & Noble, ECCV 2020) is an ImageNet-pretrained
// MobileNetV2-backbone model. Its preprocessing contract differs from
// the V1 MSI-Net pipeline in three ways we have to get right for the
// exported ONNX graph to produce correct output:
//
//   1. Channel order is **RGB**, not BGR. The VGG-era channel-reverse
//      step is gone — modern backbones keep RGB throughout.
//
//   2. Pixels are scaled to **0–1** and then **normalised by ImageNet
//      per-channel mean/std** before inference. The normalisation is
//      NOT baked into the model graph — it has to happen here.
//      Mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225].
//      Values from docs/spikes/unisal-onnx-research.md (taken in turn
//      from rdroste/unisal's SALICONDataset.json).
//
//   3. Layout is **NCHW** (`[1, 3, H, W]`), not NHWC. The ONNX graph
//      was exported with a fixed `[1, 3, 288, 384]` input — this
//      module produces the flat float array in NCHW order; the
//      `model/inference.js` layer wraps it as an ort.Tensor.
//
// This file is deliberately framework-agnostic: `toInputTensorData`
// takes a plain `ImageData` and returns a `Float32Array`. No
// `onnxruntime-web` dependency, so the bilinear resize is
// unit-testable under jsdom without a GPU or browser WASM context.

/**
 * UNISAL's native SALICON input size as `[H, W]`. 288 high, 384 wide —
 * the resolution the model was exported against, matching the values
 * in rdroste/unisal's SALICONDataset.json.
 *
 * Exported as a frozen tuple so callers can reference it without
 * guessing. Loader.js imports this rather than redefining it.
 *
 * @type {readonly [number, number]}
 */
export const UNISAL_INPUT_DIMS = /** @type {const} */ ([288, 384]);

/**
 * ImageNet mean / std used by UNISAL's preprocessing. Per-channel,
 * indexed [R, G, B]. Source: rdroste/unisal SALICONDataset.json.
 */
const IMAGENET_MEAN = /** @type {const} */ ([0.485, 0.456, 0.406]);
const IMAGENET_STD = /** @type {const} */ ([0.229, 0.224, 0.225]);

/**
 * Bilinear-resize an `ImageData` to the given target dimensions and
 * return an NCHW-flattened `Float32Array` in RGB order, values
 * ImageNet-normalised.
 *
 * Output layout: channel-plane-major. The red channel fills the first
 * `H * W` slots, green the next `H * W`, blue the last `H * W`.
 * Caller wraps as `[1, 3, H, W]` (NCHW) on the ORT side.
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
 * `F.interpolate(mode='bilinear', align_corners=False)` — which is
 * what UNISAL was trained against.
 *
 * @param {ImageData} imageData - Pixels from `ctx.getImageData(...)`.
 * @param {[number, number]} inputDims - Target `[H, W]`.
 * @returns {Float32Array} Length `3 * H * W`, NCHW, RGB, ImageNet-normalised.
 */
export function toInputTensorData(imageData, inputDims) {
  const [dstH, dstW] = inputDims;
  const srcW = imageData.width;
  const srcH = imageData.height;
  const src = imageData.data; // Uint8ClampedArray, RGBA

  const plane = dstH * dstW;
  const out = new Float32Array(plane * 3);

  const rMean = IMAGENET_MEAN[0];
  const gMean = IMAGENET_MEAN[1];
  const bMean = IMAGENET_MEAN[2];
  const rStd = IMAGENET_STD[0];
  const gStd = IMAGENET_STD[1];
  const bStd = IMAGENET_STD[2];

  // Degenerate 1×1 source — fill every output pixel with the same
  // normalised value. Guards against srcW-1=0 divide-by-zero paths in
  // some bilinear formulations; we use align-corners=false which
  // doesn't have that problem, but the shortcut is cheaper and clearer.
  if (srcW === 1 && srcH === 1) {
    const r = (src[0] / 255 - rMean) / rStd;
    const g = (src[1] / 255 - gMean) / gStd;
    const b = (src[2] / 255 - bMean) / bStd;
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
      // Normalise: 0-255 → 0-1 → subtract per-channel mean → divide by std.
      out[off] = (r / 255 - rMean) / rStd;
      out[plane + off] = (g / 255 - gMean) / gStd;
      out[2 * plane + off] = (b / 255 - bMean) / bStd;
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
