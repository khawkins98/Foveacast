// ONNX Runtime Web loader for the UNISAL saliency model.
//
// V2 swapped MSI-Net through TensorFlow.js for UNISAL through
// onnxruntime-web. The export pipeline that produced the `.onnx`
// artefact is documented in scripts/unisal-onnx-export.py and
// docs/spikes/unisal-onnx-research.md. The artefact itself lives at
// docs/models/unisal/model.onnx — committed directly to the repo so
// there is no CDN dependency for the user at runtime.
//
// `onnxruntime-web` is loaded from a vendored <script> tag in
// index.html and attaches itself to `globalThis.ort`. Keeping it off
// the ES-module graph means the rest of the UI code stays buildless;
// opening `docs/index.html` directly off the filesystem works with
// no bundler in sight.

import { UNISAL_INPUT_DIMS } from '../pipeline/preprocess.js';

// Re-export so callers who reach for loader.js don't have to know the
// pipeline is the source of truth. The constant itself lives with
// preprocess because preprocess produces the tensor shape.
export { UNISAL_INPUT_DIMS };

/**
 * Same-origin path to the vendored UNISAL ONNX artefact. Committed at
 * docs/models/unisal/model.onnx (~12.5 MB). The app serves the file
 * itself — there is no CDN fallback and no fetch-at-deploy step, so
 * the buildless "unzip and open index.html" story keeps working.
 */
export const UNISAL_MODEL_URL = './models/unisal/model.onnx';

/**
 * @typedef {Object} LoadProgress
 * @property {number} fraction - Weight-download progress in `[0, 1]`.
 * @property {number|undefined} loaded - Bytes loaded if known.
 * @property {number|undefined} total - Total bytes if known.
 *
 * UNISAL is a single artefact, so progress is a real percentage of
 * bytes fetched rather than the fraction-of-shards TF.js exposed for
 * MSI-Net. Both `loaded` and `total` are populated for a served
 * response; either may be undefined if the server omits Content-Length.
 */

/**
 * @typedef {Object} LoadedModel
 * @property {any} session - The `ort.InferenceSession` instance.
 * @property {[number, number]} inputDims - `[H, W]` for UNISAL's SALICON graph.
 */

/**
 * Fetch a URL with an intermediate stream reader so progress events
 * can be reported while the bytes are still in flight. Returns the
 * full response body as an `ArrayBuffer` once the stream finishes.
 *
 * ORT Web's `InferenceSession.create(url)` form fetches internally
 * with no progress hooks. For a 12.5 MB artefact on cold cache, a
 * progress bar is worth the extra plumbing; we fetch ourselves and
 * hand the buffer to `InferenceSession.create(bytes)`.
 *
 * @param {string} url
 * @param {(progress: LoadProgress) => void} [onProgress]
 * @returns {Promise<ArrayBuffer>}
 */
async function fetchModelBytes(url, onProgress) {
  const response = await fetch(url);
  if (!response.ok) {
    const err = /** @type {Error & { code?: string, status?: number }} */ (
      new Error(`Model download failed: HTTP ${response.status} (${url})`)
    );
    err.code = 'MODEL_DOWNLOAD_FAILED';
    err.status = response.status;
    throw err;
  }

  // Content-Length is the only honest "total" signal; when the server
  // omits it (some CDNs, some dev servers with chunked encoding) we
  // fall back to fraction-undefined and let the UI show an
  // indeterminate spinner instead.
  const headerLen = response.headers.get('Content-Length');
  const total = headerLen ? Number(headerLen) : undefined;
  const body = response.body;

  // Older browsers without ReadableStream — or any environment where
  // the body is null (shouldn't happen on fetch-200) — fall back to
  // response.arrayBuffer(). Progress is a single 1.0 at the end.
  if (!body || typeof body.getReader !== 'function') {
    const buf = await response.arrayBuffer();
    if (onProgress) onProgress({ fraction: 1, loaded: buf.byteLength, total });
    return buf;
  }

  const reader = body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    if (onProgress) {
      const fraction = total ? Math.min(loaded / total, 0.999) : undefined;
      onProgress({ fraction: fraction ?? 0, loaded, total });
    }
  }
  if (onProgress) onProgress({ fraction: 1, loaded, total: total ?? loaded });

  // Concatenate chunks into a single ArrayBuffer. One-off cost at the
  // end of download; dwarfed by the inference cost that follows.
  const out = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out.buffer;
}

/**
 * Load the UNISAL ONNX graph into an onnxruntime-web InferenceSession.
 *
 * Expects `ort` to be on `globalThis` (loaded via the vendored
 * `<script src="./vendor/ort.wasm.min.js">` in index.html). Throws a
 * clear error if it is not — a common foot-gun when refactoring the
 * HTML, and a friendly error message is worth more than a cryptic
 * "ort is not defined".
 *
 * Note on execution provider: we request the `wasm` EP explicitly
 * and nothing else. ORT Web will fall back to single-threaded WASM
 * automatically when `crossOriginIsolated` is false, which is the
 * permanent state on GitHub Pages. WebGPU is out of scope for this
 * build; see docs/vendor/README.md for the reasoning.
 *
 * @param {(progress: LoadProgress) => void} [onProgress]
 * @returns {Promise<LoadedModel>}
 */
export async function loadModel(onProgress) {
  const ort = /** @type {any} */ (globalThis).ort;
  // `ort.InferenceSession` is exposed as a class (typeof 'function'),
  // not a plain object. The earlier `typeof === 'object'` check was a
  // false-positive trip; a successful load still failed the guard and
  // surfaced as "ORT Web is not available on globalThis" on first drop.
  // The fix is to check that the constructor is callable and that its
  // static `create` exists, which is the actual contract we rely on.
  if (!ort || !ort.InferenceSession || typeof ort.InferenceSession.create !== 'function') {
    throw new Error(
      'ONNX Runtime Web is not available on globalThis. Ensure `onnxruntime-web` is loaded (via CDN script tag or vendored copy) before calling loadModel().',
    );
  }

  // Let ORT's default wasm resolution do its own thing: it loads the
  // sibling `.mjs` / `.wasm` files relative to its own script URL
  // (`./vendor/ort.wasm.min.js`), which gives the right path in both
  // dev (`/vendor/...`) and GitHub Pages (`/<repo>/vendor/...`).
  // Setting `ort.env.wasm.wasmPaths` manually was previously tried
  // and it double-prefixed the path to `/vendor/vendor/` because
  // ORT resolves the override relative to its own script too.
  //
  // Cross-origin isolation is off on Pages (no COEP header), so we
  // force single-threaded explicitly — otherwise ORT warns about
  // `numThreads > 1` on load.
  if (ort.env && ort.env.wasm) {
    ort.env.wasm.numThreads = 1;
  }

  let bytes;
  try {
    bytes = await fetchModelBytes(UNISAL_MODEL_URL, onProgress);
  } catch (err) {
    throw decorateLoadError(err, UNISAL_MODEL_URL);
  }

  let session;
  try {
    session = await ort.InferenceSession.create(bytes, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });
  } catch (err) {
    const decorated = decorateLoadError(err, UNISAL_MODEL_URL);
    // An InferenceSession.create failure is usually not a network
    // problem by the time we get here (we already have the bytes);
    // override the code accordingly.
    decorated.code = 'MODEL_LOAD_FAILED';
    decorated.message = `Model load failed after download (${UNISAL_MODEL_URL}): ${String((err && /** @type {Error} */ (err).message) || err)}`;
    throw decorated;
  }

  return {
    session,
    inputDims: UNISAL_INPUT_DIMS,
  };
}

/**
 * Classify a thrown error from the load path into a structured error
 * with a `code` property that the UI layer can branch on without
 * inspecting the message.
 *
 * Two categories matter downstream:
 *   - `MODEL_DOWNLOAD_FAILED` — network or HTTP-status failure while
 *     fetching the .onnx bytes. Recovery action: retry.
 *   - `MODEL_LOAD_FAILED` — bytes fetched but ORT could not parse or
 *     initialise them. Recovery action: clear caches and reload.
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

  // Honour an already-tagged error (fetchModelBytes sets code on HTTP failures).
  if (original && original.code === 'MODEL_DOWNLOAD_FAILED') {
    const decorated = /** @type {Error & { code: string, cause: unknown, url: string }} */ (
      new Error(original.message || `Model download failed (${url})`)
    );
    decorated.code = 'MODEL_DOWNLOAD_FAILED';
    decorated.cause = original;
    decorated.url = url;
    return decorated;
  }

  // Walk the cause chain to find network-level signals.
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
  const looksLikeHttpFailure = /HTTP \d{3}|status \d{3}/i.test(messageBlob);

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
