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
 *   attachCanvasTooltips(canvas) → void
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
 *   fixationSequence?: Array<{x: number, y: number}> | null,
 *   attentionZoneCanvas?: HTMLCanvasElement | null,
 *   centroidTrajectory?: Array<{x: number, y: number}> | null,
 *   centroidLabels?: string[] | null,
 *   overlays?: { fixationSequence: boolean, attentionZones: boolean, centroidTrajectory: boolean },
 * }} OutputViewModel
 */

/**
 * @typedef {{
 *   outputSection: HTMLElement,
 *   outputCanvasWrap: HTMLElement,
 *   outputCaption: HTMLElement,
 *   diagEl: HTMLElement,
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
export function renderOutput(viewModel, { outputSection, outputCanvasWrap, outputCaption, diagEl }) {
  const {
    image,
    heatmapCanvas,
    view,
    opacity,
    blendMode,
    fixation,
    origDims,
    duration,
    diagnostics,
    fixationSequence,
    attentionZoneCanvas,
    centroidTrajectory,
    centroidLabels,
    overlays,
  } = viewModel;

  // Build the per-composite overlay options from the overlay toggles.
  const overlayOpts = {
    fixationSequence: overlays?.fixationSequence && fixationSequence?.length ? fixationSequence : null,
    attentionZoneCanvas: overlays?.attentionZones && attentionZoneCanvas ? attentionZoneCanvas : null,
    centroidTrajectory: overlays?.centroidTrajectory && centroidTrajectory?.length >= 2 ? centroidTrajectory : null,
    centroidLabels: centroidLabels ?? null,
  };

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
  // what the pipeline actually did. The caller creates diagEl once at
  // boot and passes it here; we show/hide it every render rather than
  // relying on a lazy getElementById inside this module.
  if (diagnostics) {
    const d = diagnostics;
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
  // Always sync visibility — a render without diagnostics (e.g. view
  // change before a second inference) must hide the stale panel.
  diagEl.hidden = !diagnostics;

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
      ...overlayOpts,
    });
    composite.setAttribute('aria-label', describeHeatmap(fixation, origDims, duration, overlays));
    outputCanvasWrap.appendChild(plain);
    outputCanvasWrap.appendChild(composite);
    attachCanvasTooltips(composite);
    return composite;
  }

  // Default overlay view.
  const composite = compositeImageAndHeatmap(image, heatmapCanvas, {
    opacity,
    blendMode,
    showFixation: true,
    fixation,
    ...overlayOpts,
  });
  composite.setAttribute('aria-label', describeHeatmap(fixation, origDims, duration, overlays));
  outputCanvasWrap.appendChild(composite);
  attachCanvasTooltips(composite);
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
 * @param {{ fixationSequence?: boolean, attentionZones?: boolean, centroidTrajectory?: boolean }} [overlays]
 * @returns {string}
 */
export function describeHeatmap(fixation, origDims, durationLabel, overlays) {
  const prefix = durationLabel ? `${durationLabel} — ` : '';
  if (!fixation || !origDims) {
    return `${prefix}Predicted attention heatmap for uploaded screenshot.`;
  }
  const [h, w] = origDims;
  const activeOverlays = [];
  if (overlays?.fixationSequence) activeOverlays.push('fixation sequence');
  if (overlays?.attentionZones)   activeOverlays.push('attention zones');
  if (overlays?.centroidTrajectory) activeOverlays.push('duration trajectory');
  const overlayNote = activeOverlays.length
    ? ` Showing: ${activeOverlays.join(', ')}.`
    : '';
  return (
    `${prefix}Predicted attention heatmap for uploaded screenshot.${overlayNote} ` +
    `First-fixation estimate is at ${fixation.x} pixels across and ${fixation.y} pixels down ` +
    `on a ${w} by ${h} pixel image.`
  );
}

// ---------------------------------------------------------------------------
// Canvas hover tooltips — fixation sequence + centroid trajectory markers
// ---------------------------------------------------------------------------

/**
 * Lazily creates a single floating tooltip element on document.body that
 * follows the cursor over the composite canvas.
 *
 * The tooltip is `position: fixed` so it works regardless of scroll
 * position or the canvas element's layout context.
 *
 * @returns {HTMLElement}
 */
function getOrCreateCanvasTooltip() {
  let tip = document.getElementById('fc-canvas-tooltip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'fc-canvas-tooltip';
    tip.setAttribute('role', 'tooltip');
    tip.setAttribute('aria-live', 'polite');
    tip.className = 'fc-canvas-tooltip';
    document.body.appendChild(tip);
  }
  return tip;
}

/**
 * Attach hover tooltip handlers to a composite canvas. Handles two marker
 * sets stored by the render layer:
 *
 *   canvas._fixationMarkers   — [{x,y,r,ordinal}] from drawFixationSequence
 *   canvas._trajectoryMarkers — [{x,y,r,label}]   from drawCentroidTrajectory
 *
 * When the cursor enters a hit area a small tooltip appears near the cursor.
 * Fixation markers show "Fixation N of M — …"; trajectory dots show the
 * duration label (e.g. "First glance (1 second)").
 * Does nothing when both sets are absent.
 *
 * @param {HTMLCanvasElement} canvas
 */
export function attachCanvasTooltips(canvas) {
  const fixMarkers  = /** @type {any} */ (canvas)._fixationMarkers  || [];
  const trajMarkers = /** @type {any} */ (canvas)._trajectoryMarkers || [];
  if (fixMarkers.length === 0 && trajMarkers.length === 0) return;

  const tip   = getOrCreateCanvasTooltip();
  const total = fixMarkers.length;

  canvas.addEventListener('pointermove', (e) => {
    // Map CSS-pixel offset to canvas-pixel coordinates.
    const rect   = canvas.getBoundingClientRect();
    const scaleX = canvas.width  / rect.width;
    const scaleY = canvas.height / rect.height;
    const cx = e.offsetX * scaleX;
    const cy = e.offsetY * scaleY;

    // Fixation markers take priority (they're larger and drawn on top).
    // 50% bonus radius makes small markers easier to hover.
    /** @param {{x:number,y:number,r:number}} m */
    const inRadius = (m) => Math.hypot(cx - m.x, cy - m.y) <= m.r * 1.5;

    const hit = fixMarkers.find(inRadius) || trajMarkers.find(inRadius);

    if (hit) {
      if (hit.ordinal !== undefined) {
        // Fixation sequence marker.
        const suffix = hit.ordinal === 1 ? ' — most likely first fixation' : '';
        tip.textContent = `Fixation ${hit.ordinal} of ${total}${suffix}`;
      } else {
        // Centroid trajectory dot — show the duration label.
        tip.textContent = hit.label;
      }
      // Position 12 px right, 40 px above cursor so it doesn't obscure
      // the marker itself and stays visible near the top edge.
      tip.style.left = `${e.clientX + 12}px`;
      tip.style.top  = `${e.clientY - 40}px`;
      tip.classList.add('fc-canvas-tooltip--visible');
    } else {
      tip.classList.remove('fc-canvas-tooltip--visible');
    }
  });

  canvas.addEventListener('pointerleave', () => {
    tip.classList.remove('fc-canvas-tooltip--visible');
  });
}

/** @deprecated Use attachCanvasTooltips instead. */
export const attachFixationTooltip = attachCanvasTooltips;
