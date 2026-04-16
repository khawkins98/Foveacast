// Unit tests for the download helper.
//
// `downloadCompositeAsPng` is small but load-bearing — a quietly
// broken download button is the kind of bug a user notices once and
// silently decides the tool is untrustworthy. The three invariants
// worth pinning here:
//
//   1. `canvas.toBlob` is called with the correct MIME type.
//   2. A temporary anchor is clicked with a matching `download=`
//      filename, then removed from the DOM.
//   3. The object URL is created and later revoked, so we don't leak
//      memory on repeated downloads.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { downloadCompositeAsPng } from '../docs/src/render/download.js';

/**
 * Build a canvas-like that captures `toBlob` calls and returns a
 * canned Blob. jsdom's <canvas> has toBlob, but it returns null
 * without the optional `canvas` npm package — mocking the method
 * is simpler and lets us assert on the call shape.
 */
function makeFakeCanvas(producedBlob = new Blob(['png-bytes'], { type: 'image/png' })) {
  return {
    toBlob: vi.fn((cb, type) => {
      // Callbacks are normally async; simulate that faintly so the
      // promise chain in the helper behaves like production.
      queueMicrotask(() => cb(producedBlob));
    }),
  };
}

describe('downloadCompositeAsPng', () => {
  /** @type {any} */
  let originalCreateObjectURL;
  /** @type {any} */
  let originalRevokeObjectURL;
  /** @type {any} */
  let createSpy;
  /** @type {any} */
  let revokeSpy;
  /** @type {HTMLAnchorElement[]} */
  let appendedAnchors;
  /** @type {string[]} */
  let anchorClicks;

  beforeEach(() => {
    originalCreateObjectURL = URL.createObjectURL;
    originalRevokeObjectURL = URL.revokeObjectURL;

    createSpy = vi.fn((blob) => `blob:fake/${blob && blob.size != null ? blob.size : 'x'}`);
    revokeSpy = vi.fn();
    URL.createObjectURL = createSpy;
    URL.revokeObjectURL = revokeSpy;

    // Track anchor lifecycle.
    appendedAnchors = [];
    anchorClicks = [];
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      const el = origCreate(tag);
      if (tag === 'a') {
        appendedAnchors.push(/** @type {HTMLAnchorElement} */ (el));
        const origClick = el.click.bind(el);
        el.click = () => {
          anchorClicks.push(
            /** @type {HTMLAnchorElement} */ (el).getAttribute('download') || '',
          );
          // Don't actually navigate; jsdom would no-op anyway.
          try {
            origClick();
          } catch {
            /* ignore */
          }
        };
      }
      return el;
    });
  });

  afterEach(() => {
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    vi.restoreAllMocks();
  });

  it('rejects when the input is not a canvas with toBlob', async () => {
    await expect(
      downloadCompositeAsPng(/** @type {any} */ (null)),
    ).rejects.toThrow(/toBlob support/);

    await expect(
      downloadCompositeAsPng(/** @type {any} */ ({})),
    ).rejects.toThrow(/toBlob support/);
  });

  it('calls canvas.toBlob with image/png', async () => {
    const canvas = makeFakeCanvas();
    await downloadCompositeAsPng(/** @type {any} */ (canvas));
    expect(canvas.toBlob).toHaveBeenCalledTimes(1);
    expect(canvas.toBlob.mock.calls[0][1]).toBe('image/png');
  });

  it('creates an object URL and clicks an anchor with the given filename', async () => {
    const canvas = makeFakeCanvas();
    await downloadCompositeAsPng(/** @type {any} */ (canvas), 'my-heatmap.png');

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(appendedAnchors.length).toBe(1);
    const anchor = appendedAnchors[0];
    expect(anchor.getAttribute('download')).toBe('my-heatmap.png');
    // Anchor is removed from the document after the click.
    expect(document.body.contains(anchor)).toBe(false);
    // The click happened with the right download attribute in place.
    expect(anchorClicks).toEqual(['my-heatmap.png']);
  });

  it('uses the default filename when none is provided', async () => {
    const canvas = makeFakeCanvas();
    await downloadCompositeAsPng(/** @type {any} */ (canvas));
    expect(appendedAnchors[0].getAttribute('download')).toBe('foveacast-heatmap.png');
  });

  it('revokes the object URL on the next tick (memory cleanup)', async () => {
    // Each previous test's download also queued a revoke via
    // setTimeout(0). Those pending callbacks resolve against
    // whatever `URL.revokeObjectURL` points to at fire time — i.e.
    // this test's spy, after beforeEach swaps it in. We cannot
    // assert "spy called exactly once" in that environment, so
    // instead we assert the URL we just created gets revoked.
    const canvas = makeFakeCanvas();
    await downloadCompositeAsPng(/** @type {any} */ (canvas));

    // Revoke is queued via setTimeout(..., 0); flush the macrotask
    // queue with a short await.
    await new Promise((r) => setTimeout(r, 10));

    const createdUrl = createSpy.mock.results[0].value;
    const revokedUrls = revokeSpy.mock.calls.map((call) => call[0]);
    expect(revokedUrls).toContain(createdUrl);
  });

  it('rejects when the canvas produces a null blob', async () => {
    const canvas = {
      toBlob: (cb /* , type */) => queueMicrotask(() => cb(null)),
    };
    await expect(
      downloadCompositeAsPng(/** @type {any} */ (canvas)),
    ).rejects.toThrow(/failed to produce a PNG blob/i);
  });
});
