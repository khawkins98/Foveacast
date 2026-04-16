// TensorFlow.js Graph Model loader for MSI-Net.
//
// The MSI-Net author published pre-converted TF.js Graph Model weights to
// a public Google Cloud Storage bucket, one model.json per quality
// preset. We fetch from there directly — no vendoring, no HuggingFace
// (the HF repo only carries the Keras SavedModel, not TF.js). The PRD's
// original wording was wrong about HF; commit 31bcbb8 corrected it.
//
// `@tensorflow/tfjs` is loaded from a CDN <script> tag in index.html and
// attaches itself to `globalThis.tf`. Keeping it off the ES-module graph
// means the rest of the UI code can stay buildless — opening
// `docs/index.html` directly off the filesystem works, with no bundler
// in sight.

import { PRESETS } from '../pipeline/preprocess.js';

/**
 * Preset → `model.json` URL at the MSI-Net author's Google Cloud
 * Storage bucket. Used as a fallback when the mirrored `./models/`
 * folder is not available (e.g. the buildless filesystem distribution,
 * where no one has run `scripts/fetch-weights.sh`).
 *
 * @type {Record<keyof typeof PRESETS, string>}
 */
export const GCS_MODEL_URLS = Object.freeze({
  very_low: 'https://storage.googleapis.com/msi-net/model/very_low/model.json',
  low: 'https://storage.googleapis.com/msi-net/model/low/model.json',
  medium: 'https://storage.googleapis.com/msi-net/model/medium/model.json',
  high: 'https://storage.googleapis.com/msi-net/model/high/model.json',
  very_high: 'https://storage.googleapis.com/msi-net/model/very_high/model.json',
});

/**
 * Preset → relative path to the mirrored weights. The GitHub Actions
 * deploy workflow runs `scripts/fetch-weights.sh` before uploading
 * the Pages artefact, so the hosted build serves weights from the
 * same origin as the app.
 *
 * @type {Record<keyof typeof PRESETS, string>}
 */
export const LOCAL_MODEL_URLS = Object.freeze({
  very_low: './models/very_low/model.json',
  low: './models/low/model.json',
  medium: './models/medium/model.json',
  high: './models/high/model.json',
  very_high: './models/very_high/model.json',
});

/**
 * Canonical name kept for backwards compatibility. Existing callers
 * used `MODEL_URLS`; new callers should prefer `resolveModelUrl` which
 * picks between the local mirror and the GCS fallback.
 *
 * @type {Record<keyof typeof PRESETS, string>}
 */
export const MODEL_URLS = GCS_MODEL_URLS;

/**
 * Resolve the URL to load a preset's weights from. Tries the local
 * mirror first (HEAD request); falls back to the GCS bucket if the
 * mirror is missing or unreachable.
 *
 * WHY two probes: the buildless filesystem distribution has no
 * `models/` folder, so a local fetch would fail there. The hosted
 * GitHub Pages build has a populated mirror, so we should prefer
 * same-origin weights to reduce the CDN surface and to keep the user
 * from depending on a bucket we do not control.
 *
 * @param {keyof typeof PRESETS} preset
 * @returns {Promise<string>}
 */
export async function resolveModelUrl(preset) {
  const localUrl = LOCAL_MODEL_URLS[preset];
  try {
    const resp = await fetch(localUrl, { method: 'HEAD' });
    if (resp.ok) return localUrl;
  } catch {
    // Filesystem fetches throw rather than returning 404; treat the
    // same as "not available, fall back to GCS".
  }
  return GCS_MODEL_URLS[preset];
}

/**
 * @typedef {Object} LoadProgress
 * @property {number} fraction - Weight-download progress in `[0, 1]`.
 * @property {number|undefined} loaded - Bytes loaded; often undefined.
 * @property {number|undefined} total - Total bytes; often undefined.
 *
 * Note: tf.js's native `onProgress` only exposes a fraction, so
 * `loaded` / `total` will usually be `undefined`. They are included in
 * the event shape so we can fill them in later from a `fetch` polyfill
 * if we ever want a real progress bar with byte counts.
 */

/**
 * @typedef {Object} LoadedModel
 * @property {any} model - The `tf.GraphModel` instance.
 * @property {keyof typeof PRESETS} preset
 * @property {[number, number]} inputDims - `[H, W]` for the preset.
 */

/**
 * Load the MSI-Net Graph Model for a preset.
 *
 * Expects `tf` to be on `globalThis` (loaded via CDN in `index.html`).
 * Throws a clear error if TF.js hasn't been loaded yet — this is a
 * common foot-gun when refactoring the HTML, and a friendly error
 * message is worth more than a cryptic "tf is not defined".
 *
 * @param {keyof typeof PRESETS} preset
 * @param {(progress: LoadProgress) => void} [onProgress]
 * @returns {Promise<LoadedModel>}
 */
export async function loadModel(preset, onProgress) {
  if (!Object.prototype.hasOwnProperty.call(MODEL_URLS, preset)) {
    throw new Error(`Unknown preset: ${preset}`);
  }

  const tf = /** @type {any} */ (globalThis).tf;
  if (!tf || typeof tf.loadGraphModel !== 'function') {
    throw new Error(
      'TensorFlow.js is not available on globalThis. Ensure `@tensorflow/tfjs` is loaded (via CDN script tag) before calling loadModel().'
    );
  }

  // Prefer the same-origin mirror (populated by the Pages deploy
  // workflow); fall back to GCS for filesystem / dev-server usage
  // where no mirror has been fetched.
  const url = await resolveModelUrl(preset);

  // tf.js's `onProgress` callback signature is `(fraction: number) => void`.
  // We wrap it so callers receive a richer shape, with `loaded`/`total`
  // left undefined here (see JSDoc note above).
  const tfOnProgress = onProgress
    ? (fraction) => {
        onProgress({ fraction, loaded: undefined, total: undefined });
      }
    : undefined;

  let model;
  try {
    model = await tf.loadGraphModel(url, tfOnProgress ? { onProgress: tfOnProgress } : undefined);
  } catch (err) {
    // Classify the failure at the site it happens. `tf.loadGraphModel`
    // wraps a `fetch` for model.json + a sequence of fetches for each
    // weight shard, then parses. Distinguishing "couldn't download"
    // from "downloaded but something is wrong with the bytes" matters
    // for the user-facing message and for the recovery action the UI
    // offers (MODEL_DOWNLOAD_FAILED → retry; MODEL_LOAD_FAILED → clear
    // cached data and reload).
    //
    // Why we don't string-sniff TF.js messages: those strings have
    // changed between TF.js versions and will again. Checking the
    // error constructor / cause where possible, and the fetch-level
    // signals where the library exposes them, is more stable.
    throw decorateLoadError(err, url);
  }

  return {
    model,
    preset,
    inputDims: PRESETS[preset],
  };
}

/**
 * Classify a thrown error from `tf.loadGraphModel` into a structured
 * error with a `code` property that the UI layer can branch on
 * without inspecting the message.
 *
 * Heuristics, in order of reliability:
 *   1. A `TypeError` from `fetch` (network failure) or a cause chain
 *      with `TypeError`. Browsers throw `TypeError: Failed to fetch`
 *      (Chrome/Firefox) or `TypeError: NetworkError when attempting
 *      to fetch` (Firefox) on the network-unreachable path. This is
 *      the most reliable network signal.
 *   2. An error whose message contains HTTP status wording like
 *      "Request failed with status" — TF.js wraps non-2xx fetches
 *      this way. Treat as download failure.
 *   3. Anything else (JSON parse error, shape mismatch, unexpected
 *      token, etc.) is classified as a load/parse failure.
 *
 * The returned error carries the original as `cause` so stack traces
 * are preserved for console debugging.
 *
 * @param {unknown} err
 * @param {string} url - The URL we were trying to load from.
 * @returns {Error & { code: 'MODEL_DOWNLOAD_FAILED' | 'MODEL_LOAD_FAILED', cause?: unknown, url?: string }}
 */
function decorateLoadError(err, url) {
  const original = /** @type {any} */ (err);

  // Walk the cause chain — modern engines expose the underlying
  // TypeError from fetch via `error.cause` or `error.name`.
  const causes = [];
  let cursor = original;
  let safetyDepth = 0;
  while (cursor && safetyDepth < 5) {
    causes.push(cursor);
    cursor = cursor.cause;
    safetyDepth += 1;
  }

  const isNetworkTypeError = causes.some(
    (e) => e && (e.name === 'TypeError' || e instanceof TypeError),
  );
  const messageBlob = causes.map((e) => String((e && e.message) || e)).join(' | ');
  const looksLikeHttpFailure = /Request failed with status/i.test(messageBlob);

  const code =
    isNetworkTypeError || looksLikeHttpFailure
      ? 'MODEL_DOWNLOAD_FAILED'
      : 'MODEL_LOAD_FAILED';

  const decorated = /** @type {Error & { code: string, cause: unknown, url: string }} */ (
    new Error(
      code === 'MODEL_DOWNLOAD_FAILED'
        ? `Model download failed (${url})`
        : `Model load failed after download (${url}): ${messageBlob}`,
    )
  );
  decorated.code = code;
  decorated.cause = original;
  decorated.url = url;
  return decorated;
}
