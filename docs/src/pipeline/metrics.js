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

/**
 * For each level in `levels`, find the minimum saliency value `t` such
 * that all pixels at or above `t` collectively hold `level` fraction of
 * the total saliency mass.
 *
 * Concretely: `computeZoneThresholds([0.10, 0.25, 0.50])` returns three
 * threshold values [t10, t25, t50] where:
 *   - pixels >= t10 together account for the hottest 10 % of total mass
 *   - pixels >= t25 account for the hottest 25 %
 *   - pixels >= t50 account for the hottest 50 %
 *
 * The values are returned in the same order as `levels`.
 *
 * @param {Float32Array | number[]} saliency - Normalised values in [0,1].
 * @param {number[]} [levels=[0.10, 0.25, 0.50]] - Mass fractions, each
 *   in (0, 1], smallest first (smallest = innermost zone).
 * @returns {number[]} Threshold values parallel to `levels`.
 */
export function computeZoneThresholds(saliency, levels = [0.10, 0.25, 0.50]) {
  const n = saliency.length;
  if (n === 0) return levels.map(() => 0);

  let totalMass = 0;
  const values = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    values[i] = saliency[i];
    totalMass += saliency[i];
  }

  if (totalMass === 0) return levels.map(() => 0);

  // Sort descending so we can walk hottest-to-coldest and accumulate mass.
  values.sort((a, b) => b - a);

  const thresholds = [];
  for (const level of levels) {
    const targetMass = totalMass * level;
    let cumMass = 0;
    // Fallback threshold: the coldest value (entire map is in this zone).
    let threshold = values[values.length - 1];
    for (let i = 0; i < values.length; i++) {
      cumMass += values[i];
      if (cumMass >= targetMass) {
        threshold = values[i];
        break;
      }
    }
    thresholds.push(threshold);
  }

  return thresholds;
}

/**
 * Score each cell of a 3 × 3 rule-of-thirds grid by total saliency mass.
 *
 * Cells are indexed row-major, top-left = 0, top-centre = 1, …,
 * bottom-right = 8. Each value is an integer percentage in [0, 100].
 * Values sum to exactly 100 via the largest-remainder rounding method.
 *
 * @param {Float32Array | number[]} saliency - Flat, row-major values in
 *   [0, 1], length `width * height`.
 * @param {number} width - Map width in pixels.
 * @param {number} height - Map height in pixels.
 * @returns {number[]} Nine integers summing to exactly 100.
 */
export function computeRuleOfThirds(saliency, width, height) {
  const cells = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  let totalMass = 0;

  for (let y = 0; y < height; y++) {
    const row = Math.min(2, Math.floor((y / height) * 3));
    for (let x = 0; x < width; x++) {
      const col = Math.min(2, Math.floor((x / width) * 3));
      const v = saliency[y * width + x];
      cells[row * 3 + col] += v;
      totalMass += v;
    }
  }

  if (totalMass === 0) return [0, 0, 0, 0, 0, 0, 0, 0, 0];

  // Largest-remainder rounding: floor each percentage then distribute the
  // remaining points to cells with the largest fractional parts, so the
  // total is always exactly 100 (avoiding off-by-one display artefacts).
  const rawPcts = cells.map((v) => (v / totalMass) * 100);
  const floored = rawPcts.map((v) => Math.floor(v));
  const remainder = 100 - floored.reduce((a, b) => a + b, 0);

  const withFrac = rawPcts.map((v, i) => ({ i, frac: v - floored[i] }));
  withFrac.sort((a, b) => b.frac - a.frac);
  for (let k = 0; k < remainder; k++) {
    floored[withFrac[k].i] += 1;
  }

  return floored;
}
