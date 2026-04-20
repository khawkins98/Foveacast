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
import { loadModel, DEFAULT_DURATION, DURATION_LABELS } from './model/loader.js';
import { runInference } from './model/inference.js';
import { downsampleIfLarge } from './ui/image-resize.js';
import { postprocess } from './pipeline/postprocess.js';
import { firstFixationCentroid, topNFixations } from './pipeline/fixation.js';
import { renderSaliencyCanvas, renderAttentionZoneCanvas } from './render/saliency-canvas.js';
import { downloadCompositeAsPng } from './render/download.js';
import { isDemoModeRequested, runDemoMode } from './demo.js';
import { installPageDrop } from './ui/page-drop.js';
import { readHasRunSentinel, writeHasRunSentinel } from './ui/has-run-sentinel.js';
import { computeSaliencyMetrics, computeZoneThresholds, computeRuleOfThirds } from './pipeline/metrics.js';
import { createReport } from './ui/report.js';
import { createHud, updateHud, updateHudRuleOfThirds } from './ui/hud.js';

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
 * @typedef {{
 *   heatmapCanvas: HTMLCanvasElement,
 *   fixation: { x: number, y: number } | null,
 *   fixationSequence: Array<{x: number, y: number}>,
 *   attentionZoneCanvas: HTMLCanvasElement,
 *   ruleOfThirds: number[],
 *   origDims: [number, number],
 *   metrics: { spreadLevel: string },
 *   inferenceMs: number,
 *   diagnostics: {
 *     sourceWidth: number,
 *     sourceHeight: number,
 *     modelInputDims: [number, number],
 *     saliencyLength: number,
 *     saliencyMin: string,
 *     saliencyMax: string,
 *     saliencyMean: string,
 *     peakLocation: string,
 *     duration: string,
 *   },
 * }} DurationResult
 */

/**
 * Application state. Kept in a plain object rather than a class to
 * keep this file boring — there is only one of it and it lives for
 * the page's entire lifetime.
 *
 * @type {{
 *   loadedModel: import('./model/loader.js').LoadedModel | null,
 *   activeDuration: import('./model/loader.js').Duration,
 *   displayedDuration: import('./model/loader.js').Duration,
 *   durationResults: {
 *     '1s': DurationResult | 'loading' | 'failed' | null,
 *     '3s': DurationResult | 'loading' | 'failed' | null,
 *     '7s': DurationResult | 'loading' | 'failed' | null,
 *   },
 *   bgGenId: number,
 *   lastImage: HTMLImageElement | ImageBitmap | HTMLCanvasElement | null,
 *   lastHeatmapCanvas: HTMLCanvasElement | null,
 *   lastFixation: { x: number, y: number } | null,
 *   lastOrigDims: [number, number] | null,
 *   opacity: number,
 *   blendMode: string,
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
 *     duration: string,
 *   } | null,
 *   lastCompositeCanvas: HTMLCanvasElement | null,
 *   durationSwitchGeneration: number,
 *   overlays: { fixationSequence: boolean, attentionZones: boolean, centroidTrajectory: boolean },
 *   lastFixationSequence: Array<{x: number, y: number}> | null,
 *   lastAttentionZoneCanvas: HTMLCanvasElement | null,
 *   lastRuleOfThirds: number[] | null,
 * }}
 */
const state = {
  loadedModel: null,
  activeDuration: DEFAULT_DURATION,
  /** Which duration result is currently displayed (may differ from activeDuration
   *  when the user cycles to a cached result without reloading the model). */
  displayedDuration: DEFAULT_DURATION,
  /** Per-duration cached inference results. null = not yet run, 'loading' = in
   *  progress, 'failed' = error, or a full DurationResult object. */
  durationResults: {
    '1s': /** @type {DurationResult | 'loading' | 'failed' | null} */ (null),
    '3s': /** @type {DurationResult | 'loading' | 'failed' | null} */ (null),
    '7s': /** @type {DurationResult | 'loading' | 'failed' | null} */ (null),
  },
  /** Monotonic counter incremented whenever a new image starts inference.
   *  Background loading workers compare against this to detect cancellation. */
  bgGenId: 0,
  lastImage: null,
  lastHeatmapCanvas: null,
  lastFixation: null,
  lastOrigDims: null,
  opacity: 0.6,
  /** Canvas 2D globalCompositeOperation for the heatmap overlay layer. */
  blendMode: 'source-over',
  view: 'overlay',
  /** File dropped before the model finished loading (demo-mode race). */
  queuedFile: /** @type {File | null} */ (null),
  lastDiagnostics: null,
  /** The most recently rendered composite canvas — used by the download handler.
   *  Null when the current view is 'original' (no composite is produced). */
  lastCompositeCanvas: null,
  /** Monotonic counter incremented on every duration switch. A load that
   *  started for a previous generation is stale and should be discarded
   *  when it resolves — the user has already moved on to a different
   *  duration. This prevents a slow 1s download from stomping a fast 3s
   *  download that the user selected while the 1s was in flight. */
  durationSwitchGeneration: 0,
  /** Active overlay toggles — controlled by the overlay checkboxes. */
  overlays: { fixationSequence: false, attentionZones: false, centroidTrajectory: false },
  /** Cached saliency visualization artifacts for the currently displayed duration. */
  lastFixationSequence: /** @type {Array<{x: number, y: number}> | null} */ (null),
  lastAttentionZoneCanvas: /** @type {HTMLCanvasElement | null} */ (null),
  lastRuleOfThirds: /** @type {number[] | null} */ (null),
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
  const hudMount = mustGet('fc-hud-mount');
  const reportMount = mustGet('fc-report-mount');
  const toolbarEl = mustGet('fc-toolbar');

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

  // "New Image" button — visible after first inference in place of the
  // full dropzone. Delegates to the dropzone's file picker so the same
  // validation / callback path is used, and the dropzone's enabled/busy
  // guards prevent firing during an active inference run.
  document.getElementById('fc-new-upload-btn')
    ?.addEventListener('click', () => dropzone.openPicker());

  // Accept a file dropped anywhere on the page. Before this, dropping
  // one pixel outside the drop-zone element navigated the browser away
  // from Foveacast and opened the file in the tab — the worst failure
  // mode for a one-purpose tool. The document-level handler also gates
  // on the same enabled/busy state (via the shared callbacks: the
  // handleFile below will reject early if the model isn't ready).
  installPageDrop(fileCallbacks);

  // --- Controls ---------------------------------------------------------
  const controls = createControls({
    onDurationChange: (duration) => {
      switchDuration(duration);
    },
    onOpacityChange: (value) => {
      state.opacity = value;
      recomposite();
    },
    onViewChange: (view) => {
      state.view = view;
      renderOutput();
    },
    onBlendModeChange: (mode) => {
      state.blendMode = mode;
      recomposite();
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
    onOverlayChange: (overlays) => {
      state.overlays = overlays;
      renderOutput();
    },
  });
  controls.setDisabled(true); // Enabled once the model is ready.
  // Progressive disclosure: controls stay hidden until there is
  // actually something to control (first demo render or first
  // inference result). Pre-drop they are noise competing with the
  // drop zone for attention.
  controls.setVisible(false);
  controlsMount.appendChild(controls.element);

  // Click the output canvas area to cycle 1 s → 3 s → 7 s → 1 s.
  // Only active after an image has been processed; no-ops before first drop.
  const CYCLE_DURATIONS = /** @type {const} */ (['1s', '3s', '7s']);
  outputCanvasWrap.addEventListener('click', () => {
    if (!state.lastImage) return; // No result yet; nothing to cycle.
    const currentIdx = CYCLE_DURATIONS.indexOf(state.displayedDuration);
    const next = CYCLE_DURATIONS[(currentIdx + 1) % CYCLE_DURATIONS.length];
    switchDuration(next);
  });

  // --- Footer (attribution) --------------------------------------------
  mountFooter(document.querySelector('#fc-sidebar-credits'));

  // --- HUD stats panel -------------------------------------------------
  const hud = createHud(hudMount);

  // --- Analysis report -------------------------------------------------
  const report = createReport({ mountEl: reportMount });

  /**
   * Reveal the bottom toolbar and hide the pre-inference intro section.
   * Called from both the demo path and the real-inference path so both
   * share the same reveal behaviour.
   */
  function showControls() {
    controls.setVisible(true);
    // Reveal the bottom toolbar (was `hidden` in HTML).
    toolbarEl.hidden = false;
    // Add padding so content at the bottom of the column isn't obscured
    // by the fixed toolbar bar.
    document.getElementById('fc-main')?.classList.add('fc-main--has-toolbar');
    // Hide the empty-state intro (renamed from fc-sidebar-intro in the
    // single-column redesign).
    const intro = document.getElementById('fc-intro');
    if (intro) intro.hidden = true;
    // Swap out the full dropzone for the compact new-image button.
    // Drag-anywhere and clipboard paste remain active via page-drop.js
    // regardless of whether the dropzone element is visible.
    const dropRow = document.querySelector('.fc-drop-row');
    if (dropRow) dropRow.hidden = true;
    const newUploadRow = document.getElementById('fc-new-upload-row');
    if (newUploadRow) newUploadRow.hidden = false;
  }

  /**
   * Refresh the analysis report with the current state. Safe to call
   * repeatedly — the report module updates in-place without rebuilding DOM.
   * Called after primary inference and after each background duration arrives.
   */
  function updateReport() {
    if (!state.lastImage) return;
    report.update({ image: state.lastImage, durationResults: state.durationResults });
  }

  /**
   * Toggle the busy overlay during model loads and inference runs.
   * The topnav loading bar stays as a secondary indicator; this overlay
   * makes the blocked state unmistakable.
   *
   * @param {boolean} busy
   * @param {string} [label] - Text shown inside the overlay card.
   */
  function setAppBusy(busy, label = 'Analysing…') {
    document.querySelector('.fc-topnav')?.classList.toggle('fc-topnav--busy', busy);
    const overlay = document.getElementById('fc-busy-overlay');
    if (overlay) {
      if (busy) {
        const lbl = document.getElementById('fc-busy-overlay-label');
        if (lbl) lbl.textContent = label;
      }
      overlay.classList.toggle('fc-busy-overlay--active', busy);
    }
    // Mirror busy state onto the new-image button so it cannot be used
    // while a model load or inference run is already in progress.
    const newUploadBtn = document.getElementById('fc-new-upload-btn');
    if (newUploadBtn) newUploadBtn.disabled = busy;
  }

  /**
   * Show or hide the waiting spinner on the output canvas area.
   * Shown when the user selects a duration that is still loading in
   * the background; cleared by applyDurationResult() when ready.
   *
   * @param {boolean} waiting
   */
  function setOutputWaiting(waiting) {
    outputSection.classList.toggle('fc-output--waiting', waiting);
  }

  /**
   * Show the background-loading progress bar at the given fill fraction.
   * The fraction maps download + inference to [0, 1] across all
   * background durations.
   *
   * @param {number} fraction - Fill level in [0, 1].
   * @param {string} [currentLabel] - Human-readable label of the duration currently loading.
   */
  function showBgProgress(fraction, currentLabel) {
    const bar = document.getElementById('fc-bg-progress');
    if (!bar) return;
    bar.hidden = false;
    const fill = /** @type {HTMLElement | null} */ (bar.querySelector('.fc-bg-progress__fill'));
    if (fill) fill.style.width = `${Math.round(fraction * 100)}%`;
    const label = /** @type {HTMLElement | null} */ (bar.querySelector('.fc-bg-progress__label'));
    if (label) {
      if (fraction >= 0.99) {
        label.textContent = 'All durations ready';
      } else {
        const pct = `${Math.round(fraction * 100)}\u00a0%`;
        label.textContent = currentLabel
          ? `Loading ${currentLabel}\u2026 ${pct}`
          : `Loading\u2026 ${pct}`;
      }
    }
  }

  /** Hide the background-loading progress bar. */
  function hideBgProgress() {
    const bar = document.getElementById('fc-bg-progress');
    if (bar) bar.hidden = true;
  }

  /**
   * Apply a cached DurationResult to the display state and re-render.
   * Called both by cycle/switch code (direct) and by loadBackgroundDurations
   * when a waiting result finishes.
   *
   * @param {import('./model/loader.js').Duration} duration
   */
  function applyDurationResult(duration) {
    const result = state.durationResults[duration];
    if (!result || result === 'loading' || result === 'failed') return;

    state.lastHeatmapCanvas = result.heatmapCanvas;
    state.lastFixation = result.fixation;
    state.lastOrigDims = result.origDims;
    state.lastDiagnostics = result.diagnostics;
    state.lastFixationSequence = result.fixationSequence ?? null;
    state.lastAttentionZoneCanvas = result.attentionZoneCanvas ?? null;
    state.lastRuleOfThirds = result.ruleOfThirds ?? null;
    state.displayedDuration = duration;

    const [origH, origW] = result.origDims;
    updateHud(hud, {
      inferenceMs: result.inferenceMs,
      duration,
      spreadLevel: result.metrics.spreadLevel,
      width: origW,
      height: origH,
    });
    if (result.ruleOfThirds) {
      updateHudRuleOfThirds(hud, result.ruleOfThirds);
    }

    controls.setDuration(duration);
    setOutputWaiting(false);
    renderOutput();
  }

  /**
   * Background-load the 1 s and 7 s models, run inference on the
   * provided work canvas, and cache results in state.durationResults.
   *
   * Sequential loading (1 s then 7 s) avoids holding two 57 MB WASM
   * sessions in memory at once. Each iteration checks bgGenId at every
   * async boundary so a new image drop immediately invalidates stale work.
   * Sessions are always released in `finally` to prevent WASM heap leaks.
   *
   * @param {HTMLImageElement | ImageBitmap | HTMLCanvasElement} workCanvas
   * @param {number} genId - The bgGenId value captured at kickoff time.
   */
  async function loadBackgroundDurations(workCanvas, genId) {
    const BG_DURATIONS = /** @type {const} */ (['1s', '7s']);
    const total = BG_DURATIONS.length;

    showBgProgress(0, DURATION_LABELS[BG_DURATIONS[0]]);

    try {
      for (let i = 0; i < BG_DURATIONS.length; i++) {
        const dur = BG_DURATIONS[i];

        if (state.bgGenId !== genId) return; // stale: new image was dropped

        state.durationResults[dur] = 'loading';
        controls.setDurationStatus(dur, 'loading');

        // --- Model download ------------------------------------------------

        let bgModel = null;
        try {
          bgModel = await loadModel({
            duration: dur,
            onProgress: (p) => {
              if (state.bgGenId !== genId) return; // stale: skip UI update
              // Map this model's download progress to [i/total, (i+0.8)/total].
              showBgProgress((i + p.fraction * 0.8) / total, DURATION_LABELS[dur]);
            },
          });
        } catch (err) {
          // Model download or parse failed; mark this duration and continue.
          console.warn(`Foveacast: background model load failed for ${dur}.`, err);
          if (state.bgGenId === genId) {
            state.durationResults[dur] = 'failed';
            controls.setDurationStatus(dur, 'failed');
          }
          continue;
        }

        // Stale-check after the async load; if stale, release and bail.
        if (state.bgGenId !== genId) {
          try { bgModel.session.release(); } catch { /* best-effort */ }
          return;
        }

        // --- Inference (session always released in finally) ----------------

        let result = null;
        try {
          // Paint the progress bar at ~80% of this slot before WASM blocks.
          showBgProgress((i + 0.8) / total, DURATION_LABELS[dur]);
          // Double-rAF: ensure the browser paints the updated progress bar
          // before session.run() blocks the main thread synchronously.
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

          // Stale-check in the rAF gap: a file may have been queued during
          // the model download and could be about to run. Bail now rather
          // than stacking two WASM calls.
          if (state.bgGenId !== genId) return;

          const inferStart = performance.now();
          const { saliency, inputDims } = await runInference(workCanvas, bgModel);
          const inferenceMs = Math.round(performance.now() - inferStart);

          const origW = workCanvas.width;
          const origH = workCanvas.height;
          const metrics = computeSaliencyMetrics(saliency);
          const processed = postprocess(saliency, inputDims, [origH, origW]);
          const heatmapCanvas = renderSaliencyCanvas(processed, origW, origH);
          const fixation = firstFixationCentroid(processed, origW, origH);

          // Saliency visualization artifacts — computed once and cached.
          const fixationSequence = topNFixations(processed, origW, origH, 5);
          const zoneThresholds = computeZoneThresholds(processed, [0.10, 0.25, 0.50]);
          const attentionZoneCanvas = renderAttentionZoneCanvas(processed, origW, origH, zoneThresholds);
          const ruleOfThirds = computeRuleOfThirds(processed, origW, origH);

          let salMin = Infinity, salMax = -Infinity, salSum = 0;
          for (let j = 0; j < saliency.length; j++) {
            if (saliency[j] < salMin) salMin = saliency[j];
            if (saliency[j] > salMax) salMax = saliency[j];
            salSum += saliency[j];
          }
          const peakIdx = saliency.indexOf(salMax);
          const peakY = Math.floor(peakIdx / inputDims[1]);
          const peakX = peakIdx % inputDims[1];

          result = {
            heatmapCanvas,
            fixation,
            fixationSequence,
            attentionZoneCanvas,
            ruleOfThirds,
            origDims: /** @type {[number, number]} */ ([origH, origW]),
            metrics,
            inferenceMs,
            diagnostics: {
              sourceWidth: origW,
              sourceHeight: origH,
              modelInputDims: inputDims,
              saliencyLength: saliency.length,
              saliencyMin: salMin.toFixed(4),
              saliencyMax: salMax.toFixed(4),
              saliencyMean: (salSum / saliency.length).toFixed(4),
              peakLocation: `(${peakX}, ${peakY})`,
              duration: dur,
            },
          };
        } catch (err) {
          // Inference failed — mark failed; session released in finally below.
          console.warn(`Foveacast: background inference failed for ${dur}.`, err);
          if (state.bgGenId === genId) {
            state.durationResults[dur] = 'failed';
            controls.setDurationStatus(dur, 'failed');
          }
        } finally {
          // Always release the WASM session to return ~57 MB to the heap.
          if (bgModel) {
            try { bgModel.session.release(); } catch { /* best-effort */ }
          }
        }

        // Commit only if the result was built and still valid.
        if (result && state.bgGenId === genId) {
          state.durationResults[dur] = result;
          controls.setDurationStatus(dur, 'ready');
          updateReport(); // Refresh the report strip with the new duration canvas.
          // Announce the next duration loading, or 100% if this was the last.
          const nextLabel = i + 1 < BG_DURATIONS.length ? DURATION_LABELS[BG_DURATIONS[i + 1]] : undefined;
          showBgProgress((i + 1) / total, nextLabel);

          // If the user clicked this duration while it was loading, display
          // the result now that it has arrived.
          if (state.displayedDuration === dur) {
            applyDurationResult(dur);
          }

          // Once all 3 durations are ready, enable the trajectory overlay
          // and re-render if the trajectory toggle is on, so the overlay
          // appears without requiring the user to toggle it off and on.
          const allReady = (['1s', '3s', '7s'] /** @type {const} */).every(
            (d) => state.durationResults[d] && state.durationResults[d] !== 'loading' && state.durationResults[d] !== 'failed',
          );
          if (allReady) {
            controls.setTrajectoryAvailable(true);
            if (state.overlays.centroidTrajectory) renderOutput();
          }
        }
      }
    } finally {
      // Always hide the progress bar — whether we completed, errored, or
      // returned early due to a stale genId.
      hideBgProgress();
    }
  }

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
        showControls();
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
   * @param {{ silent?: boolean, duration?: import('./model/loader.js').Duration }} [options]
   */
  async function reloadModel(options = {}) {
    const { silent = false, duration = state.activeDuration } = options;
    // why: ORT sessions hold WASM heap memory for the graph (~57 MB).
    // Without an explicit release, switching durations repeatedly would
    // accumulate unreclaimable memory until GC collects the orphaned
    // JS wrapper — and WASM linear memory is never returned to the OS.
    if (state.loadedModel && state.loadedModel.session) {
      try { state.loadedModel.session.release(); } catch { /* best-effort */ }
    }
    state.loadedModel = null;
    state.activeDuration = duration;
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

    setAppBusy(true, 'Loading model\u2026');
    let loaded;
    try {
      loaded = await loadModel({
        duration,
        onProgress: (progress) => {
          if (silent) return;
          const elapsed = performance.now() - startedAt;
          if (!firstRunShown && elapsed > FIRST_RUN_THRESHOLD_MS && progress.fraction < 0.95) {
            firstRunShown = true;
          }
          if (firstRunShown) {
            status.showFirstRun(progress);
          }
        },
      });
    } catch (err) {
      setAppBusy(false);
      throw err;
    }
    state.loadedModel = loaded;
    writeHasRunSentinel(); // Flip the bit after a successful load.
    dropzone.setEnabled(true);
    controls.setDisabled(false);
    controls.setDurationLoading(false);
    if (!silent) status.showReady();
    setAppBusy(false);
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
   * Switch to a different viewing-duration model. Loads the new model
   * and re-runs inference on the current image if one is loaded.
   *
   * Race protection: each call increments a generation counter. If the
   * user switches duration again before the previous load finishes,
   * the earlier load's results are discarded.
   *
   * @param {import('./model/loader.js').Duration} duration
   */
  async function switchDuration(duration) {
    // Fast path: result already cached — display immediately without
    // reloading the model or re-running inference.
    const cached = state.durationResults[duration];
    if (cached && cached !== 'loading' && cached !== 'failed') {
      state.displayedDuration = duration;
      controls.setDuration(duration);
      applyDurationResult(duration);
      return;
    }

    // Pending: background loading is in progress — show waiting state
    // so the user gets feedback, and let loadBackgroundDurations auto-
    // display the result when it arrives.
    if (cached === 'loading') {
      state.displayedDuration = duration;
      controls.setDuration(duration);
      setOutputWaiting(true);
      return;
    }

    // Null or failed: fall through to the model-reload path below.
    // Cancel any in-flight background loading first so we don't have
    // competing WASM calls for the same or different durations.
    state.bgGenId++;

    if (duration === state.activeDuration && state.loadedModel) return;

    const generation = ++state.durationSwitchGeneration;
    state.activeDuration = duration;
    controls.setDurationLoading(true);

    try {
      // Load the new model. Use silent=false so the user sees progress
      // if this is a first download, but suppress if user already has
      // a result showing (the duration-loading hint is enough feedback).
      const hasExistingResult = !!state.lastImage;
      await reloadModel({
        duration,
        silent: hasExistingResult,
      });
    } catch (err) {
      // Only surface the error if this is still the active generation.
      if (generation === state.durationSwitchGeneration) {
        controls.setDurationLoading(false);
        surfaceModelError(err);
      }
      return;
    }

    // Stale: the user switched to yet another duration while we were
    // loading this one. Discard — the newer load will handle it.
    if (generation !== state.durationSwitchGeneration) return;

    controls.setDurationLoading(false);

    // Re-run inference on the current image with the new model.
    if (state.lastImage) {
      try {
        await runInferenceOnImage(state.lastImage);
      } catch (err) {
        console.error('Foveacast: re-inference after duration switch failed.', err);
        status.showError({
          code: 'INFERENCE_FAILED',
          onRetry: () => status.clear(),
        });
      }
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
   * Run inference on a prepared image source (already downsampled if
   * needed) and update state + render output. Extracted so both
   * `handleFile` and `switchDuration` can share the same pipeline.
   *
   * @param {HTMLImageElement | ImageBitmap | HTMLCanvasElement} workCanvas
   */
  async function runInferenceOnImage(workCanvas) {
    if (!state.loadedModel) return;

    // Cancel any in-flight background loading immediately. Without this,
    // dropping a new image while background inference is blocking the
    // thread would let the stale result land in durationResults between
    // the WASM return and the new file being processed.
    state.bgGenId++;

    // Capture the duration at the start of inference so we can detect
    // a stale result if the user switches duration while inference is
    // running. Without this check, a slow inference on the old model
    // would write its results into state and display them under the
    // new duration's label.
    const inferDuration = state.activeDuration;

    status.showInference();
    dropzone.setBusy(true);
    controls.setDisabled(true);
    setAppBusy(true, 'Analysing image\u2026');
    // Double-rAF: the single-rAF continuation runs during the rendering
    // pipeline's own callback phase, so the browser never reaches the
    // style/layout/paint step for that frame before we block the thread
    // with synchronous WASM.  Scheduling a second rAF from inside the
    // first causes the browser to complete one full paint cycle (showing
    // the overlay) before our continuation fires and hands control to WASM.
    await new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });

    try {
      const origW = workCanvas.width;
      const origH = workCanvas.height;

      // Run inference. `runInference` internally calls the preprocessing
      // pipeline and returns the raw model output plus the model's
      // native input dims (which post-processing needs).
      const inferStart = performance.now();
      const { saliency, inputDims, sourceDims } = await runInference(workCanvas, state.loadedModel);
      const inferenceMs = Math.round(performance.now() - inferStart);

      // Stale: the user switched duration while inference was running.
      // Discard these results — the new duration's inference will
      // produce the correct output.
      if (inferDuration !== state.activeDuration) return;

      // Upsample + blur + normalise to the work canvas's dims so the
      // heatmap aligns pixel-for-pixel with the image we're going to
      // composite it over.
      // why: metrics computed on raw model output (smaller array) to avoid
      // jank from sorting the full upsampled saliency (~2 M elements at HD).
      const metrics = computeSaliencyMetrics(saliency);
      const processed = postprocess(saliency, inputDims, [origH, origW]);

      updateHud(hud, {
        inferenceMs,
        duration: state.activeDuration,
        spreadLevel: metrics.spreadLevel,
        width: origW,
        height: origH,
      });

      const fixation = firstFixationCentroid(processed, origW, origH);

      const heatmapCanvas = renderSaliencyCanvas(processed, origW, origH);

      // Saliency visualization artifacts — computed once and cached.
      const fixationSequence = topNFixations(processed, origW, origH, 5);
      const zoneThresholds = computeZoneThresholds(processed, [0.10, 0.25, 0.50]);
      const attentionZoneCanvas = renderAttentionZoneCanvas(processed, origW, origH, zoneThresholds);
      const ruleOfThirds = computeRuleOfThirds(processed, origW, origH);
      updateHudRuleOfThirds(hud, ruleOfThirds);

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
      state.lastFixationSequence = fixationSequence;
      state.lastAttentionZoneCanvas = attentionZoneCanvas;
      state.lastRuleOfThirds = ruleOfThirds;
      state.lastDiagnostics = {
        sourceWidth: origW,
        sourceHeight: origH,
        modelInputDims: inputDims,
        saliencyLength: saliency.length,
        saliencyMin: salMin.toFixed(4),
        saliencyMax: salMax.toFixed(4),
        saliencyMean: (salSum / saliency.length).toFixed(4),
        peakLocation: `(${peakX}, ${peakY})`,
        duration: state.activeDuration,
      };

      // Cache the primary 3 s result and reset the other two durations
      // so loadBackgroundDurations starts fresh for this image.
      state.durationResults[inferDuration] = {
        heatmapCanvas,
        fixation,
        fixationSequence,
        attentionZoneCanvas,
        ruleOfThirds,
        origDims: /** @type {[number, number]} */ ([origH, origW]),
        metrics,
        inferenceMs,
        diagnostics: /** @type {any} */ (state.lastDiagnostics),
      };
      state.displayedDuration = inferDuration;
      for (const dur of /** @type {const} */ (['1s', '3s', '7s'])) {
        if (dur !== inferDuration) {
          state.durationResults[dur] = null;
          controls.setDurationStatus(dur, 'idle');
        }
      }
      controls.setDurationStatus(inferDuration, 'ready');
      // Reset trajectory availability for the new image — it will be re-enabled
      // by loadBackgroundDurations once all 3 durations complete.
      controls.setTrajectoryAvailable(false);

      // Kick off background loading of the other two durations.
      // Fire-and-forget: errors are handled inside loadBackgroundDurations.
      const kickGenId = state.bgGenId;
      loadBackgroundDurations(workCanvas, kickGenId).catch((err) => {
        console.warn('Foveacast: background duration loading threw unexpectedly.', err);
      });

      renderOutput();
      updateReport();
      // Reveal controls now that there is a real result to operate on
      // (non-demo path). Safe to call repeatedly — no-op after first.
      showControls();
      status.clear();

      // PRD §Accessibility: after inference completes, move focus to
      // the output area so keyboard users aren't left at the top of
      // the page.
      outputSection.focus();
    } finally {
      dropzone.setBusy(false);
      controls.setDisabled(false);
      setAppBusy(false);
    }
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

      await runInferenceOnImage(workCanvas);
    } catch (err) {
      console.error('Foveacast: inference failed.', err);
      status.showError({
        code: 'INFERENCE_FAILED',
        onRetry: () => status.clear(),
      });
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

    // Build centroid trajectory from all three ready duration results.
    // Ordered 1s → 3s → 7s so the line shows attention shift over time.
    const TRAJ_DURATIONS = /** @type {const} */ (['1s', '3s', '7s']);
    const centroidTrajectory = [];
    const centroidLabels = [];
    for (const d of TRAJ_DURATIONS) {
      const r = state.durationResults[d];
      if (r && r !== 'loading' && r !== 'failed' && r.fixation) {
        centroidTrajectory.push(r.fixation);
        centroidLabels.push(DURATION_LABELS[d] ?? d);
      }
    }

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
        blendMode: state.blendMode,
        fixation: state.lastFixation,
        origDims: state.lastOrigDims,
        duration: DURATION_LABELS[state.displayedDuration],
        diagnostics: state.lastDiagnostics,
        fixationSequence: state.lastFixationSequence,
        attentionZoneCanvas: state.lastAttentionZoneCanvas,
        centroidTrajectory: centroidTrajectory.length >= 2 ? centroidTrajectory : null,
        centroidLabels,
        overlays: state.overlays,
      },
      { outputSection, outputCanvasWrap, outputCaption },
    );

    // Update the workspace heading with the active viewing duration so
    // the user always knows which result is on screen without looking at
    // the sidebar selector.
    const durationBadge = document.getElementById('fc-duration-label');
    if (durationBadge) {
      const label = DURATION_LABELS[state.displayedDuration];
      durationBadge.textContent = label ?? '';
      durationBadge.hidden = !label;
    }
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
