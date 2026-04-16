// Model-backed inference entry point.
//
// This is the only function the UI layer calls for "run the model on
// this image". The UI never imports `@tensorflow/tfjs` directly — that
// isolation means swapping the MSI-Net/TF.js backend for UNISAL/ONNX in
// V2 won't touch any `render/` or `ui/` code.
//
// Note: there is no unit test for this module in Phase B; a mocked
// tensor pipeline would exercise code that is mostly tf-plumbing and
// offer little signal. Real coverage comes from the Phase E headless-
// browser E2E smoke test, which drives the full pipeline on a committed
// example screenshot and asserts the heatmap canvas is non-empty.

import { imageSourceToInputData } from '../pipeline/preprocess.js';

/**
 * @typedef {Object} InferenceContext
 * @property {any} model - `tf.GraphModel` instance from `loadModel`.
 * @property {[number, number]} inputDims - `[H, W]` for the preset.
 */

/**
 * @typedef {Object} InferenceResult
 * @property {Float32Array} saliency - Raw model output, length `H * W`.
 * @property {[number, number]} inputDims - Model input `[H, W]`.
 * @property {[number, number]} sourceDims - Source `[origH, origW]` for
 *   downstream upsampling back to the user's screenshot size.
 */

/**
 * Run MSI-Net inference on a `CanvasImageSource` or `ImageData`.
 *
 * @param {CanvasImageSource | ImageData} source
 * @param {InferenceContext} context
 * @returns {Promise<InferenceResult>}
 */
export async function runInference(source, context) {
  const tf = /** @type {any} */ (globalThis).tf;
  if (!tf) {
    throw new Error(
      'TensorFlow.js is not available on globalThis. Ensure `@tensorflow/tfjs` is loaded before calling runInference().'
    );
  }

  const { model, inputDims } = context;
  const [h, w] = inputDims;

  // Build the input tensor via the pure preprocessing path. We keep canvas
  // work inside `imageSourceToInputData` so this function stays focused
  // on tf.js ceremony.
  const { data, sourceWidth, sourceHeight } = imageSourceToInputData(
    /** @type {any} */ (source),
    inputDims
  );

  // Wrap in a tensor with explicit shape [1, H, W, 3] — MSI-Net's graph
  // model expects a batch dimension even for single-image inference.
  const input = tf.tensor(data, [1, h, w, 3], 'float32');

  // `model.predict` is synchronous in tf.js; `.data()` is async (pulls
  // the result off the GPU when WebGL/WebGPU backends are active).
  const output = /** @type {any} */ (model.predict(input));
  const flat = await output.data(); // Float32Array

  // Critical: dispose both tensors to free WebGL textures. Skipping this
  // leaks VRAM and kills the page after a few inferences.
  input.dispose();
  output.dispose();

  return {
    // `.data()` returns a Float32Array already, but we take a copy to
    // detach from tf.js's internal buffers (some backends reuse storage).
    saliency: new Float32Array(flat),
    inputDims: [h, w],
    sourceDims: [sourceHeight, sourceWidth],
  };
}
