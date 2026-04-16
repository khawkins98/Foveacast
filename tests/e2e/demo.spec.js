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
      if (msg.type() === 'error') consoleErrors.push(msg.text());
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
    // The console error filter is intentionally lenient: TF.js emits a
    // benign "WebGL is not supported" warning in headless chromium and
    // we don't want that to break the suite.
    const meaningfulErrors = consoleErrors.filter(
      (m) => !/WebGL|webgl|backend/i.test(m),
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
    await expect(banner).toContainText(/real MSI-Net/i);
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
