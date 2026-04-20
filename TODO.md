# TODO

Findings from the four overnight reviews (UX, frontend/DX, technical writing, code maintainer) that were **not** shipped in the current PR. Each item is sized, traced back to its review, and written with enough context that a future maintainer does not have to re-derive it.

Full review documents are at `/tmp/foveacast-review-{ux,frontend,writing,maintainer}.md` while they live on the author's machine; the load-bearing findings from each are summarised below.

## Legend

- **P0 / Critical** — user-visible, security-relevant, or actively broken.
- **P1 / High** — friction, drift, or latent risk that will surface soon.
- **P2 / Medium–Low** — polish or long-horizon preparation.

---

## Deferred from the UX batch (already landed: drop-anywhere, demo watermark, enable-on-demo-render, progressive disclosure)


### P2 — "Need more?" modal reads as a link list

The commercial-alternatives modal is legally and ethically right to exist, but the current treatment (plain `<a>` list) reads as abandonment. Reframe as "If you need these capabilities, these tools offer them. They are not free and they send your screenshots to a third party." Same links, different framing.

**Size:** 10 minutes, copy-only.

### P2 — Reduced-motion on the inference spinner

The progress bar respects `prefers-reduced-motion`. The "Running inference…" indeterminate spinner is a CSS rotation and does not. Swap for a static three-dot glyph when the media query matches.

**Size:** 20 minutes.

### P2 — Delight opportunity: drop-zone preview on hover

When a file is being dragged over the page (`body.fc-page-dragover`), a tiny thumbnail of the dragged file inside the drop zone would let the user know the browser has registered it. Costs a `URL.createObjectURL` per drag; remember to revoke.

**Size:** 45 minutes. Optional.

---

## Deferred from the frontend / DX batch

### P1 — Remaining unit tests for `download.js`

**Source:** frontend review P1 #4. `inference.js`, `demo.js`, and the `main.js surfaceModelError` classifier now have coverage — only `download.js` is left. A fake canvas `toBlob` mock with assertions on URL created / revoked / anchor click order would take ~30 minutes.

### P2 — `package.json` has no `engines` field

pnpm action in CI pins Node 20, but the repo does not declare its Node floor. A contributor on Node 18 would hit runtime differences in `createImageBitmap` error shapes and not know why. Add `"engines": { "node": ">=20" }`.

**Size:** 2 minutes.

---

## Deferred from the technical-writing batch

### P2 — Voice audit: one section slips into AI-register

The CONTRIBUTING.md section titled "Style" has a line — `"— the project is expected to be picked up by people who didn't build it."` — that is fine, but the paragraph around it reads more like a policy document than the rest of the voice. A humanizer pass would bring it into line.

**Size:** 15 minutes.

---

## Deferred from the maintainer batch

### Medium — No subresource-integrity (SRI) hashes on any vendored script

Vendoring closes the immediate jsDelivr supply-chain risk, but an attacker who compromises the repo could silently replace `docs/vendor/tf.min.js`. SRI hashes don't fix that — git history does — but computed hashes in a checked-in `docs/vendor/manifest.json` or as `integrity=` attributes on the script tags would let a review catch surprise changes at PR time.

**Size:** 30 minutes. Or wait until the first version bump, when the workflow is fresher.

### Medium — No axe-core or similar in the test path

No automated accessibility regression check. The PRD promises WCAG 2.1 AA and Phase D walked through this manually. A scheduled Playwright + `@axe-core/playwright` run against `?demo=1` (and perhaps a mocked loaded-model state) would catch future a11y drift without needing a manual pass every time.

**Size:** 1 hour.

---

## Saliency visualization ideas (2026-04-19 thought exploration)

Features derivable from the existing pipeline without changing the model. All operate on the normalised `Float32Array` the postprocess step already produces.

### P2 — Top-N fixation sequence via Inhibition of Return (IoR)

Classic Itti & Koch (2001) technique: find the peak pixel → apply a Gaussian suppression mask → find the next peak → repeat for N fixations. Render as numbered circles (①②③) with connecting saccade lines on the composited canvas.

`firstFixationCentroid` in `pipeline/fixation.js` already computes the first peak via weighted centroid; extending it to return top-N via IoR masking is a natural evolution. Document prominently that these are predicted population-average fixations under free-viewing, not a recording of any individual's scanpath.

**Size:** ~50 lines of pure JS in `pipeline/fixation.js` plus a corresponding overlay render in `render/saliency-canvas.js`.

### P2 — Multi-duration centroid trajectory

Compute `firstFixationCentroid` for each of the 1s, 3s, and 7s saliency maps and draw a connecting arrow path on the heatmap overlay. Shows how the centre of attention shifts as viewing time increases — something no commercial saliency tool currently visualises this way, because our three-duration output is an unusual differentiator.

**Size:** trivial to compute (centroid already runs per duration); needs a render path to draw the connecting path.

### P2 — Scanpath animation

Animate a dot traversing the IoR fixation sequence with saccade lines drawing in. More legible than static numbered markers in presentations and exports. Depends on the IoR fixation sequence item above.

**Size:** ~1 day.

### P2 — Attention zones / threshold contour overlay

Concentric boundaries at the 10%, 25%, 50% saliency-mass thresholds — a topographic map of attention. More actionable than the diffuse heatmap for questions like "is this CTA inside the top-25% attention zone?". Threshold-filled semi-transparent regions are cheaper to implement than true contour lines.

**Size:** half a day.

### P2 — Rule-of-thirds grid breakdown

Score each cell of a 3×3 overlay by total saliency mass ("top-right third captures 28% of predicted attention"). Low-cost to compute; useful for compositional analysis. May be redundant once multi-duration trajectory is implemented.

**Size:** ~30 minutes.

---

---

## Items explicitly not going into this TODO

- Mobile support, URL input, webcam gaze tracking, and video — explicitly out of scope.
- Anything that would require a build step — the "unzip and open" promise still stands.
- Architectural debates about future model versions. Those belong in `LEARNINGS.md`, not here.

---

## How this file is maintained

Add new items as they arise; do not let this file drift. When an item ships, move it out — do not leave a checkmark and a strike-through. A TODO file that accumulates completed items is indistinguishable from one that has been abandoned.

Each item should carry: severity, source (which review and which finding), a sentence of context, a concrete fix shape, and a rough size. Future-you has a much better chance of acting on "P1 — 30 min — see maintainer #5" than on "improve the tests".
