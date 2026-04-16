// Playwright config for Foveacast end-to-end tests.
//
// Scope: chromium only, demo-mode only. The real UNISAL inference path
// is deliberately NOT exercised here — loading the 12.5 MB ONNX and
// running inference on a committed fixture would take enough wall-clock
// time to slow every run, and the render-pipeline risks it would catch
// are already covered by the demo-mode suite. Adding a "real inference
// in a real browser" test is a live follow-up in ROADMAP / LEARNINGS.
//
// The `?demo=1` path exercises the same render pipeline with a
// synthetic saliency map and is the regression surface that caught
// 5bc68c3's detached-container bug after V1 shipped.
//
// This test suite is NOT run by `pnpm test` (which is vitest) — it has
// its own `pnpm test:e2e` script so unit tests stay fast and the e2e
// suite is opt-in. CI currently only runs vitest; adding e2e to CI
// would need a Playwright-capable runner image and the install step
// from README §Run locally.

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  // Glob matches `*.spec.js` — vitest's include pattern is `*.test.js`,
  // so the two suites never step on each other.
  testMatch: /.*\.spec\.js/,

  // Fail fast locally; retry once to shake out any transient network
  // jitter if a future test does exercise the real inference path.
  retries: process.env.CI ? 2 : 1,
  workers: 1,

  // Boot the Vite dev server on demand. Reuse an existing one if the
  // developer already ran `pnpm dev` in another terminal.
  webServer: {
    // `--strictPort` makes Vite fail loudly if 5173 is taken rather than
    // silently drifting to 5174/5175, which would leave Playwright
    // waiting on a URL nobody is serving. If you see the webServer
    // timeout, run `lsof -ti :5173 | xargs kill` and retry.
    command: 'pnpm dev --port 5173 --strictPort',
    url: 'http://localhost:5173/',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },

  use: {
    baseURL: 'http://localhost:5173',
    // Record on failure so CI artefacts are useful.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
