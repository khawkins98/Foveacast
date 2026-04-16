// Image preprocessing for MSI-Net input tensors.
//
// MSI-Net (Kroner et al., 2020) was trained and exported as a Keras /
// TensorFlow Graph Model. Its preprocessing contract is inherited from the
// VGG16 backbone the encoder is built on and is *not* the modern ML-default
// (0–1 normalised, RGB). Specifically:
//
//   1. Channel order is **BGR**, not RGB. VGG16's original Caffe training
//      used BGR; the Keras port preserved that. The reference MSI-Net TF.js
//      demo reverses the channel axis (`tf.reverse(t, axis=2)`) before
//      feeding the net, so we must too.
//
//   2. Pixels are fed in **0–255 float range**, *not* mean-subtracted and
//      *not* scaled to 0–1. The per-channel ImageNet mean subtraction is
//      baked into the first layer of the exported Graph Model — the model
//      handles it internally. Normalising here would double-apply it and
//      silently degrade predictions.
//
//   3. Inputs are resized with bilinear interpolation to the preset's
//      native H×W (aspect ratio is not preserved — the model expects the
//      full frame filling its receptive field, same as the reference demo).
//
// This file is deliberately framework-agnostic. `toInputTensorData` takes a
// plain `ImageData` and returns a `Float32Array` — no `tf` dependency — so
// the bilinear resize is unit-testable under jsdom without a GPU or WebGL
// context. The higher-level `imageSourceToInputData` helper uses a canvas
// to support any `CanvasImageSource`, which is convenient for real
// `<img>`/`<canvas>`/`ImageBitmap` inputs in the app.

/**
 * Input dimensions per quality preset, as `[H, W]` tuples. These five
 * resolutions are the exact sizes the MSI-Net author published TF.js
 * graph-model weights for; picking anything else means the saved graph
 * won't accept the input.
 *
 * @type {Record<'very_low' | 'low' | 'medium' | 'high' | 'very_high', [number, number]>}
 */
export const PRESETS = Object.freeze({
  very_low: [48, 64],
  low: [72, 96],
  medium: [120, 160],
  high: [168, 224],
  very_high: [240, 320],
});

/**
 * Bilinear-resize an `ImageData` to the given target dimensions and return
 * an NHWC-flattened `Float32Array` in BGR order, values clamped to
 * `[0, 255]`, alpha dropped.
 *
 * The output is flat length `H * W * 3` (caller reshapes to `[1, H, W, 3]`
 * when wrapping as a tensor — we leave that to the `model/` layer so this
 * module has no `tf` dependency).
 *
 * Why implement bilinear resize by hand instead of using a canvas? Two
 * reasons:
 *   - Testability. A pure function that takes `ImageData` in and a typed
 *     array out can be asserted on without touching the DOM.
 *   - Determinism. Canvas resampling quality varies across browsers (see
 *     `imageSmoothingQuality`). A bespoke bilinear filter gives us the
 *     same arithmetic everywhere, which matters when diffing against the
 *     reference demo.
 *
 * The implementation uses the "align corners = false" convention (sample
 * centres map to `(x + 0.5) * srcW / dstW - 0.5`), matching TensorFlow's
 * default `resizeBilinear` behaviour — which is what the reference demo
 * relies on.
 *
 * @param {ImageData} imageData - Pixels from `ctx.getImageData(...)`.
 * @param {[number, number]} inputDims - Target `[H, W]`.
 * @returns {Float32Array} Length `H * W * 3`, BGR, 0–255.
 */
export function toInputTensorData(imageData, inputDims) {
  const [dstH, dstW] = inputDims;
  const srcW = imageData.width;
  const srcH = imageData.height;
  const src = imageData.data; // Uint8ClampedArray, RGBA

  const out = new Float32Array(dstH * dstW * 3);

  // Handle the degenerate 1×1 source case up front. The general code path
  // below also works, but this makes the intent explicit and dodges a
  // subtle issue where `srcW - 1 === 0` yields 0/0 NaN in the "align
  // corners = true" formulation. We use align-corners=false throughout, but
  // the shortcut is still a welcome guardrail.
  if (srcW === 1 && srcH === 1) {
    const r = src[0];
    const g = src[1];
    const b = src[2];
    for (let i = 0; i < dstH * dstW; i++) {
      const o = i * 3;
      out[o] = clamp255(b);
      out[o + 1] = clamp255(g);
      out[o + 2] = clamp255(r);
    }
    return out;
  }

  // Pre-compute scale factors. "align corners = false" maps destination
  // pixel centres to source pixel centres via (dst + 0.5) * (src/dst) - 0.5
  // — i.e. the half-pixel offsets are baked into the mapping.
  const scaleY = srcH / dstH;
  const scaleX = srcW / dstW;

  for (let y = 0; y < dstH; y++) {
    // Source y-coordinate for the centre of destination row y.
    const srcY = (y + 0.5) * scaleY - 0.5;
    const y0 = Math.floor(srcY);
    const y1 = y0 + 1;
    const wy = srcY - y0;
    // Clamp to valid source range. This is how most image libraries
    // handle edge pixels; it's equivalent to "replicate" border mode.
    const y0c = y0 < 0 ? 0 : y0 >= srcH ? srcH - 1 : y0;
    const y1c = y1 < 0 ? 0 : y1 >= srcH ? srcH - 1 : y1;

    for (let x = 0; x < dstW; x++) {
      const srcX = (x + 0.5) * scaleX - 0.5;
      const x0 = Math.floor(srcX);
      const x1 = x0 + 1;
      const wx = srcX - x0;
      const x0c = x0 < 0 ? 0 : x0 >= srcW ? srcW - 1 : x0;
      const x1c = x1 < 0 ? 0 : x1 >= srcW ? srcW - 1 : x1;

      // Four neighbour offsets into RGBA source.
      const i00 = (y0c * srcW + x0c) * 4;
      const i01 = (y0c * srcW + x1c) * 4;
      const i10 = (y1c * srcW + x0c) * 4;
      const i11 = (y1c * srcW + x1c) * 4;

      // Bilinear interpolate each RGB channel independently (alpha dropped).
      const r = lerp2(src[i00], src[i01], src[i10], src[i11], wx, wy);
      const g = lerp2(src[i00 + 1], src[i01 + 1], src[i10 + 1], src[i11 + 1], wx, wy);
      const b = lerp2(src[i00 + 2], src[i01 + 2], src[i10 + 2], src[i11 + 2], wx, wy);

      // NHWC layout (batch=1 implied), BGR channel order.
      const o = (y * dstW + x) * 3;
      out[o] = clamp255(b);
      out[o + 1] = clamp255(g);
      out[o + 2] = clamp255(r);
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

/** Clamp a float to the 0–255 pixel range. @private */
function clamp255(v) {
  if (v < 0) return 0;
  if (v > 255) return 255;
  return v;
}

/**
 * Higher-level convenience: take any `CanvasImageSource` (e.g. `<img>`,
 * `<canvas>`, `ImageBitmap`) and produce the preprocessed input data plus
 * the source's natural dimensions (which the post-processing stage needs
 * in order to upsample the saliency map back to the original screenshot's
 * resolution).
 *
 * This *does* depend on a canvas being available, so it is kept separate
 * from `toInputTensorData` to keep that function pure and trivially
 * testable without a DOM.
 *
 * @param {CanvasImageSource & { naturalWidth?: number, width?: number, naturalHeight?: number, height?: number }} source
 * @param {[number, number]} inputDims
 * @returns {{ data: Float32Array, sourceWidth: number, sourceHeight: number }}
 */
export function imageSourceToInputData(source, inputDims) {
  // Pull the natural size out of whatever was passed in. Different source
  // types expose it under different properties, hence the fallbacks.
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
  // can read pixels. We deliberately do NOT let the canvas do the resize
  // to input dims here — we want the deterministic JS bilinear path for
  // that, via `toInputTensorData`.
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
 * Downsample a source to at most `maxWidth` pixels wide, preserving aspect
 * ratio. Always returns an `HTMLCanvasElement` — even if no downsampling is
 * needed — so callers have a uniform type to pass on to the preprocessing
 * pipeline.
 *
 * Why this exists: the PRD §Memory and System Requirements rules that
 * images wider than 2560px get downsampled to 2560px *before* preprocessing,
 * regardless of preset, to avoid OOM on large retina screenshots. We do this
 * here, with canvas `imageSmoothingEnabled = true` giving us a "good enough"
 * bilinear resample; quality at this stage is not load-bearing because the
 * input tensor is a tiny 48–240 rows tall anyway.
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

  // If already within limit, still normalise into a canvas so callers can
  // treat every return value the same.
  if (srcW <= maxWidth) {
    const canvas = document.createElement('canvas');
    canvas.width = srcW;
    canvas.height = srcH;
    // In real browsers getContext('2d') always returns a context; under
    // jsdom it returns null because jsdom doesn't implement canvas
    // rasterisation. Guard so this function stays unit-testable — callers
    // that actually need pixel data will hit the real-browser path.
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.drawImage(source, 0, 0, srcW, srcH);
    return canvas;
  }

  // Preserve aspect ratio when clamping width.
  const scale = maxWidth / srcW;
  // Use `Math.round` rather than `Math.floor` so a 3000x1500 source
  // produces 2560x1280 (exact) rather than 1279.
  const dstW = maxWidth;
  const dstH = Math.round(srcH * scale);

  const canvas = document.createElement('canvas');
  canvas.width = dstW;
  canvas.height = dstH;
  const ctx = canvas.getContext('2d');
  // jsdom returns null here; guard so tests can exercise the dimension
  // arithmetic without a working canvas rasteriser.
  if (ctx) {
    // Canvas bilinear-ish resample. The PRD only requires "downsampled to
    // 2560px"; exact filter quality is not important at this stage.
    ctx.imageSmoothingEnabled = true;
    if ('imageSmoothingQuality' in ctx) {
      /** @type {any} */ (ctx).imageSmoothingQuality = 'high';
    }
    ctx.drawImage(source, 0, 0, dstW, dstH);
  }
  return canvas;
}
