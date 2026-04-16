import { describe, it, expect } from 'vitest';
import {
  upsampleBilinear,
  gaussianBlur,
  normaliseToUnit,
  postprocess,
} from '../docs/src/pipeline/postprocess.js';

describe('upsampleBilinear', () => {
  it('returns a Float32Array of exact target length', () => {
    const raw = new Float32Array([0, 1, 2, 3]); // 2x2
    const out = upsampleBilinear(raw, [2, 2], [8, 8]);
    expect(out).toBeInstanceOf(Float32Array);
    expect(out.length).toBe(64);
  });

  it('produces a constant map from a constant input', () => {
    const raw = new Float32Array(4 * 6).fill(0.42);
    const out = upsampleBilinear(raw, [4, 6], [16, 24]);
    for (const v of out) {
      expect(v).toBeCloseTo(0.42, 6);
    }
  });

  it('handles non-square scaling', () => {
    const raw = new Float32Array([1, 2, 3, 4]); // 2x2
    const out = upsampleBilinear(raw, [2, 2], [10, 15]);
    expect(out.length).toBe(150);
    // corner values should be close to the raw corners
    expect(out[0]).toBeCloseTo(1, 2); // top-left
    expect(out[14]).toBeCloseTo(2, 2); // top-right
    expect(out[135]).toBeCloseTo(3, 2); // bottom-left
    expect(out[149]).toBeCloseTo(4, 2); // bottom-right
  });
});

describe('gaussianBlur', () => {
  it('approximately preserves total energy (delta input)', () => {
    const w = 32;
    const h = 32;
    const data = new Float32Array(w * h);
    // Delta function of mass 100 at the centre.
    data[(h / 2) * w + w / 2] = 100;

    const out = gaussianBlur(data, [h, w], 3);

    let sumIn = 0;
    let sumOut = 0;
    for (let i = 0; i < data.length; i++) {
      sumIn += data[i];
      sumOut += out[i];
    }
    // Kernel is L1-normalised and edge replication leaves interior deltas
    // undisturbed, so the sums should match to good precision.
    expect(sumOut).toBeCloseTo(sumIn, 2);
  });

  it('does not mutate the input', () => {
    const data = new Float32Array([0, 0, 1, 0, 0]);
    const before = Array.from(data);
    gaussianBlur(data, [1, 5], 1);
    expect(Array.from(data)).toEqual(before);
  });

  it('returns a zero-sigma copy when sigma is not positive', () => {
    const data = new Float32Array([1, 2, 3, 4]);
    const out = gaussianBlur(data, [2, 2], 0);
    expect(Array.from(out)).toEqual([1, 2, 3, 4]);
    // new storage, not aliased
    expect(out).not.toBe(data);
  });
});

describe('normaliseToUnit', () => {
  it('maps min to 0 and max to 1 for non-constant input', () => {
    const data = new Float32Array([1, 3, 5, 7]);
    const out = normaliseToUnit(data);
    expect(Math.min(...out)).toBe(0);
    expect(Math.max(...out)).toBe(1);
    // Linear mapping: 3 -> (3-1)/(7-1) = 2/6 = 0.333...
    expect(out[1]).toBeCloseTo(2 / 6, 6);
  });

  it('returns an all-zero array for constant input (no NaN)', () => {
    const data = new Float32Array([5, 5, 5, 5]);
    const out = normaliseToUnit(data);
    for (const v of out) expect(v).toBe(0);
  });

  it('does not mutate the input', () => {
    const data = new Float32Array([0, 10]);
    normaliseToUnit(data);
    expect(Array.from(data)).toEqual([0, 10]);
  });
});

describe('postprocess', () => {
  it('produces a target-sized array with values in [0, 1]', () => {
    // Synthetic saliency: brighter toward the bottom-right.
    const src = [2, 4];
    const raw = new Float32Array([0, 0, 1, 2, 3, 4, 5, 6]);
    // wait - src dims should be [2, 4] so raw length = 8. Good.
    const out = postprocess(raw, src, [20, 40], 2);
    expect(out.length).toBe(20 * 40);
    for (const v of out) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});
