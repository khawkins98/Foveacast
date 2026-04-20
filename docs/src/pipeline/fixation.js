// Fixation point estimation.
//
// Two exports:
//
//   firstFixationCentroid — the saliency-weighted centroid of the top
//   N% brightest pixels. Used for the main crosshair displayed after
//   every inference run.
//
//   topNFixations — an Inhibition of Return (IoR) sequence that finds
//   up to N fixation points by iteratively locating peaks and applying
//   Gaussian suppression to "return" attention to other regions. Used
//   for the numbered fixation-sequence overlay.
//
// Why saliency-*weighted* centroid (firstFixationCentroid) rather than
// a plain uniform centroid over the top-N% mask? Within a bright blob,
// values near the peak are much brighter than values near the 10%
// quantile edge. Uniform weighting is noticeably pulled toward blob
// edges; value-weighted centroid sits closer to the perceptual centre of
// mass, which is what a viewer's first fixation is modelling. It is also
// more stable under small shifts in the threshold.

/**
 * Compute the first-fixation centroid as the saliency-weighted centroid
 * of the top `topFraction` brightest pixels.
 *
 * @param {Float32Array} normalisedMap - Values in `[0, 1]`, row-major,
 *   length `width * height`. (Output of `postprocess(...)`.)
 * @param {number} width - Map width in pixels.
 * @param {number} height - Map height in pixels.
 * @param {number} [topFraction=0.10] - Fraction of brightest pixels to
 *   include. Clamped into `[0, 1]`.
 * @returns {{ x: number, y: number }} Integer pixel coordinates.
 */
export function firstFixationCentroid(normalisedMap, width, height, topFraction = 0.10) {
  const total = width * height;
  if (total === 0) {
    return { x: 0, y: 0 };
  }

  // Clamp fraction into a usable range.
  let frac = topFraction;
  if (!(frac > 0)) frac = 0;
  if (frac > 1) frac = 1;

  // Determine the saliency threshold that separates the top `frac` of
  // pixels. We could `Array.from(...).sort()` but that allocates and
  // sorts the full map; for a typical 1920x1080 screenshot that's >2M
  // entries. Instead, copy into a typed array and sort descending, which
  // is still O(n log n) but keeps the values in a TypedArray the whole
  // way. (We accept the sort cost because post-processing runs once per
  // image, off the render path.)
  const sorted = new Float32Array(normalisedMap);
  // TypedArrays sort ascending; to get a descending threshold, find the
  // cutoff index counting from the top.
  sorted.sort();
  const cutoffIndex = Math.max(0, Math.min(total - 1, total - Math.ceil(total * frac)));
  const threshold = sorted[cutoffIndex];

  let sumW = 0;
  let sumX = 0;
  let sumY = 0;
  // Pixels meeting the threshold contribute `value * position`; this is
  // the centre-of-mass formula with saliency as the mass density.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = normalisedMap[y * width + x];
      if (v >= threshold) {
        sumW += v;
        sumX += v * x;
        sumY += v * y;
      }
    }
  }

  if (sumW <= 0) {
    // Degenerate input (all zeros, or topFraction=0). Return image centre
    // as a harmless default - better than NaN reaching the UI layer.
    return {
      x: Math.floor(width / 2),
      y: Math.floor(height / 2),
    };
  }

  // Round to integer pixel coordinates. A crosshair overlay doesn't care
  // about sub-pixel precision and integers are easier for screen-reader
  // descriptions ("centred near 1420, 530").
  return {
    x: Math.round(sumX / sumW),
    y: Math.round(sumY / sumW),
  };
}

/**
 * Compute up to `n` successive fixation points using the Inhibition of
 * Return (IoR) heuristic.
 *
 * Starting from a mutable copy of the normalised saliency map, we:
 *   1. Find the first fixation via the weighted-centroid algorithm so it
 *      is consistent with the primary `firstFixationCentroid` crosshair.
 *   2. Apply separable Gaussian suppression centred on that fixation so
 *      the model "returns" to other regions.
 *   3. Find the next peak via a fast linear scan (O(n), no sort).
 *   4. Repeat until n fixations are found, the remaining map signal
 *      drops below 5 % of the original peak, or successive fixations
 *      land too close together.
 *
 * WHY weighted centroid only for the first fixation: the centroid
 * requires a sort (O(n log n)), which is acceptable once but costly
 * repeated N times. For fixations 2-N, the signal has been redistributed
 * by suppression and a direct peak scan is a good approximation.
 *
 * WHY separable Gaussian: decomposing the 2-D Gaussian into 1-D row and
 * column factors reduces Math.exp calls from W×H to W+H per fixation
 * (~3 000 vs ~2 M for a 1920 × 1080 image).
 *
 * IMPORTANT: these are predicted population-average fixations under
 * free-viewing, not a recording of any individual's actual scanpath.
 *
 * @param {Float32Array} normalisedMap - Values in [0, 1], row-major,
 *   length `width * height`. (Output of `postprocess(…)`.)
 * @param {number} width
 * @param {number} height
 * @param {number} [n=5] - Maximum number of fixations to return.
 * @param {number} [topFraction=0.10] - Passed to `firstFixationCentroid`
 *   for the first-fixation estimate.
 * @returns {Array<{x: number, y: number}>} Ordered sequence, length ≤ n.
 */
export function topNFixations(normalisedMap, width, height, n = 5, topFraction = 0.10) {
  if (n <= 0 || normalisedMap.length === 0) return [];

  const map = new Float32Array(normalisedMap); // mutable copy

  // Suppression radius based on the shorter edge so it stays proportional
  // on non-square images. Dividing by 8 gives ≈ 12.5 % of the shorter
  // edge — calibrated to match typical saccade extents in free-viewing
  // eye-tracking studies.
  const suppressionSigma = Math.min(width, height) / 8;
  const twoSigSq = 2 * suppressionSigma * suppressionSigma;

  // Pre-allocate 1-D factor arrays for separable Gaussian suppression.
  const expX = new Float32Array(width);
  const expY = new Float32Array(height);

  // Find the original peak for the relative stop condition.
  let origPeak = 0;
  for (let i = 0; i < map.length; i++) {
    if (map[i] > origPeak) origPeak = map[i];
  }

  // All-zero map — return the image centre as a single harmless fixation.
  if (origPeak <= 0) {
    return [{ x: Math.floor(width / 2), y: Math.floor(height / 2) }];
  }

  const fixations = [];

  for (let iter = 0; iter < n; iter++) {
    let fx, fy;

    if (iter === 0) {
      // First fixation: weighted centroid (matches the crosshair display).
      const c = firstFixationCentroid(map, width, height, topFraction);
      fx = c.x;
      fy = c.y;
    } else {
      // Subsequent fixations: fast linear peak scan.
      let maxVal = -Infinity;
      let maxIdx = 0;
      for (let i = 0; i < map.length; i++) {
        if (map[i] > maxVal) {
          maxVal = map[i];
          maxIdx = i;
        }
      }
      // Stop when remaining signal is below 5 % of the original peak.
      if (maxVal < origPeak * 0.05) break;
      fx = maxIdx % width;
      fy = Math.floor(maxIdx / width);
    }

    // Reject fixations that land within half a sigma of an existing one.
    // why: prevents multiple fixations clustering on the same blob when
    // suppression hasn't fully erased it yet.
    const minSep = suppressionSigma * 0.5;
    const tooClose = fixations.some((prev) => {
      const dx = prev.x - fx;
      const dy = prev.y - fy;
      return Math.sqrt(dx * dx + dy * dy) < minSep;
    });
    if (tooClose) break;

    fixations.push({ x: fx, y: fy });

    // Separable Gaussian IoR suppression: pre-compute 1-D factors then
    // combine. Each pixel is multiplied by (1 - expX[x] * expY[y]) so
    // the region around the current fixation loses signal.
    for (let x = 0; x < width; x++) {
      const dx = x - fx;
      expX[x] = Math.exp(-(dx * dx) / twoSigSq);
    }
    for (let y = 0; y < height; y++) {
      const dy = y - fy;
      expY[y] = Math.exp(-(dy * dy) / twoSigSq);
    }
    for (let y = 0; y < height; y++) {
      const rowOff = y * width;
      const ey = expY[y];
      for (let x = 0; x < width; x++) {
        map[rowOff + x] *= 1 - expX[x] * ey;
      }
    }
  }

  return fixations;
}
