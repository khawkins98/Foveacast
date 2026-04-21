/**
 * @file docs/src/ui/voxel-logo.js
 * @description Animated voxel logo mark for the hero area.
 *
 * Renders a slowly auto-rotating isometric structure using the same heerich
 * library as the ambient sphere. The shape is a hollow oblate spheroid shell —
 * wider in x/z than in y — with a clear vacant centre. As the camera angle
 * increments each frame the outer-ring silhouette oscillates between a flat
 * disc and an almond / eye form, reinforcing the eye-casting motif.
 *
 * Faces are solid-filled with a heatmap gradient: inner voxels render green,
 * outer voxels render red. A spatial wave keyed to the rotation angle produces
 * a shimmer that rolls across the structure as it turns. Top faces receive a
 * lightness bonus to simulate overhead lighting.
 *
 * The element is positioned as a translucent background layer behind the hero
 * text via CSS absolute positioning.
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

// ── Heatmap colour helpers ──────────────────────────────────────────────────
//
// Each voxel is coloured by its normalised depth within the shell (0 = inner
// edge, 1 = outer edge). Inner voxels render green (120°), outer voxels red
// (0°). A spatial wave — phase-shifted by the current rotation angle — rolls
// across voxels as the structure turns, producing a shimmer effect.
//
// NOTE: `faceStyle` deliberately captures `angle` from the outer closure.
// Because `render()` calls `h.clear()` + `h.applyGeometry()` every frame —
// after incrementing `angle` — the style functions are re-evaluated fresh
// each frame, so the shimmer evolves with the rotation.

/**
 * Compute the SVG fill/stroke style for one voxel face.
 *
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {number} lightBonus - Extra lightness added to the face (top face
 *   passes ~14 to simulate overhead illumination).
 * @param {number} currentAngle - Camera rotation angle in degrees, passed
 *   explicitly so this function stays pure and testable outside the closure.
 * @returns {{ fill: string, stroke: string, strokeWidth: number }}
 */
function faceStyle(x, y, z, lightBonus, currentAngle) {
  const cx = x - CENTER;
  const cy = y - CENTER;
  const cz = z - CENTER;
  const d  = Math.sqrt((cx / A) ** 2 + (cy / B) ** 2 + (cz / A) ** 2);
  // t: 0 at the inner edge of the shell, 1 at the outer edge.
  const t  = Math.max(0, Math.min(1, (d - R_INNER) / (R_OUTER - R_INNER)));

  // Shimmer: a wave that travels across voxels as the structure rotates.
  // Multiplying the angle by 1.5 makes the wave advance faster than the
  // rotation speed, so the shimmering feel doesn't just track camera movement.
  const wave = Math.sin(currentAngle * (Math.PI / 180) * 1.5 + x * 0.8 + z * 0.55) * 0.5 + 0.5;

  // Hue: green (120°) at inner edge → red (0°) at outer edge, ±10° shimmer.
  const hue = Math.round(120 * (1 - t) + (wave - 0.5) * 20);
  const sat = 80;
  // why: higher lightness base so heatmap colours read against the dark bg
  const lit = Math.round(48 + t * 18 + lightBonus);

  return {
    fill:        `hsl(${hue}deg ${sat}% ${lit}%)`,
    stroke:      `hsl(${hue}deg ${sat}% ${Math.max(0, lit - 14)}%)`,
    strokeWidth: 0.5,
  };
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Mount an auto-rotating, user-draggable voxel logo mark into `containerEl`.
 *
 * Interaction model
 * -----------------
 * • Pointer drag (mouse / touch via Pointer Events): horizontal drag changes
 *   the camera angle directly. On release the drag velocity carries over as
 *   momentum that decays via exponential friction back to the auto-spin speed.
 * • Keyboard (ArrowLeft / ArrowRight): 5° step per keypress; momentum decays
 *   to zero in ~40 frames, then auto-spin resumes (or stays still if
 *   prefers-reduced-motion).
 *
 * Accessibility
 * -------------
 * • prefers-reduced-motion: no auto-spin; rAF only runs while momentum >
 *   threshold (e.g. after the user has dragged and released), then stops.
 * • Container needs tabindex="0" in the HTML so keyboard interaction works.
 * • pointer-events must be enabled in CSS (no pointer-events:none).
 *
 * @param {HTMLElement} containerEl - Must already be in the DOM with CSS
 *   dimensions set. Its innerHTML is replaced each frame.
 * @returns {{ destroy: () => void }}
 */
export function createVoxelLogo(containerEl) {
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // why: constructor style is a flat fallback only (see heerich-notes.md §Gotcha 1).
  // The per-voxel style on applyGeometry overrides this for all active voxels,
  // so this value should only appear if something slips through unexpectedly.
  const h = new Heerich({
    tile: 7,
    camera: { type: 'isometric', angle: INITIAL_ANGLE },
    style: { fill: '#1a3a1a', stroke: '#0d200d', strokeWidth: 0.5 },
  });

  let angle    = INITIAL_ANGLE;
  let rafId    = /** @type {number|null} */ (null);
  let lastTs   = 0;
  let rafAlive = false;

  // Angular velocity in degrees per frame (~16 ms).
  // prefersReduced starts at 0 (no auto-spin); normal mode starts at DEG_PER_FRAME.
  let velocity = prefersReduced ? 0 : DEG_PER_FRAME;

  // Drag state
  let isDragging = false;
  let dragLastX  = 0;

  // Exponential friction: fraction of velocity that survives each frame.
  // 0.94 gives a natural-feeling ~1.5 s coast from a fast flick.
  const FRICTION = 0.94;

  // Drag sensitivity in degrees per pixel of horizontal movement.
  const DEG_PER_PX = 0.5;

  /** Rebuild the voxel scene at the current camera angle and inject SVG. */
  function render() {
    h.clear();
    h.setCamera({ type: 'isometric', angle });
    // why: omitting `opaque: false` keeps the default opaque behaviour — back
    // faces are culled so they don't bleed through the solid front faces.
    // The per-face style functions capture the `angle` closure variable, so
    // calling applyGeometry each frame produces time-varying heatmap colours.
    h.applyGeometry({
      type:   'fill',
      bounds: [[0, 0, 0], [SIZE, SIZE, SIZE]],
      test:   isOblateShell,
      style: {
        // why: applyGeometry style is face-keyed (heerich-notes.md §Gotcha 1).
        // `default` is the base for all faces; `top` overrides for roof polygons
        // to simulate overhead lighting.
        default: (x, y, z) => faceStyle(x, y, z, 0, angle),
        top:     (x, y, z) => faceStyle(x, y, z, 14, angle),
      },
    });
    containerEl.innerHTML = h.toSVG({ padding: 6 });
  }

  // ── rAF loop ────────────────────────────────────────────────────────────────

  function startRaf() {
    if (rafAlive) return;
    rafAlive = true;
    lastTs = 0;
    rafId = requestAnimationFrame(frame);
  }

  function frame(ts) {
    // why: 14 ms floor caps to ~60 fps on high-refresh displays so rotation
    // speed stays perceptually constant regardless of the panel's Hz.
    if (ts - lastTs >= 14) {
      if (!isDragging) {
        angle = (angle + velocity + 360) % 360;

        if (prefersReduced) {
          // Decay to zero, then stop rAF entirely until next interaction.
          velocity *= FRICTION;
          if (Math.abs(velocity) < 0.005) {
            velocity = 0;
            render();
            rafAlive = false;
            return; // don't re-schedule — static until user acts again
          }
        } else {
          // Decay toward the auto-spin floor using exponential approach.
          // This means: a hard throw coasts naturally, then settles back to the
          // slow continuous rotation rather than coming to a dead stop.
          velocity = velocity * FRICTION + DEG_PER_FRAME * (1 - FRICTION);
        }
      }
      render();
      lastTs = ts;
    }
    rafId = requestAnimationFrame(frame);
  }

  // ── Pointer interaction ─────────────────────────────────────────────────────

  function onPointerDown(e) {
    isDragging = true;
    dragLastX  = e.clientX;
    velocity   = 0; // pause momentum while actively grabbing
    containerEl.style.cursor = 'grabbing';
    // why: setPointerCapture keeps pointermove/up firing on this element even
    // if the pointer leaves the element bounds during the drag.
    containerEl.setPointerCapture(e.pointerId);
    startRaf(); // ensure rAF is running so renders happen
    e.preventDefault();
  }

  function onPointerMove(e) {
    if (!isDragging) return;
    const dx = e.clientX - dragLastX;
    // Update angle directly (rendered in the next rAF frame) and store the
    // instantaneous velocity so momentum works on release.
    angle     = (angle + dx * DEG_PER_PX + 360) % 360;
    velocity  = dx * DEG_PER_PX;
    dragLastX = e.clientX;
  }

  function onPointerUp() {
    if (!isDragging) return;
    isDragging = false;
    containerEl.style.cursor = '';
    // velocity retains the last drag delta; frame() will decay it from here.
  }

  // ── Keyboard interaction ────────────────────────────────────────────────────

  function onKeyDown(e) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const delta = e.key === 'ArrowLeft' ? -5 : 5;
    angle    = (angle + delta + 360) % 360;
    velocity = delta;
    startRaf();
    // why: in reduced-motion mode rAF just started, so render immediately for
    // instant visual response rather than waiting up to 14 ms.
    if (prefersReduced) render();
    e.preventDefault();
  }

  // ── Setup ───────────────────────────────────────────────────────────────────

  containerEl.addEventListener('pointerdown',  onPointerDown);
  containerEl.addEventListener('pointermove',  onPointerMove);
  containerEl.addEventListener('pointerup',    onPointerUp);
  containerEl.addEventListener('pointercancel', onPointerUp);
  containerEl.addEventListener('keydown',      onKeyDown);

  if (prefersReduced) {
    render(); // one static frame; rAF starts only when user interacts
  } else {
    startRaf(); // auto-spin
  }

  return {
    /** Stop the animation loop and remove all event listeners. */
    destroy() {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId    = null;
        rafAlive = false;
      }
      containerEl.removeEventListener('pointerdown',   onPointerDown);
      containerEl.removeEventListener('pointermove',   onPointerMove);
      containerEl.removeEventListener('pointerup',     onPointerUp);
      containerEl.removeEventListener('pointercancel', onPointerUp);
      containerEl.removeEventListener('keydown',       onKeyDown);
    },
  };
}

