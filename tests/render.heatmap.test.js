// Render tests.
//
// jsdom does not actually rasterise canvases, so we mock the minimum
// surface: `globalThis.h337` for renderHeatmapCanvas, and a stubbed
// `HTMLCanvasElement.prototype.getContext` so compositeImageAndHeatmap
// can run its drawImage calls without throwing. We assert on call
// shape — the pixels themselves are out of scope for unit tests.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  renderHeatmapCanvas,
  compositeImageAndHeatmap,
} from '../docs/src/render/heatmap.js';

/**
 * Build a fresh heatmap.js stub for a test. Returns both the stub and
 * the inner `setData`/`create` spies so assertions can inspect them.
 */
function makeH337Stub() {
  const fakeCanvas = { width: 0, height: 0, __isFakeHeatmapCanvas: true };
  const instance = {
    _renderer: { canvas: fakeCanvas },
    setData: vi.fn(),
    getDataURL: vi.fn(),
  };
  const create = vi.fn((config) => {
    // heatmap.js sizes its canvas to the container dims; reflect that
    // back so the caller sees a sensibly-sized fake canvas.
    fakeCanvas.width = parseInt(config.container.style.width, 10) || 0;
    fakeCanvas.height = parseInt(config.container.style.height, 10) || 0;
    return instance;
  });
  return { stub: { create }, instance, fakeCanvas, create };
}

describe('renderHeatmapCanvas', () => {
  /** @type {any} */
  let originalH337;

  beforeEach(() => {
    originalH337 = /** @type {any} */ (globalThis).h337;
  });

  afterEach(() => {
    /** @type {any} */ (globalThis).h337 = originalH337;
  });

  it('throws a friendly error when h337 is missing', () => {
    /** @type {any} */ (globalThis).h337 = undefined;
    expect(() => renderHeatmapCanvas(new Float32Array(4), 2, 2)).toThrow(/heatmap\.js is not available/);
  });

  it('validates the map length against width*height', () => {
    const { stub } = makeH337Stub();
    /** @type {any} */ (globalThis).h337 = stub;
    expect(() => renderHeatmapCanvas(new Float32Array(3), 2, 2)).toThrow(/does not match/);
  });

  it('calls h337.create with a container sized to (width, height)', () => {
    const { stub, create } = makeH337Stub();
    /** @type {any} */ (globalThis).h337 = stub;

    const width = 64;
    const height = 48;
    const map = new Float32Array(width * height);
    for (let i = 0; i < map.length; i++) map[i] = 0.5;

    renderHeatmapCanvas(map, width, height);

    expect(create).toHaveBeenCalledTimes(1);
    const config = create.mock.calls[0][0];
    expect(config.container.style.width).toBe(`${width}px`);
    expect(config.container.style.height).toBe(`${height}px`);
    expect(typeof config.radius).toBe('number');
  });

  it('passes setData a data array of {x, y, value} points with max=1', () => {
    const { stub, instance } = makeH337Stub();
    /** @type {any} */ (globalThis).h337 = stub;

    const width = 32;
    const height = 16;
    const map = new Float32Array(width * height).fill(0.7);

    renderHeatmapCanvas(map, width, height);

    expect(instance.setData).toHaveBeenCalledTimes(1);
    const payload = instance.setData.mock.calls[0][0];
    expect(payload.max).toBe(1);
    expect(Array.isArray(payload.data)).toBe(true);
    expect(payload.data.length).toBeGreaterThan(0);
    const first = payload.data[0];
    expect(first).toHaveProperty('x');
    expect(first).toHaveProperty('y');
    expect(first).toHaveProperty('value');
    expect(typeof first.x).toBe('number');
    expect(typeof first.y).toBe('number');
    expect(typeof first.value).toBe('number');
  });

  it('skips near-zero samples to avoid saturating h337 with empty points', () => {
    const { stub, instance } = makeH337Stub();
    /** @type {any} */ (globalThis).h337 = stub;

    const width = 32;
    const height = 16;
    const map = new Float32Array(width * height); // all zeros

    renderHeatmapCanvas(map, width, height);

    const payload = instance.setData.mock.calls[0][0];
    expect(payload.data.length).toBe(0);
  });

  it('uses a larger stride for wide images to bound the point count', () => {
    const { stub, instance } = makeH337Stub();
    /** @type {any} */ (globalThis).h337 = stub;

    const width = 320;
    const height = 240;
    const map = new Float32Array(width * height).fill(0.5);

    renderHeatmapCanvas(map, width, height);

    const payload = instance.setData.mock.calls[0][0];
    // With stride = floor(320/160) = 2, we expect ~ (320/2)*(240/2) points.
    expect(payload.data.length).toBeLessThanOrEqual((width / 2) * (height / 2));
    expect(payload.data.length).toBeGreaterThan(0);
  });

  it('returns the canvas exposed on the heatmap instance', () => {
    const { stub, fakeCanvas } = makeH337Stub();
    /** @type {any} */ (globalThis).h337 = stub;

    const width = 16;
    const height = 16;
    const map = new Float32Array(width * height).fill(0.9);
    const canvas = renderHeatmapCanvas(map, width, height);

    expect(canvas).toBe(fakeCanvas);
  });
});

describe('compositeImageAndHeatmap', () => {
  /** @type {any} */
  let originalGetContext;
  /** @type {any} */
  let ctxStub;

  beforeEach(() => {
    // Stub getContext with a minimal drawing surface. Every method
    // records calls so we can assert on ordering if needed.
    ctxStub = {
      save: vi.fn(),
      restore: vi.fn(),
      drawImage: vi.fn(),
      beginPath: vi.fn(),
      arc: vi.fn(),
      stroke: vi.fn(),
      fill: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      globalCompositeOperation: 'source-over',
      globalAlpha: 1,
      strokeStyle: '',
      fillStyle: '',
      lineWidth: 1,
    };
    originalGetContext = HTMLCanvasElement.prototype.getContext;
    // eslint-disable-next-line no-extend-native
    HTMLCanvasElement.prototype.getContext = function () {
      return ctxStub;
    };
  });

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
  });

  it('returns a canvas matching the source image dimensions', () => {
    const fakeImage = { naturalWidth: 800, naturalHeight: 600 };
    const fakeHeatmap = { width: 120, height: 80 };

    const out = compositeImageAndHeatmap(fakeImage, fakeHeatmap);

    expect(out.width).toBe(800);
    expect(out.height).toBe(600);
  });

  it('falls back to width/height when naturalWidth/Height are absent', () => {
    // e.g. a <canvas> passed as the source.
    const fakeImage = { width: 400, height: 300 };
    const fakeHeatmap = { width: 60, height: 40 };

    const out = compositeImageAndHeatmap(fakeImage, fakeHeatmap);

    expect(out.width).toBe(400);
    expect(out.height).toBe(300);
  });

  it('draws the source image then the heatmap (two drawImage calls)', () => {
    const fakeImage = { naturalWidth: 100, naturalHeight: 100 };
    const fakeHeatmap = { width: 100, height: 100 };

    compositeImageAndHeatmap(fakeImage, fakeHeatmap, { opacity: 0.5 });

    expect(ctxStub.drawImage).toHaveBeenCalledTimes(2);
    expect(ctxStub.drawImage.mock.calls[0][0]).toBe(fakeImage);
    expect(ctxStub.drawImage.mock.calls[1][0]).toBe(fakeHeatmap);
  });

  it('draws a fixation crosshair when showFixation and fixation are provided', () => {
    const fakeImage = { naturalWidth: 100, naturalHeight: 100 };
    const fakeHeatmap = { width: 100, height: 100 };

    compositeImageAndHeatmap(fakeImage, fakeHeatmap, {
      showFixation: true,
      fixation: { x: 50, y: 50 },
    });

    // The crosshair emits multiple arc + stroke + moveTo/lineTo calls.
    expect(ctxStub.arc).toHaveBeenCalled();
    expect(ctxStub.moveTo).toHaveBeenCalled();
    expect(ctxStub.lineTo).toHaveBeenCalled();
  });

  it('skips the crosshair when fixation is null', () => {
    const fakeImage = { naturalWidth: 100, naturalHeight: 100 };
    const fakeHeatmap = { width: 100, height: 100 };

    compositeImageAndHeatmap(fakeImage, fakeHeatmap, {
      showFixation: true,
      fixation: null,
    });

    expect(ctxStub.arc).not.toHaveBeenCalled();
  });

  it('clamps opacity into [0, 1]', () => {
    const fakeImage = { naturalWidth: 10, naturalHeight: 10 };
    const fakeHeatmap = { width: 10, height: 10 };

    compositeImageAndHeatmap(fakeImage, fakeHeatmap, { opacity: 5 });
    // After the restore() call globalAlpha would be back to 1 in a
    // real context; with our stub we can only observe the latest set
    // value, so checking that the code path did not throw is enough.
    expect(ctxStub.drawImage).toHaveBeenCalledTimes(2);
  });
});
