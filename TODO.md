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

---

## Items explicitly not going into this TODO

- Mobile support, URL input, webcam gaze tracking, and video — explicitly out of scope.
- Anything that would require a build step — the "unzip and open" promise still stands.
- Architectural debates about future model versions. Those belong in `LEARNINGS.md`, not here.

---

## How this file is maintained

Add new items as they arise; do not let this file drift. When an item ships, move it out — do not leave a checkmark and a strike-through. A TODO file that accumulates completed items is indistinguishable from one that has been abandoned.

Each item should carry: severity, source (which review and which finding), a sentence of context, a concrete fix shape, and a rough size. Future-you has a much better chance of acting on "P1 — 30 min — see maintainer #5" than on "improve the tests".
