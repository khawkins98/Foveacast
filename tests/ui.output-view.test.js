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

  it('prefixes the result with durationLabel when provided', () => {
    const result = describeHeatmap({ x: 10, y: 20 }, [600, 800], 'Quick scan (3 s)');
    expect(result).toMatch(/^Quick scan \(3 s\) — /);
  });

  it('includes durationLabel in the fallback string when fixation or dims are null', () => {
    const result = describeHeatmap(null, null, 'First glance (1 s)');
    expect(result).toMatch(/^First glance \(1 s\) — /);
  });

  it('omits prefix when durationLabel is absent (backward compat)', () => {
    const result = describeHeatmap({ x: 10, y: 20 }, [600, 800]);
    expect(result).not.toMatch(/^ — /);
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
  /** @type {HTMLElement} */
  let diagEl;

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
      // setLineDash needed by fixation-sequence and trajectory draw functions.
      setLineDash: vi.fn(),
      // canvas back-reference needed for proportional marker sizing.
      canvas: { width: 200, height: 100 },
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

    // Build a minimal DOM structure mirroring what main.js creates at boot.
    document.body.innerHTML = `
      <div id="container">
        <section id="sec" hidden></section>
        <div id="wrap" hidden></div>
        <p id="cap" hidden></p>
        <details id="diag" hidden><summary>Diagnostics</summary></details>
      </div>`;
    outputSection = document.getElementById('sec');
    outputCanvasWrap = document.getElementById('wrap');
    outputCaption = document.getElementById('cap');
    diagEl = document.getElementById('diag');
  });

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    document.body.innerHTML = '';
  });

  const domNodes = () => ({ outputSection, outputCanvasWrap, outputCaption, diagEl });

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

  it('includes duration label in caption when provided', () => {
    renderOutput(
      { image: fakeImage, heatmapCanvas: fakeHeatmap, view: 'overlay', opacity: 0.6,
        fixation: fakeFixation, origDims: [100, 200],
        duration: 'Quick scan (3 s)', diagnostics: null },
      domNodes(),
    );
    expect(outputCaption.textContent).toMatch(/^Quick scan \(3 s\) — /);
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

  it('shows diagEl and populates it when diagnostics are provided', () => {
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
    expect(diagEl.hidden).toBe(false);
    expect(diagEl.textContent).toContain('800 × 600');
  });

  it('hides diagEl when diagnostics is null', () => {
    renderOutput(
      { image: fakeImage, heatmapCanvas: fakeHeatmap, view: 'overlay', opacity: 0.6,
        fixation: null, origDims: null, diagnostics: null },
      domNodes(),
    );
    expect(diagEl.hidden).toBe(true);
  });

  it('hides diagEl on a subsequent render after a render with diagnostics', () => {
    const fakeDiagnostics = {
      sourceWidth: 800, sourceHeight: 600, modelInputDims: [240, 320],
      saliencyLength: 76800, saliencyMin: '0', saliencyMax: '1', saliencyMean: '0.5',
      peakLocation: '(0, 0)',
    };
    renderOutput(
      { image: fakeImage, heatmapCanvas: fakeHeatmap, view: 'overlay', opacity: 0.6,
        fixation: null, origDims: null, diagnostics: fakeDiagnostics },
      domNodes(),
    );
    expect(diagEl.hidden).toBe(false);

    // Second render without diagnostics — panel must go back to hidden.
    renderOutput(
      { image: fakeImage, heatmapCanvas: fakeHeatmap, view: 'overlay', opacity: 0.6,
        fixation: null, origDims: null, diagnostics: null },
      domNodes(),
    );
    expect(diagEl.hidden).toBe(true);
  });

  it('uses the passed diagEl rather than querying the document by id', () => {
    // Rename the element's id so getElementById would return null; the
    // function must still work using the passed reference.
    diagEl.id = 'fc-diagnostics-renamed';
    const fakeDiagnostics = {
      sourceWidth: 100, sourceHeight: 100, modelInputDims: [128, 128],
      saliencyLength: 1024, saliencyMin: '0', saliencyMax: '1', saliencyMean: '0.5',
      peakLocation: '(0, 0)',
    };
    renderOutput(
      { image: fakeImage, heatmapCanvas: fakeHeatmap, view: 'overlay', opacity: 0.6,
        fixation: null, origDims: null, diagnostics: fakeDiagnostics },
      domNodes(),
    );
    expect(diagEl.hidden).toBe(false);
    expect(diagEl.textContent).toContain('100 × 100');
    // No stray element was created under the original id.
    expect(document.getElementById('fc-diagnostics')).toBeNull();
  });

  it('creates #fc-canvas-tooltip in body when fixationSequence overlay is rendered', () => {
    renderOutput(
      {
        image: fakeImage, heatmapCanvas: fakeHeatmap, view: 'overlay', opacity: 0.6,
        fixation: fakeFixation, origDims: [100, 200], diagnostics: null,
        fixationSequence: [{ x: 50, y: 25 }, { x: 80, y: 60 }],
        overlays: { fixationSequence: true, attentionZones: false, centroidTrajectory: false },
      },
      domNodes(),
    );
    expect(document.getElementById('fc-canvas-tooltip')).not.toBeNull();
  });

  it('does not create #fc-canvas-tooltip when no overlay markers are present', () => {
    renderOutput(
      { image: fakeImage, heatmapCanvas: fakeHeatmap, view: 'overlay', opacity: 0.6,
        fixation: null, origDims: null, diagnostics: null },
      domNodes(),
    );
    expect(document.getElementById('fc-canvas-tooltip')).toBeNull();
  });
});
