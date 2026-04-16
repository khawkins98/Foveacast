// Playwright E2E — exercises the REAL ORT Web model-load path.
//
// demo.spec.js uses ?demo=1, which runs through the render pipeline
// with synthetic saliency and never actually initialises ONNX Runtime
// Web. That means every ORT-specific failure mode — the class-vs-
// object guard check, the `wasmPaths` double-prefix, the `.mjs` MIME
// handling in the Vite middleware, any future ORT runtime regression
// — slips past the demo suite. This file is the counterpart: it
// navigates to the bare URL, lets the real loader run, and asserts
// the app reaches the "model ready" state without a console error.
//
// The UNISAL ONNX artefact is 12.5 MB and the ORT Web WASM is 12 MB.
// Over localhost that is a second or two on a reasonable machine;
// the timeouts below leave ample headroom without being silly.

import { test, expect } from '@playwright/test';

test.describe('Foveacast — real model load end-to-end', () => {
  test.beforeEach(async ({ page }) => {
    const pageErrors = [];
    const consoleErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err));
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const url = msg.location && msg.location().url;
        consoleErrors.push(url ? `${msg.text()} [${url}]` : msg.text());
      }
    });
    // @ts-expect-error — stashing test state on the page object.
    page.__foveacastErrors = { pageErrors, consoleErrors };
  });

  test('boots, loads UNISAL, and reaches the ready state without errors', async ({ page }) => {
    await page.goto('/');

    // The ready banner is the single observable signal that `loadModel`
    // resolved cleanly. The banner text is defined in ui/status.js and
    // includes "drop a screenshot to start". That phrasing is stable
    // enough to assert on; if it changes we want this test to fail and
    // force a conscious update.
    const status = page.locator('.fc-status--ready');
    await expect(status).toBeVisible({ timeout: 30_000 });
    await expect(status).toContainText(/drop a screenshot/i);

    // Dropzone must be enabled — main.js flips `setEnabled(true)` in
    // the same code path that writes the ready banner.
    const dropzone = page.locator('.fc-dropzone');
    const ariaDisabled = await dropzone.getAttribute('aria-disabled');
    expect(ariaDisabled === null || ariaDisabled === 'false').toBeTruthy();

    // @ts-expect-error — stashed in beforeEach.
    const { pageErrors, consoleErrors } = page.__foveacastErrors;

    // The real load path must not throw anywhere.
    expect(pageErrors.map(String)).toEqual([]);

    // Filter the same ORT/WASM environment noise the demo suite
    // tolerates — SharedArrayBuffer warnings on non-COEP origins are
    // expected, not meaningful.
    const meaningfulErrors = consoleErrors.filter(
      (m) => !/SharedArrayBuffer|cross-origin|numThreads/i.test(m),
    );
    expect(meaningfulErrors).toEqual([]);
  });
});
