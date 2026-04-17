// Demo mode — synthetic saliency for instant preview without the model.
//
// Why this exists:
//   1. The first-run experience makes Foveacast unreliable to evaluate
//      on a flaky network. A hiring manager, colleague, or reviewer
//      should be able to see the output in under a second. `?demo=1`
//      does that by skipping the ~40–60s GCS model download and
//      substituting a synthetic saliency map.
//   2. It doubles as an end-to-end test surface. A Playwright test can
//      navigate to `?demo=1`, wait for the output to mark itself ready,
//      and assert that the rendered canvas is non-zero and that
//      `getImageData` does not throw — the exact failure mode that
//      shipped undetected in commit 5bc68c3.
//
// The saliency map is intentionally synthetic, not a pre-baked model
// output: we don't want the demo to lie about what the real model
// would say for this image, just to exercise the plumbing downstream
// of inference. A banner in the UI makes the distinction clear.

import { postprocess } from './pipeline/postprocess.js';
import { firstFixationCentroid } from './pipeline/fixation.js';
import { renderSaliencyCanvas, compositeImageAndHeatmap } from './render/saliency-canvas.js';
import { downsampleIfLarge } from './pipeline/preprocess.js';

/**
 * Native resolution of the synthetic saliency map, in `[H, W]`. Matches
 * V3 MSI-Net's export shape so the postprocess upsampling ratio matches
 * what a real model run would produce.
 */
const DEMO_SALIENCY_DIMS = /** @type {[number, number]} */ ([240, 320]);

/**
 * Path to the committed example screenshot. Relative to `index.html`.
 */
const DEMO_IMAGE_URL = './assets/example-screenshot.jpg';

/**
 * Detect whether the current URL is asking for demo mode.
 * Supports `?demo=1`, `?demo=true`, or bare `?demo`.
 * @returns {boolean}
 */
export function isDemoModeRequested() {
  try {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('demo')) return false;
    const value = params.get('demo');
    // URLSearchParams normalises a bare `?demo` to an empty string,
    // not null. Treating empty string as truthy honours the comment
    // above — a user who types the param without a value clearly
    // wants demo mode on.
    if (value === null || value === '') return true;
    const normalised = value.toLowerCase();
    // Explicit off values (`?demo=0` / `?demo=false`) defeat demo
    // mode even if the key is present, in case we ever want to set
    // it negative by default from another context.
    if (normalised === '0' || normalised === 'false') return false;
    return normalised === '1' || normalised === 'true';
  } catch {
    return false;
  }
}

/**
 * Generate a synthetic saliency map with two "blob" peaks positioned
 * at plausible web-page hotspots — roughly the top-left rule-of-thirds
 * intersection and a secondary call-to-action area mid-page right.
 *
 * Output values are in `[0, 1]`, matching V3 MSI-Net's output range.
 * The map is a plain row-major Float32Array.
 *
 * @param {[number, number]} dims - `[height, width]`.
 * @returns {Float32Array}
 */
export function makeSyntheticSaliency(dims) {
  const [h, w] = dims;
  const out = new Float32Array(h * w);

  // Blob configuration: each blob is a 2D isotropic Gaussian centred
  // at (cx, cy) with standard deviation `sigma` and a peak value.
  // Background is 0; blobs add positive mass up to their peak.
  const blobs = [
    { fx: 0.30, fy: 0.22, sigma: 0.12, peak: 1.0 },
    { fx: 0.72, fy: 0.55, sigma: 0.09, peak: 0.7 },
  ];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let value = 0;
      for (const blob of blobs) {
        const cx = blob.fx * w;
        const cy = blob.fy * h;
        const sx = blob.sigma * w;
        const sy = blob.sigma * h;
        const dx = (x - cx) / sx;
        const dy = (y - cy) / sy;
        value += blob.peak * Math.exp(-0.5 * (dx * dx + dy * dy));
      }
      // Clamp to [0, 1] — matches V3 model output range.
      out[y * w + x] = Math.min(1, value);
    }
  }

  return out;
}

/**
 * Load the committed example screenshot as an ImageBitmap, with a
 * HTMLImageElement fallback for engines that don't support
 * `createImageBitmap` from URL.
 *
 * @param {string} url
 * @returns {Promise<HTMLImageElement | ImageBitmap>}
 */
async function loadDemoImage(url) {
  // Prefer `fetch` → `createImageBitmap` because it sidesteps a potential
  // tainted-canvas issue if the asset ever moves to a cross-origin CDN.
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Demo image fetch failed: ${resp.status}`);
    const blob = await resp.blob();
    return await createImageBitmap(blob);
  } catch {
    // Fall through to the Image element path.
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e instanceof Error ? e : new Error('Demo image failed to load.'));
    img.src = url;
  });
}

/**
 * Run the full post-inference pipeline (postprocess → fixation → render
 * → composite) against a synthetic saliency map and the demo image,
 * and mount the result into the same output area the real flow uses.
 *
 * The function is defensive about DOM shape so that a Playwright test
 * can wait on a single attribute (`data-foveacast-ready="true"`) to
 * know the pipeline has completed end-to-end.
 *
 * @param {{
 *   outputCanvasWrap: HTMLElement,
 *   outputCaption: HTMLElement,
 *   outputSection: HTMLElement,
 *   onBanner?: (message: string) => void,
 * }} mounts
 */
export async function runDemoMode(mounts) {
  const {
    outputCanvasWrap,
    outputCaption,
    outputSection,
    onBanner,
  } = mounts;

  // Honest framing: the synthetic saliency isn't a real prediction.
  // Surface that before anything renders so nobody takes a demo screenshot
  // and treats it as a model output.
  if (onBanner) {
    onBanner(
      'Demo mode — this heatmap is a synthetic preview, not a real model prediction. ' +
        'Drop a screenshot or remove ?demo=1 from the URL to run real inference.',
    );
  }

  // 1. Load the demo image. downsampleIfLarge mirrors what the real
  //    handleFile path does; we keep it here so the demo and real paths
  //    are as symmetric as possible.
  const imageSource = await loadDemoImage(DEMO_IMAGE_URL);
  const workCanvas = downsampleIfLarge(imageSource, 2560);
  const origW = workCanvas.width;
  const origH = workCanvas.height;

  // 2. Synthesise a saliency map at the canonical demo dims.
  const raw = makeSyntheticSaliency(DEMO_SALIENCY_DIMS);

  // 3. Postprocess upsamples to the image's own dims, blurs, and
  //    normalises — same function the real flow calls.
  const processed = postprocess(raw, DEMO_SALIENCY_DIMS, [origH, origW]);

  // 4. Fixation centroid and heatmap render — real code paths, real
  //    heatmap.js. This is the part that would have caught the
  //    detached-container bug had the test ever reached it.
  const fixation = firstFixationCentroid(processed, origW, origH);
  const heatmapCanvas = renderSaliencyCanvas(processed, origW, origH);

  // 5. Composite and mount.
  // Demo output carries a diagonal watermark baked into the canvas
  // itself. A banner above the output is easy to crop out; a pixel
  // watermark is not. Defence in depth so nobody ships a demo
  // screenshot captioned as a real model prediction.
  const composite = compositeImageAndHeatmap(workCanvas, heatmapCanvas, {
    opacity: 0.6,
    showFixation: true,
    fixation,
    watermark: { text: 'FOVEACAST DEMO — SYNTHETIC' },
  });
  composite.setAttribute(
    'aria-label',
    `Demo heatmap for an example screenshot. First-fixation estimate is at ` +
      `${fixation.x} pixels across and ${fixation.y} pixels down on a ` +
      `${origW} by ${origH} pixel image.`,
  );

  // Reveal the output section (hidden on first load per progressive
  // disclosure) and fill it with the composited canvas.
  outputSection.hidden = false;
  outputCanvasWrap.hidden = false;
  outputCanvasWrap.textContent = '';
  outputCanvasWrap.appendChild(composite);

  outputCaption.hidden = false;
  outputCaption.textContent =
    `Demo heatmap (synthetic). First fixation at (${fixation.x}, ${fixation.y}) ` +
    `on a ${origW}×${origH} image.`;

  // Signal readiness to automated tests. A single data attribute is
  // simpler to wait on than any event-listener-based protocol.
  outputSection.setAttribute('data-foveacast-ready', 'true');
  outputSection.setAttribute('data-foveacast-mode', 'demo');
}
