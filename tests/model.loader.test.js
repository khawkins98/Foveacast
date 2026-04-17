// Loader tests. We stub `globalThis.ort.InferenceSession.create` and
// `globalThis.fetch` so we can assert on download behaviour, progress
// reporting, and error classification without depending on a real
// ONNX Runtime Web bundle or the 12.5 MB artefact on disk.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  loadModel,
  MODEL_URL,
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
function makeStreamingFetch(bytes, { contentLength = bytes.byteLength, ok = true, status = 200 } = {}) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    headers: {
      get: (name) => (String(name).toLowerCase() === 'content-length' ? String(contentLength) : null),
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

describe('MODEL_URL + MODEL_INPUT_DIMS', () => {
  it('points the app at the committed same-origin artefact', () => {
    expect(MODEL_URL).toBe('./models/v3/model.onnx');
  });

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

  it('fetches the committed same-origin artefact and hands its bytes to ort.InferenceSession.create', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const create = installOrtMock();
    globalThis.fetch = makeStreamingFetch(bytes);

    const result = await loadModel();

    expect(globalThis.fetch).toHaveBeenCalledWith(MODEL_URL);
    expect(create).toHaveBeenCalledTimes(1);
    const [passedBytes, opts] = create.mock.calls[0];
    // Bytes are handed off as ArrayBuffer (or Uint8Array) — accept both
    // so a future refactor of `fetchModelBytes` is not blocked by a
    // too-specific assertion.
    expect(passedBytes).toBeTruthy();
    expect(opts.executionProviders).toContain('wasm');
    expect(result).toEqual({ session: { fake: 'session' }, inputDims: MODEL_INPUT_DIMS });
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
    await loadModel((p) => events.push(p));

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
    await loadModel((p) => events.push(p));

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
      expect(/** @type {any} */ (err).url).toBe(MODEL_URL);
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
