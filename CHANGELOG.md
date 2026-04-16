# Changelog

All notable changes to Foveacast are recorded here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.1] — 2026-04-16

Post-release housekeeping. First pass of changes informed by actually using the shipped product, running Foveacast on its own landing page, and closing the smallest items from the overnight reviews that didn't block V1.

### Added

- **`docs/ROADMAP.md`** — candidate themes and features for V1.1, organised by theme (feature depth, model quality, UX polish, distribution, trust/infra). Menu, not a plan; the maintainer picks.
- **Dismissible mobile guard** — "Proceed anyway (at my own risk)" button on the desktop-only notice, with honest "inference may still fail" copy. The choice is remembered in `localStorage` so a reload doesn't re-prompt.
- **Heatmap-informed layout pass** — tighter header, a short "What this does" helper block alongside the drop zone at wide viewports (absorbs the wandering attention the model otherwise spends on empty right-hand margins), stronger drop-zone border and padding. Observations and the before-state are documented in `LEARNINGS.md`.
- **`download.js` unit tests** — 6 cases covering the PNG-blob-and-anchor flow, including URL revoke hygiene and null-blob rejection.
- **`heatmap.js` private-API snapshot test** — fails loudly if a future library bump renames the `_renderer.canvas` field we reach for in the render layer.
- **`resolveModelUrl` unit tests** — HEAD → 404 → GCS fallback coverage, pinning the specific shape of bug that shipped to CI the first time and was only caught by Playwright.
- **`pnpm test:e2e:no-mirror`** — runs the Playwright suite against a simulated CI environment (no populated `docs/models/` folder). One command to verify "will this pass CI?" before pushing.

### Fixed

- **Off-PRD error strings removed from `main.js`.** The last inline user-facing message (`"Demo mode failed to render…"`) now routes through a new `DEMO_FAILED` code in `STATUS_ERROR_MESSAGES`. All user-visible copy now flows through one constant.
- **CI was red on the post-ship commits.** pnpm version-conflict (`packageManager` vs. workflow `version:`) fixed by deferring to `package.json`. Playwright was failing against a no-mirror environment due to a cascade (Vite middleware falling through on missing `/models/*`, Chromium auto-logging 404s without URLs in `.text()`, the silent background model load surfacing errors during demo mode). Each failure's root cause is now covered by either middleware or test-filter changes; the `pnpm test:e2e:no-mirror` script exists so the class of bug can't recur unnoticed.

### Changed

- **Header tightened** to reduce first-fixation weight on page chrome; drop-zone dashed border from 2px to 3px.
- **Controls labels** moved to verb-first copy ("Adjust overlay strength", "Show", "Model detail") after progressive disclosure made them more visible than they used to be.
- **Model-ready banner** now reads "Model loaded — drop a screenshot to start." and stays on screen until the user drops a file, instead of auto-dismissing after 1.5 s with no next action.
- **`engines` field in `package.json`** declares the Node 20 floor.
- **SRI hashes** on vendored scripts (`docs/vendor/tf.min.js`, `docs/vendor/heatmap.min.js`) — sha384 `integrity=` attributes on the script tags plus the same hashes recorded in `docs/vendor/README.md`. Browser refuses to execute bytes that don't match.
- **Structured error codes from `loadModel`**, replacing the string-sniff against TF.js error messages that would break on a minor-version bump.
- **First-run localStorage sentinel** (`foveacast:has-run:v1`) — true first-time visitors now see the "Downloading the attention model (~60MB)" banner immediately instead of a misleading "Loading from cache" banner that upgrades after 800ms.
- **Vite dev-server middleware** now serves both `/models/*` and `/vendor/*` raw (previously only `/models/*`). Without this, Vite's import-analysis plugin mutated the vendored heatmap.js bytes, breaking the SRI check.
- **`LEARNINGS.md`** gained eight new entries covering the four-reviewer review loop as a process, the UX iteration story, the resilience trilogy (vendoring + weight mirroring + SRI), Vite dev-server quirks, the shipping-day Pages flow, the four testing tiers that emerged, structured errors vs. string-sniffing, and the meta-moment of running Foveacast on itself to inform layout.
- **`CONTRIBUTING.md`** coding guide expanded (comments, tests, layer discipline, failure handling, accessibility, dependencies, prose voice, size discipline). `CLAUDE.md` added for AI-assisted workflow notes.

### Notes

- **Model in use:** unchanged from 0.1.0 — MSI-Net, default preset Standard (120×160). No model swap; this release is cleanup and polish.

## [0.1.0] — 2026-04-16

First public cut of Foveacast. V1 per the PRD: a buildless static web app that predicts visual-attention heatmaps entirely in the browser.

### Added (0.1.0 original)

- **Demo mode (`?demo=1`)** — renders a synthetic saliency map over the committed example screenshot without touching the model or the network. Useful for evaluators who want to see output in under a second, and for automated tests that need a fast, deterministic end-to-end surface. A yellow banner and a tiled diagonal watermark in the canvas itself keep the preview from being mistaken for a real prediction.
- **Drop-anywhere support.** A file dropped anywhere on the page is accepted and routed to the same pipeline the drop-zone uses. Before this, dropping a file one pixel outside the drop-zone rectangle navigated the browser away from Foveacast — the worst failure mode for a one-purpose tool.
- **Progressive disclosure.** Opacity slider, view toggle, preset picker, and download button stay hidden until the first heatmap appears. Pre-drop, the page shows only the drop zone, the one-line promise ("Free. No account. Nothing leaves your machine."), and the attribution footer.
- **Queued-drop handling in demo mode.** A file dropped while the background model is still loading is queued and automatically runs inference once the model finishes. Previously the drop zone was dead during the model download.
- **Vendored runtime dependencies under `docs/vendor/`.** TensorFlow.js 4.22.0 (~1.4 MB) and heatmap.js 2.0.5 (~12 KB) now ship in-repo rather than loading from jsDelivr. The "unzip and open `index.html`" promise now holds without any network at all.
- **Mirrored MSI-Net weights at deploy time.** `scripts/fetch-weights.sh` pulls all five presets from the author's Google Cloud Storage bucket into `docs/models/` before the Pages artefact is packaged. The hosted site now serves weights same-origin; the GCS dependency is a fallback, not a runtime requirement.
- **Playwright end-to-end suite** under `tests/e2e/` driven by `pnpm test:e2e`. Six chromium tests against `?demo=1` now cover: canvas non-zero and `getImageData` round-trips (the detached-container regression), pixel-grid colour spread, demo banner presence, progressive disclosure, and drop-zone / controls readiness during background model load.
- **`CONTRIBUTING.md`** covering setup, testing tiers, documentation expectations (including when and how to update `LEARNINGS.md`), commit style, and review checklist.
- **`TODO.md`** capturing prioritised findings from the overnight reviews that were not shipped in this release.

### Fixed

- **Render layer no longer creates a detached heatmap container.** heatmap.js sizes its canvas from `container.offsetWidth` / `offsetHeight`, and both are zero on a detached element — which surfaced as `IndexSizeError: source height is 0` the first time anyone dropped a real screenshot. The container is now attached to `document.body` hidden for the duration of `h337.create`, then detached. Three regression tests added.
- **Demo-mode background model load no longer stomps the drop zone.** Dropzone and controls go live the moment the synthetic preview renders; a file dropped before the real model is ready gets queued rather than silently rejected.
- **README GitHub Pages URLs** are now real (`khawkins98.github.io/Foveacast`) rather than `<owner>` placeholders.
- **Deploy workflow gated on the test suite.** `.github/workflows/deploy.yml` now runs `pnpm test` inline before uploading the Pages artefact. A red `main` no longer ships.
- **Vitest output is quiet again.** jsdom's "Not implemented: HTMLCanvasElement.prototype.getContext" channel is filtered by a small `tests/setup.js`; real errors still surface.
- **Quality-preset documentation aligned with shipped code.** The PRD and README previously described a three-tier preset set that never existed; both now list the five presets the code actually ships.

### Changed

- `scripts/smoke-test.sh` header clarified: it is a liveness check for the dev server, not an end-to-end test. End-to-end coverage now lives in the Playwright suite.
- `docs/src/model/loader.js` now calls `resolveModelUrl(preset)`, which prefers the same-origin `./models/{preset}/model.json` mirror and falls back to the GCS bucket for filesystem / dev-server usage where no mirror has been fetched.

### Added (0.1.0 foundation)

- Static web app under `docs/` served directly by GitHub Pages, with no build step between the source tree and the published site.
- MSI-Net Graph Model loader targeting `@tensorflow/tfjs@4.22.0` from jsDelivr, with progress events during the first-run weight download.
- Five quality presets (Very Low, Low, Standard, High, Very High) mapped to the MSI-Net input dimensions `48x64`, `72x96`, `120x160`, `168x224`, `240x320`. Default is Standard.
- Image preprocessing: resize to the preset's input dimensions, cast to float, clip to 0–255, reverse the channel axis into BGR order, add a batch dimension. Large screenshots (wider than 2560 px) are downsampled before the model sees them.
- Saliency post-processing: bilinear upsample to the original image dimensions, Gaussian blur, normalise to 0–1, compute the centroid of the top-10% saliency region as a first-fixation estimate.
- heatmap.js overlay rendering, composited onto the original image through the Canvas 2D API, with a downloadable PNG export.
- Drop zone with drag-and-drop and click-to-browse, keyboard-operable with Tab and Enter or Space, rejecting non-PNG/JPEG input and files larger than 20 MB at the drop zone.
- Overlay opacity slider, heatmap/original view toggle, preset picker, and download button.
- First-run status banner with progress bar, model-ready confirmation, and the error messages defined in the PRD (download failed, load failed, inference failed, unsupported file, file too large).
- Mobile-browser detection with a friendly "use a desktop" message, per the PRD's browser-support scope.
- WCAG 2.1 AA accessibility pass: skip link, visible focus rings, ARIA live regions for status, reduced-motion support on the progress animation, focus move to the output area after inference.
- Persistent footer with model and preset indicator, attribution to MSI-Net, TensorFlow.js and heatmap.js, a bias-disclosure note, and a "Need more?" link to a modal listing commercial alternatives.
- Vitest test suite covering the preprocess, postprocess, fixation, heatmap render, model loader (mocked), and mobile-guard modules. Six files, 49 tests.

### Notes

- **Model in use:** MSI-Net (Kroner et al., 2020; MIT licence), ~25M parameters, converted to a TF.js Graph Model by the model's author.
- **Default preset:** Standard (120x160 input).
- **Weight hosting:** Google Cloud Storage at `storage.googleapis.com/msi-net/model/{preset}/`. Weights download once and are then served from the browser cache. The PRD's original claim that weights lived on HuggingFace was wrong and was corrected in commit 2; HF hosts the Keras SavedModel, which is not loadable in the browser without a conversion step.
- **Runtime backends:** TF.js picks the best available backend at load time. WebGL is the common case on desktop; WebGPU is used where Chrome exposes it; CPU is the fallback. The UI does not probe or expose this choice.

### Known limitations

- Desktop Chrome and Firefox only; Safari and mobile browsers are out of scope for V1.
- MSI-Net was trained primarily on natural scenes; accuracy drops on dense text, data visualisations and maps.
- First run requires network access to the Google Cloud Storage bucket. There is no vendored mirror in this release (see `LEARNINGS.md` for the resilience follow-up).
