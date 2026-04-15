// Vitest configuration for Foveacast.
//
// The pipeline, render, and UI modules all touch browser APIs
// (HTMLCanvasElement, ImageData, DOM events), so tests run against
// jsdom rather than node. `@tensorflow/tfjs` itself is never imported
// inside tests — the `model/` module is mocked — so we do not need a
// real WebGL/WebGPU environment here.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.js'],
    // The scaffolding commit lands before any test files exist. Later
    // commits (per the overnight plan) populate `tests/`. Without this
    // flag, `vitest run` exits non-zero on a clean clone, which would
    // break the "just installed, let me check it works" first-run
    // signal. Remove this line once at least one real test exists if
    // you want a zero-tests-means-misconfigured safety net.
    passWithNoTests: true,
  },
});
