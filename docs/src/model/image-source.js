// Input adapter: converts any CanvasImageSource to the flat Float32Array
// that the inference layer feeds to ort.Tensor.
//
// Why this lives in model/ rather than pipeline/:
//   `pipeline/` is pure JS (no DOM, no browser APIs) — a deliberate
//   constraint that keeps the pipeline unit-testable under jsdom without
//   a real 2D canvas context. `imageSourceToInputData` needs
//   `document.createElement('canvas')` and `ctx.getImageData`, so it
//   belongs in the model layer as an input adapter, alongside the
//   inference machinery it feeds.

import { toInputTensorData } from '../pipeline/preprocess.js';

/**
 * Take any `CanvasImageSource` (e.g. `<img>`, `<canvas>`, `ImageBitmap`)
 * and produce the preprocessed model-input data plus the source's natural
 * dimensions. The post-processing stage needs the original dimensions to
 * upsample the saliency map back to the screenshot's resolution.
 *
 * This function is the only call site of `toInputTensorData` outside of
 * tests: it bridges the DOM world (image pixels) into the pipeline layer
 * (pure Float32Array arithmetic).
 *
 * @param {CanvasImageSource & { naturalWidth?: number, width?: number, naturalHeight?: number, height?: number }} source
 * @param {[number, number]} inputDims - Model input `[H, W]`.
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
