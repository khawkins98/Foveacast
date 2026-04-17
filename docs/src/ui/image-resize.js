// UI-layer image resize helper.
//
// Why this lives in ui/ rather than pipeline/:
//   `pipeline/` is pure JS (no DOM, no browser APIs). `downsampleIfLarge`
//   must call `document.createElement('canvas')`, so it belongs in the
//   outermost (ui) layer with the other DOM-touching helpers. It is only
//   ever called from `main.js` and `demo.js` — the application entry
//   points — which are themselves ui-layer code.

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
