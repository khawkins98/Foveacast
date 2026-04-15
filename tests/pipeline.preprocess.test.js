// Unit tests for pipeline/preprocess.js. These run under jsdom (see
// vitest.config.js) so `document.createElement('canvas')` exists, but
// jsdom's canvas is a no-op — we exercise `toInputTensorData` purely on
// synthetic `ImageData` objects to avoid depending on canvas rendering.

import { describe, it, expect } from 'vitest';
import {
  PRESETS,
  toInputTensorData,
  downsampleIfLarge,
} from '../docs/src/pipeline/preprocess.js';

/**
 * Build a synthetic ImageData-like object. `toInputTensorData` only needs
 * `.width`, `.height`, and `.data` (a Uint8ClampedArray of RGBA bytes),
 * which matches the real `ImageData` shape. jsdom doesn't always expose
 * the `ImageData` constructor globally, so we return a plain duck-typed
 * object — identical to what `ctx.getImageData` returns in real browsers.
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

describe('PRESETS', () => {
  it('exposes exactly the five PRD-specified presets with correct dims', () => {
    expect(PRESETS).toEqual({
      very_low: [48, 64],
      low: [72, 96],
      medium: [120, 160],
      high: [168, 224],
      very_high: [240, 320],
    });
  });
});

describe('toInputTensorData', () => {
  it('returns Float32Array of length H*W*3 for every preset', () => {
    const img = makeImageData(64, 48, [128, 64, 32, 255]);
    for (const [name, dims] of Object.entries(PRESETS)) {
      const [h, w] = dims;
      const out = toInputTensorData(img, dims);
      expect(out, name).toBeInstanceOf(Float32Array);
      expect(out.length, name).toBe(h * w * 3);
    }
  });

  it('clamps values into [0, 255]', () => {
    const img = makeImageData(4, 4, [255, 0, 128, 255]);
    const out = toInputTensorData(img, [8, 8]);
    for (const v of out) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(255);
    }
  });

  it('emits BGR order (pure-red input yields [0, 0, 255])', () => {
    // Pure red: R=255, G=0, B=0. With BGR output, first three floats
    // should be B, G, R == 0, 0, 255.
    const img = makeImageData(1, 1, [255, 0, 0, 255]);
    const out = toInputTensorData(img, [1, 1]);
    expect(Array.from(out)).toEqual([0, 0, 255]);
  });

  it('emits BGR for pure blue too (sanity)', () => {
    // Pure blue: R=0, G=0, B=255. BGR output first three floats == 255, 0, 0.
    const img = makeImageData(1, 1, [0, 0, 255, 255]);
    const out = toInputTensorData(img, [1, 1]);
    expect(Array.from(out)).toEqual([255, 0, 0]);
  });

  it('handles non-square input resized into a preset without error', () => {
    const img = makeImageData(16, 9, [100, 150, 200, 255]);
    const out = toInputTensorData(img, [48, 64]);
    expect(out.length).toBe(48 * 64 * 3);
    // Interior pixels should stay close to the constant fill (in BGR).
    // Pick the centre pixel.
    const cx = 32;
    const cy = 24;
    const o = (cy * 64 + cx) * 3;
    expect(out[o]).toBeCloseTo(200, 0); // B
    expect(out[o + 1]).toBeCloseTo(150, 0); // G
    expect(out[o + 2]).toBeCloseTo(100, 0); // R
  });

  it('preserves constant colour fields (bilinear of a constant is a constant)', () => {
    const img = makeImageData(32, 32, [50, 60, 70, 255]);
    const out = toInputTensorData(img, [48, 64]);
    // Take inner pixels only (border clamping makes them identical anyway,
    // but inner pixels are guaranteed to have all four neighbours in range).
    for (let y = 1; y < 47; y++) {
      for (let x = 1; x < 63; x++) {
        const o = (y * 64 + x) * 3;
        expect(out[o]).toBeCloseTo(70, 6); // B
        expect(out[o + 1]).toBeCloseTo(60, 6); // G
        expect(out[o + 2]).toBeCloseTo(50, 6); // R
      }
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
