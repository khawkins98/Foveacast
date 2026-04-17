// Model-backed inference entry point.
//
// This is the only function the UI layer calls for "run the model on
// this image". The UI never imports `onnxruntime-web` directly — that
// isolation is what lets the model swap without touching `render/` or
// `ui/` code.
//
// V3 uses MSI-Net fine-tuned on UEyes (from foveacast-training). The
// ONNX graph outputs a saliency map already normalised to [0, 1] —
// no log-probability conversion needed (unlike V2's UNISAL).

import { imageSourceToInputData } from '../pipeline/preprocess.js';

/**
 * @typedef {Object} InferenceContext
 * @property {any} session - `ort.InferenceSession` instance from `loadModel`.
 * @property {[number, number]} inputDims - `[H, W]` for the model graph.
 */

/**
 * @typedef {Object} InferenceResult
 * @property {Float32Array} saliency - Raw model output, length `H * W`.
 *   V3 MSI-Net returns values in [0, 1] (min-max normalised inside
 *   the ONNX graph). No log-probability conversion needed.
 * @property {[number, number]} inputDims - Model input `[H, W]`.
 * @property {[number, number]} sourceDims - Source `[origH, origW]` for
 *   downstream upsampling back to the user's screenshot size.
 */

/**
 * Run saliency inference on a `CanvasImageSource` or `ImageData`.
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

  // V3 MSI-Net ONNX graph expects `[1, 3, H, W]` — batch, channel,
  // height, width (NCHW). The preprocess layer produces the tensor
  // already in NCHW order; ORT's Tensor constructor takes a flat
  // Float32Array and a shape array.
  const input = new ort.Tensor('float32', data, [1, 3, h, w]);

  // session.run is async. The output map is keyed by the output names
  // baked into the ONNX graph at export time — foveacast-training's
  // export_onnx.py uses "input" and "output" as the tensor names.
  const outputs = await session.run({ input });
  const outputTensor = outputs.output ?? outputs[Object.keys(outputs)[0]];
  if (!outputTensor || !outputTensor.data) {
    throw new Error(
      'ORT inference returned no output tensor. Expected an "output" tensor on the V3 MSI-Net graph.',
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
