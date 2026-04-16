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

### P2 — Reliance on `heatmapInstance._renderer.canvas` private API

**Source:** frontend P2 #5 and LEARNINGS. Noted as known fragility. Mitigation options, cheapest first:

1. Snapshot-test the internal shape by importing heatmap.js into a unit test and asserting `_renderer.canvas` is an HTMLCanvasElement after `.create`. Fails loudly if a heatmap.js minor bumps rename the field.
2. Replace heatmap.js with a ~100-line custom Canvas 2D renderer. heatmap.js does very little of value for this use case (colour ramping from a normalised float field) and the glue code to work around its quirks is comparable to the replacement.

Option 1 is 20 minutes; option 2 is a half-day.

### P2 — `package.json` has no `engines` field

pnpm action in CI pins Node 20, but the repo does not declare its Node floor. A contributor on Node 18 would hit runtime differences in `createImageBitmap` error shapes and not know why. Add `"engines": { "node": ">=20" }`.

**Size:** 2 minutes.

---

## Deferred from the technical-writing batch

### P1 — Off-PRD error string in main.js

**Source:** writing review P1 #3. `main.js:300` surfaces `INFERENCE_FAILED` with the message "The model is still loading. Please wait a moment and try again." — different text from `STATUS_ERROR_MESSAGES.INFERENCE_FAILED`. The UX queued-drop commit already replaces this code path with a first-run banner, but audit the rest of main.js for similar inline strings.

**Size:** 30 minutes.

### P2 — Voice audit: one section slips into AI-register

The CONTRIBUTING.md section titled "Style" has a line — `"— the project is expected to be picked up by people who didn't build it."` — that is fine, but the paragraph around it reads more like a policy document than the rest of the voice. A humanizer pass would bring it into line.

**Size:** 15 minutes.

---

## Deferred from the maintainer batch

### Critical — Branch protection rules are not in version control

**Source:** maintainer bus-factor table.

GitHub branch protection requires "CI must pass before merge to main". Nobody else on the project can see those rules; they live in GitHub's UI. A successor taking over would not know the rules exist.

**Fix:** adopt a tool like `probot-settings` or maintain a `docs/BRANCH_PROTECTION.md` that names the required checks (ci.yml / deploy.yml test gate / linear history / dismiss stale reviews etc.). Second-best: a comment at the top of CONTRIBUTING.md.

**Size:** 1 hour to document, up to half a day to adopt a configuration-as-code tool.

### Medium — No subresource-integrity (SRI) hashes on any vendored script

Vendoring closes the immediate jsDelivr supply-chain risk, but an attacker who compromises the repo could silently replace `docs/vendor/tf.min.js`. SRI hashes don't fix that — git history does — but computed hashes in a checked-in `docs/vendor/manifest.json` or as `integrity=` attributes on the script tags would let a review catch surprise changes at PR time.

**Size:** 30 minutes. Or wait until the first version bump, when the workflow is fresher.

### Medium — No axe-core or similar in the test path

No automated accessibility regression check. The PRD promises WCAG 2.1 AA and Phase D walked through this manually. A scheduled Playwright + `@axe-core/playwright` run against `?demo=1` (and perhaps a mocked loaded-model state) would catch future a11y drift without needing a manual pass every time.

**Size:** 1 hour.

### Low — Smoke script runs on port 5199 with no lock

If two developers run `pnpm smoke` simultaneously on the same machine (hi, CI matrix), they race on 5199. Add a PID file or pick a random high port per run.

**Size:** 15 minutes. Not urgent.

---

## Items explicitly not going into this TODO

- Anything the PRD's §Out of Scope lists (mobile support, URL input, webcam gaze tracking, video).
- Anything that would require a build step — the "unzip and open" promise still stands.
- V2 (UNISAL) or V3 (SUM). Those belong in PRD updates and `LEARNINGS.md`, not here.

---

## How this file is maintained

Add new items as they arise; do not let this file drift. When an item ships, move it out — do not leave a checkmark and a strike-through. A TODO file that accumulates completed items is indistinguishable from one that has been abandoned.

Each item should carry: severity, source (which review and which finding), a sentence of context, a concrete fix shape, and a rough size. Future-you has a much better chance of acting on "P1 — 30 min — see maintainer #5" than on "improve the tests".
