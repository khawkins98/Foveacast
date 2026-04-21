/**
 * @file docs/src/ui/voxel-logo.js
 * @description Animated voxel logo mark for the hero area.
 *
 * Renders a slowly auto-rotating isometric wireframe structure using the
 * same heerich library as the ambient sphere. The shape is a hollow oblate
 * spheroid shell — wider in x/z than in y — with a clear vacant centre.
 * As the camera angle increments each frame the outer-ring silhouette
 * oscillates between a flat disc and an almond / eye form, reinforcing the
 * eye-casting motif. The element is positioned as a translucent background
 * layer behind the hero text via CSS absolute positioning.
 *
 * Usage:
 *   const logo = createVoxelLogo(containerEl);
 *   // later, if the element is removed:
 *   logo.destroy();
 *
 * The container must have explicit CSS dimensions; the heerich SVG fills it
 * via `width:100%; height:100%`.
 */

import { Heerich } from '../../vendor/heerich.js';

// ── Grid constants ──────────────────────────────────────────────────────────

/** Grid size in voxel units. Larger grid = more voxels = finer ring detail. */
const SIZE   = 11;
/** Centre of the grid on each axis. */
const CENTER = SIZE / 2; // 5.5

// ── Shape: hollow oblate spheroid shell ─────────────────────────────────────
//
// Oblate spheroid: x/z radii (A) are larger than the y radius (B), producing
// a squished disc rather than a sphere. Rendering only the outer shell — and
// excluding the solid interior — creates a ring-like silhouette whose outline
// shifts as the camera orbits.

/** Horizontal semi-axis (x and z); governs how wide / flat the disc is. */
const A = CENTER * 0.86; // ~4.7 voxel units

/** Vertical semi-axis (y); roughly half of A → a 2:1 oblate disc. */
const B = CENTER * 0.44; // ~2.4 voxel units

/**
 * Inner exclusion threshold (normalised ellipsoidal radius).
 * Voxels whose normalised distance is BELOW this are hollow — they form
 * the empty centre of the eye. 0.82 leaves about 2–3 voxels of shell
 * thickness at the equator while opening a clear hole at the centre.
 */
const R_INNER = 0.82;

/** Outer boundary (normalised). Keeps voxels within the spheroid surface. */
const R_OUTER = 1.0;

/**
 * Shell test for the hollow oblate spheroid.
 * Normalised ellipsoidal radius: d² = (cx/A)² + (cy/B)² + (cz/A)²
 * Include a voxel iff R_INNER ≤ sqrt(d²) ≤ R_OUTER.
 *
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @returns {boolean}
 */
function isOblateShell(x, y, z) {
  const cx = x - CENTER;
  const cy = y - CENTER;
  const cz = z - CENTER;
  const d2 = (cx / A) ** 2 + (cy / B) ** 2 + (cz / A) ** 2;
  return d2 >= R_INNER * R_INNER && d2 <= R_OUTER * R_OUTER;
}

// ── Animation constants ─────────────────────────────────────────────────────

/** Camera rotation speed (degrees per ~16 ms frame at 60 fps). */
const DEG_PER_FRAME = 0.35;

/** Starting angle — matches the ambient sphere's rest angle. */
const INITIAL_ANGLE = 45;

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Mount an auto-rotating voxel logo mark into `containerEl`.
 *
 * Respects `prefers-reduced-motion`: when the media query matches, a single
 * static render is produced at the initial angle and no rAF loop is started.
 *
 * @param {HTMLElement} containerEl - Must already be in the DOM with CSS
 *   dimensions set. Its innerHTML is replaced each frame.
 * @returns {{ destroy: () => void }}
 */
export function createVoxelLogo(containerEl) {
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // why: fill:none → transparent faces, stroke:currentColor → the container's
  // CSS `color` drives the hue (inherits --fc-primary blue from the hero).
  const h = new Heerich({
    tile: 7,
    camera: { type: 'isometric', angle: INITIAL_ANGLE },
    style: {
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1,
    },
  });

  let angle  = INITIAL_ANGLE;
  let rafId  = /** @type {number|null} */ (null);
  let lastTs = 0;

  /** Rebuild the voxel scene at the current camera angle and inject SVG. */
  function render() {
    h.clear();
    h.setCamera({ type: 'isometric', angle });
    h.applyGeometry({
      type: 'fill',
      bounds: [[0, 0, 0], [SIZE, SIZE, SIZE]],
      test: isOblateShell,
      opaque: false,
    });
    containerEl.innerHTML = h.toSVG({ padding: 6 });
  }

  if (prefersReduced) {
    // Static render only — no animation loop.
    render();
    return { destroy() {} };
  }

  function frame(ts) {
    // why: 14 ms floor caps to ~60 fps on high-refresh displays so rotation
    // speed stays perceptually constant regardless of the panel's Hz.
    if (ts - lastTs >= 14) {
      angle = (angle + DEG_PER_FRAME) % 360;
      render();
      lastTs = ts;
    }
    rafId = requestAnimationFrame(frame);
  }

  render();
  rafId = requestAnimationFrame(frame);

  return {
    /** Stop the animation and release the rAF handle. */
    destroy() {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    },
  };
}

