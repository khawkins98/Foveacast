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
