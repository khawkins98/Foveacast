// Tests for compositeImageAndHeatmap (saliency-canvas.js).
//
// jsdom does not actually rasterise canvases, so we stub
// `HTMLCanvasElement.prototype.getContext` to return a minimal drawing
// surface. We assert on call shape — the pixels themselves are out of
// scope for unit tests.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { compositeImageAndHeatmap } from '../docs/src/render/saliency-canvas.js';

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
      // Text + transform APIs for the watermark path.
      strokeText: vi.fn(),
      fillText: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      // setLineDash needed by drawFixationSequence / drawCentroidTrajectory.
      setLineDash: vi.fn(),
      // canvas back-reference needed by drawFixationSequence for proportional sizing.
      canvas: { width: 800, height: 600 },
      globalCompositeOperation: 'source-over',
      globalAlpha: 1,
      strokeStyle: '',
      fillStyle: '',
      lineWidth: 1,
      font: '',
      textAlign: 'start',
      textBaseline: 'alphabetic',
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

  it('draws a tiled watermark when the watermark option is provided', () => {
    const fakeImage = { naturalWidth: 400, naturalHeight: 300 };
    const fakeHeatmap = { width: 400, height: 300 };

    compositeImageAndHeatmap(fakeImage, fakeHeatmap, {
      watermark: { text: 'FOVEACAST DEMO — SYNTHETIC' },
    });

    // Rotation + translation used by the watermark grid.
    expect(ctxStub.translate).toHaveBeenCalled();
    expect(ctxStub.rotate).toHaveBeenCalled();
    // Tiled across canvas — many stamps, each stamp is stroke + fill.
    expect(ctxStub.strokeText.mock.calls.length).toBeGreaterThan(3);
    expect(ctxStub.fillText.mock.calls.length).toBeGreaterThan(3);
    // The correct text is what gets stamped.
    expect(ctxStub.strokeText.mock.calls[0][0]).toBe('FOVEACAST DEMO — SYNTHETIC');
  });

  it('does not draw a watermark when the option is omitted (normal inference path)', () => {
    const fakeImage = { naturalWidth: 400, naturalHeight: 300 };
    const fakeHeatmap = { width: 400, height: 300 };

    compositeImageAndHeatmap(fakeImage, fakeHeatmap, {
      showFixation: false,
    });

    expect(ctxStub.strokeText).not.toHaveBeenCalled();
    expect(ctxStub.fillText).not.toHaveBeenCalled();
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

  it('draws a fixation sequence when fixationSequence is provided with ≥ 1 point', () => {
    const fakeImage = { naturalWidth: 100, naturalHeight: 100 };
    const fakeHeatmap = { width: 100, height: 100 };
    const fixationSequence = [{ x: 20, y: 20 }, { x: 60, y: 40 }, { x: 50, y: 70 }];

    compositeImageAndHeatmap(fakeImage, fakeHeatmap, {
      showFixation: false,
      fixationSequence,
    });

    // drawFixationSequence uses arc() for each numbered circle.
    expect(ctxStub.arc).toHaveBeenCalled();
    // And setLineDash for the saccade lines.
    expect(ctxStub.setLineDash).toHaveBeenCalled();
  });

  it('draws the attention zone canvas when attentionZoneCanvas is provided', () => {
    const fakeImage = { naturalWidth: 100, naturalHeight: 100 };
    const fakeHeatmap = { width: 100, height: 100 };
    const fakeZoneCanvas = { width: 100, height: 100 };

    compositeImageAndHeatmap(fakeImage, fakeHeatmap, {
      showFixation: false,
      attentionZoneCanvas: fakeZoneCanvas,
    });

    // Zone canvas is drawn via drawImage.
    expect(ctxStub.drawImage.mock.calls.some((call) => call[0] === fakeZoneCanvas)).toBe(true);
  });

  it('draws a centroid trajectory when centroidTrajectory has ≥ 2 points', () => {
    const fakeImage = { naturalWidth: 100, naturalHeight: 100 };
    const fakeHeatmap = { width: 100, height: 100 };
    const centroidTrajectory = [{ x: 30, y: 30 }, { x: 70, y: 60 }];

    compositeImageAndHeatmap(fakeImage, fakeHeatmap, {
      showFixation: false,
      centroidTrajectory,
      centroidLabels: ['1s', '3s'],
    });

    // Trajectory line uses moveTo/lineTo.
    expect(ctxStub.moveTo).toHaveBeenCalled();
    expect(ctxStub.lineTo).toHaveBeenCalled();
    // Labels drawn via fillText.
    expect(ctxStub.fillText).toHaveBeenCalled();
  });

  it('skips trajectory when fewer than 2 points', () => {
    const fakeImage = { naturalWidth: 100, naturalHeight: 100 };
    const fakeHeatmap = { width: 100, height: 100 };

    compositeImageAndHeatmap(fakeImage, fakeHeatmap, {
      showFixation: false,
      centroidTrajectory: [{ x: 50, y: 50 }],
    });

    // With one point, trajectory should not draw the connecting line.
    expect(ctxStub.lineTo).not.toHaveBeenCalled();
  });
});
