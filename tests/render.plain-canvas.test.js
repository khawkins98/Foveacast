// Tests for drawPlainImageCanvas (render/plain-canvas.js).
//
// jsdom does not rasterise canvases, so getContext is stubbed with a
// minimal drawing surface. We assert on canvas dimensions and that
// drawImage was called with the right source — the pixel content is
// out of scope for unit tests.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { drawPlainImageCanvas } from '../docs/src/render/plain-canvas.js';

describe('drawPlainImageCanvas', () => {
  /** @type {any} */
  let ctxStub;
  /** @type {any} */
  let originalGetContext;

  beforeEach(() => {
    ctxStub = { drawImage: vi.fn() };
    originalGetContext = HTMLCanvasElement.prototype.getContext;
    // eslint-disable-next-line no-extend-native
    HTMLCanvasElement.prototype.getContext = () => ctxStub;
  });

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
  });

  it('returns a canvas sized to naturalWidth × naturalHeight', () => {
    const src = { naturalWidth: 800, naturalHeight: 600 };
    const canvas = drawPlainImageCanvas(src);
    expect(canvas.width).toBe(800);
    expect(canvas.height).toBe(600);
  });

  it('falls back to .width / .height when naturalWidth is absent (e.g. <canvas> source)', () => {
    const src = { width: 320, height: 240 };
    const canvas = drawPlainImageCanvas(src);
    expect(canvas.width).toBe(320);
    expect(canvas.height).toBe(240);
  });

  it('calls drawImage with the source at position (0, 0)', () => {
    const src = { naturalWidth: 100, naturalHeight: 50 };
    drawPlainImageCanvas(src);
    expect(ctxStub.drawImage).toHaveBeenCalledWith(src, 0, 0, 100, 50);
  });

  it('returns an HTMLCanvasElement', () => {
    const src = { naturalWidth: 10, naturalHeight: 10 };
    const result = drawPlainImageCanvas(src);
    expect(result).toBeInstanceOf(HTMLCanvasElement);
  });
});
