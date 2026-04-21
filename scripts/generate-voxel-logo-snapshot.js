#!/usr/bin/env node
/**
 * @file scripts/generate-voxel-logo-snapshot.js
 * @description Renders static SVG snapshots of the hero voxel logo
 *   (hollow oblate spheroid shell) and writes two files:
 *
 *     - docs/assets/logo.svg       — full-resolution, heatmap-coloured.
 *                                    Used in README header.
 *     - docs/assets/logo-mark.svg  — coarse-grid outline version, single
 *                                    colour via currentColor. Inlined in
 *                                    the topnav brand area so it tints
 *                                    with `.fc-topnav__logo-mark { color }`.
 *
 *   The geometry and face-style logic here are deliberately kept in sync
 *   with `docs/src/ui/voxel-logo.js` — see that file for the rationale
 *   behind each constant (A, B, R_INNER, hue/lightness mapping, etc.).
 *   If you tune the hero logo's look, re-run this script so README, the
 *   topnav, and any other static consumers stay consistent.
 *
 *   NOTE: the outline version's inlined SVG string is also mirrored in
 *   `docs/index.html` (topnav brand) and in `iconVoxelMark` inside
 *   `docs/src/ui/icons.js`. After running this script, paste the body of
 *   `logo-mark.svg` into both places (or keep them in sync by hand).
 *
 * Run: node scripts/generate-voxel-logo-snapshot.js
 */

import { Heerich } from '../docs/vendor/heerich.js';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));

// ── Geometry (mirrors docs/src/ui/voxel-logo.js) ────────────────────────────

/** Grid size in voxel units. Larger grid = more voxels = finer ring detail. */
const SIZE   = 11;
/** Centre of the grid on each axis. */
const CENTER = SIZE / 2;

/** Horizontal semi-axis (x and z); governs how wide / flat the disc is. */
const A = CENTER * 0.86;
/** Vertical semi-axis (y); roughly half of A → a 2:1 oblate disc. */
const B = CENTER * 0.44;
/** Inner exclusion threshold (normalised ellipsoidal radius). */
const R_INNER = 0.82;
/** Outer boundary (normalised). */
const R_OUTER = 1.0;

/**
 * Shell test for the hollow oblate spheroid. Include a voxel iff its
 * normalised ellipsoidal radius lies between R_INNER and R_OUTER.
 */
function isOblateShell(x, y, z) {
  const cx = x - CENTER;
  const cy = y - CENTER;
  const cz = z - CENTER;
  const d2 = (cx / A) ** 2 + (cy / B) ** 2 + (cz / A) ** 2;
  return d2 >= R_INNER * R_INNER && d2 <= R_OUTER * R_OUTER;
}

// ── Face style (mirrors voxel-logo.js `faceStyle`) ──────────────────────────

/**
 * HSL fill/stroke for a single voxel face. `currentAngle` drives the
 * shimmer wave; we pick a fixed angle for the snapshot so the image is
 * deterministic.
 */
function faceStyle(x, y, z, lightBonus, currentAngle) {
  const cx = x - CENTER;
  const cy = y - CENTER;
  const cz = z - CENTER;
  const d  = Math.sqrt((cx / A) ** 2 + (cy / B) ** 2 + (cz / A) ** 2);
  const t  = Math.max(0, Math.min(1, (d - R_INNER) / (R_OUTER - R_INNER)));

  const wave = Math.sin(currentAngle * (Math.PI / 180) * 1.5 + x * 0.8 + z * 0.55) * 0.5 + 0.5;

  const hue = Math.round(120 * (1 - t) + (wave - 0.5) * 20);
  const sat = 80;
  const lit = Math.round(48 + t * 18 + lightBonus);

  return {
    fill:        `hsl(${hue}deg ${sat}% ${lit}%)`,
    stroke:      `hsl(${hue}deg ${sat}% ${Math.max(0, lit - 14)}%)`,
    strokeWidth: 0.5,
  };
}

// ── Render one frame ────────────────────────────────────────────────────────

// why: 45° is the hero's INITIAL_ANGLE — the logo's "resting" pose, with the
// hollow centre visible as a clear diamond-shaped gap.
const SNAPSHOT_ANGLE = 45;

const h = new Heerich({
  tile: 7,
  camera: { type: 'isometric', angle: SNAPSHOT_ANGLE },
  style: { fill: '#1a3a1a', stroke: '#0d200d', strokeWidth: 0.5 },
});

h.applyGeometry({
  type:   'fill',
  bounds: [[0, 0, 0], [SIZE, SIZE, SIZE]],
  test:   isOblateShell,
  style: {
    default: (x, y, z) => faceStyle(x, y, z, 0,  SNAPSHOT_ANGLE),
    top:     (x, y, z) => faceStyle(x, y, z, 14, SNAPSHOT_ANGLE),
  },
});

const rawSvg = h.toSVG({ padding: 6 });

// Add a title + aria-label so README consumers get accessible alt text
// via the `<title>` element (browsers read it as the accessible name when
// the SVG is embedded as an <img>).
const branded = rawSvg.replace(
  /<svg([^>]*)>/,
  '<svg$1 role="img" aria-label="Foveacast voxel logo">\n  <title>Foveacast</title>',
);

const outPath = join(__dir, '..', 'docs', 'assets', 'logo.svg');
writeFileSync(outPath, branded, 'utf8');
console.log(`Written: ${outPath}`);

// ── Outline mark (coarse grid, single-colour via currentColor) ──────────────
//
// The nav-bar icon renders at ~22px. A full-resolution render (SIZE=11,
// hundreds of polygons) would turn into an illegible blob at that size, and
// inline 50 KB of SVG in index.html is awful for initial paint. So we emit
// a coarse version — same oblate-shell shape, fewer voxels — with no fills
// and `currentColor` strokes so CSS `color` tints it.

/** Coarse grid size for the topnav icon. Tune for balance of detail vs file size. */
const MARK_SIZE   = 5;
const MARK_CENTER = MARK_SIZE / 2;
/** Keep the same proportions as the hero (A ≈ 0.86·CENTER, B ≈ 0.44·CENTER). */
const MARK_A = MARK_CENTER * 0.86;
const MARK_B = MARK_CENTER * 0.44;

function isOblateShellMark(x, y, z) {
  const cx = x - MARK_CENTER;
  const cy = y - MARK_CENTER;
  const cz = z - MARK_CENTER;
  const d2 = (cx / MARK_A) ** 2 + (cy / MARK_B) ** 2 + (cz / MARK_A) ** 2;
  return d2 >= R_INNER * R_INNER && d2 <= R_OUTER * R_OUTER;
}

const markH = new Heerich({
  tile: 7,
  camera: { type: 'isometric', angle: SNAPSHOT_ANGLE },
  // why: fill:none + currentColor means whatever CSS `color` the host element
  // has wins. Matches the existing almond-eye icon's theming contract.
  style: { fill: 'none', stroke: 'currentColor', strokeWidth: 1 },
});

markH.applyGeometry({
  type:   'fill',
  bounds: [[0, 0, 0], [MARK_SIZE, MARK_SIZE, MARK_SIZE]],
  test:   isOblateShellMark,
  // why: opaque:true (default) hides back faces, so the outline reads as a
  // solid silhouette with only the visible front-edge seams — much cleaner
  // at icon sizes than the full wireframe would be.
});

// Parse out viewBox + body so we can rebuild with the contract the topnav
// expects: width/height attrs for inline sizing, aria-hidden, focusable=false,
// and no inline `style` (the CSS class owns sizing).
const markRaw = markH.toSVG({ padding: 1 });
const markVb = markRaw.match(/viewBox="([^"]+)"/)?.[1];
let markBody = markRaw.match(/<svg[^>]*>([\s\S]*?)<\/svg>/)?.[1]?.trim();
if (!markVb || !markBody) throw new Error('Could not parse outline mark SVG');

// why: strip heerich's data-* debug attrs — they roughly double the byte
// count and serve no purpose in an inlined icon.
markBody = markBody.replace(/\s+data-(?:voxel|x|y|z|face)="[^"]*"/g, '');
// why: polygons in this version all share fill="none" stroke="currentColor"
// stroke-width="1". Move them onto the parent <g> to avoid per-polygon
// repetition. Also drop the redundant stroke-linejoin since round corners
// aren't meaningful at 22px.
markBody = markBody
  .replace(/<g transform="translate\(0, 0\)">/, '<g fill="none" stroke="currentColor" stroke-width="1">')
  .replace(/\s+stroke-linejoin="round"/g, '')
  .replace(/\s+fill="none"/g, '')
  .replace(/\s+stroke="currentColor"/g, '')
  .replace(/\s+stroke-width="1"/g, '');

const markSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${markVb}" width="22" height="22" fill="none" aria-hidden="true" focusable="false"><title>Foveacast logo mark</title>${markBody}</svg>`;

const markPath = join(__dir, '..', 'docs', 'assets', 'logo-mark.svg');
writeFileSync(markPath, markSvg, 'utf8');
console.log(`Written: ${markPath}  (${markSvg.length} bytes)`);
