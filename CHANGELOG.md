# Changelog

All notable changes to Foveacast are recorded here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Demo mode (`?demo=1`)** — renders a synthetic saliency map over the committed example screenshot without touching the model or the network. Useful for evaluators who want to see output in under a second, and for automated tests that need a fast, deterministic end-to-end surface. A yellow banner keeps the preview from being mistaken for a real prediction.
- **Playwright end-to-end suite** under `tests/e2e/` driven by `pnpm test:e2e`. Three chromium tests against `?demo=1` assert the output canvas has non-zero dimensions, `getImageData` does not throw (the detached-container regression), and a pixel-grid sample finds non-trivial colour spread from the heatmap layer.
- **`CONTRIBUTING.md`** covering setup, testing tiers, documentation expectations (including when and how to update `LEARNINGS.md`), commit style, and review checklist.

### Fixed

- **Render layer no longer creates a detached heatmap container.** heatmap.js sizes its canvas from `container.offsetWidth` / `offsetHeight`, and both are zero on a detached element — which surfaced as `IndexSizeError: source height is 0` the first time anyone dropped a real screenshot. The container is now attached to `document.body` hidden for the duration of `h337.create`, then detached. Three regression tests added.

### Changed

- `scripts/smoke-test.sh` header clarified: it is a liveness check for the dev server, not an end-to-end test. End-to-end coverage now lives in the Playwright suite.

## [0.1.0] — 2026-04-16

First public cut of Foveacast. V1 per the PRD: a buildless static web app that predicts visual-attention heatmaps entirely in the browser.

### Added

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
