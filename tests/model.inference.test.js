// Unit tests for the `runInference` contract on the V2 ORT Web stack.
//
// Three things matter enough to pin:
//
//   1. Input tensor shape `[1, 3, H, W]` (NCHW, float32).
//   2. `session.run` is awaited with an `image` key; the output is
//      extracted from the returned map.
//   3. `new Float32Array(outTensor.data)` copies out of ORT's internal
//      buffer — some EPs reuse storage, and returning the raw reference
//      would be a silent cross-inference corruption bug.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the preprocess helper so these tests don't depend on a real
// 2D canvas context (jsdom doesn't provide one). The mock returns a
// Float32Array sized for the requested dims plus canned source
// dimensions so we can assert the sourceDims pass-through behaviour.
let mockSourceWidth = 400;
let mockSourceHeight = 300;
vi.mock('../docs/src/pipeline/preprocess.js', () => ({
  imageSourceToInputData: vi.fn((_source, inputDims) => {
    const [h, w] = inputDims;
    return {
      data: new Float32Array(3 * h * w),
      sourceWidth: mockSourceWidth,
      sourceHeight: mockSourceHeight,
    };
  }),
}));

const { runInference } = await import('../docs/src/model/inference.js');

/**
 * Build a minimal ort-alike that records Tensor construction and
 * returns a configurable output for `session.run`.
 */
function makeOrtStub(outputFlat) {
  const tensorCtor = vi.fn(function (dtype, data, shape) {
    this.dtype = dtype;
    this.data = data;
    this.dims = shape;
  });
  const run = vi.fn(async () => ({
    output: { data: outputFlat, dims: [1, mockSourceHeight, mockSourceWidth] },
  }));
  const session = { run };
  const ort = {
    Tensor: tensorCtor,
  };
  return { ort, session, tensorCtor, run };
}

function makeFakeSource() {
  return /** @type {any} */ ({});
}

describe('runInference', () => {
  /** @type {any} */
  let originalOrt;

  beforeEach(() => {
    originalOrt = /** @type {any} */ (globalThis).ort;
  });

  afterEach(() => {
    /** @type {any} */ (globalThis).ort = originalOrt;
  });

  it('throws a friendly error when ort is missing from globalThis', async () => {
    /** @type {any} */ (globalThis).ort = undefined;
    await expect(
      runInference(makeFakeSource(), {
        session: /** @type {any} */ ({ run: async () => ({}) }),
        inputDims: [8, 8],
      }),
    ).rejects.toThrow(/ONNX Runtime Web is not available/);
  });

  it('builds the input tensor with shape [1, 3, H, W] and dtype float32', async () => {
    const [h, w] = [288, 384];
    const stub = makeOrtStub(new Float32Array(h * w));
    /** @type {any} */ (globalThis).ort = stub.ort;

    await runInference(makeFakeSource(), {
      session: stub.session,
      inputDims: [h, w],
    });

    expect(stub.tensorCtor).toHaveBeenCalledTimes(1);
    const [dtype, data, shape] = stub.tensorCtor.mock.calls[0];
    expect(dtype).toBe('float32');
    expect(shape).toEqual([1, 3, h, w]);
    expect(data).toBeInstanceOf(Float32Array);
    expect(data.length).toBe(3 * h * w);
  });

  it('runs session.run exactly once with an `input` tensor key', async () => {
    const [h, w] = [240, 320];
    const stub = makeOrtStub(new Float32Array(h * w));
    /** @type {any} */ (globalThis).ort = stub.ort;

    await runInference(makeFakeSource(), {
      session: stub.session,
      inputDims: [h, w],
    });

    expect(stub.run).toHaveBeenCalledTimes(1);
    const feeds = stub.run.mock.calls[0][0];
    expect(feeds).toHaveProperty('input');
    expect(feeds.input).toBeInstanceOf(stub.ort.Tensor);
  });

  it('returns a Float32Array copy detached from ORT internal storage', async () => {
    // Some ORT EPs reuse the buffer returned by a tensor across runs.
    // Returning the raw reference would cause the postprocess pipeline
    // to see a later inference's data under the wrong dims. The
    // contract is: the returned `saliency` array is a fresh allocation.
    const internalBuffer = new Float32Array([1, 2, 3, 4]);
    const stub = makeOrtStub(internalBuffer);
    /** @type {any} */ (globalThis).ort = stub.ort;

    const { saliency } = await runInference(makeFakeSource(), {
      session: stub.session,
      inputDims: [2, 2],
    });

    expect(saliency).toBeInstanceOf(Float32Array);
    expect(saliency).not.toBe(internalBuffer);
    expect(Array.from(saliency)).toEqual([1, 2, 3, 4]);

    saliency[0] = 999;
    expect(internalBuffer[0]).toBe(1);
  });

  it('returns inputDims and sourceDims (height, width) for downstream postprocessing', async () => {
    const stub = makeOrtStub(new Float32Array(288 * 384));
    /** @type {any} */ (globalThis).ort = stub.ort;

    const { inputDims, sourceDims } = await runInference(makeFakeSource(), {
      session: stub.session,
      inputDims: [288, 384],
    });

    expect(inputDims).toEqual([288, 384]);
    // sourceDims is [height, width] — postprocess expects that order.
    expect(sourceDims).toEqual([300, 400]);
  });

  it('falls back to the first output key when the graph does not name "output"', async () => {
    const buf = new Float32Array(4);
    const ort = {
      Tensor: function (dtype, data, dims) {
        this.dtype = dtype;
        this.data = data;
        this.dims = dims;
      },
    };
    const run = vi.fn(async () => ({ output_0: { data: buf, dims: [1, 2, 2] } }));
    /** @type {any} */ (globalThis).ort = ort;

    const { saliency } = await runInference(makeFakeSource(), {
      session: { run },
      inputDims: [2, 2],
    });

    expect(saliency).toBeInstanceOf(Float32Array);
    expect(saliency.length).toBe(4);
  });
});
