#!/usr/bin/env node
/**
 * @file scripts/generate-eye-logo.js
 * @description Generates Foveacast voxel-eye logo assets using the vendored
 *   heerich isometric library:
 *
 *   - docs/assets/logo-mark.svg  — standalone voxel eye mark (hero / README)
 *   - docs/assets/logo.svg       — horizontal lockup (eye + wordmark + tagline)
 *
 * In heerich's isometric mode, X and Z are the horizontal floor plane and Y is
 * height. A flat "floor" of cubes visible from above uses y=0 with varying x,z.
 *
 * Run: node scripts/generate-eye-logo.js
 */

import { Heerich } from '../docs/vendor/heerich.js';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));

// ── Geometry constants ──────────────────────────────────────────────────────

const TILE = 8;        // isometric tile size in px (larger = fewer, chunkier cubes)
const GRID = 30;       // grid spans 0..GRID-1 in x and z axes
const CX   = GRID / 2; // x grid centre: 15
const CZ   = GRID / 2; // z grid centre: 15

// Isometric projection parameters (heerich isometric defaults: angle=45°, pitch=35.264°)
const COS_A     = Math.cos(Math.PI / 4);          // cos(45°)  ≈ 0.7071
const SIN_A     = Math.sin(Math.PI / 4);          // sin(45°)  ≈ 0.7071
const SIN_PITCH = Math.sin(35.264 * Math.PI / 180); // sin(35.264°) ≈ 0.5774

/**
 * Isometric screen-space position for the centre of voxel (x, 0, z),
 * relative to the grid centre. Matches heerich's _projectAndSort formula:
 *   sx_norm = x*cos(angle) − z*sin(angle)
 *   sy_norm = −(x*sin(angle) + z*cos(angle)) * sin(pitch)
 *
 * @param {number} x - voxel x grid index
 * @param {number} z - voxel z grid index
 * @returns {{ sx: number, sy: number }} screen pixels from grid centre
 */
function screenPos(x, z) {
  // why: use cube centres (+0.5) and offset from grid centre so the test is
  // symmetric around the eye's visual centre.
  const cx = (x + 0.5) - CX;
  const cz = (z + 0.5) - CZ;
  return {
    sx:  (cx * COS_A - cz * SIN_A) * TILE,
    sy: -(cx * SIN_A + cz * COS_A) * SIN_PITCH * TILE,
  };
}

// ── Eye lens shape ──────────────────────────────────────────────────────────

const EYE_W = 90; // screen-space half-width  (px)
const EYE_H = 32; // screen-space half-height (px)

// Two-circle lens (almond) formula:
//   R = (W² + H²) / (2H)   — radius of each of the two equal circles
//   D = R − H               — distance of each circle centre from lens midpoint
// A point is inside the lens iff its distance from BOTH centres is ≤ R.
const LENS_R  = (EYE_W * EYE_W + EYE_H * EYE_H) / (2 * EYE_H);
const LENS_D  = LENS_R - EYE_H;
const LENS_R2 = LENS_R * LENS_R; // cached for perf

/**
 * Returns true if the screen-space point (sx, sy) lies inside the almond lens.
 *
 * @param {number} sx
 * @param {number} sy
 * @returns {boolean}
 */
function inLens(sx, sy) {
  const d1 = sx * sx + (sy - LENS_D) * (sy - LENS_D);
  const d2 = sx * sx + (sy + LENS_D) * (sy + LENS_D);
  return d1 <= LENS_R2 && d2 <= LENS_R2;
}

// ── Build Heerich scene ─────────────────────────────────────────────────────

const h = new Heerich({
  tile: TILE,
  camera: { type: 'isometric', angle: 45 },
  style: {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 0.9,
  },
});

// Flat floor at y=0: vary x and z; y bounds [0,1) gives a single layer.
h.applyGeometry({
  type: 'fill',
  bounds: [[0, 0, 0], [GRID, 1, GRID]],
  // why: slight over-inclusion (inset 0px) means we clip exactly to the lens.
  // Cubes whose CENTRE falls outside are excluded; a few edge cubes may be
  // partially clipped — that's fine for the logo aesthetic.
  test: (_x, _y, _z) => {
    const { sx, sy } = screenPos(_x, _z);
    return inLens(sx, sy);
  },
  opaque: false,
});

// ── Render ──────────────────────────────────────────────────────────────────

const rawSvg = h.toSVG({ padding: 4 });

// Extract viewBox dimensions for downstream use
const vbMatch = rawSvg.match(/viewBox="([^"]+)"/);
if (!vbMatch) throw new Error('heerich SVG missing viewBox');
const [vbX, vbY, vbW, vbH] = vbMatch[1].split(' ').map(Number);

// Extract inner polygon markup (everything between <svg …> and </svg>)
const bodyMatch = rawSvg.match(/<svg[^>]*>([\s\S]*?)<\/svg>/);
if (!bodyMatch) throw new Error('Could not parse heerich SVG body');
const polygons = bodyMatch[1].trim();

// ── logo-mark.svg ───────────────────────────────────────────────────────────
// Standalone branded file; uses SVG <style> with dark/light media query so it
// renders correctly in README, hero img, and any standalone context.

const MARK_DARK  = '#b4c5ff'; // --fc-primary dark mode
const MARK_LIGHT = '#3a4fd8'; // --fc-primary light mode approximation

const markSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX} ${vbY} ${vbW} ${vbH}" role="img" aria-label="Foveacast eye mark">
  <title>Foveacast</title>
  <style>
    :root { --eye: ${MARK_DARK}; }
    @media (prefers-color-scheme: light) { :root { --eye: ${MARK_LIGHT}; } }
    polygon { stroke: var(--eye); }
  </style>
  ${polygons}
</svg>`;

const markPath = join(__dir, '..', 'docs', 'assets', 'logo-mark.svg');
writeFileSync(markPath, markSvg, 'utf8');
console.log(`Written: ${markPath}  (viewBox: ${vbX} ${vbY} ${vbW} ${vbH})`);

// ── logo.svg ─────────────────────────────────────────────────────────────────
// Horizontal lockup: voxel eye mark scaled to 56px tall, wordmark + tagline
// to the right. Hardcoded dark-first colours with light-mode media query.
//
// Layout (all px):
//   eye mark block: 56 × 56 (eye centred inside a square block, using transform)
//   gap:            16
//   text column:    wordmark + two tagline lines

// Scale factor to fit the eye into a 56px-tall block
const eyeScale = 56 / vbH;
const eyeBlockW = Math.round(vbW * eyeScale);

// SVG canvas
const LOCKUP_H  = 72;
const TEXT_X    = eyeBlockW + 20;
const LOCKUP_W  = TEXT_X + 200;

const lockupSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${LOCKUP_W} ${LOCKUP_H}" role="img" aria-label="Foveacast">
  <title>Foveacast</title>
  <defs>
    <style>
      :root {
        --eye: ${MARK_DARK};
        --word: #dce2f7;
        --tag:  #c3c6d7;
      }
      @media (prefers-color-scheme: light) {
        :root {
          --eye:  ${MARK_LIGHT};
          --word: #1c1e2b;
          --tag:  #44475a;
        }
      }
      polygon { stroke: var(--eye); }
      .word { font: 600 26px/1 system-ui, sans-serif; fill: var(--word); }
      .tag  { font: 400 9px/1.3 system-ui, sans-serif; fill: var(--tag); }
    </style>
  </defs>

  <!-- voxel eye mark, scaled to ${eyeBlockW}×56px -->
  <g transform="translate(0, ${(LOCKUP_H - 56) / 2}) scale(${eyeScale.toFixed(4)})">
    <g transform="translate(${-vbX}, ${-vbY})">
      ${polygons}
    </g>
  </g>

  <!-- wordmark -->
  <text class="word" x="${TEXT_X}" y="${LOCKUP_H / 2 - 4}">Foveacast</text>

  <!-- tagline, two lines -->
  <text class="tag" x="${TEXT_X}" y="${LOCKUP_H / 2 + 12}">fovea centralis: the retina&#x2019;s point of sharpest focus</text>
  <text class="tag" x="${TEXT_X}" y="${LOCKUP_H / 2 + 23}">+ cast, to project and predict</text>
</svg>`;

const lockupPath = join(__dir, '..', 'docs', 'assets', 'logo.svg');
writeFileSync(lockupPath, lockupSvg, 'utf8');
console.log(`Written: ${lockupPath}  (${LOCKUP_W}×${LOCKUP_H}px)`);

console.log('\nNext steps:');
console.log('  • Review docs/assets/logo-mark.svg in a browser');
console.log('  • Review docs/assets/logo.svg in a browser');
console.log('  • If satisfied, run: git add docs/assets/ && git commit');
