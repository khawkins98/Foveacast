/**
 * voxel-bg.js — Heatmap voxel loading indicator.
 *
 * Renders the same oblate-spheroid heatmap eye as the hero logo mark while the
 * model loads, then parks invisibly once the model is ready. During inference
 * runs it reappears in the busy overlay and spins via a CSS compositor
 * animation (keeping it alive even while the main thread is blocked by ONNX).
 *
 * States:
 *   loading  → auto-spinning heatmap eye, JS rAF-driven at 30 fps
 *   ready    → rAF stopped; element hidden in rest container (opacity: 0)
 *   spinning → static rendered frame + CSS spin class (inference indicator)
 *   gone     → rAF cancelled, container cleared (destroy() was called)
 *
 * Design rules respected:
 *   - prefers-reduced-motion: no rAF, static frame shown during loading
 *   - aria-hidden="true" on the container (set in HTML); pointer-events: none
 *     (set in CSS) — purely decorative, invisible to AT
 *
 * @module ui/voxel-bg
 */

import { Heerich } from '../../vendor/heerich.js';

// ----- constants (mirrored from voxel-logo.js) ----------------------------
// These mirror the hero logo geometry so the loading indicator and hero logo
// look identical. If the hero shape changes, update both files.

/** Grid size — geometry lives in [0, SIZE) on each axis. */
const SIZE   = 11;

/** Centre of the grid on each axis. */
const CENTER = SIZE / 2; // 5.5

/** Horizontal semi-axis (x and z) of the oblate spheroid. */
const A = CENTER * 0.86;

/** Vertical semi-axis (y) of the oblate spheroid. */
const B = CENTER * 0.44;

/** Inner normalised ellipsoidal radius — voxels below this are hollow. */
const R_INNER = 0.82;

/** Outer normalised ellipsoidal radius — keeps voxels within the surface. */
const R_OUTER = 1.0;

/** Auto-spin speed: degrees per ~16 ms frame. */
const DEG_PER_FRAME = 0.35;

/** Starting and canonical resting camera angle (degrees). */
const FINAL_ANGLE_DEG = 45;

/** Frame-rate cap in Hz for the rAF loop. */
const TARGET_FPS = 30;

/**
 * How long (ms) to keep the element in the overlay after onReady fires so the
 * spinner stays visible while the overlay fades out (200 ms CSS transition).
 * A small buffer (50 ms) is added over the transition duration.
 */
const REPAENT_DELAY_MS = 250;

// ----- geometry helpers ----------------------------------------------------

/**
 * Returns true for voxels in the hollow oblate spheroid shell.
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

/**
 * Compute the SVG fill/stroke style for one voxel face.
 * Identical to faceStyle() in voxel-logo.js — heatmap green→red with shimmer.
 *
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {number} lightBonus - Extra lightness for overhead illumination.
 * @param {number} currentAngle - Current camera angle in degrees.
 * @returns {{ fill: string, stroke: string, strokeWidth: number }}
 */
function faceStyle(x, y, z, lightBonus, currentAngle) {
  const cx = x - CENTER;
  const cy = y - CENTER;
  const cz = z - CENTER;
  const d  = Math.sqrt((cx / A) ** 2 + (cy / B) ** 2 + (cz / A) ** 2);
  const t  = Math.max(0, Math.min(1, (d - R_INNER) / (R_OUTER - R_INNER)));
  const wave = Math.sin(currentAngle * (Math.PI / 180) * 1.5 + x * 0.8 + z * 0.55) * 0.5 + 0.5;
  const hue  = Math.round(120 * (1 - t) + (wave - 0.5) * 20);
  const sat  = 80;
  const lit  = Math.round(48 + t * 18 + lightBonus);
  return {
    fill:        `hsl(${hue}deg ${sat}% ${lit}%)`,
    stroke:      `hsl(${hue}deg ${sat}% ${Math.max(0, lit - 14)}%)`,
    strokeWidth: 0.5,
  };
}

// ----- public API ----------------------------------------------------------

/**
 * Create and start the voxel loading indicator for a given container element.
 *
 * Call `setState('ready')` when the model finishes loading. Call `destroy()`
 * once the element is permanently removed.
 *
 * @param {HTMLElement} containerEl - Element whose innerHTML is driven by
 *   heerich SVG output. Must already be in the DOM.
 * @param {Object} [options]
 * @param {HTMLElement} [options.restContainer] - Element to re-parent into
 *   once the loading phase ends (e.g. `.fc-main`).
 * @param {() => void} [options.onReady] - Fired exactly once when the model
 *   is ready. Triggers the busy-overlay fade-out in main.js.
 * @returns {{ setState, activate, deactivate, setAngle, destroy }}
 */
export function createVoxelBg(containerEl, options = {}) {
  const { restContainer = null, onReady = null } = options;
  // Captured at construction so activate() can re-parent the element back
  // to the busy overlay card for subsequent inference runs.
  const loadingParent = containerEl.parentElement;
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // why: constructor style is a flat fallback (heerich-notes.md §Gotcha 1).
  // Per-voxel style on applyGeometry overrides this for all active voxels.
  const h = new Heerich({
    tile: 7,
    camera: { type: 'isometric', angle: FINAL_ANGLE_DEG },
    style: { fill: '#1a3a1a', stroke: '#0d200d', strokeWidth: 0.5 },
  });

  let currentState = 'loading';
  let rafId        = /** @type {number|null} */ (null);
  let spinAngle    = FINAL_ANGLE_DEG;
  // why: restAngle keeps the last angle used so activate() renders at
  // whatever the scroll-driven angle was, not always the canonical angle.
  let restAngle    = FINAL_ANGLE_DEG;
  let lastFrameTime = 0;
  // why: onReady must fire exactly once even if setState('ready') is called
  // multiple times or after the element is already in its rest state.
  let notifiedReady = false;

  // ---- scene builder -------------------------------------------------------

  /**
   * Rebuild the oblate-spheroid heatmap scene at the given angle and inject
   * SVG. Identical to the render() in voxel-logo.js.
   *
   * @param {number} angle - Camera azimuth in degrees.
   */
  function renderAt(angle) {
    h.clear();
    h.setCamera({ type: 'isometric', angle });
    h.applyGeometry({
      type:   'fill',
      bounds: [[0, 0, 0], [SIZE, SIZE, SIZE]],
      test:   isOblateShell,
      style: {
        default: (x, y, z) => faceStyle(x, y, z, 0, angle),
        top:     (x, y, z) => faceStyle(x, y, z, 14, angle),
      },
    });
    containerEl.innerHTML = h.toSVG({ padding: 6 });
  }

  // ---- animation loop ------------------------------------------------------

  /**
   * requestAnimationFrame callback. Advances the spin angle and re-renders.
   * Capped at TARGET_FPS so high-refresh displays don't burn unnecessary CPU.
   *
   * @param {number} timestamp - DOMHighResTimeStamp from rAF.
   */
  function tick(timestamp) {
    rafId = requestAnimationFrame(tick);
    if (timestamp - lastFrameTime < 1000 / TARGET_FPS) return;
    lastFrameTime = timestamp;
    spinAngle = (spinAngle + DEG_PER_FRAME) % 360;
    renderAt(spinAngle);
  }

  // ---- ready bookkeeping ---------------------------------------------------

  /**
   * Fire onReady immediately (so the overlay starts fading), then re-parent
   * the element into restContainer after the overlay fade completes.
   * Idempotent — safe to call multiple times.
   */
  function notifyReady() {
    if (notifiedReady) return;
    notifiedReady = true;

    // Stop rAF and render one canonical static frame before re-parenting.
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    renderAt(FINAL_ANGLE_DEG);
    containerEl.classList.add('fc-voxel-bg--ready');
    currentState = 'ready';

    // Fire onReady now — the overlay starts its 200 ms fade-out with the
    // spinner still visible in it.
    onReady?.();

    // Delay the DOM re-parent until the overlay fade finishes so the spinner
    // stays visible inside the overlay throughout the transition.
    if (restContainer) {
      setTimeout(() => {
        // Guard: activate() may have already re-parented for a queued inference
        // run — skip the rest-container move if that has happened.
        if (currentState === 'ready' && containerEl.parentElement !== restContainer) {
          restContainer.appendChild(containerEl);
        }
      }, REPAENT_DELAY_MS);
    }
  }

  // ---- init ----------------------------------------------------------------

  containerEl.classList.add('fc-voxel-bg--loading');

  if (prefersReduced) {
    // Reduced motion: skip animation. Render a static frame at the canonical
    // angle so the element is visible without any motion.
    renderAt(FINAL_ANGLE_DEG);
  } else {
    renderAt(spinAngle);
    rafId = requestAnimationFrame(tick);
  }

  // ---- public interface ----------------------------------------------------

  return {
    /**
     * Transition to a new state.
     *
     * Call with 'ready' once the model finishes loading. Any other value is a
     * no-op. Calling 'ready' multiple times is idempotent.
     *
     * @param {'loading'|'ready'} newState
     */
    setState(newState) {
      if (newState !== 'ready') return;
      if (currentState === 'loading') {
        containerEl.classList.remove('fc-voxel-bg--loading');
        notifyReady();
      } else if (currentState === 'ready') {
        // Already ready (e.g. reduced-motion init). Fire onReady so callers
        // that depend on it (e.g. setAppBusy(false)) still receive the signal.
        notifyReady();
      }
    },

    /**
     * Bring the voxel into its original loading mount as the inference-run
     * loading indicator. Used after setState('ready') has been called.
     *
     * ONNX inference blocks the main thread, so JS rAF animations would
     * freeze. Instead we render one static frame then apply a CSS compositor
     * animation (`fc-voxel-spin` keyframes) so rotation continues on the
     * compositor thread while inference runs.
     *
     * No-op unless in 'ready' state and reduced-motion is not set.
     */
    activate() {
      if (currentState === 'gone' || prefersReduced) return;
      if (currentState !== 'ready') return;
      if (loadingParent && containerEl.parentElement !== loadingParent) {
        loadingParent.appendChild(containerEl);
      }
      containerEl.classList.remove('fc-voxel-bg--ready');
      currentState = 'spinning';
      // Render at restAngle so the inference spinner starts from wherever the
      // scroll-driven angle last left it rather than always snapping to 45°.
      renderAt(restAngle);
      containerEl.classList.add('fc-voxel-bg--spinning');
    },

    /**
     * Stop the inference-time spinner: remove the CSS spin class, return the
     * element to its rest container, and re-render a static frame.
     * Symmetric counterpart to activate(). No-op if not currently spinning.
     */
    deactivate() {
      if (currentState !== 'spinning') return;
      containerEl.classList.remove('fc-voxel-bg--spinning');
      if (restContainer && containerEl.parentElement !== restContainer) {
        restContainer.appendChild(containerEl);
      }
      renderAt(restAngle);
      currentState = 'ready';
      containerEl.classList.add('fc-voxel-bg--ready');
    },

    /**
     * Stop all animation and clear the container.
     */
    destroy() {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      containerEl.innerHTML = '';
      containerEl.classList.remove('fc-voxel-bg--loading', 'fc-voxel-bg--ready');
      currentState = 'gone';
    },

    /**
     * Update the camera angle used for rest-state and inference renders.
     *
     * Callers should batch with requestAnimationFrame to avoid re-rendering
     * on every scroll event. No-op in reduced-motion mode. Keeps internal
     * angle state up to date even when the element is hidden.
     *
     * @param {number} deg - Camera azimuth angle in degrees.
     */
    setAngle(deg) {
      if (prefersReduced) return;
      restAngle = deg % 360;
      // Only re-render while in rest state (element visible at opacity:0 in
      // fc-main — not worth rebuilding the SVG while it's invisible, but the
      // angle is preserved for the next activate() call).
    },
  };
}
