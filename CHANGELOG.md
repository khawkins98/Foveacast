# Changelog

All notable changes to Foveacast are recorded here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Analysis report** — scrollable report below the interactive heatmap. Presents findings in narrative order: duration tabs, hero heatmap, primary-finding headline from rule-of-thirds breakdown, first-fixation coordinate note, 3×3 rule-of-thirds grid, duration comparison strip, fixation sequence strip, attention zones strip, centroid trajectory section, and a methodology note. Builds in-place as background duration results arrive; earlier results appear without waiting for all three.
- **Duration tabs in the report** — tabbed interface above the hero canvas for switching between viewing durations. Tabs enable as each model's result arrives. Replaces the radio-button group that was in the toolbar.
- **Fixation sequence section** — three-column strip with numbered saccade paths overlaid on heatmap thumbnails, one per viewing duration. Shows the predicted scan order using inhibition-of-return (IoR). Always visible after inference; no toggle required.
- **Attention zones section** — three-column strip of heatmap thumbnails with concentric contour rings at 10%, 25%, and 50% attention mass.
- **Centroid trajectory section** — plain-image canvas with the predicted attention centroid path from first glance to sustained viewing (1 s → 3 s → 7 s). Appears once at least two duration results are ready.
- **Duration labels spell out "seconds"** — "Full viewing (7 seconds)" rather than "Full viewing (7 s)".
- **Commercial alternatives listed in README** — a short section naming paid services that offer real eye-tracking studies, with a note that they are not free and send screenshots to a third party.
- **Print stylesheet** (`docs/print.css`) — clean paper and PDF output. Inverts the dark theme to white, hides all interactive chrome (nav, toolbar, upload zone, controls), and preserves the analysis output: title, hero canvas, report findings, region grid, duration strip, overlay sections, and methodology note. Linked with `media="print"` so screen rendering is unaffected.

### Fixed

- Region-stat percentage was being multiplied twice (raw float × 100 then formatted as percent again), producing values like "4,700%" instead of "47%". Fixed in the rule-of-thirds headline and grid cells.
- Opacity and blend controls are now hidden when the view is set to "Original screenshot", where they have no effect.
- Progress bar stays visible when the user scrolls the report — it is now docked inside the fixed bottom toolbar rather than in the main content flow.

### Changed

- **Single-column layout** — the sidebar/left-dock is gone. Image drop zone and report occupy a single centred column; the controls toolbar is docked at the bottom of the page.
- **Viewing duration moved from toolbar to report** — the toolbar radio group is replaced by duration tabs in the report.
- **Overlay visualizations moved from toolbar to report** — fixation sequence, attention zones, and centroid trajectory are no longer opt-in checkboxes; they appear as static always-visible sections after inference.
- **View + opacity + download controls moved inline** — they now appear directly below the hero canvas instead of in the bottom toolbar. The toolbar is now a loading-indicator-only dock, hidden the rest of the time.
- **Region grid is now an intensity map** — each cell's background is tinted on a heat scale (dark navy → warm amber → hot orange) proportional to its share of attention, giving the 3×3 grid an at-a-glance spatial read.
- **Fixation sequence dots are colour-coded by order** — dot 1 (first, highest priority) is deep navy; the last dot grades to near-white. Number labels auto-contrast against each dot's fill colour.
- **All-caps text removed** — every `text-transform: uppercase` replaced with mixed-case. Letter-spacing reset to neutral; sub-0.6 rem labels bumped to 0.65–0.7 rem.
- **Top navigation reordered and renamed** — "Reading results" → "How to read results" (placed before Methodology); "About" → "GitHub". External nav links open in a new tab.
- **"Analysis Workspace" eyebrow removed** — the redundant label above the canvas title is gone.
- **Show control placed above Opacity** — view-mode picker is now directly under the duration picker, before the overlay-strength slider.

### Removed

- Sidebar / left-dock layout and all sidebar-specific CSS.
- Overlay checkboxes and tooltip "?" buttons from the toolbar.
- Viewing duration radio group from the toolbar.
- Blend mode dropdown — composite operation is hardcoded to `source-over` (normal), which is the only mode that makes perceptual sense for a saliency overlay.

## [0.3.0] — 2026-04-17

V3: the saliency model is now fine-tuned on real UI eye-tracking data. The stock SALICON-pretrained models from V1 and V2 were trained on natural photographs and missed UI-specific attention targets (buttons, CTAs, navigation). V3 fine-tunes [MSI-Net](https://doi.org/10.1016/j.neunet.2020.05.004) (Kroner et al. 2020) on the [UEyes dataset](https://doi.org/10.1145/3544548.3581096) (Jiang et al. 2023) — 1,980 UI screenshots with real eye-tracking from 62 participants. On a held-out test split: CC +43%, KLD −44%, NSS +45% vs the stock model.

The heatmap renderer is also replaced. heatmap.js added visual distortion (radius spreading, stride sampling, internal blur) that made the overlay look more diffuse than the model's actual predictions. The new renderer maps saliency values directly to pixels via the inferno colormap — what you see now matches what the model actually predicts.

### Added

- **V3 saliency models** — MSI-Net fine-tuned on UEyes for three viewing durations (1s, 3s, 7s), each exported as a 57 MB FP16 ONNX artefact from [foveacast-training v0.2.0](https://github.com/khawkins98/foveacast-training/releases/tag/v0.2.0). Input: 240×320 RGB. Output: [0, 1] saliency map with mean subtraction baked into the graph.
- **Viewing-duration picker** — radio-button control letting users switch between first-glance (1 s), quick-scan (3 s), and full-viewing (7 s) models. The selected model loads on demand; inference re-runs automatically on the current image.
- **Direct inferno colormap renderer** (`docs/src/render/saliency-canvas.js`) — pixel-accurate, no external library, perceptually uniform and colour-blind safe. Replaces heatmap.js for the saliency overlay.
- **Deploy-time model fetch** (`scripts/fetch-v3-model.sh`) — the three 57 MB artefacts are downloaded from the foveacast-training GitHub Release at deploy time rather than committed to the repo. Each is SHA256-verified after download. For local dev: `bash scripts/fetch-v3-model.sh` (all) or `bash scripts/fetch-v3-model.sh 3s` (one).
- **Diagnostics panel** — collapsible section below the heatmap output showing source dimensions, model identity, saliency stats, peak location, and preprocessing/postprocess details. Click "Diagnostics" to expand.
- **Attribution footer** credits [MSI-Net](https://doi.org/10.1016/j.neunet.2020.05.004) (Kroner et al. 2020, MIT), [UEyes](https://doi.org/10.1145/3544548.3581096) (Jiang et al. 2023, CC BY 4.0), and [foveacast-training](https://github.com/khawkins98/foveacast-training).

### Changed

- **Inference model: UNISAL (3.7M params, 288×384) → MSI-Net fine-tuned on UEyes (25M params, 240×320).** Larger model but substantially better on UI content. FP16 quantisation keeps the download at 57 MB (vs UNISAL's 12.5 MB).
- **Preprocessing: ImageNet normalisation removed.** V3's ONNX graph handles mean subtraction internally — the preprocessing pipeline now passes raw 0–255 RGB pixels. Aspect-ratio-preserving resize with constant-126 padding replaces the previous stretch-to-fill.
- **Postprocessing: log-probability `exp()` step removed.** V3 outputs direct [0, 1] saliency (min-max normalised inside the graph). Gaussian blur reduced from σ=28 to σ=5 — V3's output is already smooth from the VGG16 decoder's bilinear upsamples.
- **Model delivery: committed artefact → deploy-time fetch.** The `.onnx` file is no longer in the git repo. `deploy.yml` runs `scripts/fetch-v3-model.sh` before the Pages upload step. Eliminates repo bloat for a 57 MB binary.
- **Heatmap rendering: heatmap.js → direct canvas colormap.** The old renderer added radius spreading (40px per point), stride sampling, and internal blur that distorted the spatial precision of the model's predictions. The new renderer maps each pixel directly to the inferno colormap — no spreading, no sampling, no external dependency.

### Removed

- **heatmap.js dependency** — no longer imported by main.js or demo.js. The library file is retained in the repo for reference but unused at runtime.
- **UNISAL model** at `docs/models/unisal/model.onnx` — replaced by V3 duration-specific models fetched at deploy time to `docs/models/v3/{1s,3s,7s}/model.onnx`.

## [0.2.0] — 2026-04-16

V2 per the PRD: the inference model and runtime both change. MSI-Net through TensorFlow.js is replaced by UNISAL through ONNX Runtime Web. The user-visible feature set is unchanged — drop a screenshot, get back a heatmap — but the bytes under the hood are different, and the preset picker is gone because UNISAL is a single fixed-shape model.

This release is a breaking change for anyone with cached MSI-Net weights; the new model is served from `./models/unisal/model.onnx` and the old `./models/{preset}/` paths are no longer populated by any ship path.

### Added

- **UNISAL ONNX model, committed at `docs/models/unisal/model.onnx`** — 12.5 MB single-file artefact, exported from the stock `rdroste/unisal` SALICON checkpoint. No CDN dependency: the file is served same-origin from the repo. The export script lives at `scripts/unisal-onnx-export.py`, with the reproduction recipe documented in the script's docstring.
- **ONNX Runtime Web runtime**, vendored at `docs/vendor/ort.wasm.min.js` + `docs/vendor/ort-wasm-simd-threaded.wasm` + `docs/vendor/ort-wasm-simd-threaded.mjs` (version 1.24.3, MIT licence). Runs single-threaded on GitHub Pages because COEP headers are not available; ORT Web handles the fallback automatically.
- **Desk-research and hands-on export spike write-up** at `docs/spikes/unisal-onnx-research.md`. Answers every question the earlier V2 investigation had left open, including the ORT Web bundle reality, community-export status, and the log-probability output quirk.

### Changed

- **Inference model: MSI-Net (~25M params, 5 presets) → UNISAL (3.7M params, 1 shape).** UNISAL is ~6.7× smaller by parameter count. Input is a fixed 288×384 RGB tensor with ImageNet normalisation. The fixed shape removes the speed/quality trade-off the preset picker used to expose.
- **Inference runtime: `@tensorflow/tfjs` 4.22 → `onnxruntime-web` 1.24.3.** Net first-load budget moved from ~1.4 MB of JS + ~24 MB of weights to ~12 MB of WASM + 12.5 MB of weights. Subsequent cached loads pay only the asset cache cost, which is comparable.
- **Postprocess pipeline** gained a `logProbsToProbabilities` step (`exp(y - max(y))`) before the upsample/blur/normalise path. UNISAL's output is log-softmax over the grid; MSI-Net's was direct 0–255 intensity. The exp step turns the diffuse raw logits into a localised saliency peak.
- **Preprocess layout** moved from NHWC BGR 0–255 (MSI-Net / VGG inheritance) to NCHW RGB ImageNet-normalised 0–1 (UNISAL / MobileNetV2 inheritance). The module is still framework-agnostic — no `onnxruntime-web` dependency.
- **Preset picker removed** from the controls UI. Opacity, view toggle, and download button remain.
- **Attribution footer** credits UNISAL (Apache 2.0) and ONNX Runtime Web (MIT) in place of MSI-Net and TensorFlow.js.
- **First-run banner copy** cites the actual UNISAL download size (~13 MB) rather than MSI-Net's ~60 MB. Ready-state copy unchanged.
- **`loadModel` signature simplified** from `loadModel(preset, onProgress)` to `loadModel(onProgress)`. Progress events now carry real `loaded` / `total` byte counts — `loader.js` fetches via a `ReadableStream` so the progress bar can show byte counts instead of falling back to opaque fractions.
- **Demo-mode synthetic saliency** now generates log-probability-range values at UNISAL's native 288×384 shape so it flows through the same postprocess as real inference.
- **Deploy workflow** no longer calls `scripts/fetch-weights.sh`. The UNISAL artefact is committed, so the Pages upload picks it up directly from the repo.

### Removed

- **`@tensorflow/tfjs` vendor** (`docs/vendor/tf.min.js`, `docs/vendor/LICENCE-TFJS.txt`).
- **`scripts/fetch-weights.sh`** and **`scripts/test-e2e-no-mirror.sh`** — the former mirrored MSI-Net weights at deploy time, the latter simulated a missing mirror in CI. Neither is meaningful under V2's in-repo weight story.
- **Preset-related code** across loader, controls, main, and tests: `PRESETS` constant, `resolveModelUrl`, `GCS_MODEL_URLS`, `LOCAL_MODEL_URLS`, `MODEL_URLS`, `PRESET_CODE_NAMES`, `onPresetChange` callback.

### Notes

- **Quality benchmark against MSI-Net: not done.** The spike doc recommended a qualitative comparison before committing to V2; we shipped anyway. If user-facing output looks worse on real content, the revert path is clean — the layer boundaries held, and a V1 restore is mechanically a diff revert plus re-running `scripts/fetch-weights.sh` (preserved in git history).
- **WebGPU is off.** GitHub Pages cannot set `Cross-Origin-Embedder-Policy: require-corp`, which ORT Web's WebGPU EP needs for threading; the JSEP WASM variant is an extra ~10 MB for capability we cannot use. The ship build is the WASM-only `ort.wasm.min.js`.
- **Model credit:** UNISAL (Droste, Jiao & Noble, ECCV 2020; Apache 2.0), single SALICON-trained export, ~3.7M parameters.

## [0.1.1] — 2026-04-16

Post-release housekeeping. First pass of changes informed by actually using the shipped product, running Foveacast on its own landing page, and closing the smallest items from the overnight reviews that didn't block V1.

### Added

- **`docs/ROADMAP.md`** — candidate themes and features for `0.2.0`, organised by theme (feature depth, model quality, UX polish, distribution, trust/infra). Includes a short versioning note explaining that the PRD's "V1/V2/V3" numbering is about model generations and is orthogonal to semver. Menu, not a plan; the maintainer picks.
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
inear upsample to the original image dimensions, Gaussian blur, normalise to 0–1, compute the centroid of the top-10% saliency region as a first-fixation estimate.
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
