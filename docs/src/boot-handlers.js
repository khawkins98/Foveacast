/**
 * boot-handlers.js
 *
 * Extracts the two stateful boot-time helpers — reloadModel and handleFile
 * — from the main.js boot() closure so they can be unit-tested in
 * isolation. Each function takes an explicit `deps` parameter in place of
 * the closure variables it previously captured.
 *
 * Callers (main.js) build a bound wrapper once during boot and use that
 * wrapper everywhere else, e.g.:
 *
 *   const boundReloadModel = (opts) => reloadModel(opts, reloadModelDeps);
 *
 * Exports:
 *   reloadModel(options, deps) — load/reload the saliency model
 *   handleFile(file, deps)     — decode and queue/run inference on a file
 *   loadFileAsImage(file)      — HTMLImageElement fallback for File → bitmap
 */

import { loadModel } from './model/loader.js';
import { readHasRunSentinel, writeHasRunSentinel } from './ui/has-run-sentinel.js';
import { downsampleIfLarge } from './ui/image-resize.js';

/**
 * ms elapsed before we upgrade a cache-load banner to a first-run banner.
 * If the model is already cached, the fetch completes in well under 800 ms;
 * if it takes longer, the user is almost certainly downloading for the
 * first time (or cleared site data).
 */
const FIRST_RUN_THRESHOLD_MS = 800;

/**
 * @typedef {{
 *   state: object,
 *   dropzone: { setEnabled: (v: boolean) => void, setLabel: (s: string) => void },
 *   controls: { setDisabled: (v: boolean) => void, setDurationLoading: (v: boolean) => void },
 *   status: {
 *     showFirstRun: (p: object) => void,
 *     showCacheLoad: () => void,
 *     showError: (o: object) => void,
 *     clear: () => void,
 *     element: HTMLElement,
 *   },
 *   setAppBusy: (busy: boolean, label?: string) => void,
 *   voxelBg: { setState: (s: string) => void } | null,
 *   handleFileFn: (file: File) => Promise<void>,
 * }} ReloadModelDeps
 */

/**
 * Load the saliency model with a first-run-vs-cache banner heuristic.
 *
 * `silent` suppresses the cache-load / first-run / ready banners so the
 * demo-mode background load does not stomp the demo banner. The dropzone
 * enable / controls enable / error surfacing all still run normally — only
 * the chatty status transitions are skipped.
 *
 * @param {{ silent?: boolean, duration?: import('./model/loader.js').Duration }} [options]
 * @param {ReloadModelDeps} deps
 */
export async function reloadModel(options = {}, deps) {
  const { state, dropzone, controls, status, setAppBusy, voxelBg, handleFileFn } = deps;
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

  // The sentinel is the authoritative signal. If it's absent, this browser
  // has never completed a model load before, so show the first-run banner
  // immediately — no 800ms wait contradicting the user's experience. If
  // it's present we still default to the cache-load banner and upgrade via
  // the time heuristic, which covers users who cleared site data.
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
  // Successful load: clear any OOM-retry sentinel set by a previous failed attempt.
  sessionStorage.removeItem('fc-oom-cache-cleared');
  writeHasRunSentinel(); // Flip the bit after a successful load.
  dropzone.setEnabled(true);
  controls.setDisabled(false);
  controls.setDurationLoading(false);
  if (!silent) {
    // Show "Model ready" inside the drop zone rather than in a separate
    // banner above it — the two messages were redundant. The label resets
    // to the default on the next setEnabled(true) call (after inference
    // completes), so it only appears once.
    dropzone.setLabel(
      'Model ready \u2014 drop a screenshot here, click to choose a file, or paste from the clipboard.',
    );
    status.clear();
  }
  // Trigger the cube→sphere morph now that the model is ready. The overlay
  // stays up until voxelBg fires onReady (main.js), which then calls
  // setAppBusy(false). If voxelBg is absent, fall back to the immediate
  // fade so the user is not stuck behind the overlay.
  if (voxelBg) {
    voxelBg.setState('ready');
  } else {
    setAppBusy(false);
  }

  // Drain any file the user dropped while we were still loading. This is
  // the second half of the demo-mode queued-drop flow.
  if (state.queuedFile) {
    const pending = state.queuedFile;
    state.queuedFile = null;
    status.element.removeAttribute('data-foveacast-queued');
    // Don't await — same reason the dropzone onFile doesn't await: we
    // want the caller to return promptly.
    handleFileFn(pending).catch((err) => {
      console.error('Foveacast: queued-file inference failed.', err);
      status.showError({
        code: 'INFERENCE_FAILED',
        onRetry: () => status.clear(),
      });
    });
  }
}

/**
 * @typedef {{
 *   state: object,
 *   status: {
 *     showFirstRun: (p: object) => void,
 *     showError: (o: object) => void,
 *     clear: () => void,
 *     element: HTMLElement,
 *   },
 *   runInferenceOnImage: (workCanvas: HTMLCanvasElement) => Promise<void>,
 * }} HandleFileDeps
 */

/**
 * Handle a user-dropped file through the full pipeline.
 *
 * In demo mode the dropzone goes live as soon as the synthetic preview
 * renders, which may be well before the real model has finished
 * downloading. A drop that arrives in that window gets queued: we show
 * the first-run banner so the user knows why the wait, and reloadModel()
 * picks up the queued file when it resolves. The user never sees a "model
 * still loading, try again" dead end.
 *
 * @param {File} file
 * @param {HandleFileDeps} deps
 */
export async function handleFile(file, deps) {
  const { state, status, runInferenceOnImage } = deps;

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
 * Load a File via an HTMLImageElement as a fallback when
 * `createImageBitmap` isn't available or refuses the input.
 * @param {File} file
 * @returns {Promise<HTMLImageElement>}
 */
export function loadFileAsImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      // Keep the URL alive long enough for downstream canvas draws — we
      // revoke after a tick.
      setTimeout(() => URL.revokeObjectURL(url), 0);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image from file'));
    };
    img.src = url;
  });
}
