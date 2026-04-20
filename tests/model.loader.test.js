// Loader tests. We stub `globalThis.ort.InferenceSession.create` and
// `globalThis.fetch` so we can assert on download behaviour, progress
// reporting, and error classification without depending on a real
// ONNX Runtime Web bundle or the 57 MB artefact on disk.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  loadModel,
  modelUrlForDuration,
  DURATIONS,
  DURATION_LABELS,
  DEFAULT_DURATION,
  MODEL_INPUT_DIMS,
} from '../docs/src/model/loader.js';

/**
 * Build a minimal ort-like mock that returns the session shape
 * `loadModel` expects. Any test that needs per-call behaviour
 * overrides this with its own vi.fn after installation.
 */
function installOrtMock({ sessionCreate } = {}) {
  const create = sessionCreate || vi.fn().mockResolvedValue({ fake: 'session' });
  /** @type {any} */ (globalThis).ort = {
    InferenceSession: { create },
    Tensor: function () {},
    env: { wasm: { wasmPaths: null, numThreads: null } },
  };
  return create;
}

/**
 * Build a fetch mock that streams `bytes` through a ReadableStream so
 * the progress-tracking code path is actually exercised.
 */
function makeStreamingFetch(bytes, { contentLength = bytes.byteLength, ok = true, status = 200, etag = null } = {}) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    headers: {
      get: (name) => {
        const n = String(name).toLowerCase();
        if (n === 'content-length') return contentLength != null ? String(contentLength) : null;
        if (n === 'etag') return etag;
        return null;
      },
    },
    body: {
      getReader() {
        let delivered = false;
        return {
          async read() {
            if (delivered) return { done: true, value: undefined };
            delivered = true;
            return { done: false, value: bytes };
          },
        };
      },
    },
    arrayBuffer: async () => bytes.buffer,
  });
}

describe('DURATIONS + DURATION_LABELS + DEFAULT_DURATION', () => {
  it('lists three viewing-window durations', () => {
    expect(Array.from(DURATIONS)).toEqual(['1s', '3s', '7s']);
  });

  it('has a human-readable label for each duration', () => {
    for (const dur of DURATIONS) {
      expect(typeof DURATION_LABELS[dur]).toBe('string');
      expect(DURATION_LABELS[dur].length).toBeGreaterThan(0);
    }
  });

  it('defaults to 3s', () => {
    expect(DEFAULT_DURATION).toBe('3s');
  });
});

describe('modelUrlForDuration', () => {
  it('returns the correct path for each duration', () => {
    expect(modelUrlForDuration('1s')).toBe('./models/v3/1s/model.onnx');
    expect(modelUrlForDuration('3s')).toBe('./models/v3/3s/model.onnx');
    expect(modelUrlForDuration('7s')).toBe('./models/v3/7s/model.onnx');
  });
});

describe('MODEL_INPUT_DIMS', () => {
  it('matches the SALICON export shape [240, 320]', () => {
    expect(Array.from(MODEL_INPUT_DIMS)).toEqual([240, 320]);
  });
});

describe('loadModel', () => {
  /** @type {any} */
  let originalOrt;
  /** @type {any} */
  let originalFetch;

  beforeEach(() => {
    originalOrt = /** @type {any} */ (globalThis).ort;
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    /** @type {any} */ (globalThis).ort = originalOrt;
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('throws when ort is missing from globalThis', async () => {
    /** @type {any} */ (globalThis).ort = undefined;
    await expect(loadModel()).rejects.toThrow(/ONNX Runtime Web is not available/);
  });

  it('accepts the real-shape ort.InferenceSession (a class, not a plain object)', async () => {
    // Regression for a false-positive guard: the earlier check was
    // `typeof ort.InferenceSession === 'object'`, but ORT Web exposes
    // InferenceSession as a class — typeof 'function'. A successful
    // load hit the guard and surfaced as "ORT is not available" on
    // first drop. This test pins the real global shape so that
    // failure mode cannot come back.
    class FakeInferenceSession {
      static async create() {
        return { fake: 'session' };
      }
    }
    /** @type {any} */ (globalThis).ort = {
      InferenceSession: FakeInferenceSession,
      Tensor: function () {},
      env: { wasm: {} },
    };
    globalThis.fetch = makeStreamingFetch(new Uint8Array(8));

    const result = await loadModel();
    expect(result.session).toEqual({ fake: 'session' });
  });

  it('defaults to the 3s model URL', async () => {
    const create = installOrtMock();
    globalThis.fetch = makeStreamingFetch(new Uint8Array([1, 2, 3]));

    await loadModel();

    expect(globalThis.fetch).toHaveBeenCalledWith(modelUrlForDuration('3s'));
  });

  it('fetches the correct artefact when a duration is specified', async () => {
    const create = installOrtMock();
    globalThis.fetch = makeStreamingFetch(new Uint8Array([1, 2, 3]));

    await loadModel({ duration: '1s' });

    expect(globalThis.fetch).toHaveBeenCalledWith(modelUrlForDuration('1s'));
  });

  it('hands bytes to ort.InferenceSession.create with wasm EP', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const create = installOrtMock();
    globalThis.fetch = makeStreamingFetch(bytes);

    const result = await loadModel();

    expect(create).toHaveBeenCalledTimes(1);
    const [passedBytes, opts] = create.mock.calls[0];
    expect(passedBytes).toBeTruthy();
    expect(opts.executionProviders).toContain('wasm');
    expect(result).toEqual({
      session: { fake: 'session' },
      inputDims: MODEL_INPUT_DIMS,
      duration: '3s',
    });
  });

  it('returns the requested duration in the result', async () => {
    installOrtMock();
    globalThis.fetch = makeStreamingFetch(new Uint8Array(8));

    const result = await loadModel({ duration: '7s' });
    expect(result.duration).toBe('7s');
  });

  it('forces single-threaded WASM (no COEP on Pages)', async () => {
    // We deliberately do NOT set `ort.env.wasm.wasmPaths` here. ORT
    // resolves its sibling `.mjs`/`.wasm` files relative to its own
    // script URL by default, which gives the right path for both
    // the dev server and GitHub Pages. An earlier draft set
    // `wasmPaths = './vendor/'` and that broke in the browser —
    // ORT resolves the override relative to its own script too,
    // so it requested `/vendor/vendor/ort-wasm-simd-threaded.mjs`.
    installOrtMock();
    globalThis.fetch = makeStreamingFetch(new Uint8Array(8));

    await loadModel();
    const ort = /** @type {any} */ (globalThis).ort;
    expect(ort.env.wasm.numThreads).toBe(1);
    expect(ort.env.wasm.wasmPaths).toBeFalsy();
  });

  it('reports progress as fraction + loaded/total when Content-Length is set', async () => {
    installOrtMock();
    const bytes = new Uint8Array(1024);
    globalThis.fetch = makeStreamingFetch(bytes);

    const events = [];
    await loadModel({ onProgress: (p) => events.push(p) });

    expect(events.length).toBeGreaterThanOrEqual(1);
    const final = events[events.length - 1];
    expect(final.fraction).toBe(1);
    expect(final.loaded).toBe(1024);
    expect(final.total).toBe(1024);
  });

  it('still reports a final progress event when Content-Length is missing', async () => {
    installOrtMock();
    const bytes = new Uint8Array(256);
    globalThis.fetch = makeStreamingFetch(bytes, { contentLength: undefined });

    const events = [];
    await loadModel({ onProgress: (p) => events.push(p) });

    const final = events[events.length - 1];
    expect(final.fraction).toBe(1);
    expect(final.loaded).toBe(256);
  });
});

describe('loadModel — structured error classification', () => {
  /** @type {any} */
  let originalOrt;
  /** @type {any} */
  let originalFetch;

  beforeEach(() => {
    originalOrt = /** @type {any} */ (globalThis).ort;
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    /** @type {any} */ (globalThis).ort = originalOrt;
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('classifies an HTTP-404 as MODEL_DOWNLOAD_FAILED', async () => {
    installOrtMock();
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });

    try {
      await loadModel();
      throw new Error('expected loadModel to reject');
    } catch (err) {
      expect(/** @type {any} */ (err).code).toBe('MODEL_DOWNLOAD_FAILED');
      expect(/** @type {any} */ (err).url).toBe(modelUrlForDuration('3s'));
    }
  });

  it('classifies a TypeError from fetch as MODEL_DOWNLOAD_FAILED', async () => {
    installOrtMock();
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    try {
      await loadModel();
      throw new Error('expected loadModel to reject');
    } catch (err) {
      expect(/** @type {any} */ (err).code).toBe('MODEL_DOWNLOAD_FAILED');
    }
  });

  it('classifies an ORT parse/init failure as MODEL_LOAD_FAILED', async () => {
    const parseErr = new Error('Failed to parse ONNX model: unexpected end of file');
    installOrtMock({ sessionCreate: vi.fn().mockRejectedValue(parseErr) });
    globalThis.fetch = makeStreamingFetch(new Uint8Array(16));

    try {
      await loadModel();
      throw new Error('expected loadModel to reject');
    } catch (err) {
      expect(/** @type {any} */ (err).code).toBe('MODEL_LOAD_FAILED');
      expect(/** @type {any} */ (err).cause).toBe(parseErr);
    }
  });

  it('follows the cause chain to find a TypeError', async () => {
    const inner = new TypeError('NetworkError when attempting to fetch resource');
    const wrapper = /** @type {any} */ (new Error('fetch wrapped'));
    wrapper.cause = inner;
    installOrtMock();
    globalThis.fetch = vi.fn().mockRejectedValue(wrapper);

    try {
      await loadModel();
      throw new Error('expected loadModel to reject');
    } catch (err) {
      expect(/** @type {any} */ (err).code).toBe('MODEL_DOWNLOAD_FAILED');
    }
  });
});

// ---------------------------------------------------------------------------
// Cache API caching
// ---------------------------------------------------------------------------
// These tests mock `globalThis.caches` to exercise the Cache API layer in
// `fetchModelBytes`. In the normal jsdom test environment `caches` is
// undefined, so existing tests are unaffected; only this block sets it up.
// ---------------------------------------------------------------------------

describe('Cache API caching', () => {
  /** @type {any} */ let originalCaches;
  /** @type {any} */ let originalOrt;
  /** @type {any} */ let originalFetch;

  beforeEach(() => {
    originalCaches = /** @type {any} */ (globalThis).caches;
    originalOrt = /** @type {any} */ (globalThis).ort;
    originalFetch = globalThis.fetch;
    installOrtMock();
  });

  afterEach(() => {
    /** @type {any} */ (globalThis).caches = originalCaches;
    /** @type {any} */ (globalThis).ort = originalOrt;
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  /**
   * Build a minimal `caches`-like mock and return the inner `cache` object
   * so individual tests can assert on `match`, `put`, and `delete` calls.
   */
  function makeCachesMock({ cachedResponse = /** @type {any} */ (null) } = {}) {
    const mockCache = {
      match: vi.fn().mockResolvedValue(cachedResponse),
      delete: vi.fn().mockResolvedValue(true),
      put: vi.fn().mockResolvedValue(undefined),
    };
    /** @type {any} */ (globalThis).caches = {
      open: vi.fn().mockResolvedValue(mockCache),
    };
    return mockCache;
  }

  /**
   * Build a duck-typed Response-like object as returned by `cache.match()`.
   * `etag` may be null to simulate a cached entry without a validator.
   */
  function makeCachedEntry(bytes, etag) {
    return {
      headers: {
        get: (/** @type {string} */ name) => {
          const n = String(name).toLowerCase();
          if (n === 'etag') return etag ?? null;
          if (n === 'content-type') return 'application/octet-stream';
          if (n === 'content-length') return String(bytes.byteLength);
          return null;
        },
      },
      arrayBuffer: async () => bytes.buffer.slice(0),
    };
  }

  it('serves from cache immediately without blocking on a network round-trip', async () => {
    const bytes = new Uint8Array([10, 20, 30, 40]);
    const etag = '"model-etag-v1"';
    makeCachesMock({ cachedResponse: makeCachedEntry(bytes, etag) });

    // HEAD resolves (background revalidation) but should not block the return
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: (/** @type {string} */ n) => (n === 'ETag' ? etag : null) },
    });

    const progressEvents = /** @type {any[]} */ ([]);
    const result = await loadModel({ onProgress: (p) => progressEvents.push(p) });

    // Model loaded from cache
    expect(result.session).toEqual({ fake: 'session' });
    // Exactly one progress event fired at fraction=1 (instant cache read)
    expect(progressEvents).toHaveLength(1);
    expect(progressEvents[0].fraction).toBe(1);
    // No GET fetch — only the background HEAD
    const getCalls = globalThis.fetch.mock.calls.filter(
      (/** @type {any[]} */ [, opts]) => !opts || opts.method !== 'HEAD',
    );
    expect(getCalls).toHaveLength(0);
  });

  it('evicts stale cache entry in background when server ETag changes', async () => {
    const oldEtag = '"old-etag"';
    const newEtag = '"new-etag"';
    const mockCache = makeCachesMock({
      cachedResponse: makeCachedEntry(new Uint8Array([1, 2, 3]), oldEtag),
    });

    // HEAD returns new ETag — model was updated on the server
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: (/** @type {string} */ n) => (n === 'ETag' ? newEtag : null) },
    });

    await loadModel();
    // Flush the background revalidation promise chain
    await new Promise((r) => setTimeout(r, 0));

    // Stale entry should have been evicted; next load will re-download
    expect(mockCache.delete).toHaveBeenCalledWith(modelUrlForDuration('3s'));
    // We did NOT re-download in this same session
    const getCalls = globalThis.fetch.mock.calls.filter(
      (/** @type {any[]} */ [, opts]) => !opts || opts.method !== 'HEAD',
    );
    expect(getCalls).toHaveLength(0);
  });

  it('keeps cache entry when server ETag matches (no eviction)', async () => {
    const etag = '"stable-etag"';
    const mockCache = makeCachesMock({
      cachedResponse: makeCachedEntry(new Uint8Array([5, 6, 7]), etag),
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: (/** @type {string} */ n) => (n === 'ETag' ? etag : null) },
    });

    await loadModel();
    await new Promise((r) => setTimeout(r, 0));

    expect(mockCache.delete).not.toHaveBeenCalled();
  });

  it('uses stale cache entry when offline (HEAD rejects)', async () => {
    const etag = '"offline-etag"';
    makeCachesMock({ cachedResponse: makeCachedEntry(new Uint8Array([9, 8, 7]), etag) });

    // All fetch calls fail (offline)
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Network failure'));

    const result = await loadModel();
    await new Promise((r) => setTimeout(r, 0));

    // Model still loaded from the stale cache entry
    expect(result.session).toEqual({ fake: 'session' });
  });

  it('downloads and caches the model on a cache miss', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const etag = '"fresh-etag"';
    const mockCache = makeCachesMock({ cachedResponse: null });

    globalThis.fetch = makeStreamingFetch(bytes, { etag });

    await loadModel();

    // Bytes should have been written to the cache
    expect(mockCache.put).toHaveBeenCalledTimes(1);
    const [cachedUrl] = mockCache.put.mock.calls[0];
    expect(cachedUrl).toBe(modelUrlForDuration('3s'));
  });

  it('does not cache when the server response has no ETag', async () => {
    // No ETag — we refuse to cache to avoid a permanently stale entry
    const mockCache = makeCachesMock({ cachedResponse: null });
    globalThis.fetch = makeStreamingFetch(new Uint8Array([1, 2, 3]), { etag: null });

    await loadModel();

    expect(mockCache.put).not.toHaveBeenCalled();
  });

  it('falls back to normal network fetch when Cache API is unavailable', async () => {
    // Simulate an environment where caches is undefined (e.g. non-secure context)
    /** @type {any} */ (globalThis).caches = undefined;
    globalThis.fetch = makeStreamingFetch(new Uint8Array([1, 2, 3]), { etag: '"x"' });

    const result = await loadModel();
    expect(result.session).toEqual({ fake: 'session' });
  });
});
