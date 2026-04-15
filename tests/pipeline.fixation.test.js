import { describe, it, expect } from 'vitest';
import { firstFixationCentroid } from '../docs/src/pipeline/fixation.js';

describe('firstFixationCentroid', () => {
  it('returns integer coordinates within image bounds', () => {
    const w = 40;
    const h = 30;
    const map = new Float32Array(w * h);
    // A single bright spot at (10, 5).
    map[5 * w + 10] = 1;
    const c = firstFixationCentroid(map, w, h, 0.1);
    expect(Number.isInteger(c.x)).toBe(true);
    expect(Number.isInteger(c.y)).toBe(true);
    expect(c.x).toBeGreaterThanOrEqual(0);
    expect(c.x).toBeLessThan(w);
    expect(c.y).toBeGreaterThanOrEqual(0);
    expect(c.y).toBeLessThan(h);
  });

  it('returns a centroid in the top-right quadrant when only that quadrant is bright', () => {
    const w = 100;
    const h = 100;
    const map = new Float32Array(w * h);
    // Fill the top-right quadrant (x in [50,99], y in [0,49]) with a
    // gaussian-ish bright region peaked near (75, 25).
    for (let y = 0; y < 50; y++) {
      for (let x = 50; x < 100; x++) {
        const dx = x - 75;
        const dy = y - 25;
        map[y * w + x] = Math.exp(-(dx * dx + dy * dy) / 200);
      }
    }
    const c = firstFixationCentroid(map, w, h, 0.1);
    expect(c.x).toBeGreaterThanOrEqual(50); // right half
    expect(c.y).toBeLessThan(50); // top half
    // Close to the peak.
    expect(Math.abs(c.x - 75)).toBeLessThan(10);
    expect(Math.abs(c.y - 25)).toBeLessThan(10);
  });

  it('returns image centre for an all-zero map (no NaN leak)', () => {
    const w = 20;
    const h = 10;
    const map = new Float32Array(w * h);
    const c = firstFixationCentroid(map, w, h, 0.1);
    expect(c).toEqual({ x: 10, y: 5 });
  });

  it('handles topFraction = 1.0 (all pixels weighted)', () => {
    const w = 4;
    const h = 4;
    // Uniform map - centroid should be the image centre (weighted mean
    // of x coords 0..3 is 1.5, rounded to 2).
    const map = new Float32Array(w * h).fill(1);
    const c = firstFixationCentroid(map, w, h, 1);
    expect(c.x).toBe(2);
    expect(c.y).toBe(2);
  });
});
