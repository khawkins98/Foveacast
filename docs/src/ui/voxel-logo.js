/**
 * @file docs/src/ui/voxel-logo.js
 * @description Animated voxel logo mark for the hero area.
 *
 * Renders a slowly auto-rotating isometric wireframe structure using the
 * same heerich library as the ambient sphere. The structure used here is a
 * hollow oblate spheroid shell — a squished sphere shell that, as the camera
 * angle increments each frame, produces a silhouette that oscillates between
 * a round disc and an almond / eye shape. No external assets required.
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

/** Grid size in voxel units. */
const SIZE   = 9;
/** Centre of the grid on each axis. */
const CENTER = SIZE / 2; // 4.5

// ── Shape: oblate spheroid shell ────────────────────────────────────────────
//
// An oblate spheroid is an ellipsoid with equal horizontal (x, z) radii
// larger than the vertical (y) radius — like a squished ball / flying saucer.
// Viewing it isometrically while rotating the camera produces a silhouette
// that sweeps between circular and almond, mimicking a rotating eye.

/** Horizontal semi-axis (wider than tall). */
const A = CENTER * 0.84; // x, z radius
/** Vertical semi-axis (squished). */
const B = CENTER * 0.42; // y radius — half of A gives a nice disc shape

/** Inner shell threshold (normalised). */
const R_INNER = 0.72;
/** Outer shell threshold (normalised). */
const R_OUTER = 1.0;

/**
 * Shell test for the oblate spheroid.
 * The normalised distance `d` equals (cx/A)² + (cy/B)² + (cz/A)²;
 * we include the voxel if sqrt(d) is in [R_INNER, R_OUTER].
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
  const d = (cx / A) ** 2 + (cy / B) ** 2 + (cz / A) ** 2;
  return d >= R_INNER * R_INNER && d <= R_OUTER * R_OUTER;
}

// ── Animation constants ─────────────────────────────────────────────────────

/** Camera rotation speed (degrees per 16 ms frame ≈ 60 fps). */
const DEG_PER_FRAME = 0.35;

/** Starting angle matches the ambient sphere's rest angle. */
const INITIAL_ANGLE = 45;

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Mount an auto-rotating voxel logo mark into `containerEl`.
 *
 * Respects `prefers-reduced-motion`: when reduced motion is requested the
 * structure is rendered statically at the initial angle with no rAF loop.
 *
 * @param {HTMLElement} containerEl - Must already be in the DOM with CSS
 *   dimensions set. Its innerHTML is replaced each frame.
 * @returns {{ destroy: () => void }}
 */
export function createVoxelLogo(containerEl) {
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // why: same style conventions as voxel-bg.js — fill:none makes faces
  // transparent so only stroke lines are visible (wireframe aesthetic);
  // currentColor lets the container's CSS `color` property drive the hue.
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
    containerEl.innerHTML = h.toSVG({ padding: 5 });
  }

  if (prefersReduced) {
    // Single static render — no animation loop.
    render();
    return { destroy() {} };
  }

  function frame(ts) {
    // why: cap to ~60 fps by skipping frames on high-refresh displays to
    // keep rotation speed perceptually constant regardless of display Hz.
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
