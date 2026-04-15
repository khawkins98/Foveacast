// First-fixation centroid estimation.
//
// The PRD (§Post-processing pipeline, §Output) asks for a marked "first
// fixation" point — the spot a viewer is predicted to look at first. We
// approximate this as the centroid of the top N% of the normalised
// saliency map (default 10%, per PRD).
//
// Why saliency-*weighted* centroid rather than a plain uniform centroid
// over the top-N% mask? Because within a bright blob, values near the
// peak are much brighter than values near the 10%-quantile edge. Uniform
// weighting treats the dimmest included pixel the same as the peak and
// is noticeably pulled toward blob edges; value-weighted centroid sits
// closer to the perceptual centre of mass of the brightness, which is
// what a viewer's first fixation is modelling. It is also more stable
// under small shifts in the threshold (adding a few near-threshold
// pixels barely moves the weighted result).

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
