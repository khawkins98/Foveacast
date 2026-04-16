// Loader tests. We stub `globalThis.tf.loadGraphModel` so we can assert
// on URL routing and the progress-callback contract without depending on
// a real TensorFlow.js runtime.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadModel, MODEL_URLS } from '../docs/src/model/loader.js';
import { PRESETS } from '../docs/src/pipeline/preprocess.js';

describe('MODEL_URLS', () => {
  it('has an entry for every preset, pointing at the GCS bucket', () => {
    for (const preset of Object.keys(PRESETS)) {
      expect(MODEL_URLS[preset]).toBe(
        `https://storage.googleapis.com/msi-net/model/${preset}/model.json`
      );
    }
  });
});

describe('loadModel', () => {
  /** @type {any} */
  let originalTf;

  beforeEach(() => {
    originalTf = /** @type {any} */ (globalThis).tf;
  });

  afterEach(() => {
    /** @type {any} */ (globalThis).tf = originalTf;
  });

  it('throws when tf is missing from globalThis', async () => {
    /** @type {any} */ (globalThis).tf = undefined;
    await expect(loadModel('medium')).rejects.toThrow(/TensorFlow\.js is not available/);
  });

  it('throws on unknown preset', async () => {
    /** @type {any} */ (globalThis).tf = {
      loadGraphModel: vi.fn().mockResolvedValue({ fake: true }),
    };
    await expect(loadModel('ultra')).rejects.toThrow(/Unknown preset: ultra/);
  });

  it('uses the correct URL for each of the five presets', async () => {
    const stub = vi.fn().mockResolvedValue({ fake: 'model' });
    /** @type {any} */ (globalThis).tf = { loadGraphModel: stub };

    for (const preset of /** @type {(keyof typeof PRESETS)[]} */ (Object.keys(PRESETS))) {
      stub.mockClear();
      const result = await loadModel(preset);
      expect(stub).toHaveBeenCalledTimes(1);
      expect(stub.mock.calls[0][0]).toBe(MODEL_URLS[preset]);
      expect(result.preset).toBe(preset);
      expect(result.inputDims).toEqual(PRESETS[preset]);
      expect(result.model).toEqual({ fake: 'model' });
    }
  });

  it('invokes the caller onProgress with a richer shape when tf fires its native callback', async () => {
    const stub = vi.fn().mockImplementation(async (_url, opts) => {
      // Simulate tf.js firing its fraction-only onProgress twice.
      opts.onProgress(0.25);
      opts.onProgress(1.0);
      return { fake: 'model' };
    });
    /** @type {any} */ (globalThis).tf = { loadGraphModel: stub };

    const events = [];
    await loadModel('high', (p) => events.push(p));

    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0]).toEqual({ fraction: 0.25, loaded: undefined, total: undefined });
    expect(events[events.length - 1].fraction).toBe(1.0);
  });

  it('does not pass an onProgress option when the caller omits the callback', async () => {
    const stub = vi.fn().mockResolvedValue({ fake: 'model' });
    /** @type {any} */ (globalThis).tf = { loadGraphModel: stub };

    await loadModel('low');
    // tf.loadGraphModel was called either with no second arg or with
    // undefined. Either way, there is no onProgress wrapping.
    const secondArg = stub.mock.calls[0][1];
    expect(secondArg === undefined || secondArg.onProgress === undefined).toBe(true);
  });
});

describe('loadModel — structured error classification', () => {
  /** @type {any} */
  let originalTf;

  beforeEach(() => {
    originalTf = /** @type {any} */ (globalThis).tf;
  });

  afterEach(() => {
    /** @type {any} */ (globalThis).tf = originalTf;
  });

  it('classifies a TypeError from fetch as MODEL_DOWNLOAD_FAILED', async () => {
    const netErr = new TypeError('Failed to fetch');
    /** @type {any} */ (globalThis).tf = {
      loadGraphModel: vi.fn().mockRejectedValue(netErr),
    };

    try {
      await loadModel('medium');
      throw new Error('expected loadModel to reject');
    } catch (err) {
      expect(/** @type {any} */ (err).code).toBe('MODEL_DOWNLOAD_FAILED');
      expect(/** @type {any} */ (err).cause).toBe(netErr);
      expect(/** @type {any} */ (err).url).toContain('medium/model.json');
    }
  });

  it('classifies an HTTP-status failure as MODEL_DOWNLOAD_FAILED', async () => {
    // tf.js wraps non-2xx responses this way.
    const httpErr = new Error('Request failed with status 404');
    /** @type {any} */ (globalThis).tf = {
      loadGraphModel: vi.fn().mockRejectedValue(httpErr),
    };

    try {
      await loadModel('low');
      throw new Error('expected loadModel to reject');
    } catch (err) {
      expect(/** @type {any} */ (err).code).toBe('MODEL_DOWNLOAD_FAILED');
    }
  });

  it('classifies a JSON parse error as MODEL_LOAD_FAILED', async () => {
    // Downloaded bytes were garbled — this is the post-download path.
    const parseErr = new SyntaxError('Unexpected token < in JSON at position 0');
    /** @type {any} */ (globalThis).tf = {
      loadGraphModel: vi.fn().mockRejectedValue(parseErr),
    };

    try {
      await loadModel('high');
      throw new Error('expected loadModel to reject');
    } catch (err) {
      expect(/** @type {any} */ (err).code).toBe('MODEL_LOAD_FAILED');
    }
  });

  it('follows the cause chain to find a TypeError', async () => {
    // Some environments wrap the underlying TypeError in a plain
    // Error. The classifier should still recognise the inner network
    // failure via `cause`.
    const inner = new TypeError('NetworkError when attempting to fetch resource');
    const wrapper = /** @type {any} */ (new Error('loadGraphModel failed'));
    wrapper.cause = inner;

    /** @type {any} */ (globalThis).tf = {
      loadGraphModel: vi.fn().mockRejectedValue(wrapper),
    };

    try {
      await loadModel('very_low');
      throw new Error('expected loadModel to reject');
    } catch (err) {
      expect(/** @type {any} */ (err).code).toBe('MODEL_DOWNLOAD_FAILED');
    }
  });

  it('falls back to MODEL_LOAD_FAILED for unclassified errors', async () => {
    const weird = new Error('mysterious library internal');
    /** @type {any} */ (globalThis).tf = {
      loadGraphModel: vi.fn().mockRejectedValue(weird),
    };

    try {
      await loadModel('medium');
      throw new Error('expected loadModel to reject');
    } catch (err) {
      expect(/** @type {any} */ (err).code).toBe('MODEL_LOAD_FAILED');
      expect(/** @type {any} */ (err).cause).toBe(weird);
    }
  });
});
