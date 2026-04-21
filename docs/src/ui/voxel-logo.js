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

// ── Pitch wobble ────────────────────────────────────────────────────────────
//
// heerich's built-in isometric camera locks pitch to 35.264° (the angle at
// which a cube's three visible faces project to equal-area rhombi). We want
// the shape to tumble slightly as it spins — a little whimsy, non-periodic
// enough that it never feels mechanical — so we switch to `orthographic`
// (which accepts an explicit pitch) and animate pitch with two slow sines
// at incommensurable frequencies. The sum is bounded, but the quasi-periodic
// beat pattern means it never visibly repeats.

/** Rest pitch; matches the isometric default so nothing changes visually at t=0. */
const PITCH_BASE_DEG = 35.264;

/** Amplitude (°) of the two wobble sines. Total excursion stays within ±|A1|+|A2|. */
const WOBBLE_A1 = 2.5;
const WOBBLE_A2 = 1.8;

/** Angular frequencies in radians per millisecond. Periods ≈ 25 s and ≈ 16 s. */
const WOBBLE_W1 = 0.00025;
const WOBBLE_W2 = 0.00039;

// ── Hover heat spot ─────────────────────────────────────────────────────────
//
// Moving the pointer over the logo heats up the voxels closest to the
// cursor — they shift toward red and brighten — with smooth radial falloff
// so the effect reads like a warm spotlight following the mouse. The
// highlight is additive on top of the resting heatmap colours and fades
// in/out when the pointer enters or leaves.

/** Per-frame ease rates toward the global hover target (0 = rest, 1 = active). */
const HOVER_IN_RATE  = 0.18; // ~80 ms to full
const HOVER_OUT_RATE = 0.10; // ~200 ms back

/**
 * Falloff radius (SVG user-units) for the pointer "heat" spot. Distances
 * smaller than this fully light up; distances past ~2× this fade to zero
 * via a smoothstep. Tuned to ~1–2 voxel widths at tile=7.
 */
const HEAT_RADIUS = 10;

/**
 * Tile size used by the Heerich camera. Must match the `tile` value passed
 * to `new Heerich()` below — voxel→SVG projection uses it.
 */
const TILE = 7;

/**
 * Projection offset applied to every vertex by heerich when emitting SVG
 * (`(t + 5) * tileW`). We replicate it here so the voxel-centre positions
 * we compute land in the same user-space as the pointer position we read
 * via `getScreenCTM().inverse()`.
 */
const HEERICH_PROJ_OFFSET = 5;

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
 * Project a voxel centre (x+0.5, y+0.5, z+0.5) into the same SVG user-space
 * that heerich emits its polygon points into. Matches the formula in
 * `heerich.js` _projectAndSort for the `orthographic`/`isometric` branch,
 * including the constant `(t + 5) * tileW` shift.
 *
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {number} angleDeg
 * @param {number} pitchDeg
 * @returns {{ sx: number, sy: number }} coordinates in SVG user-units.
 */
function projectVoxelCenter(x, y, z, angleDeg, pitchDeg) {
  const a = angleDeg * (Math.PI / 180);
  const p = pitchDeg * (Math.PI / 180);
  const cx = x + 0.5, cy = y + 0.5, cz = z + 0.5;
  const sxRaw =  cx * Math.cos(a) - cz * Math.sin(a);
  const syRaw =  cy * Math.cos(p) - (cx * Math.sin(a) + cz * Math.cos(a)) * Math.sin(p);
  return {
    sx: (sxRaw + HEERICH_PROJ_OFFSET) * TILE,
    sy: (syRaw + HEERICH_PROJ_OFFSET) * TILE,
  };
}

/**
 * Smoothstep — classic 3x²-2x³ S-curve on [0,1]. Used for the hover-heat
 * radial falloff so the highlight tapers off smoothly instead of linearly.
 */
function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

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
 * @param {number} currentPitchDeg - Camera pitch in degrees (for the wobble).
 * @param {number} hoverT - Global hover gate [0, 1]. 0 disables the heat
 *   spot entirely; eased on enter/leave so the effect fades in and out.
 * @param {number|null} pointerSx - Pointer X in SVG user-space, or null if
 *   the pointer is not over the element (in which case no heat is applied).
 * @param {number|null} pointerSy - Pointer Y in SVG user-space.
 * @returns {{ fill: string, stroke: string, strokeWidth: number }}
 */
function faceStyle(x, y, z, lightBonus, currentAngle, currentPitchDeg, hoverT, pointerSx, pointerSy) {
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

  // Per-voxel heat from the pointer spot. 0 when the pointer is absent,
  // elsewhere smoothstep'd from 1 at pointer centre to 0 past 2×HEAT_RADIUS.
  // Multiplied by the global hoverT gate so enter/leave cross-fades cleanly.
  let heat = 0;
  if (hoverT > 0 && pointerSx !== null && pointerSy !== null) {
    const { sx, sy } = projectVoxelCenter(x, y, z, currentAngle, currentPitchDeg);
    const dist = Math.hypot(sx - pointerSx, sy - pointerSy);
    // why: smoothstep from 2R → 0 flipped gives 1 near centre, 0 at 2R.
    heat = (1 - smoothstep(HEAT_RADIUS, HEAT_RADIUS * 2, dist)) * hoverT;
  }

  // Hue: green (120°) at inner edge → red (0°) at outer edge, ±10° shimmer.
  // Heat pushes the green-end contribution down toward 0, so voxels near
  // the pointer collapse to red while distant ones keep their resting hue.
  const baseHue = 120 * (1 - t) * (1 - heat) + (wave - 0.5) * 20;
  const hue = Math.round(baseHue);
  // Additive saturation + lightness bumps for the heated voxels — makes
  // the spotlight read as "hot" rather than just a colour swap.
  const sat = Math.round(80 + heat * 15);
  const lit = Math.round(48 + t * 18 + lightBonus + heat * 18);

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
  //
  // why: `orthographic` instead of `isometric` — heerich's isometric camera
  // hardcodes pitch to 35.264°, but we want to animate pitch for the wobble.
  // Setting angle=45 + pitch=35.264 on orthographic is visually identical to
  // isometric at rest.
  const h = new Heerich({
    tile: TILE,
    camera: { type: 'orthographic', angle: INITIAL_ANGLE, pitch: PITCH_BASE_DEG },
    style: { fill: '#1a3a1a', stroke: '#0d200d', strokeWidth: 0.5 },
  });

  let angle    = INITIAL_ANGLE;
  let rafId    = /** @type {number|null} */ (null);
  let lastTs   = 0;
  let rafAlive = false;

  // Hover state — pointer enter/leave toggles `isHovered`, and `hoverT` eases
  // toward that target each frame. `pointerSvgX/Y` track the pointer in the
  // SVG's own user-coordinate space (same as the polygon points) so the
  // per-voxel heat falloff can compare distances directly. null while the
  // pointer is outside the element.
  let isHovered    = false;
  let hoverT       = 0;
  let pointerSvgX  = /** @type {number|null} */ (null);
  let pointerSvgY  = /** @type {number|null} */ (null);

  // Pitch wobble — phase randomised per instance so two logos on the same
  // page (e.g. hero + loading indicator) don't bob in lockstep.
  const wobblePhase = Math.random() * Math.PI * 2;

  // Angular velocity in degrees per frame (~16 ms).
  // prefersReduced starts at 0 (no auto-spin); normal mode starts at DEG_PER_FRAME.
  let velocity = prefersReduced ? 0 : DEG_PER_FRAME;

  // Pause state — toggled by a single click/tap.
  // Not applicable in reduced-motion mode (there is no auto-spin to pause).
  let paused = false;

  // Drag state
  let isDragging    = false;
  let dragLastX     = 0;
  // why: tracks whether the pointer moved enough to count as a drag.
  // Reset on pointerdown; set once movement exceeds 3 px. Prevents a
  // short tap from being treated as a drag (which would skip the pause toggle).
  let pointerHasMoved = false;

  // Exponential friction: fraction of velocity that survives each frame.
  // 0.94 gives a natural-feeling ~1.5 s coast from a fast flick.
  const FRICTION = 0.94;

  // Drag sensitivity in degrees per pixel of horizontal movement.
  const DEG_PER_PX = 0.5;

  /**
   * Current pitch in degrees for a given rAF timestamp. Sum of two slow
   * sines at incommensurable frequencies — quasi-periodic, bounded,
   * non-repeating-feeling. Returns the rest value in reduced-motion mode.
   *
   * @param {number} ts - rAF timestamp (ms since document origin).
   */
  function currentPitch(ts) {
    if (prefersReduced) return PITCH_BASE_DEG;
    return PITCH_BASE_DEG
      + WOBBLE_A1 * Math.sin(ts * WOBBLE_W1 + wobblePhase)
      + WOBBLE_A2 * Math.sin(ts * WOBBLE_W2 + wobblePhase * 1.7);
  }

  /**
   * Rebuild the voxel scene at the current camera angle/pitch and inject SVG.
   *
   * @param {number} [ts] - rAF timestamp used to drive the pitch wobble.
   *   Defaults to `performance.now()` for non-rAF callers (togglePause, init).
   */
  function render(ts = performance.now()) {
    // why: capture pitch once per frame so every face in the pass uses the
    // same value for its voxel-centre projection (frame coherence).
    const pitchDeg = currentPitch(ts);
    h.clear();
    h.setCamera({ type: 'orthographic', angle, pitch: pitchDeg });
    // why: omitting `opaque: false` keeps the default opaque behaviour — back
    // faces are culled so they don't bleed through the solid front faces.
    // The per-face style functions close over `angle`, `pitchDeg`, `hoverT`,
    // and the pointer coords, so re-running applyGeometry each frame gives
    // time-varying heatmap colours plus a cursor-following heat spot.
    h.applyGeometry({
      type:   'fill',
      bounds: [[0, 0, 0], [SIZE, SIZE, SIZE]],
      test:   isOblateShell,
      style: {
        // why: applyGeometry style is face-keyed (heerich-notes.md §Gotcha 1).
        // `default` is the base for all faces; `top` overrides for roof polygons
        // to simulate overhead lighting.
        default: (x, y, z) => faceStyle(x, y, z, 0,  angle, pitchDeg, hoverT, pointerSvgX, pointerSvgY),
        top:     (x, y, z) => faceStyle(x, y, z, 14, angle, pitchDeg, hoverT, pointerSvgX, pointerSvgY),
      },
    });
    containerEl.innerHTML = h.toSVG({ padding: 6 });
  }

  /**
   * Convert a client-space pointer event into the SVG's own user-coordinate
   * space (where heerich's polygon points live). Returns null if no SVG has
   * been rendered yet — initial pointerenter fires before the first frame is
   * replaced in rare cases.
   */
  function pointerToSvgCoords(e) {
    const svg = containerEl.querySelector('svg');
    if (!svg || typeof svg.getScreenCTM !== 'function') return null;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const svgPt = pt.matrixTransform(ctm.inverse());
    return { x: svgPt.x, y: svgPt.y };
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
      // Advance rotation only when not dragging AND not paused. Skipping
      // the velocity-floor line while paused is the whole reason this
      // branch exists — otherwise DEG_PER_FRAME * (1 - FRICTION) would
      // creep velocity back above zero every frame and the logo would
      // silently start spinning again a few frames after a pause.
      if (!isDragging && !paused) {
        angle = (angle + velocity + 360) % 360;

        if (prefersReduced) {
          // Decay to zero. In reduced-motion mode rAF normally stops once
          // the logo settles — but if a hover transition is still in flight
          // we need to keep ticking until hoverT reaches its target too.
          velocity *= FRICTION;
          const hoverSettled =
            Math.abs(hoverT - (isHovered ? 1 : 0)) < 0.005;
          if (Math.abs(velocity) < 0.005 && hoverSettled) {
            velocity = 0;
            hoverT   = isHovered ? 1 : 0;
            render(ts);
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

      // Ease hover state toward its target every frame. Faster attack than
      // release matches how most hover/press interactions feel right.
      const hoverTarget = isHovered ? 1 : 0;
      const rate        = isHovered ? HOVER_IN_RATE : HOVER_OUT_RATE;
      hoverT += (hoverTarget - hoverT) * rate;
      render(ts);
      lastTs = ts;

      // While paused, the only reasons to keep ticking are (a) the
      // hover-out transition is still in flight and (b) the pointer is
      // over the logo and the heat spot needs to follow mouse moves.
      // Once neither is true, stop rAF so the paused logo sits still.
      if (paused && !isHovered && Math.abs(hoverT) < 0.005) {
        hoverT   = 0;
        render(ts);
        rafAlive = false;
        return;
      }
    }
    rafId = requestAnimationFrame(frame);
  }

  // ── Pause toggle ────────────────────────────────────────────────────────────

  /**
   * Toggle auto-spin on/off. A single click/tap (no drag) calls this.
   * In reduced-motion mode there is no auto-spin, so the toggle is a no-op.
   */
  function togglePause() {
    if (prefersReduced) return;
    paused = !paused;
    containerEl.classList.toggle('fc-hero-logo--paused', paused);
    // Update the accessible label so screen readers announce the new state.
    containerEl.setAttribute(
      'aria-label',
      paused
        ? 'Foveacast logo — paused. Click or press Space to resume.'
        : 'Foveacast logo — drag or use arrow keys to spin. Click or press Space to pause.',
    );
    if (paused) {
      velocity = 0;
      if (rafAlive) {
        cancelAnimationFrame(rafId);
        rafId    = null;
        rafAlive = false;
      }
    } else {
      velocity = DEG_PER_FRAME;
      startRaf();
    }
  }

  // ── Pointer interaction ─────────────────────────────────────────────────────

  function onPointerDown(e) {
    isDragging      = true;
    pointerHasMoved = false;
    dragLastX       = e.clientX;
    velocity        = 0; // pause momentum while actively grabbing
    containerEl.style.cursor = 'grabbing';
    // why: setPointerCapture keeps pointermove/up firing on this element even
    // if the pointer leaves the element bounds during the drag.
    containerEl.setPointerCapture(e.pointerId);
    startRaf(); // ensure rAF is running so renders happen during drag
    e.preventDefault();
  }

  function onPointerMove(e) {
    // Always update the cursor-tracking point so the heat spot follows
    // the pointer even when no drag is active.
    if (isHovered) {
      const svgPt = pointerToSvgCoords(e);
      if (svgPt) {
        pointerSvgX = svgPt.x;
        pointerSvgY = svgPt.y;
      }
    }

    if (!isDragging) return;
    const dx = e.clientX - dragLastX;
    // Mark as a drag once the pointer has moved more than 3 px, so a
    // stationary tap does not accidentally suppress the pause toggle.
    if (!pointerHasMoved && Math.abs(e.clientX - dragLastX) > 3) {
      pointerHasMoved = true;
    }
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

    if (!pointerHasMoved) {
      // Tap/click with no meaningful movement → toggle pause.
      togglePause();
      velocity = 0;
      return;
    }

    // Drag release: if paused, stop rAF so the logo goes static again.
    if (paused) {
      velocity = 0;
      if (rafAlive) {
        cancelAnimationFrame(rafId);
        rafId    = null;
        rafAlive = false;
      }
    }
    // else: velocity from drag decays naturally via frame().
  }

  function onPointerCancel() {
    // Interrupted gesture (e.g. another pointer took priority). Mark as
    // "has moved" so the cancel is never mistaken for a click.
    pointerHasMoved = true;
    isDragging      = false;
    containerEl.style.cursor = '';
    if (paused) {
      velocity = 0;
      if (rafAlive) {
        cancelAnimationFrame(rafId);
        rafId    = null;
        rafAlive = false;
      }
    }
  }

  // ── Hover interaction ───────────────────────────────────────────────────────
  //
  // pointerenter/leave (not mouseenter/leave) so touch "hover" via hover-capable
  // styluses and mouse-emulating devices also trigger the effect. The rAF loop
  // must be running for the easing to render — so in reduced-motion mode we
  // restart it on enter/leave; the frame() early-exit now also waits for the
  // hover transition to settle before stopping.

  function onPointerEnter(e) {
    isHovered = true;
    // Seed the heat spot at the entry point so the first rendered frame
    // already shows the highlight where the pointer actually is, rather
    // than at a stale coord from a previous hover.
    const svgPt = pointerToSvgCoords(e);
    if (svgPt) {
      pointerSvgX = svgPt.x;
      pointerSvgY = svgPt.y;
    }
    if (!rafAlive) startRaf();
  }

  function onPointerLeave() {
    isHovered = false;
    // why: keep the last pointer coords around until hoverT eases to zero,
    // so the fade-out shrinks in place instead of jumping to origin.
    if (!rafAlive) startRaf();
  }

  // ── Keyboard interaction ────────────────────────────────────────────────────

  function onKeyDown(e) {
    // Space / Enter: toggle pause (same as a click).
    if (e.key === ' ' || e.key === 'Enter') {
      togglePause();
      e.preventDefault();
      return;
    }
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

  containerEl.addEventListener('pointerdown',   onPointerDown);
  containerEl.addEventListener('pointermove',   onPointerMove);
  containerEl.addEventListener('pointerup',     onPointerUp);
  containerEl.addEventListener('pointercancel', onPointerCancel);
  containerEl.addEventListener('pointerenter',  onPointerEnter);
  containerEl.addEventListener('pointerleave',  onPointerLeave);
  containerEl.addEventListener('keydown',       onKeyDown);

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
      containerEl.removeEventListener('pointerenter',  onPointerEnter);
      containerEl.removeEventListener('pointerleave',  onPointerLeave);
      containerEl.removeEventListener('pointerdown',   onPointerDown);
      containerEl.removeEventListener('pointermove',   onPointerMove);
      containerEl.removeEventListener('pointerup',     onPointerUp);
      containerEl.removeEventListener('pointercancel', onPointerCancel);
      containerEl.removeEventListener('keydown',       onKeyDown);
    },
  };
}

