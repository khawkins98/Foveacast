// Foveacast — application bootstrap.
//
// This is the single entry point for the static app. It wires the UI
// modules (status, dropzone, controls) together, loads the model, and
// drives the end-to-end inference → render → composite pipeline.
//
// Architecture note: the UI layer never imports `onnxruntime-web` or
// `heatmap.js` directly. Both are loaded from vendored <script> tags
// in `index.html` and reached through the `model/` and `render/`
// modules. V2 proved the value of that boundary — swapping MSI-Net
// through TensorFlow.js for UNISAL through ORT Web happened inside
// `model/` and the surrounding layers never noticed.

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
 * V2 removed the `preset` field because UNISAL ships as a single
 * fixed-shape ONNX graph.
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
      const compositeCanvas = outputCanvasWrap.querySelector('canvas');
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
  // Populated here so the model-version indicator can be refreshed when
  // the preset changes. Commit 13 fleshes out the content.
  renderFooter();

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
   * Load the UNISAL model with a first-run-vs-cache banner heuristic
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
    renderFooter();

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

      const heatmapCanvas = renderHeatmapCanvas(processed, origW, origH);

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
    // Reveal the output section — it's hidden on first load so the
    // pre-drop page isn't cluttered by a reserved empty box (same
    // progressive-disclosure principle as the controls panel).
    outputSection.hidden = false;
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

    // Diagnostic panel — collapsible details below the caption showing
    // what the pipeline actually did. Helps debug "is it using the right
    // model / right image / right preprocessing" ambiguity.
    let diagEl = document.getElementById('fc-diagnostics');
    if (!diagEl) {
      diagEl = document.createElement('details');
      diagEl.id = 'fc-diagnostics';
      diagEl.style.cssText = 'margin:0.5rem 0; font-size:0.75rem; color:#666; max-width:600px;';
      const summary = document.createElement('summary');
      summary.textContent = 'Diagnostics';
      summary.style.cursor = 'pointer';
      diagEl.appendChild(summary);
      outputCaption.parentNode.insertBefore(diagEl, outputCaption.nextSibling);
    }
    if (state.lastDiagnostics) {
      const d = state.lastDiagnostics;
      const lines = [
        `Source image: ${d.sourceWidth} × ${d.sourceHeight} px`,
        `Model input: ${d.modelInputDims[0]} × ${d.modelInputDims[1]} (NCHW, RGB, 0–255)`,
        `Model: MSI-Net fine-tuned on UEyes (v0.1.0, FP16)`,
        `Saliency output: ${d.saliencyLength} values, range [${d.saliencyMin}, ${d.saliencyMax}], mean ${d.saliencyMean}`,
        `Peak attention at: ${d.peakLocation} in model space`,
        `Preprocessing: aspect-preserving bilinear resize + pad 126`,
        `Postprocess: upsample to source dims → σ=5 Gaussian blur → normalise`,
      ];
      // Keep the <summary>, replace everything after it.
      while (diagEl.childNodes.length > 1) diagEl.removeChild(diagEl.lastChild);
      const pre = document.createElement('pre');
      pre.style.cssText = 'margin:0.3rem 0; white-space:pre-wrap; font-family:monospace; font-size:0.7rem; line-height:1.5;';
      pre.textContent = lines.join('\n');
      diagEl.appendChild(pre);
    }

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

  /**
   * Render (or refresh) the attribution footer. The footer carries:
   *   - Model version indicator.
   *   - Credits for UNISAL, ONNX Runtime Web, and heatmap.js.
   *   - Non-dismissible bias disclosure (PRD §Attribution).
   *   - A "Need more?" button that opens the commercial-alternatives
   *     modal, per PRD §Positioning and Alternatives.
   */
  function renderFooter() {
    const footer = document.querySelector('.fc-footer');
    if (!footer) return;
    footer.textContent = '';

    const modelLine = document.createElement('p');
    modelLine.className = 'fc-footer__line fc-footer__model';
    modelLine.textContent = 'Model: MSI-Net · fine-tuned on UEyes (240×320)';
    footer.appendChild(modelLine);

    // Attribution lines are built as individual nodes rather than one
    // innerHTML blob so the anchors carry real DOM event hooks (and so
    // a future reviewer spotting innerHTML doesn't need to worry about
    // XSS exposure in a static page).
    const credits = document.createElement('p');
    credits.className = 'fc-footer__line';
    credits.appendChild(
      textAndLink(
        'Architecture: ',
        'MSI-Net',
        'https://doi.org/10.1016/j.neunet.2020.05.004',
        ' (Kroner et al. 2020, MIT). ',
      ),
    );
    credits.appendChild(
      textAndLink(
        'Fine-tuned on ',
        'UEyes',
        'https://doi.org/10.1145/3544548.3581096',
        ' (Jiang et al. 2023, CC BY 4.0). ',
      ),
    );
    credits.appendChild(
      textAndLink(
        'Training pipeline: ',
        'foveacast-training',
        'https://github.com/khawkins98/foveacast-training',
        '. ',
      ),
    );
    credits.appendChild(
      textAndLink(
        'Inference via ',
        'ONNX Runtime Web',
        'https://onnxruntime.ai/docs/tutorials/web/',
        ' (MIT). ',
      ),
    );
    credits.appendChild(
      textAndLink(
        'Heatmap rendering by ',
        'heatmap.js',
        'https://www.patrick-wied.at/static/heatmapjs/',
        ' by Patrick Wied (MIT).',
      ),
    );
    footer.appendChild(credits);

    const bias = document.createElement('p');
    bias.className = 'fc-footer__line fc-footer__bias';
    bias.textContent =
      "Heatmap outputs reflect population-average gaze patterns from the model's training data. They are estimates, not measurements of any specific person's attention.";
    footer.appendChild(bias);

    const moreLine = document.createElement('p');
    moreLine.className = 'fc-footer__line';
    const moreLabel = document.createTextNode('Need more than Foveacast can offer? ');
    const moreBtn = document.createElement('button');
    moreBtn.type = 'button';
    moreBtn.className = 'fc-footer__more';
    moreBtn.textContent = 'See commercial alternatives.';
    moreBtn.addEventListener('click', openAlternativesModal);
    moreLine.appendChild(moreLabel);
    moreLine.appendChild(moreBtn);
    footer.appendChild(moreLine);
  }

  /**
   * Open the commercial-alternatives modal and remember what had
   * focus so we can restore it on close.
   *
   * WHY we use <dialog>.showModal(): it gives us focus-trap and
   * Escape-to-close without hand-rolling either. showModal also
   * elevates the dialog to the top-layer so no z-index games are
   * needed.
   */
  function openAlternativesModal() {
    const modal = /** @type {HTMLDialogElement | null} */ (
      document.getElementById('fc-alternatives-modal')
    );
    if (!modal) return;
    const previouslyFocused = /** @type {HTMLElement | null} */ (document.activeElement);

    const onClose = () => {
      modal.removeEventListener('close', onClose);
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus();
      }
    };
    modal.addEventListener('close', onClose);

    if (typeof modal.showModal === 'function') {
      modal.showModal();
    } else {
      // Extremely old engine fallback — just show it. Focus and
      // dismissal gestures won't be trapped, but the content is still
      // readable. <dialog> is supported everywhere in our target set.
      modal.setAttribute('open', '');
    }
  }

  /**
   * Helper that builds a lead-text + anchor + trailing-text run in a
   * single span, which keeps the footer prose readable in the DOM
   * without resorting to innerHTML.
   * @param {string} lead
   * @param {string} linkText
   * @param {string} href
   * @param {string} trail
   */
  function textAndLink(lead, linkText, href, trail) {
    const span = document.createElement('span');
    span.appendChild(document.createTextNode(lead));
    const a = document.createElement('a');
    a.href = href;
    a.textContent = linkText;
    a.rel = 'noopener noreferrer';
    span.appendChild(a);
    span.appendChild(document.createTextNode(trail));
    return span;
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
