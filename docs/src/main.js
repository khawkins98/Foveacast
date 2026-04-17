// Foveacast — application bootstrap.
//
// This is the single entry point for the static app. It wires the UI
// modules (status, dropzone, controls) together, loads the model, and
// drives the end-to-end inference → render → composite pipeline.
//
// Architecture note: the UI layer never imports `onnxruntime-web` or
// runtime directly. ORT Web is loaded from a vendored <script> tag in
// `index.html` and reached through the `model/` module. The `render/`
// layer handles saliency visualisation via a direct inferno colormap
// renderer. The boundary between model, pipeline, and render layers
// is what let V3 swap the model without touching the UI code.

import { mountMobileGuard } from './ui/mobile-guard.js';
import { createStatus } from './ui/status.js';
import { createDropzone } from './ui/dropzone.js';
import { createControls } from './ui/controls.js';
import { mountFooter } from './ui/footer.js';
import { renderOutput as renderOutputView } from './ui/output-view.js';
import { loadModel } from './model/loader.js';
import { runInference } from './model/inference.js';
import { downsampleIfLarge } from './ui/image-resize.js';
import { postprocess } from './pipeline/postprocess.js';
import { firstFixationCentroid } from './pipeline/fixation.js';
import { renderSaliencyCanvas } from './render/saliency-canvas.js';
import { downloadCompositeAsPng } from './render/download.js';
import { isDemoModeRequested, runDemoMode } from './demo.js';
import { installPageDrop } from './ui/page-drop.js';
import { readHasRunSentinel, writeHasRunSentinel } from './ui/has-run-sentinel.js';

/**
 * Threshold (ms) above which we treat the first onProgress tick as a
 * genuine network download rather than a cache hit. WHY a time-based
 * heuristic is still here alongside the localStorage sentinel below:
 * the sentinel is authoritative when it is present, but it can be
 * absent for a returning user who cleared site data or who came in
 * via incognito. The time heuristic is the safety net for those
 * cases — it starts with the cache-load banner and upgrades to the
 * first-run banner once a slow progress tick arrives.
 */
const FIRST_RUN_THRESHOLD_MS = 800;

/**
 * Application state. Kept in a plain object rather than a class to
 * keep this file boring — there is only one of it and it lives for
 * the page's entire lifetime.
 *
 * The V1 `preset` field was removed — V3 MSI-Net is a single
 * fixed-shape model (240×320).
 *
 * @type {{
 *   loadedModel: { session: any, inputDims: [number, number] } | null,
 *   lastImage: HTMLImageElement | ImageBitmap | HTMLCanvasElement | null,
 *   lastHeatmapCanvas: HTMLCanvasElement | null,
 *   lastFixation: { x: number, y: number } | null,
 *   lastOrigDims: [number, number] | null,
 *   opacity: number,
 *   view: 'overlay' | 'original' | 'sidebyside',
 *   queuedFile: File | null,
 *   lastDiagnostics: {
 *     sourceWidth: number,
 *     sourceHeight: number,
 *     modelInputDims: [number, number],
 *     saliencyLength: number,
 *     saliencyMin: string,
 *     saliencyMax: string,
 *     saliencyMean: string,
 *     peakLocation: string,
 *   } | null,
 *   lastCompositeCanvas: HTMLCanvasElement | null,
 * }}
 */
const state = {
  loadedModel: null,
  lastImage: null,
  lastHeatmapCanvas: null,
  lastFixation: null,
  lastOrigDims: null,
  opacity: 0.6,
  view: 'overlay',
  /** File dropped before the model finished loading (demo-mode race). */
  queuedFile: /** @type {File | null} */ (null),
  lastDiagnostics: null,
  /** The most recently rendered composite canvas — used by the download handler.
   *  Null when the current view is 'original' (no composite is produced). */
  lastCompositeCanvas: null,
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
  // message instead of the app. The guard is dismissible via a
  // "Proceed anyway" button — see mobile-guard.js for the copy. When
  // dismissed, it writes a localStorage sentinel and then we reload
  // the page. Reload is simpler and more reliable than reconstructing
  // index.html's mount-point DOM from JS: on the next boot, the
  // sentinel is set, the guard returns early, and the app
  // bootstraps normally.
  if (
    mountMobileGuard(appRoot, {
      onProceed: () => window.location.reload(),
    })
  ) {
    return;
  }

  // Mount points — these exist in index.html.
  const statusMount = mustGet('fc-status-mount');
  const dropzoneMount = mustGet('fc-dropzone-mount');
  const controlsMount = mustGet('fc-controls-mount');
  const outputSection = mustGet('fc-output');
  const outputCanvasWrap = mustGet('fc-output-canvas-wrap');
  const outputCaption = mustGet('fc-output-caption');

  // --- Status banner ----------------------------------------------------
  const status = createStatus();
  statusMount.appendChild(status.element);

  // --- Dropzone ---------------------------------------------------------
  // Single callback pair shared by the drop-zone click-to-pick flow
  // and the document-level drop handler. Factor it so there is one
  // place to change behaviour.
  const fileCallbacks = {
    /** @param {File} file */
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
    /** @param {{ code: string, message: string }} err */
    onError: (err) => {
      status.showError({ code: err.code, message: err.message });
    },
  };

  const dropzone = createDropzone(fileCallbacks);
  dropzone.setEnabled(false); // Disabled until the model finishes loading.
  dropzoneMount.appendChild(dropzone.element);

  // Accept a file dropped anywhere on the page. Before this, dropping
  // one pixel outside the drop-zone element navigated the browser away
  // from Foveacast and opened the file in the tab — the worst failure
  // mode for a one-purpose tool. The document-level handler also gates
  // on the same enabled/busy state (via the shared callbacks: the
  // handleFile below will reject early if the model isn't ready).
  installPageDrop(fileCallbacks);

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
    onDownload: () => {
      // why: state.lastCompositeCanvas is always the most recent composite,
      // even in side-by-side view where querySelector('canvas') would return
      // the plain image canvas (appended first) rather than the heatmap composite.
      const compositeCanvas = state.lastCompositeCanvas;
      if (!compositeCanvas) return;
      downloadCompositeAsPng(/** @type {HTMLCanvasElement} */ (compositeCanvas)).catch((err) => {
        console.error('Foveacast: download failed.', err);
      });
    },
  });
  controls.setDisabled(true); // Enabled once the model is ready.
  // Progressive disclosure: controls stay hidden until there is
  // actually something to control (first demo render or first
  // inference result). Pre-drop they are noise competing with the
  // drop zone for attention.
  controls.setVisible(false);
  controlsMount.appendChild(controls.element);

  // --- Footer (attribution) --------------------------------------------
  mountFooter(
    document.querySelector('.fc-footer'),
    /** @type {HTMLDialogElement | null} */ (document.getElementById('fc-alternatives-modal')),
  );

  // --- Demo mode short-circuit ------------------------------------------
  // When `?demo=1` is present, skip the model download entirely and run
  // a synthetic saliency map through the render pipeline. Normal flow
  // resumes as soon as the user drops their own file (we still let the
  // real model load in the background so a drop works immediately
  // after the demo renders).
  const demoMode = isDemoModeRequested();

  if (demoMode) {
    runDemoMode({
      outputCanvasWrap,
      outputCaption,
      outputSection,
      onBanner: (message) => status.showDemoBanner(message),
    })
      .then(() => {
        // As soon as the demo renders, the user has a canvas to
        // control — enable and reveal the controls plus the dropzone
        // right away even though the background model is still
        // loading. If the user drops a file before the model is
        // ready, the drop is queued and auto-runs once load resolves.
        dropzone.setEnabled(true);
        controls.setDisabled(false);
        controls.setVisible(true);
      })
      .catch((err) => {
        console.error('Foveacast: demo mode failed.', err);
        // DEMO_FAILED is its own code + message in STATUS_ERROR_MESSAGES.
        // Keeping it out of INFERENCE_FAILED means a user who sees a
        // demo-mode error still knows the real inference path is
        // independently usable.
        status.showError({ code: 'DEMO_FAILED' });
      });
    // Fall through: the normal `reloadModel()` still runs below in
    // silent mode (no cache-load banner stomps the demo banner). The
    // model keeps loading in the background so a user drop works as
    // soon as load resolves — directly if already ready, or via the
    // queued-file path if the drop happened first.
    // Silent background load — if it fails, stay silent. The user is
    // in demo mode; they asked for a preview, not real inference. If
    // they later drop a file, `handleFile` will detect that no model
    // is loaded and THAT is the moment to show the download banner
    // (via the queued-drop path). Surfacing an error banner now would
    // confuse the demo experience and fail E2E tests that assert no
    // console errors during demo render.
    reloadModel({ silent: true }).catch((err) => {
      console.warn('Foveacast: background model load failed in demo mode.', err);
    });
  } else {
    // --- Kick off model load (normal path) ------------------------------
    reloadModel().catch((err) => surfaceModelError(err));
  }

  // --- Exposed helpers (closures over `state`) --------------------------

  /**
   * Load the saliency model with a first-run-vs-cache banner heuristic
   * (see `FIRST_RUN_THRESHOLD_MS`).
   *
   * `silent` suppresses the cache-load / first-run / ready banners so
   * the demo-mode background load does not stomp the demo banner. The
   * dropzone enable / controls enable / error surfacing all still run
   * normally — only the chatty status transitions are skipped.
   *
   * @param {{ silent?: boolean }} [options]
   */
  async function reloadModel(options = {}) {
    const { silent = false } = options;
    state.loadedModel = null;
    dropzone.setEnabled(false);
    controls.setDisabled(true);

    const startedAt = performance.now();
    let firstRunShown = false;

    // The sentinel is the authoritative signal. If it's absent, this
    // browser has never completed a model load before, so show the
    // first-run banner immediately — no 800ms wait contradicting the
    // user's experience. If it's present we still default to the
    // cache-load banner and upgrade via the time heuristic, which
    // covers users who cleared site data since their last visit.
    const hasRunBefore = readHasRunSentinel();

    if (!silent) {
      if (!hasRunBefore) {
        status.showFirstRun({ fraction: 0, loaded: undefined, total: undefined });
        firstRunShown = true;
      } else {
        status.showCacheLoad();
      }
    }

    const loaded = await loadModel((progress) => {
      if (silent) return;
      const elapsed = performance.now() - startedAt;
      if (!firstRunShown && elapsed > FIRST_RUN_THRESHOLD_MS && progress.fraction < 0.95) {
        firstRunShown = true;
      }
      if (firstRunShown) {
        status.showFirstRun(progress);
      }
    });
    state.loadedModel = loaded;
    writeHasRunSentinel(); // Flip the bit after a successful load.
    dropzone.setEnabled(true);
    controls.setDisabled(false);
    if (!silent) status.showReady();
    // why: footer is static — no re-mount needed after model reload.

    // Drain any file the user dropped while we were still loading.
    // This is the second half of the demo-mode queued-drop flow.
    if (state.queuedFile) {
      const pending = state.queuedFile;
      state.queuedFile = null;
      status.element.removeAttribute('data-foveacast-queued');
      // Don't await — same reason the dropzone onFile doesn't await:
      // we want the caller to return promptly.
      handleFile(pending).catch((err) => {
        console.error('Foveacast: queued-file inference failed.', err);
        status.showError({
          code: 'INFERENCE_FAILED',
          onRetry: () => status.clear(),
        });
      });
    }
  }

  /**
   * Route a model-loading failure to the right PRD error code.
   *
   * Errors thrown from `loadModel` carry a structured `code` of either
   * `MODEL_DOWNLOAD_FAILED` or `MODEL_LOAD_FAILED`. For anything not
   * from our loader (shouldn't happen in normal flow, but defensive),
   * fall back to `MODEL_LOAD_FAILED`.
   *
   * V2 simplified the retry: ORT Web caches the `.onnx` bytes in the
   * browser's ordinary HTTP cache, so "clear cached data and retry"
   * is just a hard reload. No IndexedDB housekeeping to chase.
   *
   * @param {unknown} err
   */
  function surfaceModelError(err) {
    console.error('Foveacast: model load failed.', err);
    const structuredCode = /** @type {any} */ (err) && /** @type {any} */ (err).code;
    const code =
      structuredCode === 'MODEL_DOWNLOAD_FAILED' || structuredCode === 'MODEL_LOAD_FAILED'
        ? structuredCode
        : 'MODEL_LOAD_FAILED';
    status.showError({
      code,
      onRetry: () => {
        if (code === 'MODEL_LOAD_FAILED') {
          window.location.reload();
          return;
        }
        reloadModel().catch(surfaceModelError);
      },
    });
  }

  /**
   * Handle a user-dropped file through the full pipeline.
   *
   * In demo mode the dropzone goes live as soon as the synthetic
   * preview renders, which may be well before the real model has
   * finished downloading. A drop that arrives in that window gets
   * queued: we show the first-run banner so the user knows why the
   * wait, and `reloadModel()` picks up the queued file when it
   * resolves. The user never sees a "model still loading, try again"
   * dead end.
   *
   * @param {File} file
   */
  async function handleFile(file) {
    if (!state.loadedModel) {
      state.queuedFile = file;
      // Surface the real download/cache banner so the user sees that
      // something is happening. The visible banner depends on whether
      // the silent background load has passed the first-run threshold.
      status.showFirstRun({ fraction: 0, loaded: undefined, total: undefined });
      status.element.setAttribute('data-foveacast-queued', 'true');
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
      const { saliency, inputDims, sourceDims } = await runInference(workCanvas, state.loadedModel);

      // Upsample + blur + normalise to the work canvas's dims so the
      // heatmap aligns pixel-for-pixel with the image we're going to
      // composite it over.
      const processed = postprocess(saliency, inputDims, [origH, origW]);

      const fixation = firstFixationCentroid(processed, origW, origH);

      const heatmapCanvas = renderSaliencyCanvas(processed, origW, origH);

      // Diagnostic: compute saliency stats for the debug panel.
      let salMin = Infinity, salMax = -Infinity, salSum = 0;
      for (let i = 0; i < saliency.length; i++) {
        if (saliency[i] < salMin) salMin = saliency[i];
        if (saliency[i] > salMax) salMax = saliency[i];
        salSum += saliency[i];
      }
      const peakIdx = saliency.indexOf(salMax);
      const peakY = Math.floor(peakIdx / inputDims[1]);
      const peakX = peakIdx % inputDims[1];

      state.lastImage = workCanvas;
      state.lastHeatmapCanvas = heatmapCanvas;
      state.lastFixation = fixation;
      state.lastOrigDims = [origH, origW];
      state.lastDiagnostics = {
        sourceWidth: origW,
        sourceHeight: origH,
        modelInputDims: inputDims,
        saliencyLength: saliency.length,
        saliencyMin: salMin.toFixed(4),
        saliencyMax: salMax.toFixed(4),
        saliencyMean: (salSum / saliency.length).toFixed(4),
        peakLocation: `(${peakX}, ${peakY})`,
      };

      renderOutput();
      // Reveal controls now that there is a real result to operate on
      // (non-demo path). Safe to call repeatedly — no-op after first.
      controls.setVisible(true);
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
    // Delegate rendering to the output-view module. The return value is
    // the composite canvas (null for the 'original' view) which we store
    // so the download handler always has a direct reference — avoiding
    // the side-by-side bug where querySelector('canvas') returns the
    // plain image canvas (appended first) instead of the composite.
    state.lastCompositeCanvas = renderOutputView(
      {
        image: state.lastImage,
        heatmapCanvas: state.lastHeatmapCanvas,
        view: state.view,
        opacity: state.opacity,
        fixation: state.lastFixation,
        origDims: state.lastOrigDims,
        diagnostics: state.lastDiagnostics,
      },
      { outputSection, outputCanvasWrap, outputCaption },
    );
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
