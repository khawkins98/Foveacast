/**
 * ui/output-view.js
 *
 * Renders the output area (canvas wrap + caption + diagnostics panel)
 * after a successful inference run, or after the opacity or view mode
 * changes. Knows nothing about the inference pipeline; it receives a
 * plain view-model object and DOM node references.
 *
 * Exports:
 *   renderOutput(viewModel, domNodes) → HTMLCanvasElement | null
 *   describeHeatmap(fixation, origDims) → string   (also used for aria-label)
 */

import { drawPlainImageCanvas } from '../render/plain-canvas.js';
import { compositeImageAndHeatmap } from '../render/saliency-canvas.js';

/**
 * @typedef {{
 *   image: HTMLImageElement | ImageBitmap | HTMLCanvasElement,
 *   heatmapCanvas: HTMLCanvasElement,
 *   view: 'overlay' | 'original' | 'sidebyside',
 *   opacity: number,
 *   blendMode?: string,
 *   fixation: { x: number, y: number } | null,
 *   origDims: [number, number] | null,
 *   duration?: string,
 *   diagnostics: {
 *     sourceWidth: number,
 *     sourceHeight: number,
 *     modelInputDims: [number, number],
 *     saliencyLength: number,
 *     saliencyMin: string,
 *     saliencyMax: string,
 *     saliencyMean: string,
 *     peakLocation: string,
 *   } | null,
 * }} OutputViewModel
 */

/**
 * @typedef {{
 *   outputSection: HTMLElement,
 *   outputCanvasWrap: HTMLElement,
 *   outputCaption: HTMLElement,
 * }} OutputDomNodes
 */

/**
 * Render the canvas output and update the caption and diagnostics panel.
 * Reveals the output section if it was hidden.
 *
 * @param {OutputViewModel} viewModel
 * @param {OutputDomNodes} domNodes
 * @returns {HTMLCanvasElement | null} The composite canvas, or null when
 *   view is 'original' (no composite is produced in that mode).
 */
export function renderOutput(viewModel, { outputSection, outputCanvasWrap, outputCaption }) {
  const { image, heatmapCanvas, view, opacity, blendMode, fixation, origDims, duration, diagnostics } = viewModel;

  // Reveal the output section — it's hidden on first load so the
  // pre-drop page isn't cluttered by a reserved empty box (same
  // progressive-disclosure principle as the controls panel).
  outputSection.hidden = false;
  outputCanvasWrap.hidden = false;
  outputCanvasWrap.textContent = '';
  outputCanvasWrap.classList.toggle('fc-output__canvas-wrap--sidebyside', view === 'sidebyside');

  // Sighted redundancy for the first-fixation crosshair: show the
  // coordinates as plain text below the canvas. Screen readers
  // already get this via `aria-label`, but a visible caption helps
  // everyone compare runs without squinting at pixel positions.
  outputCaption.textContent = describeHeatmap(fixation, origDims, duration);
  outputCaption.hidden = false;

  // Diagnostic panel — collapsible details below the caption showing
  // what the pipeline actually did. Only rendered when diagnostics are
  // available; no empty container is left in the DOM otherwise.
  if (diagnostics) {
    const d = diagnostics;
    let diagEl = document.getElementById('fc-diagnostics');
    if (!diagEl) {
      diagEl = document.createElement('details');
      diagEl.id = 'fc-diagnostics';
      diagEl.style.cssText = 'margin:0.5rem 0; font-size:0.75rem; color:#666; max-width:600px;';
      const summary = document.createElement('summary');
      summary.textContent = 'Diagnostics';
      summary.style.cursor = 'pointer';
      diagEl.appendChild(summary);
      outputCaption.parentNode.insertBefore(diagEl, outputCaption.nextSibling);
    }
    const lines = [
      `Source image: ${d.sourceWidth} × ${d.sourceHeight} px`,
      `Model input: ${d.modelInputDims[0]} × ${d.modelInputDims[1]} (NCHW, RGB, 0–255)`,
      `Model: MSI-Net fine-tuned on UEyes (v0.1.0, FP16)`,
      `Saliency output: ${d.saliencyLength} values, range [${d.saliencyMin}, ${d.saliencyMax}], mean ${d.saliencyMean}`,
      `Peak attention at: ${d.peakLocation} in model space`,
      `Preprocessing: aspect-preserving bilinear resize + pad 126`,
      `Postprocess: upsample to source dims → σ=5 Gaussian blur → normalise`,
    ];
    // Keep the <summary>, replace everything after it.
    while (diagEl.childNodes.length > 1) diagEl.removeChild(diagEl.lastChild);
    const pre = document.createElement('pre');
    pre.style.cssText =
      'margin:0.3rem 0; white-space:pre-wrap; font-family:monospace; font-size:0.7rem; line-height:1.5;';
    pre.textContent = lines.join('\n');
    diagEl.appendChild(pre);
  }

  if (view === 'original') {
    const plain = drawPlainImageCanvas(image);
    plain.setAttribute('aria-label', 'Original screenshot, without heatmap overlay.');
    outputCanvasWrap.appendChild(plain);
    return null;
  }

  if (view === 'sidebyside') {
    const plain = drawPlainImageCanvas(image);
    plain.setAttribute('aria-label', 'Original screenshot.');
    const composite = compositeImageAndHeatmap(image, heatmapCanvas, {
      opacity,
      blendMode,
      showFixation: true,
      fixation,
    });
    composite.setAttribute('aria-label', describeHeatmap(fixation, origDims, duration));
    outputCanvasWrap.appendChild(plain);
    outputCanvasWrap.appendChild(composite);
    return composite;
  }

  // Default overlay view.
  const composite = compositeImageAndHeatmap(image, heatmapCanvas, {
    opacity,
    blendMode,
    showFixation: true,
    fixation,
  });
  composite.setAttribute('aria-label', describeHeatmap(fixation, origDims, duration));
  outputCanvasWrap.appendChild(composite);
  return composite;
}

/**
 * Human-readable sentence describing the heatmap for screen reader
 * announcements and the visible caption. The fixation coordinates are
 * included as integers so the announcement is concrete and not just
 * "a heatmap". An optional duration label prefixes the description so
 * the user always knows which viewing window is displayed.
 *
 * @param {{ x: number, y: number } | null} fixation
 * @param {[number, number] | null} origDims - `[h, w]` from the pipeline.
 * @param {string} [durationLabel] - Human label e.g. "Quick scan (3 s)".
 * @returns {string}
 */
export function describeHeatmap(fixation, origDims, durationLabel) {
  const prefix = durationLabel ? `${durationLabel} — ` : '';
  if (!fixation || !origDims) {
    return `${prefix}Predicted attention heatmap for uploaded screenshot.`;
  }
  const [h, w] = origDims;
  return (
    `${prefix}Predicted attention heatmap for uploaded screenshot. ` +
    `First-fixation estimate is at ${fixation.x} pixels across and ${fixation.y} pixels down ` +
    `on a ${w} by ${h} pixel image.`
  );
}
