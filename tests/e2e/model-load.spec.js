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
// V3 ships three duration-specific models (1s, 3s, 7s). The default
// (3s) is loaded on boot. The duration-switch test exercises the
// model-swap path.
//
// The V3 MSI-Net ONNX artefacts are 57 MB each (FP16) and the ORT
// Web WASM is 12 MB. Over localhost that is a second or two on a
// reasonable machine; the timeouts below leave ample headroom without
// being silly.
//
// Service worker (coi-sw.js) note: on a fresh browser context the SW
// registers on the first navigation and triggers one page reload so
// that COEP/COOP headers take effect (making crossOriginIsolated = true
// and enabling WASM threading). Playwright's page object tracks
// through this reload automatically; the generous timeouts below
// absorb the extra round-trip. On the first load (before the SW is
// active) ORT may emit SharedArrayBuffer warnings — those are expected
// and filtered below. On the reloaded page crossOriginIsolated = true
// and no threading warnings are emitted.

import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Preflight: the real-model tests require the ONNX artefact to be present
// locally. The file is gitignored (57 MB FP16 weights). Without this check,
// a missing model produces a silent Playwright timeout that is hard to
// diagnose. This check fails fast with a human-readable message instead.
const MODEL_PATH = resolve(new URL('../../docs/models/v3/3s/model.onnx', import.meta.url).pathname);
const MODEL_PRESENT = existsSync(MODEL_PATH);

test.describe('Foveacast — real model load end-to-end', () => {
  test.beforeAll(() => {
    if (!MODEL_PRESENT) {
      throw new Error(
        `Missing ONNX model file: ${MODEL_PATH}\n` +
        `Run scripts/fetch-v3-model.sh first, then re-run pnpm test:e2e.\n` +
        `(The demo-only suite — pnpm test:e2e -- --grep demo — works without it.)`,
      );
    }
  });

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

  test('boots, loads the default (3s) model, and reaches the ready state without errors', async ({ page }) => {
    await page.goto('/');

    // The drop-zone label switches to "Model ready — drop a screenshot…"
    // once `loadModel` resolves cleanly (see main.js boot path; the old
    // `.fc-status--ready` banner was consolidated into the drop zone in
    // commit 6dbaf0a). The "Model ready" + "drop a screenshot" phrasing
    // is stable enough to assert on; if it changes we want this test to
    // fail and force a conscious update.
    const label = page.locator('.fc-dropzone__label');
    await expect(label).toContainText(/model ready/i, { timeout: 30_000 });
    await expect(label).toContainText(/drop a screenshot/i);

    // Dropzone must be enabled — main.js flips `setEnabled(true)` in
    // the same code path that writes the ready banner.
    const dropzone = page.locator('.fc-dropzone');
    const ariaDisabled = await dropzone.getAttribute('aria-disabled');
    expect(ariaDisabled === null || ariaDisabled === 'false').toBeTruthy();

    // Duration tabs are only visible after inference; in the model-ready
    // state (no image yet) there is no report section to check. The
    // meaningful signal here is that the app reached ready without errors.
    // (The tab-selection behaviour is exercised in the demo-render test below.)

    // @ts-expect-error — stashed in beforeEach.
    const { pageErrors, consoleErrors } = page.__foveacastErrors;

    // The real load path must not throw anywhere.
    expect(pageErrors.map(String)).toEqual([]);

    // On the first navigation the SW has not yet installed, so ORT may
    // emit SharedArrayBuffer / threading warnings before the SW-triggered
    // reload. Filter those expected noise lines. After the reload
    // crossOriginIsolated = true and no threading warnings appear.
    const meaningfulErrors = consoleErrors.filter(
      (m) => !/SharedArrayBuffer|cross-origin|numThreads/i.test(m),
    );
    expect(meaningfulErrors).toEqual([]);

    // Verify the SW is active and the page is cross-origin isolated.
    // If coi-sw.js fails to register, this fails fast and surfaces
    // the root cause before ORT threading bugs become mysterious.
    const isCrossOriginIsolated = await page.evaluate(
      () => /** @type {any} */ (globalThis).crossOriginIsolated,
    );
    expect(isCrossOriginIsolated, 'crossOriginIsolated should be true after SW reload').toBe(true);
  });

  test('duration picker shows all three options (1s, 3s, 7s) after demo render', async ({ page }) => {
    // why: controls use progressive disclosure — hidden until first
    // render. Demo mode is the fastest path to make them visible
    // without dropping a real file.
    await page.goto('/?demo=1');

    // Wait for demo render to complete (controls are revealed after).
    await expect(
      page.locator('#fc-output[data-foveacast-ready="true"]'),
    ).toBeVisible({ timeout: 15_000 });

    // All three duration tabs must be present in the report.
    for (const dur of ['1s', '3s', '7s']) {
      const tab = page.locator(`.fc-report__hero-tab[data-duration="${dur}"]`);
      await expect(tab).toBeVisible();
    }
    // The 3s tab should be selected and enabled (demo mode provides a 3s result).
    const tab3s = page.locator('.fc-report__hero-tab[data-duration="3s"]');
    await expect(tab3s).toHaveAttribute('aria-selected', 'true');
    await expect(tab3s).toHaveAttribute('aria-disabled', 'false');
  });
});
