/**
 * render/plain-canvas.js
 *
 * Renders an image source onto a plain canvas at the image's native
 * pixel dimensions, with no overlay or compositing. Kept in the render
 * layer because it touches HTMLCanvasElement and CanvasRenderingContext2D.
 */

/**
 * Build a canvas containing only the source image at its own pixel size.
 * Used for the 'original' view and as the left panel of the side-by-side view.
 *
 * @param {HTMLImageElement | ImageBitmap | HTMLCanvasElement} imageSource
 * @returns {HTMLCanvasElement}
 */
export function drawPlainImageCanvas(imageSource) {
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
  if (ctx) ctx.drawImage(imageSource, 0, 0, width, height);
  return canvas;
}
