# Working with heerich.js in Foveacast

Project-specific cheatsheet for [heerich](https://github.com/meodai/heerich) — the tiny 3D voxel → SVG engine we use for the loading indicator, the ambient background sphere, and the hero logo mark. This file exists because the full upstream README is long, the library has several sharp edges, and we've already burned a day on two of them.

- **Vendored at:** `docs/vendor/heerich.js` (version **0.14.0**, MIT)
- **Upstream:** https://github.com/meodai/heerich · [README](https://github.com/meodai/heerich/blob/main/README.md) · [homepage/demos](https://meodai.github.io/heerich/)
- **Our consumers:**
  - `docs/src/ui/voxel-bg.js` — heatmap oblate-spheroid eye during model load; re-parents as ambient background once ready; CSS compositor spin during inference
  - `docs/src/ui/voxel-logo.js` — sticky hero logo mark (auto-rotating hollow oblate spheroid, click-to-pause, drag-to-spin)

If you are adding a new voxel effect, start by skimming those two files — they cover 90% of the patterns you'll need.

---

## Mental model (read this before reaching for the API)

heerich is a **voxel scene builder that serialises to SVG**, not a game engine. The loop is always:

1. Construct an engine: `const h = new Heerich({ camera, style, tile, gap })`.
2. Mutate the scene with `applyGeometry / addGeometry / removeGeometry / applyStyle / rotate / clear`.
3. Serialise with `h.toSVG({ padding })` and shove the string into `el.innerHTML`.

There is **no retained GPU state, no WebGL, no canvas**. Every frame is a full SVG rebuild — which is why we aggressively frame-cap and prefer CSS animations for anything the main thread can't guarantee. See the rAF vs CSS note below.

Geometry is stored per-voxel; boolean ops (`'union' | 'subtract' | 'intersect' | 'exclude'`) let you carve and combine. For anything beyond a box/sphere/line, reach for `type: 'fill'` with a `test: (x,y,z) => boolean` predicate — that's how both `voxel-bg.js` and `voxel-logo.js` draw their shapes.

---

## API surface we actually use

### Construction

```js
new Heerich({
  tile: 7,                                       // voxel size in SVG px (default 40)
  camera: { type: 'isometric', angle: 45 },      // see Camera, below
  style: { fill: 'none', stroke: 'currentColor', strokeWidth: 1 }, // defaultStyle — FLAT
  gap: 0,                                        // 0–0.5, spacing between voxels
})
```

**The `style` constructor option is a flat style object, not keyed by face.** See Gotcha #1.

### Camera

Four projection types. We use `isometric` everywhere.

| Type | Meaning of `angle` | Notes |
|------|-------------------|-------|
| `isometric` | horizontal rotation (pan) | pitch is locked to 35.264°; **use 45° / 135° / 225° / 315°** for pixel-aligned edges |
| `orthographic` | pan | accepts a separate `pitch` — use this if you need a non-isometric parallel view |
| `oblique` | direction Z recedes | has a `distance` |
| `perspective` | maps to camera X | single vanishing point, has `distance` and `position` |

Both of our consumers spin by calling `h.setCamera({ type: 'isometric', angle: newAngle })` each frame before rebuilding.

### Building geometry

```js
// Convenience
h.addGeometry({ type, ... })     // = applyGeometry({ mode: 'union', ... })
h.removeGeometry({ type, ... })  // = applyGeometry({ mode: 'subtract', ... })

// The general-purpose primitive — what we use for custom shapes
h.applyGeometry({
  type: 'fill',
  bounds: [[0, 0, 0], [SIZE, SIZE, SIZE]],       // inclusive-exclusive on each axis
  test: (x, y, z) => /* boolean */,              // predicate over integer coords
  opaque: false,                                 // let back faces render (needed for wireframe)
  style: { fill: 'none', stroke: 'currentColor' },
})

// Built-in shapes we don't currently use but could:
h.applyGeometry({ type: 'box',    position: [0,0,0], size: [3,2,4] })
h.applyGeometry({ type: 'sphere', center:   [5,5,5], radius: 3 })
h.applyGeometry({ type: 'line',   from: [0,0,0], to: [10,5,0], radius: 1, shape: 'rounded' })
```

All shape opts accept `mode`, `style`, `content`, `opaque`, `meta`, `rotate`, `scale`, `scaleOrigin`, `gap`. See [upstream docs](https://github.com/meodai/heerich#shapes) for the full grid.

### Rendering

```js
el.innerHTML = h.toSVG({ padding: 8 })
```

Interesting options we haven't used yet but might: `occlusion: true` (vector-accurate culling, good for plotters / clean SVG export), `offset`, `prepend/append` (for SVG `<defs>` like filters), `faces` (render a pre-computed face list — useful if we ever want to tween between snapshots without rebuilding).

### Clearing / mutating

```js
h.clear()                    // wipe all voxels
h.setCamera({ angle })       // update just the camera
h.applyStyle({ ... })        // restyle without add/remove
h.rotate({ axis: 'y', turns: 2 })   // 90° increments only
```

---

## Coordinate system — read before debugging "why is it upside down"

- **X** = horizontal (left/right)
- **Y** = vertical, **Y increases DOWNWARD** (SVG/DOM convention, not OpenGL). `y: -4` is *above* origin, `y: 4` is *below*.
- **Z** = depth (front/back). The closest-to-camera octant at the default 45° angle is `[-X, -Y, -Z]` (negative), not `[+X, +Y, +Z]`.
- **Valid range:** -512 to 511 on each axis.

If you're carving out "the front of a block to see inside", you subtract *negative* values. This has tripped up every person who has built for WebGL before.

---

## Styling

Style keys are per face: `default | top | bottom | left | right | front | back`. Each face style is an object of SVG presentation attributes (`fill`, `stroke`, `strokeWidth`, …).

**The constructor's `style` option is flat** (it IS the defaultStyle). The per-voxel `style` option on `applyGeometry` is the keyed form. See Gotcha #1.

Style values can be functions of `(x, y, z)` — useful for procedural shading without a shader.

---

## Gotchas we have actually hit

### 1. `style:` on the constructor is flat; `style:` on geometry is face-keyed

```js
// ❌ WRONG — constructor. Renders every polygon with default="[object Object]" and no fill/stroke.
new Heerich({ style: { default: { fill: 'none', stroke: '#fff' } } })

// ✅ RIGHT — constructor
new Heerich({ style: { fill: 'none', stroke: '#fff' } })

// ✅ RIGHT — on applyGeometry, the wrapper is required
h.applyGeometry({ ..., style: { default: { fill: 'none', stroke: '#fff' } } })
```

Symptom: invisible geometry (black fill, no stroke → disappears on dark backgrounds). See `LEARNINGS.md` entry 2026-04-20.

### 2. CSS custom properties (`var(--fc-primary)`) don't resolve inside SVG presentation attributes

heerich writes `fill` / `stroke` as attributes on each `<polygon>`. Browsers do **not** resolve `var(...)` inside SVG presentation attrs (SVG 1.1 behaviour; SVG2 is inconsistent across engines). Workaround we use:

```js
style: { fill: 'none', stroke: 'currentColor', strokeWidth: 1 }
```

and then set `color: var(--fc-primary)` on the container element via CSS. `currentColor` is an allowed keyword in SVG attributes and inherits through the cascade.

Alternative: style the rendered SVG via a CSS rule like `.fc-voxel-bg svg polygon { stroke: var(--fc-primary); }`. That works in SVG2 and overrides the attribute. Pick one, don't mix.

### 3. Main-thread blocking kills rAF animations; use CSS for inference-time motion

ORT inference blocks the main thread. A rAF-driven camera spin will stutter or freeze during inference because the callback is queued behind the model work. For anything that must keep animating while heavy JS runs:

1. Render the scene **once** (one `h.toSVG()` call into innerHTML).
2. Apply a CSS keyframes `transform: rotate()` animation to the container.
3. Add `will-change: transform` so the SVG gets promoted to its own compositor layer at setup time.

Compositor-thread transforms keep ticking even when the main thread is busy. Tradeoff: the animation is a 2D in-plane rotation rather than a 3D camera orbit — visually fine for symmetric shapes (our sphere shell), not fine for asymmetric ones. See the `activate()` / `deactivate()` methods in `voxel-bg.js` for the pattern.

### 4. Full scene rebuild per frame → cap your frame rate

Every camera change = `h.clear()` + rebuild + `toSVG()` + innerHTML assignment. At the scales we use (grid sizes 8–11), that's cheap enough for 30–60 fps on a laptop but not free on mobile. Both consumers cap frame rate explicitly:

- `voxel-bg.js`: 30 fps cap via `TARGET_FPS`
- `voxel-logo.js`: ~60 fps cap via 14 ms floor

Do not let a spinner free-run at 144 Hz — you'll burn battery for no perceptual gain.

### 5. `prefers-reduced-motion` is non-negotiable

Every animated voxel surface in this project checks `window.matchMedia('(prefers-reduced-motion: reduce)').matches` and falls back to a single static render. Copy the pattern from the existing consumers. The accessibility rule in CLAUDE.md applies — no exceptions.

### 6. Container must be in the DOM with explicit dimensions

The SVG fills the container via `width:100%; height:100%`. If the element is detached or has zero-size parents, you'll get an empty viewBox or a crushed layout. This bit us on heatmap.js in V1 (see LEARNINGS 2026-04-06) — heerich doesn't have the same offsetWidth/zero-size failure mode, but the rule "don't render into a detached element" still applies. Keep the container in the live tree and give it CSS dimensions before the first `toSVG()` call.

### 7. `opaque: false` is required for the wireframe look

Default voxels occlude their neighbours. For wireframe effects (transparent fill, only strokes visible), pass `opaque: false` on the geometry. Otherwise back faces won't render even if their fill is `none`, because the engine culls them as occluded.

---

## Patterns from our two consumers

### Custom shape via `test:` predicate

Both files use the same pattern — define an integer-space predicate, pass it to `applyGeometry({ type: 'fill', bounds, test, opaque: false })`.

Examples already in the codebase:
- Cube wireframe cage: voxel where ≥2 of 3 coords are at a grid boundary.
- Sphere shell: Euclidean distance from centre in `[R_inner, R_outer]`.
- Hollow oblate spheroid: `(cx/A)² + (cy/B)² + (cz/A)² ∈ [R_inner², R_outer²]` — non-uniform radii squash it into a disc.

If you need a new shape, write a predicate and a bounding box — that's the whole contract.

### Stochastic morph between two shapes

> **Note:** `voxel-bg.js` no longer uses this pattern (removed April 2026 when the wireframe cube/sphere was replaced with the heatmap eye). The technique is preserved here because it is reusable for any future two-shape transition.

Combine two shape predicates with a per-voxel noise threshold:

```js
const n = positionalNoise(x, y, z)            // deterministic 0..1
return (inCube && n > ease) || (inSphere && n <= ease)
```

Cube voxels depart as `ease` rises past their noise value; sphere voxels arrive as `ease` rises past theirs. Voxels in both sets persist. The result looks like an organic scatter instead of a wavefront sweep. Reusable for any two-shape transition.

### Deterministic positional noise

```js
function positionalNoise(x, y, z) {
  return ((x * 7 + y * 11 + z * 13) % 17) / 17
}
```

Integer hash — no floating-point drift, stable across refreshes, no seed state to thread through. Good enough for "stagger voxel timings pseudo-randomly."

### Snapping camera for screenshot stability

Before any state transition that ends in a still image (e.g. morph start / morph end), snap the camera back to a canonical angle. Otherwise whatever angle the spinning animation happened to be at when the state change fired becomes the resting angle — different on every run, which breaks visual diff tests.

---

## Things we don't use yet but are worth knowing about

- **`findByPosition([x, y])`** — SVG-space hit test. Returns `{ voxel, face } | null`. If we ever do an interactive voxel UI (click to carve, hover to highlight), this is the entry point.
- **`getVoxelInfo(voxel)`** — projected 2D center / bounds / normalised coordinates for a single voxel. Pairs with `findByPosition` for full click-to-highlight flows.
- **`findVoxels(predicate)`** — iterate all voxels matching a predicate. Useful for styling subsets by `meta.id`.
- **`meta:`** on `applyGeometry` — attaches `data-*` attributes to every rendered polygon. Good for CSS hover states or DOM querying.
- **Decals** (`h.defineDecal(name, content)`) — stamp SVG paths onto face quads with bilinear-warped corners. If we ever want an icon on a cube face (the MSI-Net input preview, for instance), this is how.
- **`toJSON()` / `Heerich.fromJSON()`** — serialise a scene. Functional styles get dropped with a console warning.
- **`GPURenderer`** — typed arrays for WebGL/WebGPU/Three.js `BufferGeometry`. We have no GPU path today, but if we ever need one this is the bridge.
- **`occlusion: true`** on `toSVG()` — vector-accurate clipping, no overlapping paths. Needed if we ever export to a pen plotter.

---

## When you're stuck

1. Open the upstream [demo gallery](https://meodai.github.io/heerich/) — most effects have a live source link.
2. Read the two files under `docs/src/ui/voxel-*.js`. Everything we've figured out lives in those comments.
3. Check the upstream [README](https://github.com/meodai/heerich/blob/main/README.md) — it's dense but complete.
4. Add a new entry to `LEARNINGS.md` if you work out something non-obvious, and update this file if it's a gotcha that would trip a future reader.
