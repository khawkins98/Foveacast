// ONNX Runtime Web loader for the V3 MSI-Net saliency models.
//
// V3 ships three duration-specific models (1s, 3s, 7s viewing windows),
// each fine-tuned on the corresponding UEyes ground-truth heatmap. The
// loader accepts a `duration` parameter and resolves the correct ONNX
// artefact path. All three share the same input shape (240×320) and
// preprocessing contract — the only difference is which viewing-window
// ground truth they were trained against.
//
// The .onnx artefacts are fetched from a GitHub Release at deploy time
// (not committed to the repo — at 57 MB each they would bloat the
// clone). The deploy workflow in .github/workflows/deploy.yml downloads
// them to docs/models/v3/{1s,3s,7s}/model.onnx before the Pages upload
// step.
//
// `onnxruntime-web` is loaded from a vendored <script> tag in
// index.html and attaches itself to `globalThis.ort`. Keeping it off
// the ES-module graph means the rest of the UI code stays buildless;
// opening `docs/index.html` directly off the filesystem works with
// no bundler in sight.

import { MODEL_INPUT_DIMS } from '../pipeline/preprocess.js';

// Re-export so callers who reach for loader.js don't have to know the
// pipeline is the source of truth. The constant itself lives with
// preprocess because preprocess produces the tensor shape.
export { MODEL_INPUT_DIMS };

/**
 * Available viewing-duration windows. Each corresponds to a separate
 * ONNX model fine-tuned on the matching UEyes heatmap variant.
 *
 * - `1s` — first glance: what grabs the eye first.
 * - `3s` — quick scan: what's noticed in a few seconds.
 * - `7s` — full viewing: what's eventually seen.
 *
 * @type {readonly ['1s', '3s', '7s']}
 */
export const DURATIONS = /** @type {const} */ (['1s', '3s', '7s']);

/**
 * @typedef {'1s' | '3s' | '7s'} Duration
 */

/**
 * Human-readable labels for each duration, used in the controls UI.
 * @type {Readonly<Record<Duration, string>>}
 */
export const DURATION_LABELS = Object.freeze({
  '1s': 'First glance (1 second)',
  '3s': 'Quick scan (3 seconds)',
  '7s': 'Full viewing (7 seconds)',
});

/** @type {Duration} */
export const DEFAULT_DURATION = '3s';

/**
 * Build the same-origin path to the ONNX artefact for the given duration.
 * Downloaded at deploy time from the foveacast-training GitHub Release
 * (not committed to the repo). For local dev, run the fetch script first:
 *   scripts/fetch-v3-model.sh
 *
 * @param {Duration} duration
 * @returns {string}
 */
export function modelUrlForDuration(duration) {
  if (!DURATIONS.includes(duration)) {
    throw new Error(
      `Invalid duration "${duration}". Expected one of: ${DURATIONS.join(', ')}`,
    );
  }
  return `./models/v3/${duration}/model.onnx`;
}

/**
 * @typedef {Object} LoadProgress
 * @property {number} fraction - Weight-download progress in `[0, 1]`.
 * @property {number|undefined} loaded - Bytes loaded if known.
 * @property {number|undefined} total - Total bytes if known.
 *
 * The model is a single artefact, so progress is a real percentage of
 * bytes fetched rather than the fraction-of-shards TF.js exposed for
 * MSI-Net. Both `loaded` and `total` are populated for a served
 * response; either may be undefined if the server omits Content-Length.
 */

/**
 * @typedef {Object} LoadedModel
 * @property {any} session - The `ort.InferenceSession` instance.
 * @property {[number, number]} inputDims - `[H, W]` for the model graph.
 * @property {Duration} duration - Which viewing window this model was trained on.
 */

/**
 * Cache API store name for persisted model artefacts. The `v1` suffix
 * lets a future breaking change (different URL scheme, model format)
 * force a clean slate by bumping to `v2`, treating every browser as a
 * first-time visitor for the new download.
 */
const CACHE_NAME = 'foveacast-models-v1';

/**
 * Revalidate a cached model entry in the background using an ETag HEAD
 * check. If the server ETag has changed (i.e. a new model was deployed),
 * evict the stale entry so the *next* page load re-downloads the updated
 * model. Errors are silently ignored — offline, server hiccups, quota
 * issues — none of these should disturb a loaded session.
 *
 * @param {string} url
 * @param {string} cachedEtag
 * @param {Cache} cache
 */
async function revalidateCachedModel(url, cachedEtag, cache) {
  try {
    const head = await fetch(url, { method: 'HEAD' });
    const serverEtag = head.ok ? head.headers.get('ETag') : null;
    if (serverEtag && serverEtag !== cachedEtag) {
      // why: evict now so the next load fetches the updated model; the
      // current session is unaffected — bytes are already in memory.
      await cache.delete(url);
    }
  } catch {
    // Offline or transient network error — stale model is better than none.
  }
}

/**
 * Try to serve model bytes from the Cache API. Returns an ArrayBuffer
 * immediately on a hit, or `null` on a miss.
 *
 * Why Cache API and not the browser HTTP cache?
 *   GitHub Pages serves `.onnx` files with `Cache-Control: max-age=600`
 *   (10 minutes). After that window the browser must revalidate, and a
 *   changed ETag (e.g. after a re-deploy) triggers a full 57 MB download.
 *   Cache API storage has no automatic TTL — the model stays until the user
 *   clears site data or this function evicts it on an ETag mismatch.
 *
 * Cache hits never block on the network: bytes are served immediately,
 * and a background HEAD request revalidates the ETag. If the model was
 * updated, the stale entry is evicted and the *next* load re-downloads.
 *
 * Only entries backed by an ETag are persisted, so we always have a
 * validator for future revalidation and never accumulate permanently stale
 * entries.
 *
 * @param {string} url
 * @param {(progress: LoadProgress) => void} [onProgress]
 * @returns {Promise<ArrayBuffer|null>}
 */
async function readFromModelCache(url, onProgress) {
  if (typeof caches === 'undefined') return null;
  try {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(url);
    if (!cached) return null;

    const cachedEtag = cached.headers.get('ETag');
    const buf = await cached.arrayBuffer();

    // Revalidate in background — don't gate cache hits on a network round-trip.
    // If the ETag changed, the stale entry is evicted; the next page load
    // re-downloads. If we're offline the stale model serves fine.
    if (cachedEtag) {
      revalidateCachedModel(url, cachedEtag, cache).catch(() => {});
    }

    if (onProgress) onProgress({ fraction: 1, loaded: buf.byteLength, total: buf.byteLength });
    return buf;
  } catch {
    // Cache API error (quota, permissions, …) — fall through to network.
    return null;
  }
}

/**
 * Persist model bytes to the Cache API after a successful network download,
 * so future page loads can skip the re-download.
 *
 * We only cache responses that carry an ETag. Without a validator we cannot
 * detect future model updates, and the entry would remain forever stale.
 *
 * Errors are silently swallowed — a cache write failure is non-fatal; the
 * model is already loaded and the user is unaware.
 *
 * @param {string} url
 * @param {ArrayBuffer} buf
 * @param {Headers} responseHeaders - From the original GET response (for ETag).
 */
async function writeToModelCache(url, buf, responseHeaders) {
  if (typeof caches === 'undefined') return;
  const etag = responseHeaders.get('ETag');
  // Only cache if we have a validator for future revalidation. GitHub Pages
  // always provides ETags; this guard prevents permanent stale entries if a
  // future CDN ever omits them.
  if (!etag) return;
  try {
    const cache = await caches.open(CACHE_NAME);
    const headers = new Headers();
    headers.set('ETag', etag);
    headers.set(
      'Content-Type',
      responseHeaders.get('Content-Type') || 'application/octet-stream',
    );
    headers.set('Content-Length', String(buf.byteLength));
    // buf.slice(0) gives the Response its own copy of the bytes so the
    // caller's ArrayBuffer remains valid for ORT inference after this awaits.
    await cache.put(url, new Response(buf.slice(0), { headers }));
  } catch {
    // Quota exceeded or Cache API unavailable — not fatal.
  }
}

/**
 * Fetch a URL with an intermediate stream reader so progress events
 * can be reported while the bytes are still in flight. Returns the
 * full response body as an `ArrayBuffer` once the stream finishes.
 *
 * ORT Web's `InferenceSession.create(url)` form fetches internally
 * with no progress hooks. For a 57 MB artefact on cold cache, a
 * progress bar is worth the extra plumbing; we fetch ourselves and
 * hand the buffer to `InferenceSession.create(bytes)`.
 *
 * On repeat visits the bytes come from the Cache API (see
 * `readFromModelCache`), bypassing the browser HTTP cache which
 * GitHub Pages expires every 10 minutes.
 *
 * @param {string} url
 * @param {(progress: LoadProgress) => void} [onProgress]
 * @returns {Promise<ArrayBuffer>}
 */
async function fetchModelBytes(url, onProgress) {
  // Try the Cache API before hitting the network. Unlike the HTTP cache
  // (max-age=600 on GitHub Pages), Cache API storage persists across sessions
  // and is only evicted when the server ETag changes or the user clears site data.
  const cachedBuf = await readFromModelCache(url, onProgress);
  if (cachedBuf) return cachedBuf;

  const response = await fetch(url);
  if (!response.ok) {
    const err = /** @type {Error & { code?: string, status?: number }} */ (
      new Error(`Model download failed: HTTP ${response.status} (${url})`)
    );
    err.code = 'MODEL_DOWNLOAD_FAILED';
    err.status = response.status;
    throw err;
  }

  const responseHeaders = response.headers;

  // Content-Length is the only honest "total" signal; when the server
  // omits it (some CDNs, some dev servers with chunked encoding) we
  // fall back to fraction-undefined and let the UI show an
  // indeterminate spinner instead.
  const headerLen = responseHeaders.get('Content-Length');
  const total = headerLen ? Number(headerLen) : undefined;
  const body = response.body;

  let buf;

  // Older browsers without ReadableStream — or any environment where
  // the body is null (shouldn't happen on fetch-200) — fall back to
  // response.arrayBuffer(). Progress is a single 1.0 at the end.
  if (!body || typeof body.getReader !== 'function') {
    buf = await response.arrayBuffer();
    if (onProgress) onProgress({ fraction: 1, loaded: buf.byteLength, total });
  } else {
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
    buf = out.buffer;
  }

  // Persist for future visits. Awaited so tests can assert on cache.put
  // without extra flushes; for users the extra latency is negligible
  // compared to the 57 MB download that just finished.
  await writeToModelCache(url, buf, responseHeaders);

  return buf;
}

/**
 * Load one of the V3 MSI-Net ONNX graphs into an onnxruntime-web
 * InferenceSession.
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
 * @param {object} [options]
 * @param {Duration} [options.duration] - Viewing window (default: '3s').
 * @param {(progress: LoadProgress) => void} [options.onProgress]
 * @returns {Promise<LoadedModel>}
 */
export async function loadModel(options = {}) {
  const { duration = DEFAULT_DURATION, onProgress } = options;
  const url = modelUrlForDuration(duration);

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
    bytes = await fetchModelBytes(url, onProgress);
  } catch (err) {
    throw decorateLoadError(err, url);
  }

  let session;
  try {
    session = await ort.InferenceSession.create(bytes, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });
  } catch (err) {
    const decorated = decorateLoadError(err, url);
    // An InferenceSession.create failure is usually not a network
    // problem by the time we get here (we already have the bytes);
    // override the code accordingly.
    decorated.code = 'MODEL_LOAD_FAILED';
    decorated.message = `Model load failed after download (${url}): ${String((err && /** @type {Error} */ (err).message) || err)}`;
    throw decorated;
  }

  return {
    session,
    inputDims: MODEL_INPUT_DIMS,
    duration,
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
