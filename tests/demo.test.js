// Unit tests for the demo-mode helpers.
//
// `isDemoModeRequested` parses the query string and is a single
// branch gate on whether main.js takes the synthetic-preview path
// or the real-model path. A bug here is a user-visible bug.
//
// `makeSyntheticSaliency` generates the map the demo pipeline
// renders. The shape / value-range contract matters: under V2 the
// postprocess pipeline applies `exp(y - max(y))` first, so the demo
// has to produce values in a log-probability-like range rather than
// the 0–255 MSI-Net outputs were in. Row-major order is what the
// rest of the pipeline assumes.
//
// `runDemoMode` is covered by Playwright (end-to-end) — it needs
// the DOM, an image fetch, and the real render stack, and mocking
// all of that would test our mocks rather than our code.

import { describe, it, expect, afterEach } from 'vitest';
import { isDemoModeRequested, makeSyntheticSaliency } from '../docs/src/demo.js';

describe('isDemoModeRequested', () => {
  /**
   * Push a new URL into jsdom's history so `window.location.search`
   * returns the test-controlled query string. This is friendlier
   * than redefining the `search` property, which jsdom marks as
   * non-configurable.
   */
  function withSearch(search, fn) {
    const prev = window.location.pathname + window.location.search;
    const next = window.location.pathname + (search || '');
    window.history.pushState(null, '', next);
    try {
      return fn();
    } finally {
      window.history.pushState(null, '', prev);
    }
  }

  it('returns false on an empty query string', () => {
    withSearch('', () => {
      expect(isDemoModeRequested()).toBe(false);
    });
  });

  it('returns true for ?demo=1', () => {
    withSearch('?demo=1', () => {
      expect(isDemoModeRequested()).toBe(true);
    });
  });

  it('returns true for ?demo=true (case-insensitive)', () => {
    withSearch('?demo=true', () => {
      expect(isDemoModeRequested()).toBe(true);
    });
    withSearch('?demo=TRUE', () => {
      expect(isDemoModeRequested()).toBe(true);
    });
  });

  it('returns true for bare ?demo (no value)', () => {
    withSearch('?demo', () => {
      expect(isDemoModeRequested()).toBe(true);
    });
  });

  it('returns false for ?demo=0 (explicit off)', () => {
    withSearch('?demo=0', () => {
      expect(isDemoModeRequested()).toBe(false);
    });
  });

  it('returns false for ?demo=false', () => {
    withSearch('?demo=false', () => {
      expect(isDemoModeRequested()).toBe(false);
    });
  });

  it('ignores unrelated query params', () => {
    withSearch('?other=value&foo=bar', () => {
      expect(isDemoModeRequested()).toBe(false);
    });
  });

  it('still returns true when other params are present alongside demo', () => {
    withSearch('?other=1&demo=1&foo=bar', () => {
      expect(isDemoModeRequested()).toBe(true);
    });
  });
});

describe('makeSyntheticSaliency', () => {
  it('returns a Float32Array of length H * W', () => {
    const map = makeSyntheticSaliency([120, 160]);
    expect(map).toBeInstanceOf(Float32Array);
    expect(map.length).toBe(120 * 160);
  });

  it('works at arbitrary dims, not just the demo default', () => {
    const map = makeSyntheticSaliency([24, 32]);
    expect(map.length).toBe(24 * 32);
  });

  it('produces values in the log-probability range UNISAL emits', () => {
    // UNISAL output in practice sits between roughly -25 and -7. The
    // demo should land in the same band so the postprocess `exp` step
    // behaves the same on demo output as on real model output.
    const map = makeSyntheticSaliency([60, 80]);
    for (let i = 0; i < map.length; i++) {
      expect(map[i]).toBeGreaterThanOrEqual(-30);
      expect(map[i]).toBeLessThanOrEqual(0);
    }
  });

  it('has a peak meaningfully above its background', () => {
    // Every-pixel-identical would render a flat heatmap. The
    // synthetic blobs should create at least a few nats of spread
    // between the background and the peak.
    const map = makeSyntheticSaliency([120, 160]);
    let min = map[0];
    let max = map[0];
    for (let i = 1; i < map.length; i++) {
      if (map[i] < min) min = map[i];
      if (map[i] > max) max = map[i];
    }
    expect(max - min).toBeGreaterThan(5);
  });

  it('has a peak somewhere near the top-left blob (rule-of-thirds position)', () => {
    // The demo positions a blob at roughly (fx: 0.30, fy: 0.22).
    // We look for the brightest pixel and confirm it is in the
    // left-half / top-half of the map rather than centred or
    // bottom-right.
    const [h, w] = [120, 160];
    const map = makeSyntheticSaliency([h, w]);
    let maxIdx = 0;
    for (let i = 1; i < map.length; i++) if (map[i] > map[maxIdx]) maxIdx = i;
    const y = Math.floor(maxIdx / w);
    const x = maxIdx % w;
    expect(x).toBeLessThan(w * 0.5);
    expect(y).toBeLessThan(h * 0.5);
  });

  it('is row-major — the index (y, x) maps to map[y * w + x]', () => {
    // This is the convention the rest of the pipeline assumes. A
    // quiet row-vs-column bug here would show up as a rotated
    // heatmap in the demo.
    const [h, w] = [10, 20];
    const map = makeSyntheticSaliency([h, w]);
    // Construct the peak the same way the generator does and
    // confirm the expected index is among the top values.
    // The primary blob is at (fx 0.30, fy 0.22) → (x=6, y=2).
    const peakIdx = 2 * w + 6;
    // Should be significantly above the mean.
    let mean = 0;
    for (let i = 0; i < map.length; i++) mean += map[i];
    mean /= map.length;
    expect(map[peakIdx]).toBeGreaterThan(mean);
  });
});
