// Status banner — first-run progress, cache loads, inference state,
// and error recovery UI.
//
// The banner lives above the output area and carries both transient
// progress messages and the app's error surface. A single region with
// a mode switch (role / aria-live) is preferable to separate banners
// because screen readers only announce one live region at a time
// reliably; funnelling everything through one node keeps the
// announcement story predictable.
//
// PRD references:
//   - §First-Run: the ~60MB first-run copy, verbatim.
//   - §Error States: every error message is quoted verbatim.
//   - §Accessibility: role/aria-live switching, prefers-reduced-motion.

/**
 * User-facing error messages, verbatim from PRD §Error States. Kept
 * in one place so updates track a single source of truth.
 *
 * @type {Record<string, string>}
 */
const ERROR_MESSAGES = {
  MODEL_DOWNLOAD_FAILED:
    "Couldn't download the model — check your connection and try again.",
  MODEL_LOAD_FAILED:
    'There was a problem loading the model. Try clearing the cache and reloading.',
  UNSUPPORTED_TYPE:
    'Foveacast accepts PNG and JPEG screenshots. Try saving your image as a PNG first.',
  TOO_LARGE:
    'That image is too large. Try a screenshot under 20MB, or use a lower screen resolution.',
  INFERENCE_FAILED:
    'Something went wrong during analysis. Try the Fast preset, or use a smaller image.',
  DEMO_FAILED:
    'Demo mode failed to render. Real inference is unaffected \u2014 drop a screenshot to run it, or reload to try the demo again.',
};

const GENERIC_ERROR =
  'Something went wrong. Please reload the page and try again.';

/**
 * Retry button label per error code. Most errors retry with the
 * obvious verb ("Try again"); MODEL_LOAD_FAILED triggers a destructive
 * cache-clear so its label has to be explicit.
 *
 * @type {Record<string, string>}
 */
const RETRY_LABELS = {
  MODEL_LOAD_FAILED: 'Clear cached data and retry',
};

/**
 * @typedef {Object} FirstRunProgress
 * @property {number} fraction - 0..1
 * @property {number|undefined} [loaded]
 * @property {number|undefined} [total]
 */

/**
 * @typedef {Object} ErrorParams
 * @property {string} code
 * @property {string} [message]
 * @property {() => void} [onRetry]
 */

/**
 * @typedef {Object} StatusController
 * @property {HTMLElement} element
 * @property {(progress: FirstRunProgress) => void} showFirstRun
 * @property {() => void} showCacheLoad
 * @property {() => void} showReady
 * @property {(label?: string) => void} showInference
 * @property {(err: ErrorParams) => void} showError
 * @property {(message: string) => void} showDemoBanner
 * @property {() => void} clear
 */

/**
 * Does the user prefer reduced motion? We check at render time
 * rather than once at module load so changes to the OS setting are
 * respected immediately on the next state transition.
 */
function prefersReducedMotion() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * Build the status banner. The returned controller exposes one method
 * per state transition; calling any of them replaces the visible
 * content wholesale, so the caller does not need to track previous
 * state. `clear()` returns the banner to an empty, invisible state.
 *
 * @returns {StatusController}
 */
export function createStatus() {
  const root = document.createElement('div');
  root.className = 'fc-status';
  // Default polite — first-run, cache-load, ready, and inference
  // updates should not interrupt. Errors flip the region to assertive
  // below.
  root.setAttribute('role', 'status');
  root.setAttribute('aria-live', 'polite');
  root.hidden = true;

  /** Timer handle used by showReady() to auto-dismiss. Cleared whenever
   *  a different state takes over so old timers cannot dismiss the
   *  newer message mid-flight. */
  let readyTimeout = /** @type {ReturnType<typeof setTimeout>|null} */ (null);

  function clearReadyTimer() {
    if (readyTimeout !== null) {
      clearTimeout(readyTimeout);
      readyTimeout = null;
    }
  }

  /** Replace the banner's inner content with a freshly-built tree. */
  function setBody(mode, children) {
    clearReadyTimer();

    root.textContent = '';
    // Reset mode-specific classes each time so stale styling never
    // carries across transitions.
    root.className = `fc-status fc-status--${mode}`;

    // Error mode gets assertive + role=alert so screen readers
    // interrupt. All other modes are polite.
    if (mode === 'error') {
      root.setAttribute('role', 'alert');
      root.setAttribute('aria-live', 'assertive');
    } else {
      root.setAttribute('role', 'status');
      root.setAttribute('aria-live', 'polite');
    }

    for (const child of children) {
      if (child) root.appendChild(child);
    }
    root.hidden = false;
  }

  // --- First-run download -------------------------------------------

  /** @param {FirstRunProgress} progress */
  function showFirstRun(progress) {
    const fraction = Math.max(0, Math.min(1, Number(progress.fraction) || 0));
    const pct = Math.round(fraction * 100);

    const body = document.createElement('p');
    body.className = 'fc-status__body';
    body.textContent =
      'Downloading the attention model (one-time, ~60MB). This takes a minute on first open; after that it\u2019s instant.';

    const bar = document.createElement('progress');
    bar.className = 'fc-status__progress';
    bar.max = 1;
    bar.value = fraction;
    bar.setAttribute('aria-label', 'Model download progress');

    const readout = document.createElement('span');
    readout.className = 'fc-status__readout';
    // Prefer byte counts when the caller has them; fall back to a bare
    // percentage otherwise (tf.js's onProgress typically omits bytes).
    if (
      typeof progress.loaded === 'number' &&
      typeof progress.total === 'number' &&
      progress.total > 0
    ) {
      const loadedMb = (progress.loaded / (1024 * 1024)).toFixed(1);
      const totalMb = (progress.total / (1024 * 1024)).toFixed(1);
      readout.textContent = `${loadedMb} MB / ${totalMb} MB (${pct}%)`;
    } else {
      readout.textContent = `${pct}%`;
    }

    setBody('first-run', [body, bar, readout]);
  }

  // --- Cache load ---------------------------------------------------

  function showCacheLoad() {
    const body = document.createElement('p');
    body.className = 'fc-status__body';
    body.textContent = 'Loading model from cache\u2026';

    const bar = document.createElement('progress');
    bar.className = 'fc-status__progress';
    // No `value` → indeterminate.
    bar.setAttribute('aria-label', 'Loading model');

    setBody('cache-load', [body, bar]);
  }

  // --- Ready ---------------------------------------------------------

  function showReady() {
    const body = document.createElement('p');
    body.className = 'fc-status__body';
    // Carries the next action on purpose. "Model ready." on its own
    // left screen-reader users with no clue what to do, and the
    // auto-dismiss meant sighted users sometimes missed it entirely.
    body.textContent = 'Model loaded \u2014 drop a screenshot to start.';

    setBody('ready', [body]);

    // Stay on screen. The caller clears this banner when a drop
    // arrives (via `status.clear()` in the inference success path),
    // so there is no need for a timer to race against. Leaving the
    // message up until the user takes the next step is what makes
    // the message useful.
  }

  // --- Inference -----------------------------------------------------

  /** @param {string} [label] */
  function showInference(label) {
    const body = document.createElement('p');
    body.className = 'fc-status__body';
    body.textContent = label || 'Running inference\u2026';

    const indicator = document.createElement('span');
    // Reduced-motion users get a static dot; everyone else gets a
    // CSS-animated spinner the stylesheet drives off this class.
    if (prefersReducedMotion()) {
      indicator.className = 'fc-status__indicator fc-status__indicator--static';
      indicator.textContent = '\u25CF'; // ● — solid circle, stable across fonts.
      indicator.setAttribute('aria-hidden', 'true');
    } else {
      indicator.className = 'fc-status__indicator fc-status__indicator--spin';
      indicator.setAttribute('aria-hidden', 'true');
    }

    setBody('inference', [indicator, body]);
  }

  // --- Error ---------------------------------------------------------

  /** @param {ErrorParams} params */
  function showError(params) {
    const code = params && params.code ? String(params.code) : 'GENERIC';
    const message =
      (params && params.message) || ERROR_MESSAGES[code] || GENERIC_ERROR;

    const body = document.createElement('p');
    body.className = 'fc-status__body';
    body.textContent = message;

    const children = [body];

    if (params && typeof params.onRetry === 'function') {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'fc-status__retry';
      btn.textContent = RETRY_LABELS[code] || 'Try again';
      btn.addEventListener('click', () => {
        // Caller is responsible for whatever state follows (e.g.
        // calling showFirstRun again). We just fire the hook.
        params.onRetry();
      });
      children.push(btn);
    }

    setBody('error', children);
  }

  // --- Clear ---------------------------------------------------------

  function clear() {
    clearReadyTimer();
    root.textContent = '';
    root.hidden = true;
    root.className = 'fc-status';
    root.setAttribute('role', 'status');
    root.setAttribute('aria-live', 'polite');
  }

  // --- Demo mode -----------------------------------------------------
  //
  // Used only when `?demo=1` is in the URL. The banner makes clear that
  // the rendered output is synthetic — we don't want anyone taking a
  // screenshot of the demo and captioning it "here's what the model
  // thinks about my page".

  /** @param {string} message */
  function showDemoBanner(message) {
    const body = document.createElement('p');
    body.className = 'fc-status__body';
    body.textContent = message;

    setBody('demo', [body]);
    root.setAttribute('data-foveacast-status', 'demo');
  }

  return {
    element: root,
    showFirstRun,
    showCacheLoad,
    showReady,
    showInference,
    showError,
    showDemoBanner,
    clear,
  };
}

/**
 * Exported for tests and for UI code that needs to display the same
 * canonical message text (e.g. the dropzone already embeds the
 * UNSUPPORTED_TYPE/TOO_LARGE strings — both sources should stay in
 * lockstep).
 */
export const STATUS_ERROR_MESSAGES = Object.freeze({ ...ERROR_MESSAGES });
