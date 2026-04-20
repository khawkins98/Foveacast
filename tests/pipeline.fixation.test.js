import { describe, it, expect } from 'vitest';
import { firstFixationCentroid, topNFixations } from '../docs/src/pipeline/fixation.js';

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

describe('topNFixations', () => {
  it('returns at most n fixations', () => {
    const w = 60, h = 60;
    const map = new Float32Array(w * h);
    // Three distinct blobs.
    for (const [cx, cy] of [[10, 10], [40, 10], [25, 45]]) {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const dx = x - cx, dy = y - cy;
          map[y * w + x] += Math.exp(-(dx * dx + dy * dy) / 20);
        }
      }
    }
    const seq = topNFixations(map, w, h, 2);
    expect(seq.length).toBeLessThanOrEqual(2);
    expect(seq.length).toBeGreaterThanOrEqual(1);
  });

  it('returns a single centre fixation for an all-zero map', () => {
    const w = 50, h = 40;
    const map = new Float32Array(w * h);
    const seq = topNFixations(map, w, h, 5);
    expect(seq).toHaveLength(1);
    expect(seq[0].x).toBe(Math.floor(w / 2));
    expect(seq[0].y).toBe(Math.floor(h / 2));
  });

  it('returns an empty array when n = 0', () => {
    const map = new Float32Array(100).fill(1);
    expect(topNFixations(map, 10, 10, 0)).toHaveLength(0);
  });

  it('returns an empty array for empty map', () => {
    expect(topNFixations(new Float32Array(0), 0, 0, 5)).toHaveLength(0);
  });

  it('coordinates are within image bounds', () => {
    const w = 80, h = 60;
    const map = new Float32Array(w * h);
    for (let i = 0; i < map.length; i++) map[i] = Math.random();
    const seq = topNFixations(map, w, h, 5);
    for (const { x, y } of seq) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(w);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThan(h);
    }
  });

  it('n=1 returns a single fixation consistent with firstFixationCentroid', () => {
    const w = 40, h = 30;
    const map = new Float32Array(w * h);
    // Single bright pixel.
    map[15 * w + 20] = 1;
    const seq = topNFixations(map, w, h, 1);
    const single = firstFixationCentroid(new Float32Array(map), w, h, 0.10);
    expect(seq).toHaveLength(1);
    // The IoR first fixation should be the same as firstFixationCentroid.
    expect(seq[0].x).toBe(single.x);
    expect(seq[0].y).toBe(single.y);
  });
});
