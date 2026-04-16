// Model-backed inference entry point.
//
// This is the only function the UI layer calls for "run the model on
// this image". The UI never imports `onnxruntime-web` directly — that
// isolation is what let V2 swap the backend from MSI-Net through
// TensorFlow.js to UNISAL through ORT Web without touching any `render/`
// or `ui/` code.
//
// The full `runInference` contract stays identical to the V1 version:
// take an image-like input and a `{ session, inputDims }` context,
// return `{ saliency, inputDims, sourceDims }`. The *content* of the
// saliency array has changed — UNISAL emits log-probabilities rather
// than MSI-Net's 0–255 intensity map — but that is a postprocessing
// concern, not this layer's.

import { imageSourceToInputData } from '../pipeline/preprocess.js';

/**
 * @typedef {Object} InferenceContext
 * @property {any} session - `ort.InferenceSession` instance from `loadModel`.
 * @property {[number, number]} inputDims - `[H, W]` for UNISAL's graph.
 */

/**
 * @typedef {Object} InferenceResult
 * @property {Float32Array} saliency - Raw model output, length `H * W`.
 *   UNISAL returns log-probabilities; the postprocess layer applies
 *   `exp()` before the visual normalisation path.
 * @property {[number, number]} inputDims - Model input `[H, W]`.
 * @property {[number, number]} sourceDims - Source `[origH, origW]` for
 *   downstream upsampling back to the user's screenshot size.
 */

/**
 * Run UNISAL inference on a `CanvasImageSource` or `ImageData`.
 *
 * @param {CanvasImageSource | ImageData} source
 * @param {InferenceContext} context
 * @returns {Promise<InferenceResult>}
 */
export async function runInference(source, context) {
  const ort = /** @type {any} */ (globalThis).ort;
  if (!ort || !ort.Tensor) {
    throw new Error(
      'ONNX Runtime Web is not available on globalThis. Ensure `onnxruntime-web` is loaded before calling runInference().',
    );
  }

  const { session, inputDims } = context;
  const [h, w] = inputDims;

  // Build the input tensor via the pure preprocessing path. We keep
  // canvas work inside `imageSourceToInputData` so this function stays
  // focused on ORT ceremony.
  const { data, sourceWidth, sourceHeight } = imageSourceToInputData(
    /** @type {any} */ (source),
    inputDims,
  );

  // UNISAL's ONNX graph expects `[1, 3, H, W]` — batch, channel,
  // height, width (NCHW). The preprocess layer produces the tensor
  // already in NCHW order; ORT's Tensor constructor takes a flat
  // Float32Array and a shape array.
  const input = new ort.Tensor('float32', data, [1, 3, h, w]);

  // session.run is async. The output map is keyed by the output names
  // baked into the ONNX graph at export time — scripts/unisal-onnx-export.py
  // uses "saliency" as the output name.
  const outputs = await session.run({ image: input });
  const outputTensor = outputs.saliency ?? outputs[Object.keys(outputs)[0]];
  if (!outputTensor || !outputTensor.data) {
    throw new Error(
      'ORT inference returned no output tensor. Expected an "saliency" output on the UNISAL graph.',
    );
  }

  // Copy into a fresh Float32Array. ORT reuses output buffers between
  // runs under some backends; copying detaches us from that lifecycle.
  const flat = /** @type {Float32Array} */ (outputTensor.data);

  return {
    saliency: new Float32Array(flat),
    inputDims: [h, w],
    sourceDims: [sourceHeight, sourceWidth],
  };
}
