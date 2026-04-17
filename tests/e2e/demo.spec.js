// Playwright E2E — exercises the real render pipeline in a real
// browser via demo mode.
//
// This is the test surface that would have caught the detached-
// container bug fixed in 96c81d8. The earlier unit tests mocked
// `h337.create` and never observed the real `container.offsetWidth`
// behaviour; that mismatch is exactly why a real browser matters.
//
// The suite is deliberately small. Every assertion targets a failure
// mode we've actually seen or can articulate a specific risk for:
//   - the output canvas renders with non-zero dimensions;
//   - `getImageData` on the output does not throw (the "source height
//     is 0" IndexSizeError);
//   - the page loads without a console error;
//   - keyboard focus lands somewhere reachable after render.
//
// Run via `pnpm test:e2e`. Not included in `pnpm test` (vitest).

import { test, expect } from '@playwright/test';

test.describe('Foveacast — demo mode end-to-end', () => {
  test.beforeEach(async ({ page }) => {
    // Capture any page errors; each test decides whether to assert on
    // them. Having them on the test object makes debugging failures
    // substantially easier than reading Playwright's own error output.
    const pageErrors = [];
    const consoleErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err));
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        // Combine text and location URL so downstream filters can
        // match against either. Chromium's network-layer 404 errors
        // put the URL in `.location()`, not in `.text()`.
        const url = msg.location && msg.location().url;
        consoleErrors.push(url ? `${msg.text()} [${url}]` : msg.text());
      }
    });
    // @ts-expect-error — stashing test state on the page object.
    page.__foveacastErrors = { pageErrors, consoleErrors };
  });

  test('renders a non-zero canvas and permits getImageData', async ({ page }) => {
    await page.goto('/?demo=1');

    // The demo pipeline completes asynchronously (image fetch +
    // postprocess + render). A single attribute flip tells us we're
    // done.
    const output = page.locator('#fc-output[data-foveacast-ready="true"]');
    await expect(output).toBeVisible({ timeout: 15_000 });
    await expect(output).toHaveAttribute('data-foveacast-mode', 'demo');

    // Exactly one canvas in the overlay view.
    const canvas = page.locator('#fc-output-canvas-wrap canvas');
    await expect(canvas).toHaveCount(1);

    const dims = await canvas.evaluate((el) => {
      const c = /** @type {HTMLCanvasElement} */ (el);
      return { width: c.width, height: c.height };
    });
    expect(dims.width).toBeGreaterThan(0);
    expect(dims.height).toBeGreaterThan(0);

    // This is the regression check for 5bc68c3 / 96c81d8. heatmap.js's
    // internal `getImageData` call threw `IndexSizeError: source height
    // is 0` when its container was detached. If we can round-trip a
    // pixel here, the render completed without that failure mode.
    const getImageDataOk = await canvas.evaluate((el) => {
      const c = /** @type {HTMLCanvasElement} */ (el);
      const ctx = c.getContext('2d');
      if (!ctx) return { ok: false, reason: 'no-2d-context' };
      try {
        const data = ctx.getImageData(0, 0, 1, 1);
        return { ok: data && data.data.length === 4, reason: 'ok' };
      } catch (err) {
        return { ok: false, reason: String(err && err.message) };
      }
    });
    expect(getImageDataOk.ok, getImageDataOk.reason).toBe(true);

    // No uncaught page errors should have fired during the demo render.
    // @ts-expect-error — stashed in beforeEach.
    const { pageErrors, consoleErrors } = page.__foveacastErrors;
    expect(pageErrors.map(String)).toEqual([]);
    // The console-error filter is intentionally lenient about
    // network- and backend-related noise that is expected in this
    // environment:
    //   - ORT Web can log SharedArrayBuffer / threading warnings when
    //     `crossOriginIsolated` is false; these are expected on
    //     GitHub Pages and in the Playwright dev-server, and ORT
    //     falls back to single-threaded automatically.
    //   - The silent background model load in demo mode will try to
    //     fetch `./models/v3/model.onnx`. Playwright serves this
    //     file correctly when present, but Chromium still logs any
    //     transient fetch noise the wasm loader surfaces during
    //     initialisation.
    const meaningfulErrors = consoleErrors.filter(
      (m) =>
        !/WebGL|webgl|SharedArrayBuffer|cross-origin|wasm/i.test(m) &&
        !(/404/.test(m) && /\/models\//.test(m)),
    );
    expect(meaningfulErrors).toEqual([]);
  });

  test('shows the synthetic-preview banner so viewers do not mistake it for real inference', async ({
    page,
  }) => {
    await page.goto('/?demo=1');

    const banner = page.locator('.fc-status--demo');
    await expect(banner).toBeVisible({ timeout: 5_000 });
    await expect(banner).toContainText(/synthetic preview/i);
    await expect(banner).toContainText(/real model prediction/i);
  });

  test('progressive disclosure: controls are hidden on a fresh load and revealed after the first render', async ({
    page,
  }) => {
    // Navigate without ?demo=1 first — the background model load
    // would take ~60s, which would dominate the test budget, so we
    // short-circuit the assertion as soon as the fresh-load state is
    // observable. We only care that the controls panel is hidden
    // before any render has happened.
    await page.goto('/');
    const controls = page.locator('#fc-controls-mount > *').first();
    // First visible element under the mount should have hidden
    // because createControls defaults to hidden=false but main.js
    // calls setVisible(false) on boot.
    await expect(controls).toBeHidden({ timeout: 5_000 });

    // Now check the reveal path via demo mode (faster than a real
    // model load).
    await page.goto('/?demo=1');
    await expect(page.locator('#fc-output[data-foveacast-ready="true"]')).toBeVisible({
      timeout: 15_000,
    });
    // After demo renders, the controls panel should be visible.
    await expect(page.locator('#fc-controls-mount > *').first()).toBeVisible();
  });

  test('dropzone and controls are interactive as soon as demo renders, even while the background model is still loading', async ({
    page,
  }) => {
    // UX regression: previously `reloadModel({silent: true})` kept
    // the dropzone and controls disabled for 40–60s after the demo
    // finished rendering. A user who dropped their own file in that
    // window hit a dead dropzone with no signal. Now the dropzone and
    // controls are live immediately; a drop gets queued and runs when
    // the model finishes.
    await page.goto('/?demo=1');

    // Demo-render ready
    await expect(page.locator('#fc-output[data-foveacast-ready="true"]')).toBeVisible({
      timeout: 15_000,
    });

    // Dropzone must not report aria-disabled
    const dropzone = page.locator('.fc-dropzone');
    await expect(dropzone).toHaveAttribute('aria-disabled', /^(?!true$).*/).catch(async () => {
      // Alternative: attribute absent is also fine.
      const val = await dropzone.getAttribute('aria-disabled');
      expect(val).not.toBe('true');
    });

    // Opacity slider operable
    const slider = page.locator('input[type="range"]').first();
    await expect(slider).toBeEnabled();

    // Download button operable
    const download = page.getByRole('button', { name: /download/i });
    await expect(download).toBeEnabled();
  });

  test('the composited canvas carries a demo watermark that survives cropping', async ({
    page,
  }) => {
    // Watermark prevents someone cropping a demo screenshot and
    // posting it as a real MSI-Net prediction. The banner above the
    // canvas is easy to crop out; the watermark tiled into the pixels
    // is not. We sample a vertical-strip centred on the canvas — a
    // crop of just that strip would be a plausible social-media grab
    // and should still contain watermark ink.
    await page.goto('/?demo=1');
    const canvas = page.locator('#fc-output-canvas-wrap canvas');
    await expect(canvas).toBeVisible({ timeout: 15_000 });

    const hasWatermarkInk = await canvas.evaluate((el) => {
      const c = /** @type {HTMLCanvasElement} */ (el);
      const ctx = c.getContext('2d');
      if (!ctx) return false;
      const stripWidth = Math.max(20, Math.floor(c.width * 0.35));
      const stripX = Math.floor((c.width - stripWidth) / 2);
      const sample = ctx.getImageData(stripX, 0, stripWidth, c.height).data;
      // Watermark ink: white fill over black stroke at ~0.55 alpha.
      // After compositing over varied heatmap colours the locally
      // brightest pixels with near-neutral hue are a strong signal.
      // We count pixels whose min(R,G,B) is high AND channels are
      // close to each other — characteristic of the white fill.
      let brightNeutral = 0;
      for (let i = 0; i < sample.length; i += 4) {
        const r = sample[i];
        const g = sample[i + 1];
        const b = sample[i + 2];
        const min = Math.min(r, g, b);
        const max = Math.max(r, g, b);
        if (min > 200 && max - min < 25) brightNeutral += 1;
      }
      return brightNeutral > 30;
    });
    expect(hasWatermarkInk).toBe(true);
  });

  test('the composited canvas contains non-trivial heatmap colour', async ({
    page,
  }) => {
    // A rendered heatmap should introduce pixels that are not pure
    // greyscale (heatmap.js uses a red-to-blue gradient). If the
    // heatmap layer fails silently we'd still see the underlying
    // screenshot but the composite's colour distribution would look
    // suspiciously close to the grayscale of the source. Sampling a
    // grid of pixels and checking that at least one differs
    // significantly across RGB channels is a cheap liveness probe.
    await page.goto('/?demo=1');
    const canvas = page.locator('#fc-output-canvas-wrap canvas');
    await expect(canvas).toBeVisible({ timeout: 15_000 });

    const hasColourSpread = await canvas.evaluate((el) => {
      const c = /** @type {HTMLCanvasElement} */ (el);
      const ctx = c.getContext('2d');
      if (!ctx) return false;
      const step = Math.max(1, Math.floor(Math.min(c.width, c.height) / 20));
      for (let y = 0; y < c.height; y += step) {
        for (let x = 0; x < c.width; x += step) {
          const [r, g, b] = ctx.getImageData(x, y, 1, 1).data;
          const max = Math.max(r, g, b);
          const min = Math.min(r, g, b);
          if (max - min > 40) return true;
        }
      }
      return false;
    });
    expect(hasColourSpread).toBe(true);
  });
});
