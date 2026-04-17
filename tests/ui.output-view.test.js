// Tests for ui/output-view.js — describeHeatmap and renderOutput.
//
// describeHeatmap is a pure function; no DOM setup needed.
//
// renderOutput builds and appends DOM nodes, so each test gets a
// fresh container with an output section, canvas wrap, and caption
// element. getContext is stubbed so drawPlainImageCanvas and
// compositeImageAndHeatmap don't crash under jsdom.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { describeHeatmap, renderOutput } from '../docs/src/ui/output-view.js';

// ---------------------------------------------------------------------------
// describeHeatmap
// ---------------------------------------------------------------------------

describe('describeHeatmap', () => {
  it('returns a fallback string when fixation is null', () => {
    const result = describeHeatmap(null, [600, 800]);
    expect(result).toBe('Predicted attention heatmap for uploaded screenshot.');
  });

  it('returns a fallback string when origDims is null', () => {
    const result = describeHeatmap({ x: 100, y: 200 }, null);
    expect(result).toBe('Predicted attention heatmap for uploaded screenshot.');
  });

  it('includes fixation.x as "pixels across"', () => {
    const result = describeHeatmap({ x: 123, y: 456 }, [600, 800]);
    expect(result).toContain('123 pixels across');
  });

  it('includes fixation.y as "pixels down"', () => {
    const result = describeHeatmap({ x: 123, y: 456 }, [600, 800]);
    expect(result).toContain('456 pixels down');
  });

  it('describes the image as "width by height" using origDims [h, w]', () => {
    // origDims is [h, w] per the pipeline convention.
    const result = describeHeatmap({ x: 10, y: 20 }, [600, 800]);
    expect(result).toContain('800 by 600');
  });
});

// ---------------------------------------------------------------------------
// renderOutput — DOM behaviour
// ---------------------------------------------------------------------------

describe('renderOutput', () => {
  /** @type {any} */
  let ctxStub;
  /** @type {any} */
  let originalGetContext;
  /** @type {HTMLElement} */
  let outputSection;
  /** @type {HTMLElement} */
  let outputCanvasWrap;
  /** @type {HTMLElement} */
  let outputCaption;

  const fakeImage = { naturalWidth: 200, naturalHeight: 100 };
  const fakeHeatmap = { width: 200, height: 100 };
  const fakeFixation = { x: 50, y: 25 };

  beforeEach(() => {
    ctxStub = {
      drawImage: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      arc: vi.fn(),
      stroke: vi.fn(),
      fill: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      strokeText: vi.fn(),
      fillText: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
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
    HTMLCanvasElement.prototype.getContext = () => ctxStub;

    // Build a minimal DOM structure. outputCaption needs a parentNode so
    // the diagnostics <details> insertBefore call has somewhere to go.
    document.body.innerHTML = `
      <div id="container">
        <section id="sec" hidden></section>
        <div id="wrap" hidden></div>
        <p id="cap" hidden></p>
      </div>`;
    outputSection = document.getElementById('sec');
    outputCanvasWrap = document.getElementById('wrap');
    outputCaption = document.getElementById('cap');
  });

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    document.body.innerHTML = '';
  });

  const domNodes = () => ({ outputSection, outputCanvasWrap, outputCaption });

  it('reveals outputSection and outputCanvasWrap', () => {
    renderOutput(
      { image: fakeImage, heatmapCanvas: fakeHeatmap, view: 'overlay', opacity: 0.6,
        fixation: fakeFixation, origDims: [100, 200], diagnostics: null },
      domNodes(),
    );
    expect(outputSection.hidden).toBe(false);
    expect(outputCanvasWrap.hidden).toBe(false);
  });

  it('sets the caption text via describeHeatmap', () => {
    renderOutput(
      { image: fakeImage, heatmapCanvas: fakeHeatmap, view: 'overlay', opacity: 0.6,
        fixation: fakeFixation, origDims: [100, 200], diagnostics: null },
      domNodes(),
    );
    expect(outputCaption.textContent).toContain('50 pixels across');
  });

  it('overlay view — appends one canvas and returns it', () => {
    const result = renderOutput(
      { image: fakeImage, heatmapCanvas: fakeHeatmap, view: 'overlay', opacity: 0.6,
        fixation: null, origDims: null, diagnostics: null },
      domNodes(),
    );
    expect(outputCanvasWrap.querySelectorAll('canvas').length).toBe(1);
    expect(result).toBeInstanceOf(HTMLCanvasElement);
  });

  it('original view — appends one canvas and returns null', () => {
    const result = renderOutput(
      { image: fakeImage, heatmapCanvas: fakeHeatmap, view: 'original', opacity: 0.6,
        fixation: null, origDims: null, diagnostics: null },
      domNodes(),
    );
    expect(outputCanvasWrap.querySelectorAll('canvas').length).toBe(1);
    expect(result).toBeNull();
  });

  it('sidebyside view — appends two canvases (plain first, composite second)', () => {
    const result = renderOutput(
      { image: fakeImage, heatmapCanvas: fakeHeatmap, view: 'sidebyside', opacity: 0.6,
        fixation: fakeFixation, origDims: [100, 200], diagnostics: null },
      domNodes(),
    );
    const canvases = outputCanvasWrap.querySelectorAll('canvas');
    expect(canvases.length).toBe(2);
    // The returned canvas should be the composite (second one).
    expect(result).toBe(canvases[1]);
  });

  it('applies sidebyside CSS class only for sidebyside view', () => {
    renderOutput(
      { image: fakeImage, heatmapCanvas: fakeHeatmap, view: 'sidebyside', opacity: 0.6,
        fixation: null, origDims: null, diagnostics: null },
      domNodes(),
    );
    expect(outputCanvasWrap.classList.contains('fc-output__canvas-wrap--sidebyside')).toBe(true);

    // Re-render in overlay — class should be removed.
    renderOutput(
      { image: fakeImage, heatmapCanvas: fakeHeatmap, view: 'overlay', opacity: 0.6,
        fixation: null, origDims: null, diagnostics: null },
      domNodes(),
    );
    expect(outputCanvasWrap.classList.contains('fc-output__canvas-wrap--sidebyside')).toBe(false);
  });

  it('creates a diagnostics <details> element when diagnostics are provided', () => {
    renderOutput(
      {
        image: fakeImage, heatmapCanvas: fakeHeatmap, view: 'overlay', opacity: 0.6,
        fixation: null, origDims: null,
        diagnostics: {
          sourceWidth: 800, sourceHeight: 600,
          modelInputDims: [240, 320],
          saliencyLength: 76800,
          saliencyMin: '-1.23', saliencyMax: '0.45', saliencyMean: '-0.3',
          peakLocation: '(120, 80)',
        },
      },
      domNodes(),
    );
    const diagEl = document.getElementById('fc-diagnostics');
    expect(diagEl).not.toBeNull();
    expect(diagEl.tagName.toLowerCase()).toBe('details');
    expect(diagEl.textContent).toContain('800 × 600');
  });

  it('does not create a diagnostics element when diagnostics is null', () => {
    renderOutput(
      { image: fakeImage, heatmapCanvas: fakeHeatmap, view: 'overlay', opacity: 0.6,
        fixation: null, origDims: null, diagnostics: null },
      domNodes(),
    );
    expect(document.getElementById('fc-diagnostics')).toBeNull();
  });
});
