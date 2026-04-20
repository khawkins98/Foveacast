# Roadmap

What we might do next, grouped by theme and sized so a `0.2.0` scope can be assembled from three to five items. This file is a menu, not a plan — the actual `0.2.0` scope is whatever the maintainer picks and commits to.

Status is honest about what's researched, what's speculative, and what requires user research before sizing.

Near-term items that are already queued up live in [TODO.md](../TODO.md). The roadmap is for the step above that: features and directions that warrant a minor-version bump.

## Versioning note

Foveacast is pre-1.0. Semver releases climb `0.1.0` → `0.1.1` → `0.2.0` → `0.3.0` → eventually `1.0.0` when the product and API shape feel stable enough to freeze. A breaking change in the pre-1.0 phase can land under a minor bump; a `1.0.0` release will mean we are committing to a stable public surface.

The PRD's "Version 1 / 2 / 3" numbering referred to **model generations** — MSI-Net via TF.js (V1), UNISAL via ORT Web (V2), MSI-Net fine-tuned on UEyes via ORT Web (V3). All three have shipped. The generation label is orthogonal to semver. The semver number tracks what changed for users; the generation tracks what changed under the hood.

---

## Immediate context

`0.3.x` is current (April 2026). The Precision Lens redesign landed a new UI, parallel multi-duration inference (1 s / 3 s / 7 s), blend-mode controls, a methodology page, and a "Reading your results" guide. The model moved from UNISAL (V2) to MSI-Net fine-tuned on the UEyes web eye-tracking dataset (V3). The next inflection is whether `0.4.0` deepens the feature set, extends comparison workflows, or sharpens the model-quality story.

## Decision principles

- **Preserve the "unzip and open `index.html`" promise.** Anything that introduces a build step or a server-side dependency has a higher bar than anything that doesn't.
- **Preserve the "nothing leaves your machine" positioning.** Anything that adds a network round-trip beyond the first-run weight download is a scope change that needs a deliberate conversation, not a drive-by.
- **Prefer compounding improvements.** A change that makes the next change easier is worth more than a change that closes a specific P1 finding in isolation.
- **Rough size is noisy.** The estimates below are "gut, informed by the V1 build." Anything above "half a day" should be re-sized before committing to it.

---

## Theme: feature depth

Things a user who has already tried Foveacast might ask for next.

### Viewport comparison (desktop vs. mobile)

**Size:** 1–2 days. **Status:** speculative. Viewport comparison is the highest-probability early request; the layout was sketched with a second drop-zone slot in mind.

Accept two screenshots, run inference on each, render them side-by-side with shared opacity/view controls. Obvious extensions: AOI differences highlighted, first-fixation crosshair on each, a download that packages both as a single PNG.

Risk: the layout math for a side-by-side composited canvas on narrow viewports needs thought. The output could stack when the wrapper drops below some breakpoint.

### Attention-ordered regions (AOI list)

**Size:** half a day to a day. **Status:** not scoped in PRD; mentioned in passing by commercial tools.

After inference, compute the top N peaks in the saliency map (non-maximum suppression on the blurred map), list them in order, and label them on the composited canvas ("1", "2", "3"…). Useful for "where does the eye land second?" questions — a common design review framing that a single first-fixation point doesn't answer.

### Compare a design change

**Size:** 1–2 days. **Status:** speculative.

"I tweaked the header — did the attention pattern change?" Drop a before + after; show the two heatmaps and a difference view that highlights regions where attention shifted. The most useful feature for actual iterative design work, and the one most likely to justify returning to the tool rather than using it once.

### Save & reload sessions

**Size:** half a day. **Status:** speculative.

Serialise `{ sourceImage, saliencyMap, preset, opacity }` to an IndexedDB record. "Recent screenshots" list in the UI. Nothing leaves the machine; this is local history, not cloud sync.

---

## Theme: model quality

### V2 — UNISAL via ONNX Runtime Web (shipped 0.2.0)

**Status:** shipped in `0.2.0`. UNISAL replaced MSI-Net; ORT Web replaced TensorFlow.js. Superseded by V3 in `0.3.0`. Spike notes are preserved at [`docs/spikes/unisal-onnx-research.md`](spikes/unisal-onnx-research.md).

One open follow-up from the V2 era that is still relevant:
- **Real-inference Playwright test** — the current E2E suite runs against demo mode (synthetic saliency), so the real ORT Web inference path is only tested by hand and by unit-level contract. A Playwright test that actually loads the ONNX model and runs inference on a committed fixture would close the only remaining gap in the testing tiers.

### V3 — MSI-Net fine-tuned on UEyes (shipped 0.3.0)

**Status:** shipped in `0.3.0`. MSI-Net, retrained on the UEyes web page eye-tracking dataset, runs via ORT Web — the same ONNX inference plumbing as V2 UNISAL. Three duration variants (1 s, 3 s, 7 s) are served from gitignored model files fetched at deploy time. See LEARNINGS.md for the V2 → V3 swap notes.

Open follow-up from V3:
- **Qualitative benchmark against UNISAL** — still unanswered. The swap happened before a side-by-side comparison could inform the decision. Still worth doing.

### Model-quality benchmarking

**Size:** half a day. **Status:** speculative.

Pick ~20 representative screenshots (landing pages, data dashboards, editorial articles, dense text, map UIs) and run each through all five presets plus Attention Insight's free tier. Qualitative comparison grid. Not code — research to inform the V2 decision and future PRD edits.

---

## Theme: UX and product polish

### Drop-zone preview on drag

**Size:** 45 minutes. **Status:** delight; TODO.md entry.

Render a small thumbnail of the dragged file inside the drop zone while a file is being dragged over the page. Gives the user confirmation the browser has registered their file.

### Attention tour / first-time-visitor onboarding

**Size:** half a day. **Status:** speculative.

A one-time tour for first-timers: "drop any screenshot → this is the heatmap → this is the first-fixation point → these controls adjust the overlay." Auto-dismisses after use and never returns. Contains the bias disclosure as its final slide so it can't be missed.

### Output annotation

**Size:** 1 day. **Status:** speculative.

Let the user draw boxes on the output and export annotated PNGs for design-review email threads. "Why does nobody look at the CTA?" — a heatmap plus a circle around the CTA is the communication artefact the user actually wants to paste into Slack.

### Accessibility harness in CI

**Size:** 1 hour. **Status:** TODO.md entry.

`@axe-core/playwright` run against `?demo=1` in the Playwright job. Fails the build on a new AA regression. Would have to figure out how to handle the headless browser's rendering quirks versus real a11y surface — some known false positives on canvas content.

---

## Theme: distribution

### Tauri native desktop app

**Size:** 2–3 days for a first working build. **Status:** speculative.

Packaged macOS and Windows installers. Inference via the Rust `ort` crate (CoreML + DirectML where available) instead of TF.js. Likely faster on low-end hardware, and gives a file-association + drag-from-Finder experience that the web app can't match.

Worth doing once the current ONNX model is stable — the Tauri build and the web build would share the same ONNX artefact.

### Figma plugin

**Size:** unknown, probably 3–5 days. **Status:** speculative.

"Predict attention on this Figma frame without exporting it." Foveacast-in-Figma could become the default channel for designers who don't want to screenshot-export before running a check. Would require learning the Figma plugin toolchain; the attention rendering itself is unchanged.

### Browser extension

**Size:** 1–2 days. **Status:** speculative. An extension that captures the current tab and routes it through Foveacast in a side panel.

---

## Theme: trust, governance, infrastructure

### Branch protection as code

**Size:** 1 hour–half day. **Status:** TODO.md entry at Critical. Best as its own PR.

Move the "CI must pass" and other branch-protection rules out of GitHub's UI and into a versioned config (probot-settings, or a documentation-only file for now). A successor maintainer can see the rules without clicking into Settings.

### Hash-pinned CDN fallback (no-vendor mode)

**Size:** half a day. **Status:** speculative.

An `?cdn=1` flag that loads TF.js and heatmap.js from jsDelivr instead of `docs/vendor/`, with SRI hashes matching the vendored bytes. Useful for measuring the TTFB cost of the vendor bloat; useful as a fallback if a vendored file is ever pulled. Mostly a thought experiment at this scale.

### Usage telemetry — opt-in, aggregate, privacy-preserving

**Size:** 2–3 days including a proper privacy policy. **Status:** carefully out of scope for now.

If we ever want to know which presets are actually used, how long inference takes across real hardware, or how often the first-drop-fails error path fires, we need some signal. Anything we build here has to be off by default, honest in its copy, zero-PII, and inspectable in the network panel. Not `0.2.0` material unless a specific question demands it.

---

## How this file is maintained

When an item ships, delete it. Do not leave a checkbox and a strikethrough. The roadmap is a forward-looking menu; archaeology belongs in CHANGELOG and LEARNINGS.

When an item is decided against, move it to a short "decided against" section at the bottom with one sentence of why — or remove it entirely if the reason is obvious from the absence.
