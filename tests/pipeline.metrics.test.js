// Unit tests for pipeline/metrics.js.
//
// Pure-function module: no DOM, no browser APIs. Runs in vitest with
// the node environment.

import { describe, it, expect } from 'vitest';
import { computeSaliencyMetrics } from '../docs/src/pipeline/metrics.js';

describe('computeSaliencyMetrics', () => {
  it('returns High spread for an empty array', () => {
    const result = computeSaliencyMetrics([]);
    expect(result.concentration).toBe(0);
    expect(result.spreadLevel).toBe('High');
  });

  it('returns High spread when all values are zero', () => {
    const result = computeSaliencyMetrics(new Float32Array([0, 0, 0, 0, 0]));
    expect(result.concentration).toBe(0);
    expect(result.spreadLevel).toBe('High');
  });

  it('returns concentration 100 and Low spread for a single non-zero pixel', () => {
    // 1 pixel in 10 — top 10% IS that pixel, holding all the mass.
    const arr = new Float32Array(10).fill(0);
    arr[0] = 1.0;
    const result = computeSaliencyMetrics(arr);
    expect(result.concentration).toBe(100);
    expect(result.spreadLevel).toBe('Low');
  });

  it('returns concentration ~10 and High spread for a perfectly uniform map', () => {
    // Uniform: top 10% holds exactly 10% of mass. concentration = 10.
    const arr = new Float32Array(100).fill(1 / 100);
    const result = computeSaliencyMetrics(arr);
    expect(result.concentration).toBe(10);
    expect(result.spreadLevel).toBe('High');
  });

  it('returns High spread for a nearly-uniform map (concentration < 35)', () => {
    const arr = new Float32Array(200).fill(1);
    const result = computeSaliencyMetrics(arr);
    // top 10% of 200 = 20 pixels, each with value 1, total 200.
    // concentration = 20/200 * 100 = 10.
    expect(result.concentration).toBe(10);
    expect(result.spreadLevel).toBe('High');
  });

  it('returns Low spread for a map with a strong central spike', () => {
    // 9 hot pixels (0.9 each) surrounded by 91 cold pixels (0.01 each).
    const arr = new Float32Array(100).fill(0.01);
    for (let i = 0; i < 9; i++) arr[i] = 0.9;
    const result = computeSaliencyMetrics(arr);
    // top 10% = 10 pixels: 9 × 0.9 = 8.1, plus 1 cold pixel 0.01 = 8.11
    // total = 9 × 0.9 + 91 × 0.01 = 8.1 + 0.91 = 9.01
    // concentration ≈ 8.11 / 9.01 ≈ 90 → Low spread
    expect(result.spreadLevel).toBe('Low');
    expect(result.concentration).toBeGreaterThanOrEqual(55);
  });

  it('returns Medium spread for a map with moderate focus (concentration 35-54)', () => {
    // Craft a map where exactly the top 10% holds ~40% of the mass.
    // Use 10 hot pixels at value 4, 90 cold at value 1.
    // total = 10*4 + 90*1 = 40 + 90 = 130
    // top 10% = 10 pixels × 4 = 40
    // concentration = 40/130 * 100 ≈ 31 → actually High, let me recalculate
    // For Medium we need concentration in [35, 54].
    // Use 10 hot at 5, 90 cold at 1:
    // total = 50 + 90 = 140; top 10 = 50; concentration = 50/140*100 ≈ 36 → Medium
    const arr = new Float32Array(100).fill(1);
    for (let i = 0; i < 10; i++) arr[i] = 5;
    const result = computeSaliencyMetrics(arr);
    expect(result.spreadLevel).toBe('Medium');
    expect(result.concentration).toBeGreaterThanOrEqual(35);
    expect(result.concentration).toBeLessThan(55);
  });

  it('spreadLevel threshold: concentration exactly 55 → Low', () => {
    // Manufacture a precise concentration by using a large array.
    // 10 hot pixels at 110, 90 cold at 1.
    // total = 1100 + 90 = 1190
    // top 10% of 100 = 10 → concentration = 1100/1190*100 ≈ 92 → Low
    // Let me instead compute: need concentration = round(x) = 55
    // Use 1000 pixels. top 10% = 100 pixels.
    // Want topMass/totalMass = 55/100.
    // Set 100 hot at 55, 900 cold at (1 - proportional filler).
    // Actually, let's keep it simple: 100 pixels, 10 hot at 5.5, 90 cold at 1.
    // total = 55 + 90 = 145. top = 55. concentration = round(55/145*100) = round(37.9) = 38 → Medium
    // More straightforward: 10 hot at 11, 90 cold at 1.
    // total = 110 + 90 = 200. top = 110. concentration = round(110/200*100) = 55. → Low
    const arr = new Float32Array(100).fill(1);
    for (let i = 0; i < 10; i++) arr[i] = 11;
    const result = computeSaliencyMetrics(arr);
    expect(result.concentration).toBe(55);
    expect(result.spreadLevel).toBe('Low');
  });

  it('spreadLevel threshold: concentration exactly 35 → Medium', () => {
    // 100 pixels, 10 hot + 90 cold.
    // Need round(top/total*100) = 35.
    // top/total = 35/100 = 0.35 → top = 0.35 * total
    // Let hot = h, cold = 1. top = 10h. total = 10h + 90.
    // 10h / (10h + 90) = 0.35 → 10h = 0.35(10h + 90) → 10h = 3.5h + 31.5
    // → 6.5h = 31.5 → h = 4.846…
    // Try h=4.85: top=48.5, total=48.5+90=138.5, conc=round(48.5/138.5*100)=round(35.02)=35 ✓
    const arr = new Float32Array(100).fill(1);
    for (let i = 0; i < 10; i++) arr[i] = 4.85;
    const result = computeSaliencyMetrics(arr);
    expect(result.concentration).toBe(35);
    expect(result.spreadLevel).toBe('Medium');
  });

  it('works with a Float32Array input', () => {
    const arr = new Float32Array([0.2, 0.8, 0.5, 0.1, 0.4]);
    const result = computeSaliencyMetrics(arr);
    expect(typeof result.concentration).toBe('number');
    expect(['Low', 'Medium', 'High']).toContain(result.spreadLevel);
  });

  it('works with a plain Array input', () => {
    const arr = [0.1, 0.2, 0.3, 0.4, 0.5];
    const result = computeSaliencyMetrics(arr);
    expect(typeof result.concentration).toBe('number');
    expect(['Low', 'Medium', 'High']).toContain(result.spreadLevel);
  });
});
