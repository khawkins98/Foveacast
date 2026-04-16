// Unit tests for the `runInference` contract.
//
// Why this file exists now: the PRD names `runInference` as the V2
// ONNX swap contract, and until this commit the file had no tests.
// The maintainer review flagged it as a High-severity gap — the
// three things that would silently break on a refactor are:
//   1. Input tensor shape `[1, H, W, 3]` (batch + HWC).
//   2. Tensor disposal — forgetting to `.dispose()` leaks VRAM and
//      kills the page after a few inferences.
//   3. `new Float32Array(flat)` copies out of tf.js's internal
//      buffer — some backends reuse storage, and returning the raw
//      `.data()` result would be a silent cross-inference corruption
//      bug.
//
// The tests stub `globalThis.tf` so they never touch a real TF.js
// runtime, and stub `imageSourceToInputData` via a jsdom-compatible
// canvas source.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the preprocess helper so these tests don't depend on a real
// 2D canvas context (jsdom doesn't provide one). The mock returns
// a Float32Array sized for the requested dims plus canned source
// dimensions so we can assert the sourceDims pass-through behaviour.
let mockSourceWidth = 400;
let mockSourceHeight = 300;
vi.mock('../docs/src/pipeline/preprocess.js', () => ({
  imageSourceToInputData: vi.fn((_source, inputDims) => {
    const [h, w] = inputDims;
    return {
      data: new Float32Array(h * w * 3),
      sourceWidth: mockSourceWidth,
      sourceHeight: mockSourceHeight,
    };
  }),
}));

const { runInference } = await import('../docs/src/model/inference.js');

/**
 * Build a minimal tf-alike that records the shape passed to
 * `tf.tensor`, captures `.dispose()` calls on the tensors it
 * produces, and returns a configurable `.predict()` output.
 */
function makeTfStub(predictedFlat) {
  const input = { shape: null, disposed: false, dispose: vi.fn(function () { this.disposed = true; }) };
  const output = {
    disposed: false,
    dispose: vi.fn(function () { this.disposed = true; }),
    data: vi.fn().mockResolvedValue(predictedFlat),
  };
  const model = {
    predict: vi.fn(() => output),
  };
  const tf = {
    tensor: vi.fn((data, shape, dtype) => {
      input.shape = shape;
      input.dtype = dtype;
      input.data = data;
      return input;
    }),
  };
  return { tf, model, input, output };
}

/**
 * Any opaque source is fine for these tests because the real
 * `imageSourceToInputData` is mocked above. We still set
 * `mockSourceWidth`/`mockSourceHeight` before each call so the
 * sourceDims pass-through test can vary per case.
 */
function makeFakeSource() {
  return /** @type {any} */ ({});
}

describe('runInference', () => {
  /** @type {any} */
  let originalTf;

  beforeEach(() => {
    originalTf = /** @type {any} */ (globalThis).tf;
  });

  afterEach(() => {
    /** @type {any} */ (globalThis).tf = originalTf;
  });

  it('throws a friendly error when tf is missing from globalThis', async () => {
    /** @type {any} */ (globalThis).tf = undefined;
    await expect(
      runInference(makeFakeSource(), {
        model: /** @type {any} */ ({ predict: () => null }),
        inputDims: [8, 8],
      }),
    ).rejects.toThrow(/TensorFlow\.js is not available/);
  });

  it('builds the input tensor with shape [1, H, W, 3] and dtype float32', async () => {
    const [h, w] = [48, 64];
    const stub = makeTfStub(new Float32Array(h * w));
    /** @type {any} */ (globalThis).tf = stub.tf;

    await runInference(makeFakeSource(), {
      model: stub.model,
      inputDims: [h, w],
    });

    expect(stub.tf.tensor).toHaveBeenCalledTimes(1);
    const [, shape, dtype] = stub.tf.tensor.mock.calls[0];
    expect(shape).toEqual([1, h, w, 3]);
    expect(dtype).toBe('float32');
  });

  it('passes the preprocessed data array to tf.tensor with length H * W * 3', async () => {
    const [h, w] = [32, 24];
    const stub = makeTfStub(new Float32Array(h * w));
    /** @type {any} */ (globalThis).tf = stub.tf;

    await runInference(makeFakeSource(), {
      model: stub.model,
      inputDims: [h, w],
    });

    const [data] = stub.tf.tensor.mock.calls[0];
    expect(data).toBeInstanceOf(Float32Array);
    expect(data.length).toBe(h * w * 3);
  });

  it('disposes both the input and output tensors (no VRAM leak)', async () => {
    const stub = makeTfStub(new Float32Array(48 * 64));
    /** @type {any} */ (globalThis).tf = stub.tf;

    await runInference(makeFakeSource(), {
      model: stub.model,
      inputDims: [48, 64],
    });

    expect(stub.input.dispose).toHaveBeenCalledTimes(1);
    expect(stub.output.dispose).toHaveBeenCalledTimes(1);
    expect(stub.input.disposed).toBe(true);
    expect(stub.output.disposed).toBe(true);
  });

  it('returns a Float32Array copy detached from tf.js internal storage', async () => {
    // Some tf.js backends reuse the buffer returned by .data() across
    // inferences. Returning the raw reference would cause the
    // postprocess pipeline to see a later inference's data under the
    // wrong dims. The contract is: the returned `saliency` array is a
    // fresh allocation.
    const internalBuffer = new Float32Array([1, 2, 3, 4]);
    const stub = makeTfStub(internalBuffer);
    /** @type {any} */ (globalThis).tf = stub.tf;

    const { saliency } = await runInference(makeFakeSource(), {
      model: stub.model,
      inputDims: [2, 2],
    });

    expect(saliency).toBeInstanceOf(Float32Array);
    expect(saliency).not.toBe(internalBuffer);
    expect(Array.from(saliency)).toEqual([1, 2, 3, 4]);

    // Mutating the returned array must not touch the internal buffer.
    saliency[0] = 999;
    expect(internalBuffer[0]).toBe(1);
  });

  it('returns inputDims and sourceDims (height, width) for downstream postprocessing', async () => {
    const stub = makeTfStub(new Float32Array(120 * 160));
    /** @type {any} */ (globalThis).tf = stub.tf;

    const { inputDims, sourceDims } = await runInference(makeFakeSource(), {
      model: stub.model,
      inputDims: [120, 160],
    });

    expect(inputDims).toEqual([120, 160]);
    // sourceDims is [height, width] — postprocess expects that order.
    expect(sourceDims).toEqual([300, 400]);
  });

  it('calls model.predict exactly once with the input tensor', async () => {
    const stub = makeTfStub(new Float32Array(48 * 64));
    /** @type {any} */ (globalThis).tf = stub.tf;

    await runInference(makeFakeSource(), {
      model: stub.model,
      inputDims: [48, 64],
    });

    expect(stub.model.predict).toHaveBeenCalledTimes(1);
    expect(stub.model.predict.mock.calls[0][0]).toBe(stub.input);
  });
});
