/**
 * voxel-bg.js — Wireframe voxel background decoration.
 *
 * Renders an isometric wireframe cube while the model loads, then runs a
 * stochastic morph to a sphere shell once the model is ready. After that the
 * sphere rests as a low-opacity background element until the caller destroys it.
 *
 * States:
 *   loading  → spinning cube, rAF-driven at 30 fps
 *   morphing → stochastic cube→sphere transition over ~1.5 s
 *   ready    → static sphere shell (rAF stopped); CSS transitions handle
 *              the opacity/position change to background
 *   gone     → rAF cancelled, container cleared (destroy() was called)
 *
 * Design rules respected:
 *   - prefers-reduced-motion: no rAF, jump straight to final sphere state
 *   - aria-hidden="true" on the container (set in HTML); pointer-events: none
 *     (set in CSS) — purely decorative, invisible to AT
 *
 * @module ui/voxel-bg
 */

import { Heerich } from '../../vendor/heerich.js';

// ----- constants -----------------------------------------------------------

/** How fast the cube spins: degrees advanced per rendered frame at 30 fps. */
const SPIN_DEG_PER_FRAME = 0.8;

/** Duration of the cube→sphere morph animation in milliseconds. */
const MORPH_DURATION_MS = 1500;

/**
 * Camera angle for the resting sphere (degrees). Snapping to this at morph
 * start ensures the final orientation is always the same regardless of where
 * the spin stopped — so screenshots and visual tests are deterministic.
 */
const FINAL_ANGLE_DEG = 45;

/** Grid size — geometry lives in [0, SIZE) on each axis. */
const SIZE = 8;

/** Center of the grid (used for sphere distance calculations). */
const CENTER = (SIZE - 1) / 2; // 3.5

/**
 * Sphere shell inner / outer radii. Tuned so the shell has roughly the same
 * visual density as the cube cage (~60 vs ~80 visible voxels), making the
 * morph look balanced rather than suddenly expanding or contracting.
 */
const SPHERE_INNER_R = 2.9;
const SPHERE_OUTER_R = 3.6;

/** Frame-rate cap in Hz for the rAF loop. */
const TARGET_FPS = 30;

// ----- geometry helpers ----------------------------------------------------

/**
 * Deterministic positional noise in [0, 1). Used to stagger the per-voxel
 * departure/arrival timing during the morph so it looks organic rather than a
 * uniform wavefront sweep.
 *
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @returns {number} value in [0, 1)
 */
function positionalNoise(x, y, z) {
  // why: simple integer hash — no floating-point drift, O(1), repeatable.
  return ((x * 7 + y * 11 + z * 13) % 17) / 17;
}

/**
 * Returns true for voxels on the wireframe cage of the cube.
 * An edge voxel has at least 2 of its 3 coordinates at the grid boundary
 * (0 or SIZE-1), which selects the 12 edges of the cube.
 *
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @returns {boolean}
 */
function isCubeEdge(x, y, z) {
  const atBound = (v) => v === 0 || v === SIZE - 1;
  return [x, y, z].filter(atBound).length >= 2;
}

/**
 * Returns true for voxels in the sphere shell band.
 *
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @returns {boolean}
 */
function isSphereShell(x, y, z) {
  const dx = x - CENTER;
  const dy = y - CENTER;
  const dz = z - CENTER;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return dist >= SPHERE_INNER_R && dist <= SPHERE_OUTER_R;
}

// ----- public API ----------------------------------------------------------

/**
 * Create and start the voxel background for a given container element.
 *
 * Call `setState('ready')` when the model finishes loading to trigger the
 * morph. Call `destroy()` once the background is no longer needed (e.g., the
 * user has dropped their first image and the voxel element is about to be
 * hidden anyway).
 *
 * @param {HTMLElement} containerEl - The element whose innerHTML will be driven
 *   by heerich SVG output. Must already be in the DOM.
 * @param {Object} [options]
 * @param {HTMLElement} [options.restContainer] - If provided, the container
 *   element is moved (DOM re-parented) into this element when the morph
 *   completes. Used so the loading-time mount (e.g. busy overlay card) is
 *   different from the rest-state mount (e.g. main column for the ambient
 *   sphere). Pass null/undefined to keep the element in place.
 * @param {() => void} [options.onReady] - Fired exactly once, when the morph
 *   completes (or immediately, in the prefers-reduced-motion case where
 *   setState('ready') jumps straight to the sphere). Use this to coordinate
 *   external state — e.g. fading out the busy overlay only after the cube
 *   has finished morphing inside it.
 * @returns {{ setState: (s: 'loading'|'ready') => void, destroy: () => void }}
 */
export function createVoxelBg(containerEl, options = {}) {
  const { restContainer = null, onReady = null } = options;
  // Captured at construction so activate() can re-parent the element
  // back to its original loading mount (typically the busy overlay
  // card) for subsequent inference runs.
  const loadingParent = containerEl.parentElement;
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // why: heerich's `style` option is a flat style object — it becomes
  // defaultStyle directly and is spread into per-face style objects. Wrapping
  // it in a `default:` key (as the per-voxel-style API does) breaks
  // serialisation: every face renders with `default="[object Object]"` and no
  // fill/stroke at all, so the browser falls back to black-fill/no-stroke.
  //
  // opaque:false (set per applyGeometry call) lets back faces render; fill:none
  // makes every face transparent so only the stroke outline is visible — the
  // wireframe aesthetic. We use 'currentColor' rather than a CSS custom property
  // because heerich writes stroke as an SVG presentation attribute, and browsers
  // do not resolve var() inside SVG presentation attributes. Setting color on
  // the container element (in CSS) and using currentColor here lets the design
  // token propagate via the CSS cascade. CSS rules on
  // `.fc-voxel-bg svg polygon` can still override either property in SVG2.
  const h = new Heerich({
    camera: { type: 'isometric', angle: FINAL_ANGLE_DEG },
    style: {
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1,
    },
  });

  let currentState = 'loading';
  let rafId = /** @type {number|null} */ (null);
  let spinAngle = FINAL_ANGLE_DEG;
  let morphStartTime = /** @type {number|null} */ (null);
  let lastFrameTime = 0;
  // why: onReady must fire exactly once even if setState('ready') is called
  // multiple times or after the element is already in its rest state.
  let notifiedReady = false;

  /**
   * Final-state bookkeeping: re-parent into the rest container (if any),
   * mark the element with the rest-state class, and notify the caller.
   * Idempotent — safe to call from the morph completion path AND from
   * setState('ready') in the reduced-motion or already-ready cases.
   */
  function notifyReady() {
    if (notifiedReady) return;
    notifiedReady = true;
    if (restContainer && containerEl.parentElement !== restContainer) {
      // appendChild moves the element rather than copying it, so the
      // already-rendered SVG content goes with it.
      restContainer.appendChild(containerEl);
    }
    containerEl.classList.add('fc-voxel-bg--ready');
    onReady?.();
  }

  // ---- scene builders -----------------------------------------------------

  /** Update the Heerich scene to the spinning cube at the current spinAngle. */
  function buildCubeScene() {
    h.clear();
    h.setCamera({ type: 'isometric', angle: spinAngle });
    h.applyGeometry({
      type: 'fill',
      bounds: [[0, 0, 0], [SIZE, SIZE, SIZE]],
      test: isCubeEdge,
      opaque: false,
    });
  }

  /**
   * Update the Heerich scene to the stochastic morph state.
   *
   * At t=0 only cube-edge voxels are visible; at t=1 only sphere-shell
   * voxels are visible. In between, each voxel's positional noise value
   * determines when it transitions, producing an organic scatter effect.
   *
   * @param {number} t - Smoothstepped morph progress in [0, 1].
   */
  function buildMorphScene(t) {
    h.clear();
    // why: snap camera to final angle at morph start so the cube's residual
    // spin angle does not carry over into the resting sphere orientation.
    h.setCamera({ type: 'isometric', angle: FINAL_ANGLE_DEG });
    const ease = t * t * (3 - 2 * t); // smoothstep
    h.applyGeometry({
      type: 'fill',
      bounds: [[0, 0, 0], [SIZE, SIZE, SIZE]],
      test: (x, y, z) => {
        const inCube = isCubeEdge(x, y, z);
        const inSphere = isSphereShell(x, y, z);
        if (!inCube && !inSphere) return false;
        const n = positionalNoise(x, y, z);
        // Cube voxels depart as ease rises above their noise threshold.
        // Sphere voxels arrive as ease rises past their noise threshold.
        // Shared voxels satisfy both conditions so they stay throughout.
        return (inCube && n > ease) || (inSphere && n <= ease);
      },
      opaque: false,
    });
  }

  /** Update the Heerich scene to the final static sphere shell. */
  function buildSphereScene() {
    h.clear();
    h.setCamera({ type: 'isometric', angle: FINAL_ANGLE_DEG });
    h.applyGeometry({
      type: 'fill',
      bounds: [[0, 0, 0], [SIZE, SIZE, SIZE]],
      test: isSphereShell,
      opaque: false,
    });
  }

  /** Write the current Heerich scene into the container as an SVG string. */
  function render() {
    containerEl.innerHTML = h.toSVG({ padding: 8 });
  }

  // ---- animation loop -----------------------------------------------------

  /**
   * requestAnimationFrame callback. Advances the current animation state and
   * re-renders. Self-cancels when the 'morphing' state reaches completion.
   *
   * @param {number} timestamp - DOMHighResTimeStamp from rAF.
   */
  function tick(timestamp) {
    rafId = requestAnimationFrame(tick);

    // Cap frame rate to TARGET_FPS to avoid unnecessary CPU/GPU work on
    // high-refresh displays where the background animation would otherwise
    // render at 120/144 fps.
    if (timestamp - lastFrameTime < 1000 / TARGET_FPS) return;
    lastFrameTime = timestamp;

    if (currentState === 'loading') {
      spinAngle = (spinAngle + SPIN_DEG_PER_FRAME) % 360;
      buildCubeScene();
      render();
    } else if (currentState === 'morphing') {
      if (!morphStartTime) morphStartTime = timestamp;
      const raw = (timestamp - morphStartTime) / MORPH_DURATION_MS;
      const t = Math.min(raw, 1);
      buildMorphScene(t);
      render();
      if (t >= 1) {
        // Morph complete. Render the final sphere and stop the rAF loop.
        // CSS handles the transition to the background (opacity + position).
        buildSphereScene();
        render();
        cancelAnimationFrame(rafId);
        rafId = null;
        currentState = 'ready';
        notifyReady();
      }
    }
    // 'ready' state: rAF has already been cancelled above — this branch is
    // unreachable but explicit for clarity.
  }

  // ---- init ---------------------------------------------------------------

  buildCubeScene();
  render();
  containerEl.classList.add('fc-voxel-bg--loading');

  if (prefersReduced) {
    // Reduced motion: skip all animation. Jump straight to the final sphere so
    // the element is visible as a static decoration without any motion.
    buildSphereScene();
    render();
    containerEl.classList.remove('fc-voxel-bg--loading');
    containerEl.classList.add('fc-voxel-bg--ready');
    currentState = 'ready';
  } else {
    rafId = requestAnimationFrame(tick);
  }

  // ---- public interface ---------------------------------------------------

  return {
    /**
     * Transition to a new state.
     *
     * Only the 'loading' → 'ready' transition is externally meaningful:
     * call this with 'ready' once the model finishes loading to trigger the
     * cube→sphere morph. Calling 'ready' from any state other than 'loading'
     * is a no-op (idempotent).
     *
     * @param {'loading'|'ready'} newState
     */
    setState(newState) {
      if (newState !== 'ready') return;
      if (currentState === 'loading') {
        currentState = 'morphing';
        morphStartTime = null;
        containerEl.classList.remove('fc-voxel-bg--loading');
        if (prefersReduced) {
          // Skip the morph entirely — go straight to sphere.
          buildSphereScene();
          render();
          currentState = 'ready';
          notifyReady();
        } else if (!rafId) {
          // Restart the loop if it was somehow cancelled before morph start.
          rafId = requestAnimationFrame(tick);
        }
        // Otherwise: rAF loop is already running from init and will pick up
        // the new 'morphing' state on the next tick.
      } else if (currentState === 'ready') {
        // Reduced-motion init already jumped to 'ready'. The caller still
        // expects an onReady fire so they can clear loading-state UI.
        notifyReady();
      }
    },

    /**
     * Bring the voxel back into its original loading mount as the
     * inference-run loading indicator. Used after the initial
     * cube→sphere morph has completed.
     *
     * Implementation note: ONNX inference blocks the main thread, so a
     * JS/rAF-driven animation would stutter or freeze entirely while
     * the model runs. Instead, we render the sphere ONCE and let the
     * compositor-thread CSS animation (`fc-voxel-spin` keyframes,
     * applied via the `--spinning` class) handle the rotation —
     * compositor-only `transform` animations keep ticking even while
     * the main thread is busy.
     *
     * No-op unless the morph has completed, the element exists, and
     * reduced-motion is not preferred.
     */
    activate() {
      if (currentState === 'gone' || prefersReduced) return;
      if (currentState !== 'ready') return;
      if (loadingParent && containerEl.parentElement !== loadingParent) {
        loadingParent.appendChild(containerEl);
      }
      // why: --ready styles the rest-state ambient sphere (low opacity,
      // corner offset). In the overlay, the in-overlay CSS already
      // forces opacity:1 and centring, but stripping the class keeps
      // the element semantically clean and lets the overlay variant
      // win without specificity gymnastics.
      containerEl.classList.remove('fc-voxel-bg--ready');
      currentState = 'spinning';
      // Render the static sphere a single time; CSS animates the spin
      // from here so we do not need a rAF loop while inference blocks
      // the main thread.
      buildSphereScene();
      render();
      containerEl.classList.add('fc-voxel-bg--spinning');
    },

    /**
     * Stop the inference-time spinner: drop the CSS spin class, return
     * the element to its rest container, and re-render the static
     * sphere. Symmetric counterpart to activate(). No-op if not
     * currently spinning.
     */
    deactivate() {
      if (currentState !== 'spinning') return;
      containerEl.classList.remove('fc-voxel-bg--spinning');
      if (restContainer && containerEl.parentElement !== restContainer) {
        restContainer.appendChild(containerEl);
      }
      buildSphereScene();
      render();
      currentState = 'ready';
      containerEl.classList.add('fc-voxel-bg--ready');
    },

    /**
     * Stop all animation and clear the container.
     *
     * Intended to be called after a CSS fade-out completes so the rAF loop
     * does not keep running in the background once the element is invisible.
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
  };
}
