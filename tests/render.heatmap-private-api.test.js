// Snapshot test: the vendored heatmap.min.js still references the
// private field names we depend on.
//
// Why a source-string snapshot rather than a runtime shape check:
//   heatmap.js's `create()` calls `createLinearGradient` and other
//   2D-context methods that jsdom does not implement. We cannot
//   instantiate the library under vitest, so a shape assertion after
//   `h337.create(...)` would fail for reasons unrelated to the API
//   contract we care about. The Playwright E2E suite exercises the
//   runtime shape against a real browser; this test is a fast
//   tripwire for the bytes on disk.
//
// What this catches:
//   A future vendored-library bump that silently renames the private
//   field `_renderer.canvas` would take down `docs/src/render/heatmap.js`
//   in production — we reach into the instance via that exact path.
//   If the minified source no longer contains `_renderer`, the fail
//   message points at the right file and the right line in our own
//   code to update.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('heatmap.js private API snapshot', () => {
  const source = readFileSync(
    join(process.cwd(), 'docs/vendor/heatmap.min.js'),
    'utf8',
  );

  it('the vendored file still contains the `_renderer` identifier we reach for', () => {
    // If this fails after a heatmap.js version bump, update
    // `docs/src/render/heatmap.js` to use whatever new accessor the
    // library exposes (ideally `getCanvas()` if one has landed) and
    // update this test's expected literal.
    expect(source).toContain('_renderer');
  });

  it('the vendored file references `canvas` as a renderer property', () => {
    // Looser sibling check. If `_renderer.canvas` gets renamed to
    // `_renderer.cnv` (or similar) the first assertion still passes
    // but production silently breaks. Matching on a minimised
    // identifier pair is noisier — instead we check the literal
    // string `.canvas=` which the minifier preserves for member
    // assignments into the renderer.
    expect(source).toMatch(/\.canvas\s*=/);
  });

  it('exposes an `h337` global at script-eval time (sanity)', () => {
    // Running the minified source under `new Function` attaches the
    // library to `globalThis`. We do not instantiate anything — just
    // confirm the script evaluates cleanly and the global name is
    // the one our <script src=...> in index.html depends on.
    // eslint-disable-next-line no-new-func
    new Function(source).call(globalThis);
    expect(/** @type {any} */ (globalThis).h337).toBeTruthy();
    expect(typeof /** @type {any} */ (globalThis).h337.create).toBe('function');
  });
});
