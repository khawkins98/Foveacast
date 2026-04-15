// Canvas → PNG download helper.
//
// The "save the composited heatmap" button calls into here. We pick
// `canvas.toBlob` over `toDataURL` because large screenshots at High
// preset produce data URLs in the tens of megabytes — browsers choke
// on them, and Safari in particular truncates long anchor `href`s.
// Blob + object URL is both faster and more reliable.

/**
 * Download a canvas as a PNG file by programmatically clicking a
 * temporary anchor. Returns a promise that resolves once the Blob has
 * been generated and the URL revoked.
 *
 * WHY revoke the URL: object URLs anchor memory to the document's
 * lifetime. For a short download click we want to release that memory
 * as soon as the browser has handed the file off to the user.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {string} [filename='foveacast-heatmap.png']
 * @returns {Promise<void>}
 */
export async function downloadCompositeAsPng(canvas, filename = 'foveacast-heatmap.png') {
  if (!canvas || typeof canvas.toBlob !== 'function') {
    throw new Error('downloadCompositeAsPng requires a canvas with toBlob support.');
  }

  const blob = await new Promise((resolve, reject) => {
    try {
      canvas.toBlob((result) => {
        if (!result) {
          reject(new Error('Canvas failed to produce a PNG blob.'));
          return;
        }
        resolve(result);
      }, 'image/png');
    } catch (err) {
      reject(err);
    }
  });

  const url = URL.createObjectURL(/** @type {Blob} */ (blob));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  // Firefox requires the anchor to be in the document for the click
  // to trigger a download. Chrome/Safari do not, but appending is
  // harmless — we remove it immediately afterwards.
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);

  // Revoke on the next tick so the browser has a beat to start the
  // download before the URL vanishes.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
