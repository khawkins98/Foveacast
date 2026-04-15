// Foveacast — application bootstrap.
//
// This is the single entry point for the static app. It wires the UI
// modules (status, dropzone, controls) together, loads the model, and
// drives the end-to-end inference → render → composite pipeline.
//
// Architecture note: the UI layer never imports `@tensorflow/tfjs` or
// `heatmap.js` directly. Both are loaded from CDN <script> tags in
// `index.html` and reached through the `model/` and `render/` modules.
// Keeping that isolation intact is what lets Phase 2 swap TF.js for
// ONNX Runtime Web without touching anything below.

import { mountMobileGuard } from './ui/mobile-guard.js';
import { createStatus } from './ui/status.js';
import { createDropzone } from './ui/dropzone.js';
import { createControls } from './ui/controls.js';
import { loadModel } from './model/loader.js';
import { runInference } from './model/inference.js';
import { downsampleIfLarge } from './pipeline/preprocess.js';
import { postprocess } from './pipeline/postprocess.js';
import { firstFixationCentroid } from './pipeline/fixation.js';
import {
  renderHeatmapCanvas,
  compositeImageAndHeatmap,
} from './render/heatmap.js';
import { downloadCompositeAsPng } from './render/download.js';

/**
 * Human-readable preset codenames for the model-version footer line.
 * Matches the PRD copy (§Attribution) and mirrors the control labels.
 */
const PRESET_CODE_NAMES = Object.freeze({
  very_low: 'Fast (48×64)',
  low: 'Low (72×96)',
  medium: 'Standard (120×160)',
  high: 'High (168×224)',
  very_high: 'Very high (240×320)',
});

/**
 * Threshold (ms) above which we treat the first onProgress tick as a
 * genuine network download rather than a cache hit. WHY a time-based
 * heuristic: tf.js's `loadGraphModel` surfaces only a fraction in
 * `onProgress`, not a byte count or a "from cache" flag. Cached loads
 * finish in under ~300ms on a laptop; a real first-run download streams
 * for several seconds, so the first progress tick arrives well past the
 * first few hundred milliseconds. We default to showing the cache-load
 * banner and upgrade to the first-run banner on slow progress. Simple,
 * and robust against the library never telling us what mode we are in.
 */
const FIRST_RUN_THRESHOLD_MS = 800;

/**
 * Application state. Kept in a plain object rather than a class to keep
 * this file boring — there is only one of it and it lives for the page's
 * entire lifetime.
 * @type {{
 *   preset: import('./ui/controls.js').ControlsController extends any ? string : never,
 *   loadedModel: { model: any, inputDims: [number, number], preset: string } | null,
 *   lastImage: HTMLImageElement | ImageBitmap | HTMLCanvasElement | null,
 *   lastHeatmapCanvas: HTMLCanvasElement | null,
 *   lastFixation: { x: number, y: number } | null,
 *   lastOrigDims: [number, number] | null,
 *   opacity: number,
 *   view: 'overlay' | 'original' | 'sidebyside',
 * }}
 */
const state = {
  preset: 'medium',
  loadedModel: null,
  lastImage: null,
  lastHeatmapCanvas: null,
  lastFixation: null,
  lastOrigDims: null,
  opacity: 0.6,
  view: 'overlay',
};

/**
 * Boot the app once the DOM is ready. Single entry point; everything
 * else is called from here so the order of operations is auditable.
 */
function boot() {
  const appRoot = document.getElementById('fc-app');
  if (!appRoot) {
    // Shouldn't happen — fail loudly if the HTML was edited out from
    // under us.
    console.error('Foveacast: missing #fc-app root element.');
    return;
  }

  // PRD §Browser Support: mobile users see a friendly desktop-only
  // message instead of the app. Must run before any model code.
  if (mountMobileGuard(appRoot)) return;

  // Mount points — these exist in index.html.
  const statusMount = mustGet('fc-status-mount');
  const dropzoneMount = mustGet('fc-dropzone-mount');
  const controlsMount = mustGet('fc-controls-mount');
  const outputSection = mustGet('fc-output');
  const outputPlaceholder = mustGet('fc-output-placeholder');
  const outputCanvasWrap = mustGet('fc-output-canvas-wrap');
  const outputCaption = mustGet('fc-output-caption');

  // --- Status banner ----------------------------------------------------
  const status = createStatus();
  statusMount.appendChild(status.element);

  // --- Dropzone ---------------------------------------------------------
  const dropzone = createDropzone({
    onFile: (file) => {
      // Kick off async work but don't await — we want the event handler
      // to return promptly.
      handleFile(file).catch((err) => {
        console.error('Foveacast: unexpected error handling file.', err);
        status.showError({
          code: 'INFERENCE_FAILED',
          onRetry: () => status.clear(),
        });
      });
    },
    onError: (err) => {
      // Validation failures from the dropzone (UNSUPPORTED_TYPE /
      // TOO_LARGE) arrive here. Surface them via the same banner.
      status.showError({ code: err.code, message: err.message });
    },
  });
  dropzone.setEnabled(false); // Disabled until the model finishes loading.
  dropzoneMount.appendChild(dropzone.element);

  // --- Controls ---------------------------------------------------------
  const controls = createControls({
    onOpacityChange: (value) => {
      state.opacity = value;
      recomposite();
    },
    onViewChange: (view) => {
      state.view = view;
      renderOutput();
    },
    onPresetChange: (preset) => {
      state.preset = preset;
      // A new preset means new weights; teardown any previous state and
      // reload. We leave the last image on screen while the new model
      // downloads — swapping models does not invalidate the composite
      // on display, only the next inference.
      reloadModel().catch((err) => surfaceModelError(err));
    },
    onDownload: () => {
      const compositeCanvas = outputCanvasWrap.querySelector('canvas');
      if (!compositeCanvas) return;
      downloadCompositeAsPng(/** @type {HTMLCanvasElement} */ (compositeCanvas)).catch((err) => {
        console.error('Foveacast: download failed.', err);
      });
    },
  });
  controls.setDisabled(true); // Enabled once the model is ready.
  controlsMount.appendChild(controls.element);

  // --- Footer (attribution) --------------------------------------------
  // Populated here so the model-version indicator can be refreshed when
  // the preset changes. Commit 13 fleshes out the content.
  renderFooter();

  // --- Kick off model load ---------------------------------------------
  reloadModel().catch((err) => surfaceModelError(err));

  // --- Exposed helpers (closures over `state`) --------------------------

  /**
   * Load the model for `state.preset` with a first-run-vs-cache banner
   * heuristic (see FIRST_RUN_THRESHOLD_MS).
   */
  async function reloadModel() {
    state.loadedModel = null;
    dropzone.setEnabled(false);
    controls.setDisabled(true);

    const startedAt = performance.now();
    let firstRunShown = false;

    // Default to the cache-load banner. If progress stretches past the
    // threshold, we switch to the first-run banner with the ~60MB copy.
    status.showCacheLoad();

    try {
      const loaded = await loadModel(state.preset, (progress) => {
        const elapsed = performance.now() - startedAt;
        if (!firstRunShown && elapsed > FIRST_RUN_THRESHOLD_MS && progress.fraction < 0.95) {
          firstRunShown = true;
        }
        if (firstRunShown) {
          status.showFirstRun(progress);
        }
      });
      state.loadedModel = loaded;
      dropzone.setEnabled(true);
      controls.setDisabled(false);
      status.showReady();
      renderFooter();
    } catch (err) {
      // Re-throw so the outer catch can choose the right error code.
      throw err;
    }
  }

  /**
   * Decide which PRD error code a model-loading failure maps to. A
   * network/fetch failure is MODEL_DOWNLOAD_FAILED; everything else
   * (parsing, incompatible format, unknown) is MODEL_LOAD_FAILED.
   * @param {unknown} err
   */
  function surfaceModelError(err) {
    console.error('Foveacast: model load failed.', err);
    const msg = String((/** @type {any} */ (err) && /** @type {any} */ (err).message) || err).toLowerCase();
    const looksNetwork =
      msg.includes('fetch') ||
      msg.includes('network') ||
      msg.includes('failed to load') ||
      msg.includes('err_');
    const code = looksNetwork ? 'MODEL_DOWNLOAD_FAILED' : 'MODEL_LOAD_FAILED';
    status.showError({
      code,
      onRetry: () => {
        if (code === 'MODEL_LOAD_FAILED') {
          // PRD §Error States: "Clear cached data and retry" should
          // clear the cached weights. tf.js caches inside IndexedDB
          // under the URL key when IndexedDBLoader is used; the simple
          // HTTP cache path (what we use) is cleared by a hard reload.
          // We surface both: reload will re-fetch; tf.io removal is a
          // best-effort extra.
          try {
            const tf = /** @type {any} */ (globalThis).tf;
            if (tf && tf.io && typeof tf.io.removeModel === 'function') {
              // Best-effort — ignore failures, this API is only used
              // when models were saved via tf.io.
              tf.io.removeModel(`indexeddb://${state.preset}`).catch(() => {});
            }
          } catch {
            /* ignore */
          }
          window.location.reload();
          return;
        }
        reloadModel().catch(surfaceModelError);
      },
    });
  }

  /**
   * Handle a user-dropped file through the full pipeline.
   * @param {File} file
   */
  async function handleFile(file) {
    if (!state.loadedModel) {
      status.showError({
        code: 'INFERENCE_FAILED',
        message: 'The model is still loading. Please wait a moment and try again.',
      });
      return;
    }

    status.showInference();
    dropzone.setBusy(true);
    controls.setDisabled(true);

    try {
      // `createImageBitmap` is the right path — it decodes off the main
      // thread when the browser supports it. Falling back to an
      // HTMLImageElement keeps the flow alive on older engines.
      let bitmap;
      try {
        bitmap = await createImageBitmap(file);
      } catch {
        bitmap = await loadFileAsImage(file);
      }

      // PRD §Memory: images wider than 2560px are downsampled before
      // preprocessing to dodge OOM on retina screenshots.
      const workCanvas = downsampleIfLarge(bitmap, 2560);

      const origW = workCanvas.width;
      const origH = workCanvas.height;

      // Run inference. `runInference` internally calls the preprocessing
      // pipeline and returns the raw model output plus the model's
      // native input dims (which post-processing needs).
      const { saliency, inputDims } = await runInference(workCanvas, state.loadedModel);

      // Upsample + blur + normalise to the work canvas's dims so the
      // heatmap aligns pixel-for-pixel with the image we're going to
      // composite it over.
      const processed = postprocess(saliency, inputDims, [origH, origW]);

      const fixation = firstFixationCentroid(processed, origW, origH);

      const heatmapCanvas = renderHeatmapCanvas(processed, origW, origH);

      state.lastImage = workCanvas;
      state.lastHeatmapCanvas = heatmapCanvas;
      state.lastFixation = fixation;
      state.lastOrigDims = [origH, origW];

      renderOutput();
      status.clear();

      // PRD §Accessibility: after inference completes, move focus to
      // the output area so keyboard users aren't left at the top of
      // the page.
      outputSection.focus();
    } catch (err) {
      console.error('Foveacast: inference failed.', err);
      status.showError({
        code: 'INFERENCE_FAILED',
        onRetry: () => status.clear(),
      });
    } finally {
      dropzone.setBusy(false);
      controls.setDisabled(false);
    }
  }

  /**
   * Recompose the current image + heatmap with the current opacity.
   * Called when the opacity slider moves.
   */
  function recomposite() {
    if (!state.lastImage || !state.lastHeatmapCanvas) return;
    renderOutput();
  }

  /** Draw the composited canvas (or plain image / side-by-side) into the output wrap. */
  function renderOutput() {
    if (!state.lastImage || !state.lastHeatmapCanvas) return;
    outputPlaceholder.hidden = true;
    outputCanvasWrap.hidden = false;
    outputCanvasWrap.textContent = '';
    outputCanvasWrap.classList.toggle(
      'fc-output__canvas-wrap--sidebyside',
      state.view === 'sidebyside',
    );

    // Sighted redundancy for the first-fixation crosshair: show the
    // coordinates as plain text below the canvas. Screen readers
    // already get this via `aria-label`, but a visible caption helps
    // everyone compare runs without squinting at pixel positions.
    outputCaption.textContent = describeHeatmap(state.lastFixation, state.lastOrigDims);
    outputCaption.hidden = false;

    if (state.view === 'original') {
      const plain = drawPlainImageCanvas(state.lastImage);
      plain.setAttribute(
        'aria-label',
        'Original screenshot, without heatmap overlay.',
      );
      outputCanvasWrap.appendChild(plain);
      return;
    }

    if (state.view === 'sidebyside') {
      const plain = drawPlainImageCanvas(state.lastImage);
      plain.setAttribute('aria-label', 'Original screenshot.');
      const composite = compositeImageAndHeatmap(
        state.lastImage,
        state.lastHeatmapCanvas,
        {
          opacity: state.opacity,
          showFixation: true,
          fixation: state.lastFixation,
        },
      );
      composite.setAttribute(
        'aria-label',
        describeHeatmap(state.lastFixation, state.lastOrigDims),
      );
      outputCanvasWrap.appendChild(plain);
      outputCanvasWrap.appendChild(composite);
      return;
    }

    // Default overlay view.
    const composite = compositeImageAndHeatmap(
      state.lastImage,
      state.lastHeatmapCanvas,
      {
        opacity: state.opacity,
        showFixation: true,
        fixation: state.lastFixation,
      },
    );
    composite.setAttribute(
      'aria-label',
      describeHeatmap(state.lastFixation, state.lastOrigDims),
    );
    outputCanvasWrap.appendChild(composite);
  }

  /** Render (or refresh) the attribution footer. */
  function renderFooter() {
    const footer = document.querySelector('.fc-footer');
    if (!footer) return;
    footer.textContent = '';

    const modelLine = document.createElement('p');
    modelLine.className = 'fc-footer__line fc-footer__model';
    const codeName = PRESET_CODE_NAMES[state.preset] || state.preset;
    modelLine.textContent = `Model: MSI-Net · ${codeName}`;
    footer.appendChild(modelLine);

    const credits = document.createElement('p');
    credits.className = 'fc-footer__line';
    credits.innerHTML =
      'Attention prediction by <a href="https://github.com/alexanderkroner/saliency" rel="noopener noreferrer">MSI-Net</a> (Alexander Kroner, MIT). ' +
      'Inference via <a href="https://www.tensorflow.org/js" rel="noopener noreferrer">TensorFlow.js</a> (Apache 2.0). ' +
      'Heatmap rendering by <a href="https://www.patrick-wied.at/static/heatmapjs/" rel="noopener noreferrer">heatmap.js</a> (Patrick Wied, MIT).';
    footer.appendChild(credits);

    const bias = document.createElement('p');
    bias.className = 'fc-footer__line fc-footer__bias';
    bias.textContent =
      "Heatmap outputs reflect population-average gaze patterns from the model's training data. They are estimates, not measurements of any specific person's attention.";
    footer.appendChild(bias);
  }

  /** Build a canvas that just contains the image, at the image's own pixel size. */
  function drawPlainImageCanvas(imageSource) {
    const width =
      /** @type {any} */ (imageSource).naturalWidth ||
      /** @type {any} */ (imageSource).width;
    const height =
      /** @type {any} */ (imageSource).naturalHeight ||
      /** @type {any} */ (imageSource).height;
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    const ctx = c.getContext('2d');
    if (ctx) ctx.drawImage(imageSource, 0, 0, width, height);
    return c;
  }
}

/**
 * Load a File via an HTMLImageElement as a fallback when
 * `createImageBitmap` isn't available or refuses the input.
 * @param {File} file
 * @returns {Promise<HTMLImageElement>}
 */
function loadFileAsImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      // Keep the URL alive long enough for downstream canvas draws — we
      // revoke after a tick.
      setTimeout(() => URL.revokeObjectURL(url), 0);
      resolve(img);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e instanceof Error ? e : new Error('Failed to load image.'));
    };
    img.src = url;
  });
}

/**
 * Sentence describing the heatmap for screen reader users. The
 * fixation coordinates are included as integers so the announcement is
 * concrete and not just "a heatmap".
 * @param {{ x: number, y: number } | null} fixation
 * @param {[number, number] | null} origDims - `[h, w]`.
 */
function describeHeatmap(fixation, origDims) {
  if (!fixation || !origDims) {
    return 'Predicted attention heatmap for uploaded screenshot.';
  }
  const [h, w] = origDims;
  return (
    `Predicted attention heatmap for uploaded screenshot. ` +
    `First-fixation estimate is at ${fixation.x} pixels across and ${fixation.y} pixels down ` +
    `on a ${w} by ${h} pixel image.`
  );
}

/** @param {string} id */
function mustGet(id) {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Foveacast: expected element #${id} in DOM.`);
  }
  return el;
}

// Boot on DOMContentLoaded — or immediately if the DOM is already
// parsed (happens when this script is injected after load, e.g. via
// the dev server's HMR reconnect path).
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
