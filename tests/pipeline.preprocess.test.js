// Unit tests for pipeline/preprocess.js. These run under jsdom (see
// vitest.config.js) so `document.createElement('canvas')` exists, but
// jsdom's canvas is a no-op — we exercise `toInputTensorData` purely
// on synthetic `ImageData` objects to avoid depending on canvas
// rendering.

import { describe, it, expect } from 'vitest';
import {
  MODEL_INPUT_DIMS,
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

// V3 uses raw 0–255 values (no ImageNet normalisation). The ONNX graph
// handles mean subtraction internally. Tests assert raw clamped pixel
// values rather than norm(c, byte) transforms.

describe('MODEL_INPUT_DIMS', () => {
  it('is the SALICON-native [240, 320] shape MSI-Net V3 was exported for', () => {
    expect(Array.from(MODEL_INPUT_DIMS)).toEqual([240, 320]);
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
    expect(out[0]).toBeCloseTo(255, 5); // R plane
    expect(out[1]).toBeCloseTo(0, 5); // G plane
    expect(out[2]).toBeCloseTo(0, 5); // B plane
  });

  it('emits RGB for pure blue too (sanity)', () => {
    // Pure blue: R=0, G=0, B=255. Red plane should be near -2.12
    // (the normalised zero), green similar, blue around +2.64.
    const img = makeImageData(1, 1, [0, 0, 255, 255]);
    const out = toInputTensorData(img, [1, 1]);
    expect(out[0]).toBeCloseTo(0, 5);
    expect(out[1]).toBeCloseTo(0, 5);
    expect(out[2]).toBeCloseTo(255, 5);
  });

  it('normalises pixel bytes to ImageNet mean/std', () => {
    // 128-grey is right in the middle — each channel normalises
    // independently because the ImageNet means/stds differ slightly.
    const img = makeImageData(1, 1, [128, 128, 128, 255]);
    const out = toInputTensorData(img, [1, 1]);
    expect(out[0]).toBeCloseTo(128, 5);
    expect(out[1]).toBeCloseTo(128, 5);
    expect(out[2]).toBeCloseTo(128, 5);
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
    expect(out[off]).toBeCloseTo(100, 1);
    expect(out[plane + off]).toBeCloseTo(150, 1);
    expect(out[2 * plane + off]).toBeCloseTo(200, 1);
  });

  it('preserves constant colour fields through resize', () => {
    const img = makeImageData(32, 32, [50, 60, 70, 255]);
    const dims = /** @type {[number, number]} */ ([24, 32]);
    const [h, w] = dims;
    const out = toInputTensorData(img, dims);
    const plane = h * w;
    // With aspect-ratio-preserving resize, a 32×32 source into a 24×32
    // target scales to 24×24 (preserving aspect) and pads left/right
    // with 126. Check the centre of the non-padded region.
    const scale = Math.min(h / 32, w / 32);
    const scaledH = Math.round(32 * scale);
    const scaledW = Math.round(32 * scale);
    const padTop = Math.floor((h - scaledH) / 2);
    const padLeft = Math.floor((w - scaledW) / 2);
    for (let y = padTop + 1; y < padTop + scaledH - 1; y++) {
      for (let x = padLeft + 1; x < padLeft + scaledW - 1; x++) {
        const off = y * w + x;
        expect(out[off]).toBeCloseTo(50, 5);
        expect(out[plane + off]).toBeCloseTo(60, 5);
        expect(out[2 * plane + off]).toBeCloseTo(70, 5);
      }
    }
  });

  it('fast-paths a 1×1 degenerate source', () => {
    const img = makeImageData(1, 1, [200, 100, 50, 255]);
    const dims = /** @type {[number, number]} */ ([4, 4]);
    const [h, w] = dims;
    const out = toInputTensorData(img, dims);
    const plane = h * w;
    const expR = 200;
    const expG = 100;
    const expB = 50;
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
