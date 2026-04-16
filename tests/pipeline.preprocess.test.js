// Unit tests for pipeline/preprocess.js. These run under jsdom (see
// vitest.config.js) so `document.createElement('canvas')` exists, but
// jsdom's canvas is a no-op — we exercise `toInputTensorData` purely
// on synthetic `ImageData` objects to avoid depending on canvas
// rendering.

import { describe, it, expect } from 'vitest';
import {
  UNISAL_INPUT_DIMS,
  toInputTensorData,
  downsampleIfLarge,
} from '../docs/src/pipeline/preprocess.js';

/**
 * Build a synthetic ImageData-like object. `toInputTensorData` only
 * needs `.width`, `.height`, and `.data` (a Uint8ClampedArray of RGBA
 * bytes), which matches the real `ImageData` shape.
 */
function makeImageData(width, height, fill = [0, 0, 0, 255]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = fill[0];
    data[i * 4 + 1] = fill[1];
    data[i * 4 + 2] = fill[2];
    data[i * 4 + 3] = fill[3];
  }
  return { data, width, height };
}

// ImageNet constants — duplicated here so the tests do not depend on
// internal module state. If the numbers in preprocess.js ever change,
// the same change has to land in both places, which is the intended
// friction.
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

/** Expected normalised value for channel c given 0–255 input. */
function norm(c, byte) {
  return (byte / 255 - MEAN[c]) / STD[c];
}

describe('UNISAL_INPUT_DIMS', () => {
  it('is the SALICON-native [288, 384] shape UNISAL was exported for', () => {
    expect(Array.from(UNISAL_INPUT_DIMS)).toEqual([288, 384]);
  });
});

describe('toInputTensorData', () => {
  it('returns a Float32Array of length 3 * H * W in NCHW layout', () => {
    const img = makeImageData(64, 48, [128, 64, 32, 255]);
    const dims = /** @type {[number, number]} */ ([24, 32]);
    const [h, w] = dims;
    const out = toInputTensorData(img, dims);
    expect(out).toBeInstanceOf(Float32Array);
    expect(out.length).toBe(3 * h * w);
  });

  it('emits RGB channel-plane-major (NOT NHWC and NOT BGR)', () => {
    // Pure red: R=255, G=0, B=0. In NCHW the red plane is [0..H*W),
    // green is [H*W..2*H*W), blue is [2*H*W..3*H*W). ImageNet-normalised
    // values are what the ONNX graph actually receives.
    const img = makeImageData(1, 1, [255, 0, 0, 255]);
    const out = toInputTensorData(img, [1, 1]);
    expect(out[0]).toBeCloseTo(norm(0, 255), 5); // R plane
    expect(out[1]).toBeCloseTo(norm(1, 0), 5); // G plane
    expect(out[2]).toBeCloseTo(norm(2, 0), 5); // B plane
  });

  it('emits RGB for pure blue too (sanity)', () => {
    // Pure blue: R=0, G=0, B=255. Red plane should be near -2.12
    // (the normalised zero), green similar, blue around +2.64.
    const img = makeImageData(1, 1, [0, 0, 255, 255]);
    const out = toInputTensorData(img, [1, 1]);
    expect(out[0]).toBeCloseTo(norm(0, 0), 5);
    expect(out[1]).toBeCloseTo(norm(1, 0), 5);
    expect(out[2]).toBeCloseTo(norm(2, 255), 5);
  });

  it('normalises pixel bytes to ImageNet mean/std', () => {
    // 128-grey is right in the middle — each channel normalises
    // independently because the ImageNet means/stds differ slightly.
    const img = makeImageData(1, 1, [128, 128, 128, 255]);
    const out = toInputTensorData(img, [1, 1]);
    expect(out[0]).toBeCloseTo(norm(0, 128), 5);
    expect(out[1]).toBeCloseTo(norm(1, 128), 5);
    expect(out[2]).toBeCloseTo(norm(2, 128), 5);
  });

  it('handles non-square input resized into a target shape', () => {
    const img = makeImageData(16, 9, [100, 150, 200, 255]);
    const dims = /** @type {[number, number]} */ ([24, 32]);
    const [h, w] = dims;
    const out = toInputTensorData(img, dims);
    expect(out.length).toBe(3 * h * w);
    const plane = h * w;
    const cx = 16;
    const cy = 12;
    const off = cy * w + cx;
    // Centre pixel is deep inside the constant fill, so bilinear
    // interpolation should reproduce the source colour closely.
    expect(out[off]).toBeCloseTo(norm(0, 100), 1);
    expect(out[plane + off]).toBeCloseTo(norm(1, 150), 1);
    expect(out[2 * plane + off]).toBeCloseTo(norm(2, 200), 1);
  });

  it('preserves constant colour fields through resize', () => {
    const img = makeImageData(32, 32, [50, 60, 70, 255]);
    const dims = /** @type {[number, number]} */ ([24, 32]);
    const [h, w] = dims;
    const out = toInputTensorData(img, dims);
    const plane = h * w;
    // Inner pixels have all four bilinear neighbours inside the
    // constant fill, so they should be exactly the normalised values.
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const off = y * w + x;
        expect(out[off]).toBeCloseTo(norm(0, 50), 5);
        expect(out[plane + off]).toBeCloseTo(norm(1, 60), 5);
        expect(out[2 * plane + off]).toBeCloseTo(norm(2, 70), 5);
      }
    }
  });

  it('fast-paths a 1×1 degenerate source', () => {
    const img = makeImageData(1, 1, [200, 100, 50, 255]);
    const dims = /** @type {[number, number]} */ ([4, 4]);
    const [h, w] = dims;
    const out = toInputTensorData(img, dims);
    const plane = h * w;
    const expR = norm(0, 200);
    const expG = norm(1, 100);
    const expB = norm(2, 50);
    for (let i = 0; i < plane; i++) {
      expect(out[i]).toBeCloseTo(expR, 5);
      expect(out[plane + i]).toBeCloseTo(expG, 5);
      expect(out[2 * plane + i]).toBeCloseTo(expB, 5);
    }
  });
});

describe('downsampleIfLarge', () => {
  // jsdom doesn't implement canvas drawing, but it does give us an
  // HTMLCanvasElement with settable width/height. We can construct a
  // "source-like" canvas with explicit natural dims and verify the
  // returned canvas has the right dimensions.

  it('scales a 3000x1500 canvas to 2560x1280', () => {
    const src = document.createElement('canvas');
    src.width = 3000;
    src.height = 1500;
    const out = downsampleIfLarge(src, 2560);
    expect(out).toBeInstanceOf(HTMLCanvasElement);
    expect(out.width).toBe(2560);
    expect(out.height).toBe(1280);
  });

  it('passes through a source already within the limit', () => {
    const src = document.createElement('canvas');
    src.width = 1920;
    src.height = 1080;
    const out = downsampleIfLarge(src, 2560);
    expect(out.width).toBe(1920);
    expect(out.height).toBe(1080);
  });

  it('respects a custom maxWidth', () => {
    const src = document.createElement('canvas');
    src.width = 4000;
    src.height = 2000;
    const out = downsampleIfLarge(src, 1000);
    expect(out.width).toBe(1000);
    expect(out.height).toBe(500);
  });

  it('throws on zero-size source', () => {
    const src = document.createElement('canvas');
    src.width = 0;
    src.height = 0;
    expect(() => downsampleIfLarge(src)).toThrow(/zero width or height/);
  });
});
