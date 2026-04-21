# TODO

Findings from the four overnight reviews (UX, frontend/DX, technical writing, code maintainer) that were **not** shipped in the current PR. Each item is sized, traced back to its review, and written with enough context that a future maintainer does not have to re-derive it.

Full review documents are at `/tmp/foveacast-review-{ux,frontend,writing,maintainer}.md` while they live on the author's machine; the load-bearing findings from each are summarised below.

## Legend

- **P0 / Critical** — user-visible, security-relevant, or actively broken.
- **P1 / High** — friction, drift, or latent risk that will surface soon.
- **P2 / Medium–Low** — polish or long-horizon preparation.

---

## Deferred from the UX batch (already landed: drop-anywhere, demo watermark, enable-on-demo-render, progressive disclosure)

### P2 — Delight opportunity: drop-zone preview on hover

When a file is being dragged over the page (`body.fc-page-dragover`), a tiny thumbnail of the dragged file inside the drop zone would let the user know the browser has registered it. Costs a `URL.createObjectURL` per drag; remember to revoke.

**Size:** 45 minutes. Optional.

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

### P2 — Scanpath animation

Animate a dot traversing the IoR fixation sequence with saccade lines drawing in. More legible than static numbered markers in presentations and exports. Depends on the top-N fixation sequence (now shipped).

**Size:** ~1 day.

---

## Speculative — structural input alongside the screenshot (2026-04-20)

### P2 — Optional HTML input for element-level feedback

Today the pipeline sees pixels. A designer gets a heatmap but no answer to "where does my primary CTA rank?" If the user could optionally drop the page's HTML alongside the screenshot, we could extract element bounding boxes (from `getBoundingClientRect`-style data or a serialised DOM snapshot) and score each one against the saliency field the model already produces. Output would be a ranked list: "Sign up button — 4th most salient region, 0.31 peak" next to the existing heatmap.

Why this and not URL input: URL input is out of scope (line 57) because it breaks offline-first and introduces CORS. An HTML *file* the user provides alongside the screenshot does neither — it's still a local-only drop.

Main concerns before committing:
- The screenshot and the HTML snapshot have to agree on viewport and DPR, or the bounding boxes land in the wrong place on the heatmap. Users would need a small capture helper (bookmarklet? Playwright snippet in the docs?) to produce both in lockstep. That's real UX friction.
- The saliency model itself doesn't get smarter from HTML — this is purely a *second track* of feedback derived from the existing heatmap. Worth doing only if element-level ranking is meaningfully more useful to users than the current visual overlay.
- Adds a structural-analysis slice to `pipeline/` that currently doesn't exist. Not a layer violation, but a new responsibility.

**Size:** ~3 days for a rough version (file input + DOM parser + box-to-saliency scoring + UI list). More if we build the capture helper. Revisit once we have user feedback on whether the pixel-only heatmap is sufficient.

---

## Items explicitly not going into this TODO

- Mobile support, URL input, webcam gaze tracking, and video — explicitly out of scope.
- Anything that would require a build step — the "unzip and open" promise still stands.
- Architectural debates about future model versions. Those belong in `LEARNINGS.md`, not here.

---

## How this file is maintained

Add new items as they arise; do not let this file drift. When an item ships, move it out — do not leave a checkmark and a strike-through. A TODO file that accumulates completed items is indistinguishable from one that has been abandoned.

Each item should carry: severity, source (which review and which finding), a sentence of context, a concrete fix shape, and a rough size. Future-you has a much better chance of acting on "P1 — 30 min — see maintainer #5" than on "improve the tests".
