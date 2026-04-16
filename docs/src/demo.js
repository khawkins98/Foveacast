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
import {
  renderHeatmapCanvas,
  compositeImageAndHeatmap,
} from './render/heatmap.js';
import { downsampleIfLarge } from './pipeline/preprocess.js';

/**
 * Native resolution of the synthetic saliency map, in `[H, W]`.
 * Chosen to match the `medium` preset's input dims so the postprocess
 * upsampling ratio matches what a real model run would produce on a
 * typical screenshot.
 */
const DEMO_SALIENCY_DIMS = /** @type {[number, number]} */ ([120, 160]);

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
    if (value === null) return true; // bare `?demo`
    return value === '1' || value.toLowerCase() === 'true';
  } catch {
    return false;
  }
}

/**
 * Generate a synthetic saliency map with two Gaussian blobs positioned
 * at plausible web-page "hotspots" — roughly the top-left rule-of-thirds
 * intersection and a secondary call-to-action area mid-page right.
 *
 * Values are in `[0, 255]` to mirror the real model output range before
 * postprocess. The map is a plain row-major Float32Array.
 *
 * @param {[number, number]} dims - `[height, width]`.
 * @returns {Float32Array}
 */
export function makeSyntheticSaliency(dims) {
  const [h, w] = dims;
  const out = new Float32Array(h * w);

  // Blob configuration: each blob is a 2D isotropic Gaussian centred at
  // (cx, cy) with standard deviation `sigma`, scaled by `peak`.
  // Coordinates are given as fractions of width/height so the same
  // configuration works at any resolution.
  const blobs = [
    { fx: 0.30, fy: 0.22, sigma: 0.12, peak: 220 },
    { fx: 0.72, fy: 0.55, sigma: 0.09, peak: 150 },
  ];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (const blob of blobs) {
        const cx = blob.fx * w;
        const cy = blob.fy * h;
        const sx = blob.sigma * w;
        const sy = blob.sigma * h;
        const dx = (x - cx) / sx;
        const dy = (y - cy) / sy;
        v += blob.peak * Math.exp(-0.5 * (dx * dx + dy * dy));
      }
      // Clamp at 255 so the synthetic map stays in the same numeric
      // range as a real MSI-Net output.
      out[y * w + x] = Math.min(255, v);
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
 *   outputPlaceholder: HTMLElement,
 *   outputCanvasWrap: HTMLElement,
 *   outputCaption: HTMLElement,
 *   outputSection: HTMLElement,
 *   onBanner?: (message: string) => void,
 * }} mounts
 */
export async function runDemoMode(mounts) {
  const {
    outputPlaceholder,
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
      'Demo mode — this heatmap is a synthetic preview, not a real MSI-Net prediction. ' +
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
  const heatmapCanvas = renderHeatmapCanvas(processed, origW, origH);

  // 5. Composite and mount.
  const composite = compositeImageAndHeatmap(workCanvas, heatmapCanvas, {
    opacity: 0.6,
    showFixation: true,
    fixation,
  });
  composite.setAttribute(
    'aria-label',
    `Demo heatmap for an example screenshot. First-fixation estimate is at ` +
      `${fixation.x} pixels across and ${fixation.y} pixels down on a ` +
      `${origW} by ${origH} pixel image.`,
  );

  outputPlaceholder.hidden = true;
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
