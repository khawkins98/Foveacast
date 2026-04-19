/**
 * pipeline/metrics.js
 *
 * Derives human-readable quality metrics from a postprocessed saliency
 * map. These are computed after postprocess() has already upsample-,
 * Gaussian-blurred, and normalised the model output, so they reflect
 * what the rendered heatmap actually shows rather than raw model output.
 *
 * Pure JS: no DOM, no browser APIs, no imports. Suitable for use in
 * both the browser and vitest (jsdom / node).
 */

/**
 * @typedef {'Low' | 'Medium' | 'High'} SpreadLevel
 */

/**
 * @typedef {Object} SaliencyMetrics
 * @property {number} concentration - Fraction [0–100] of total saliency
 *   mass held by the top 10 % of pixels. High → attention is focused on
 *   a small area; low → attention is distributed across the image.
 * @property {SpreadLevel} spreadLevel - Categorical label derived from
 *   `concentration`: ≥ 55 → "Low" spread (focused), 35–54 → "Medium",
 *   < 35 → "High" spread (diffuse).
 */

/**
 * Compute attention-distribution metrics from a flat, normalised
 * saliency array.
 *
 * @param {Float32Array | number[]} saliency - Flat saliency values, each
 *   in [0, 1]. Must be the postprocessed output (normalised), not raw
 *   model logits or log-probabilities.
 * @returns {SaliencyMetrics}
 */
export function computeSaliencyMetrics(saliency) {
  const n = saliency.length;

  // Edge case: empty or all-zero map has no meaningful metrics.
  if (n === 0) return { concentration: 0, spreadLevel: 'High' };

  // Sum total mass and collect values for sorting.
  let totalMass = 0;
  const values = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    values[i] = saliency[i];
    totalMass += saliency[i];
  }

  if (totalMass === 0) return { concentration: 0, spreadLevel: 'High' };

  // Sort descending to find the cumulative mass curve.
  values.sort((a, b) => b - a);

  // Count how many pixels make up the top 10 % of the image.
  const topK = Math.max(1, Math.ceil(n * 0.1));

  let topMass = 0;
  for (let i = 0; i < topK; i++) {
    topMass += values[i];
  }

  // Concentration: what % of total attention sits in the top 10 % of
  // pixels? A perfectly uniform map scores 10; a single-spike map
  // scores 100. Typical photographic stimuli land around 35–65.
  const concentration = Math.round((topMass / totalMass) * 100);

  // Map to a qualitative label that is meaningful to UX practitioners:
  //   ≥ 55 → "Low" spread  (attention clustered, easy to follow)
  //   35–54 → "Medium"     (some clear focal regions with diffusion)
  //   < 35 → "High" spread (attention scattered, competing elements)
  let spreadLevel;
  if (concentration >= 55) {
    spreadLevel = 'Low';
  } else if (concentration >= 35) {
    spreadLevel = 'Medium';
  } else {
    spreadLevel = 'High';
  }

  return { concentration, spreadLevel };
}
