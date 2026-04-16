# Foveacast — PRD

**Product name:** Foveacast  
**Status:** Draft  
**Version:** 0.6  
**Author:** Ken Hawkins

---

## Problem Statement

Communications and UX teams need to understand where users are likely to look on a web page before it goes live — without access to specialist eye-tracking hardware, a UX researcher, or a paid SaaS subscription. Existing predictive tools (Attention Insight, Brainsight) solve this problem but introduce account friction, recurring cost, and data-sharing concerns. There is no good self-contained, offline-capable option.

Foveacast is that option. It is free, open source, runs entirely in the user's browser, and shares no data with any server — not the image, not the result, not any usage telemetry. Everything stays on the user's machine.

Foveacast is also an experiment in a broader question: how much of what organisations pay $150–200 per seat per month for can be replicated as a free, open tool that any colleague can use without an account, without a procurement process, and without their work leaving their machine? The answer, at least for predictive attention heatmaps, turns out to be: most of it.

---

## Goal

Build a tool that accepts a screenshot of a web page and returns a predicted visual attention heatmap, running entirely on the user's own machine with no server, no account, and no data leaving the device.

---

## Target Users

- **Communications staff** reviewing campaign pages, landing pages, and editorial layouts before publish
- **Web officers and designers** checking visual hierarchy and CTA prominence
- **UX-aware developers** wanting a quick attention sanity-check without a full research study

Primary context: small-to-medium digital teams in NGOs, public sector, and international organisations — users who are not data scientists and should not need to be.

---

## Non-Goals

- Real-time webcam-based gaze tracking
- Behaviour-based heatmaps from live user sessions (that is a different product category)
- URL crawling, headless rendering, or backend infrastructure of any kind
- Replacing a real eye-tracking study for high-stakes decisions

---

## Positioning and Alternatives

Foveacast occupies a specific niche: **free, private, offline-capable, and open source**. It is deliberately not trying to compete with commercial tools on features. Users who need richer analysis, design tool integrations, team collaboration, or higher-accuracy models should use a commercial service — and Foveacast should say so clearly in its UI rather than pretending those tools do not exist.

### What Foveacast is

- Free, with no account and no subscription
- Open source — the model, the code, and the methodology are all inspectable
- Private — no image or result ever leaves the user's machine
- Lightweight — a single page, no install, no dependencies to manage
- Honest about limitations — predictive estimates, not measured eye-tracking data

### What Foveacast is not

It is not a replacement for professional UX research, real eye-tracking studies, or the commercial tools below for teams that need their capabilities.

### Commercial alternatives worth knowing

These tools offer more robust analysis pipelines, higher model accuracy in some cases, and integrations that Foveacast does not have and does not intend to build. They are worth using when the use case justifies the cost and data-sharing trade-off.

| Tool | Notable features | Integrations |
|---|---|---|
| **[Attention Insight](https://attentioninsight.com)** | Predictive heatmaps, clarity score, AOI analysis, free tier available | Figma plugin, browser extension, Adobe XD |
| **[Brainsight](https://www.brainsight.app)** | Predictive heatmaps, gaze plot, scroll heatmaps, benchmarking | Figma plugin |
| **[Neurons (formerly Predict)](https://www.neuronsinc.com)** | Neuroscience-backed model, cognitive demand scoring, benchmarks | Figma, Adobe XD, browser extension |
| **[EyeQuant](https://www.eyequant.com)** | Perception score, region of interest analysis, A/B comparison | API access, browser extension |
| **[Tobii](https://www.tobii.com)** | Hardware-based real gaze tracking for high-confidence research | Lab and remote study setups |

Foveacast's UI should include a short "Need more?" note — not buried in the footer, but accessible from the main interface — pointing to this list. The framing should be generous: these are good tools, Foveacast is a different kind of tool, both have their place.

---

## Input / Output

**Input:** A screenshot image (PNG or JPEG), drag-and-dropped or file-picked by the user.  
**Output:** The original screenshot with a semi-transparent predicted attention heatmap blended over it, plus a marked "first fixation" centroid estimate.

Optional secondary output: a downloadable PNG of the heatmap overlay.

---

## Core User Flow

1. User opens the app (web browser, local file, or installed app depending on version)
2. User drags a screenshot onto the drop zone, or clicks to browse
3. App displays a loading indicator while inference runs
4. App renders the screenshot with heatmap overlay
5. User can adjust overlay opacity via a slider
6. User can toggle between "attention heatmap" view and "clean screenshot" view
7. User can download the composited result

No account. No upload to a server. No configuration required.

---

## Versions

### Version 1 — Static Web App (primary target)

A self-contained static web application that runs entirely in the browser using TensorFlow.js inference.

**Model:** MSI-Net (MIT licence, ~25M parameters)  
**Distribution:** Single HTML file plus model weights, hostable on GitHub Pages or distributable as a downloaded folder. Users open `index.html` in any modern browser.  
**Inference:** TensorFlow.js — the model author has published a working TF.js browser demo with quality presets (very low → very high), providing a direct reference implementation. No ONNX conversion step required. Model weights download once on first use and are cached by the browser thereafter. The converted TF.js Graph Model weights are hosted on Google Cloud Storage (`storage.googleapis.com/msi-net/model/{preset}/`); HuggingFace hosts only the original Keras SavedModel, which is not loadable in the browser without a conversion step.  
**Rendering:** heatmap.js for the attention overlay. Canvas API for compositing.

**Key constraint:** No build step required to use. The download should be "unzip and open index.html."

**Why MSI-Net for V1:** Not because it is the most accurate model available, but because it is the only candidate with a proven browser inference path. The model author has already done the hard work of converting to TF.js and exposing quality presets. This makes V1 an assembly task rather than a research engineering task.

**Limitations to communicate to users:**
- Inference runs on the user's CPU/GPU — performance varies by device
- Model was trained primarily on natural scenes; accuracy is lower on dense text, data tables, and maps
- Output is a probabilistic estimate based on population-average gaze patterns, not measured eye-tracking data

---

### Version 2 — Improved Model + Tauri Option

Two parallel improvements that may ship together or separately depending on effort.

**2a — UNISAL model upgrade (static web app, same distribution)**

Swap MSI-Net for UNISAL via ONNX Runtime Web. UNISAL (Apache 2.0, ECCV 2020) is smaller and faster than MSI-Net and was designed for joint image/video saliency — meaning it generalises better across content types. It is pure PyTorch with standard ops, making the ONNX export path straightforward in principle (though not yet attempted for browser deployment).

Migration path: PyTorch model → `torch.onnx.export` → ONNX graph validation → ONNX Runtime Web (WebAssembly + WebGPU backends).

**2b — Tauri native app (optional, parallel track)**

A packaged native desktop application for users who prefer an installed experience or need faster inference on low-end hardware.

- Distribution: signed installer for macOS and Windows via GitHub Releases
- Inference: ONNX Runtime via the Rust `ort` crate — same ONNX model as 2a, faster than WebAssembly
- Additional: CoreML execution provider on Apple Silicon, DirectML on Windows
- Additional: drag-from-Finder/Explorer, file associations, offline-first without browser cache dependency

**When to prioritise 2b:** If V1 inference performance is unacceptably slow on typical hardware, or if user feedback requests a native install experience.

---

### Version 3 — SUM model (stretch goal, research track)

Upgrade to SUM (Saliency Unification through Mamba, WACV 2025 Oral, MIT licence) — the academically correct model for this use case because it explicitly includes a UI/web page inference condition (`--condition 3`) trained on interface screenshots rather than natural scenes.

**Why this is a stretch goal rather than V2:** SUM's performance advantage over earlier models comes from custom CUDA kernels (`mamba-ssm`, `causal-conv1d`). These compiled CUDA extensions cannot be directly exported to ONNX or run in WebAssembly. A workaround exists — Mamba includes a pure PyTorch naive implementation (`use_fast_path=False`) that avoids the custom kernels — but this path has not been validated for SUM specifically, and some ops in the VMamba visual encoder may have their own kernel dependencies. The conversion is doable but requires hands-on investigation and is not guaranteed.

**Investigation required before committing to V3:**
1. Load SUM with `use_fast_path=False` forced throughout the model
2. Verify inference output matches the CUDA-kernel version on sample images
3. Attempt `torch.onnx.export` and inspect the graph for unresolved custom ops
4. Test the resulting ONNX model in ONNX Runtime (CPU) before attempting browser deployment
5. If successful, test in ONNX Runtime Web (WebAssembly backend)

If the naive path works, V3 would ship the same static web app interface as V1/V2 but with meaningfully better accuracy on web/UI content — which is the primary use case.

---

## Research Background

Predictive eye-tracking heatmaps are a well-established research field, distinct from actual gaze tracking. The approach uses deep learning models trained on large human fixation datasets to predict where people will look in an image, without any camera hardware.

### Scientific basis

The field is grounded in computational models of visual saliency — the tendency of certain image regions to attract attention based on low-level features (contrast, colour, edges), mid-level features (symmetry, junctions), and high-level semantic features (faces, text, objects). Modern deep saliency models have demonstrated strong predictive accuracy against held-out human eye-tracking data on standard benchmarks (MIT300, SALICON).

Key research:
- **Itti & Koch (1998)** — foundational bottom-up saliency model based on contrast, orientation, and colour features. Historically important; superseded by deep models.
- **Bylinskii et al. (2017)** — "Learning Visual Importance for Graphic Designs and Data Visualizations." *UIST 2017*. The most direct academic precedent for Foveacast: a saliency model trained specifically on graphic designs and data visualisations rather than natural scenes. Validates the core problem Foveacast is solving — that natural-scene models apply the wrong priors to designed content. Code available.
- **Leiva et al. (2020)** — "Understanding Visual Saliency in Mobile User Interfaces." *MobileHCI 2020*. Saliency specific to mobile UI layouts; directly relevant to the planned desktop/mobile viewport comparison feature.
- **Fosco et al. (2020)** — "Predicting Visual Importance Across Graphic Design Types." *UIST 2020*. Cross-design-type generalisation — relevant to whether a model trained on one content category transfers to others.
- **Kroner et al. (2020)** — MSI-Net. "Contextual Encoder-Decoder Network for Visual Saliency Prediction." *Neural Networks*. doi:10.1016/j.neunet.2020.05.004. Preprint: arXiv:1902.06634.
- **Droste, Jiao & Noble (2020)** — UNISAL. "Unified Image and Video Saliency Modeling." *ECCV 2020*. arXiv:2003.05477.
- **Kümmerer et al. (2021)** — benchmarking study confirming deep saliency models (MSI-Net, DeepGaze II, SAM-ResNet) as state-of-the-art predictors of human attention across both low-level and high-level features. *Scientific Reports*.
- **Chen et al. (2023)** — "What Do Deep Saliency Models Learn about Visual Attention?" *NeurIPS 2023*. Meta-analysis of saliency model behaviour; useful for understanding and communicating model limitations. Code available.
- **Cartella et al. (2024)** — "Trends, Applications, and Challenges in Human Attention Modelling." *IJCAI 2024 Survey Track*. Comprehensive peer-reviewed survey of the field. arXiv:2402.18673. The single best overview citation for Foveacast's research background.

### Training datasets

- **SALICON** — the primary training dataset for most modern web-applicable models. Collected via mouse movement as a proxy for gaze (established as a valid proxy in controlled studies). Contains images from MS-COCO, including a mix of natural scenes and structured content.
- **MIT300 / MIT1003** — standard eye-tracking benchmarks used for model evaluation. Natural scene photographs with recorded fixation data.
- **DHF1K, Hollywood-2, UCF-Sports** — video saliency datasets used by UNISAL for joint image/video training.

---

## Model Selection

### Model strategy by version

| Version | Model | Role | Licence | Browser path |
|---|---|---|---|---|
| V1 | MSI-Net | Ship now | MIT ✓ | TF.js ✓ proven |
| V2 | UNISAL | Upgrade path | Apache 2.0 ✓ | ONNX conversion (standard ops, feasible) |
| V3 | SUM | Stretch goal | MIT ✓ | ONNX conversion (CUDA kernel blocker — see investigation log) |

---

### V1 model: MSI-Net

**Repository:** [github.com/alexanderkroner/saliency](https://github.com/alexanderkroner/saliency)  
**HuggingFace:** [huggingface.co/alexanderkroner/MSI-Net](https://huggingface.co/alexanderkroner/MSI-Net)  
**Licence:** MIT ✓ confirmed  
**Parameters:** ~25M  
**Framework:** TensorFlow (SavedModel); TF.js port exists and demonstrated by the author

Selected for V1 because the model author has already published a working TF.js browser demo with quality presets, making V1 an integration task not a research engineering task.

**Architecture:** Contextual encoder-decoder with ASPP module for multi-scale feature extraction. VGG16 encoder backbone pretrained on ImageNet, fine-tuned on SALICON.

**Known limitations (from the official model card):**
- Trained under free-viewing paradigm; may not match task-directed attention
- Training data was primarily natural images; lower accuracy on dense text, data tables, patterns
- Saliency-based models have shown racial and gender biases in cropping applications — output reflects average patterns from training population

---

### V2 model: UNISAL

**Repository:** [github.com/rdroste/unisal](https://github.com/rdroste/unisal)  
**Licence:** Apache 2.0 ✓ confirmed  
**Parameters:** ~5–20× smaller than MSI-Net  
**Framework:** PyTorch (standard ops, no custom CUDA kernels)  
**Paper:** Droste, Jiao & Noble (2020), ECCV. arXiv:2003.05477

UNISAL achieves state-of-the-art performance across image and video saliency datasets with significantly fewer parameters than competing models. Its joint image/video training means it generalises better across content types. Standard PyTorch ops make the ONNX export path straightforward in principle, though not yet attempted for browser deployment.

**ONNX conversion path:** `model.eval()` → `torch.onnx.export` with fixed input shape → validate with `onnxruntime` CPU → test in `onnxruntime-web` (WebAssembly + WebGPU backends).

---

### V3 model: SUM

**Repository:** [github.com/Arhosseini77/SUM](https://github.com/Arhosseini77/SUM)  
**Licence:** MIT ✓ confirmed  
**Paper:** Hosseini et al. (2025), WACV Oral. arXiv:2406.17815  
**Framework:** PyTorch + VMamba (custom CUDA kernels — see investigation log)

SUM is the academically strongest model for Foveacast's use case. It is the only model in this survey explicitly trained with a UI/web page condition as a first-class data type, using a Conditional Visual State Space (C-VSS) block that adapts attention priors by image type. At inference, `--condition 3` selects UI-optimised priors. See the investigation log for a full account of the browser deployment blocker and potential workaround path.

---

### Other candidates considered and not selected

| Model | Licence | Notes | Decision |
|---|---|---|---|
| **FastSal** | Unconfirmed | MobileNetV2 backbone, near real-time on CPU. Potentially fastest browser option. | Licence must be confirmed before use |
| **TranSalNet** | Unconfirmed | Transformer-based, higher accuracy than MSI-Net. DenseNet-161 or ResNet-50 backbone. | Licence unconfirmed; heavier than UNISAL |
| **EML-NET** | Unconfirmed | Parallel multi-backbone encoder, strong benchmarks. | Licence unconfirmed |
| **DeepGaze IIE** | Unconfirmed | Very high benchmark accuracy. ResNet-50 based. | Large; licence unconfirmed; no meaningful advantage over SUM for UI content |
| **SalNAS** | Unconfirmed | NAS-optimised (2024), 20.98M params, self-knowledge distillation. | No confirmed licence or browser path |
| **SalM²** | Unconfirmed | AAAI 2025, extremely small (0.0785M params). | Trained for driver attention in traffic scenes — wrong domain |

---

### Quality presets

Expose inference quality as a user-facing preset, following the pattern from the MSI-Net TF.js demo. The demo ships five tiers and Foveacast exposes the same five under human-readable labels. The underlying input dimensions are `H × W` in pixels, matching the dims the model author converted the weights against.

| Preset label (dropdown) | Preset code | Input dims (H × W) | Expected speed | Use case |
|---|---|---|---|---|
| Fast (very low) | `very_low` | 48 × 64 | Quickest; least detailed output | Rough sanity check on older or modest hardware |
| Low | `low` | 72 × 96 | Faster than Standard; still coarse | Quick pass when Fast feels too blocky |
| Standard | `medium` | 120 × 160 | The default; balances speed and detail | Most reviews |
| High | `high` | 168 × 224 | Slower; more detailed contours | Detailed review before publish |
| Very high (slowest) | `very_high` | 240 × 320 | Slowest; most detailed output | Final pass on a fast machine |

---

### Post-processing pipeline

Raw model output is a float32 saliency map. Applied regardless of model version:
1. Upsample to match original screenshot dimensions (bilinear interpolation)
2. Normalise values to 0–1 range
3. Apply Gaussian blur (σ ≈ 20–40px at 1× resolution) for smooth contours
4. Compute centroid of top-10% saliency region as "first fixation" point estimate
5. Pass float array to heatmap.js for colour mapping and Canvas compositing

---

## Technical Stack

### Version 1 — Static Web App

| Component | Choice | Rationale |
|---|---|---|
| Inference runtime | TensorFlow.js | MSI-Net author has proven browser path; no ONNX conversion needed |
| Saliency model | MSI-Net | MIT licence, 25M params, TF.js demo exists, weights on the model CDN |
| Heatmap rendering | heatmap.js | ~3kB gzip, well-maintained, Canvas-based |
| Image compositing | Canvas 2D API | No dependencies |
| UI framework | Vanilla JS | Avoid build toolchain; "unzip and open" distribution goal |
| Model hosting | Google Cloud Storage (converted TF.js weights published by the model author); bundled fallback out of scope for V1 | First load download; cached by browser thereafter |
| Distribution | GitHub Pages + downloadable zip | Zero infrastructure, zero cost |

### Version 2 — UNISAL upgrade + optional Tauri

| Component | Choice | Rationale |
|---|---|---|
| Inference runtime | ONNX Runtime Web | WebAssembly (all browsers) + WebGPU (Chrome/Edge acceleration) |
| Saliency model | UNISAL | Apache 2.0, smaller/faster than MSI-Net, standard ONNX export path |
| Model format | ONNX | Single format works for both browser (ORT Web) and Tauri (`ort` crate) |
| Tauri inference (2b) | `ort` Rust crate | CoreML on Apple Silicon, DirectML on Windows |
| Heatmap rendering | heatmap.js | Unchanged from V1 |
| Distribution | GitHub Pages + GitHub Releases (Tauri) | |

### Version 3 — SUM (if CUDA blocker resolved)

Same stack as V2 but with SUM weights and ONNX graph. Frontend unchanged. The condition token (`3` for UI) is baked into the ONNX graph at export time or passed as a fixed input tensor.

---

## Development Practices

Foveacast is a personal/small-team tool intended to be maintained over time and potentially extended by others. The codebase should reflect that: clear, tested, documented, and structured so that swapping model backends (the most likely significant change) does not require rewriting the application.

### Test-driven development

Write tests before or alongside implementation, not after. For a tool whose core output is a float array rendered as a visual, tests serve a specific purpose: catching regressions when model weights or post-processing parameters change, and verifying that the preprocessing pipeline (resize, normalise, pad) produces the correct tensor shape and value range at every step.

Minimum test surface:
- Image preprocessing pipeline — input dimensions in, correct tensor shape and normalisation range out
- Post-processing pipeline — raw saliency float array in, correctly upsampled, blurred, and normalised output
- First fixation centroid calculation — known saliency map in, correct centroid coordinates out
- Canvas compositing — heatmap overlay renders at correct dimensions without clipping
- Model loading — weights load without error and session initialises correctly

Tests should run headlessly (no browser required for logic tests) using a framework like Vitest or Jest. Canvas-dependent tests can use a lightweight mock or run in a jsdom environment.

### Code architecture

The codebase should be organised around clear module boundaries so that the model backend can be swapped (MSI-Net → UNISAL → SUM) without touching the UI layer or the post-processing pipeline.

Suggested module separation:
- `model/` — model loading, session management, inference call. All framework-specific code (TF.js or ONNX Runtime Web) lives here and nowhere else.
- `pipeline/` — preprocessing and post-processing. Pure functions with no framework dependencies; the easiest layer to test.
- `render/` — heatmap.js integration and Canvas compositing.
- `ui/` — DOM interaction, drag-and-drop, slider, download button.

Each module should expose a minimal, typed interface. The `model/` module in particular should present a single `runInference(imageTensor) → Float32Array` contract so that the rest of the codebase is indifferent to whether the backend is TF.js or ONNX Runtime Web.

### Documentation standards

All public functions and module interfaces should carry JSDoc comments — parameter types, return types, and a one-line description of purpose. Comments should explain *why*, not *what*; the code explains what.

The README should be kept current and cover: what Foveacast is, how to run it locally, how to run the tests, and the model version in use.

### Commit conventions

Use [Conventional Commits](https://www.conventionalcommits.org/) throughout:

```
feat: add opacity slider to heatmap overlay
fix: correct tensor normalisation range for high-res preset
docs: update learnings.md with ONNX conversion attempt notes
chore: bump onnxruntime-web to 1.20.0
test: add pipeline unit tests for gaussian blur post-processing
refactor: extract model loading into dedicated module
```

Commit messages should be written as a record of intent, not just action — future readers (including the author six months later) should be able to understand *why* a change was made from the commit message alone when the diff is ambiguous.

### Maintained files

Two files should be kept current alongside the codebase:

**`CHANGELOG.md`** — one entry per release, following [Keep a Changelog](https://keepachangelog.com/) format. Sections: Added, Changed, Fixed, Removed. Each entry should note the model version in use at that release, since a model swap is functionally a breaking change from the user's perspective (heatmap outputs will differ).

**`LEARNINGS.md`** — a running log of technical decisions, dead ends, and discoveries that do not belong in commit messages or the changelog. Written in plain prose, dated, and informal. Examples of what belongs here: notes from the SUM ONNX conversion investigation, observations about inference speed differences across browsers, unexpected behaviour in TF.js WebGPU backend, accuracy comparisons between MSI-Net quality presets. This file is the basis for future blog posts and is explicitly part of the development workflow, not an afterthought.

### Deployment

The canonical deployment target is **GitHub Pages**, served from the `gh-pages` branch or the `/docs` folder of `main`. A GitHub Actions workflow should handle deployment automatically on push to `main`:

1. Run tests — fail the workflow if any test fails
2. Build (if a build step exists; V1 may be buildless)
3. Deploy to GitHub Pages

Model weights should not be committed to the repository. They should be fetched from the model CDN at runtime (V1/TF.js) or linked in the README with download instructions. The `.gitignore` should explicitly exclude weight files (`*.pb`, `*.onnx`, `*.bin` above a size threshold) to prevent accidental commits.

---

## Browser Support

**Supported:** Chrome and Firefox on desktop (macOS, Windows, Linux). These are the primary targets and all features must work correctly in both.

**Not supported:** Mobile browsers. Inference requires meaningful CPU/GPU resources and working memory that mobile devices cannot reliably provide. The tool is a desktop workflow aid — this is a deliberate scope decision, not an oversight. Mobile users who open the URL should see a clear, friendly message explaining that Foveacast is designed for desktop use.

**Not required but beneficial:** WebGPU acceleration is available in Chrome and behind a flag in Firefox. Where present it significantly speeds up inference. The fallback to WebAssembly CPU must be automatic and silent — users should not need to know or care which backend is running. Do not test for WebGPU and show an error; test for it and use it if present.

**Safari:** Not a target for V1. WebAssembly support in Safari is sufficient in principle, but TF.js WebGPU and WASM SIMD behaviour in Safari has historically been inconsistent enough to deprioritise. May be revisited for V2.

---

## First-Run Experience

The first time a user opens Foveacast, the model weights need to download before inference is possible. This is the highest-risk moment for user abandonment and must be handled explicitly.

**On page load:** Immediately begin downloading model weights in the background. Show a visible, friendly loading banner — not a spinner alone — that explains what is happening in plain language: "Downloading the attention model (one-time, ~60MB). This takes a minute on first open; after that it's instant." Show a progress bar with percentage or MB downloaded.

**Drop zone state before weights are ready:** The drop zone should be visible but clearly inactive — greyed out with a label like "Ready once model loads…". Do not hide it; showing it sets expectations about what comes next.

**On completion:** Animate the drop zone to its active state with a brief confirmation ("Model ready"). No page reload required.

**On subsequent visits:** Weights are cached by the browser. The tool should be usable within a few seconds of page load. Show a brief "Loading model from cache…" indicator so users know something is happening.

**Browser cache eviction:** If cached weights have been cleared, the full download experience repeats. This should be treated as a first-run, not a silent failure.

---

## Error States and Failure Modes

Foveacast should fail gracefully and informatively in all cases. The following are the expected failure scenarios and the correct response to each.

**Model download failure** (network error, CDN unavailable): Show a clear error message with a retry button. Do not leave the user on a broken loading state. Message: "Couldn't download the model — check your connection and try again."

**Model load failure** (weights corrupted, incompatible format): Show an error with a "Clear cached data and retry" option that clears the cached weights and triggers a fresh download. Message: "There was a problem loading the model. Try clearing the cache and reloading."

**Unsupported file type** (user drops a PDF, TIFF, SVG, etc.): Reject gracefully at the drop zone with an inline message. Do not silently fail or show a blank output. Message: "Foveacast accepts PNG and JPEG screenshots. Try saving your image as a PNG first."

**File too large** (image exceeds a defined maximum — suggested 20MB): Reject at drop with a clear message. Message: "That image is too large. Try a screenshot under 20MB, or use a lower screen resolution."

**Inference timeout or failure** (WASM crash, out-of-memory, unexpected model error): Show a recoverable error state that allows the user to try again or try a different quality preset. Message: "Something went wrong during analysis. Try the Fast preset, or use a smaller image."

**WebGPU context lost** (GPU reset during inference, common on some hardware): Detect the context loss, fall back to WASM CPU silently, and retry inference automatically. If the retry also fails, surface the generic inference error above.

**General principle:** Every error state must offer a clear next action. No dead ends. Errors should be logged to the browser console with enough detail for a developer to diagnose, but the user-facing message should always be plain English and actionable.

---

## Attribution

Foveacast is built on open-source models and libraries whose licences require attribution. This must appear in the UI — not only in the README or a separate licence file — because the tool is distributed as a static page without a conventional installation flow.

A small, persistent footer (or a modal accessible from an "About" link) must include:

- **Model credit:** "Attention prediction powered by [MSI-Net](https://github.com/alexanderkroner/saliency) by Alexander Kroner, MIT licence" — updated to reflect the active model at each version release.
- **Runtime credit:** TensorFlow.js (V1) or ONNX Runtime Web (V2+), with licence.
- **Rendering credit:** heatmap.js by Patrick Wied, MIT licence.
- **Model version indicator:** Which model and quality preset is currently in use. This is functional as well as attributive — users comparing outputs across sessions need to know if the model changed.

The footer should also carry the bias disclosure: a brief, plain-language statement that heatmap outputs reflect population-average gaze patterns from the model's training data and should not be treated as measurements of any specific user's attention.

---

## Accessibility

Foveacast should meet WCAG 2.1 AA as a minimum. Given that it is a tool for reviewing visual design, shipping it in an inaccessible state is particularly inconsistent.

**Keyboard navigation:** The drop zone must be keyboard-accessible — focusable with Tab, activatable with Enter or Space to open a file picker. All controls (opacity slider, view toggle, download button) must be operable without a mouse.

**Screen reader support:** The drop zone needs a clear ARIA label and role. The heatmap output, being a visual graphic, needs an accessible text alternative — at minimum, an `aria-label` on the canvas element describing what it represents (e.g. "Predicted attention heatmap for uploaded screenshot"). The first fixation point should be described in text as well as visually marked.

**Colour contrast:** All UI text must meet AA contrast ratios. The heatmap colour scale (red-to-blue) is readable for most common forms of colour vision deficiency, but the tool should not rely solely on colour to communicate the first fixation point — use a shape (crosshair or dot) with a label as well.

**Motion:** The inference loading animation should respect `prefers-reduced-motion`. A static progress indicator is an acceptable fallback.

**Focus management:** After inference completes, focus should move to the output area so keyboard users are not left at the top of the page.

---

## Memory and System Requirements

Foveacast's inference pipeline makes real demands on the host machine. These should be communicated clearly during onboarding rather than discovered as slow or failed inference.

**Recommended:** 8GB RAM or more, modern CPU with at least 4 cores. Chrome or Firefox updated within the last 6 months.

**Minimum:** 4GB RAM. Inference at High quality preset may be slow or fail.

**Onboarding note:** On first run, alongside the model download progress, show a brief system note: "Foveacast runs the attention model directly in your browser. For best results, close other tabs and applications before running analysis. The High quality preset needs a reasonably fast computer — use Fast or Standard on older machines."

This framing sets expectations without gatekeeping. Users on modest hardware can still use the tool; they just need to know to choose the Fast preset.

**Image size cap:** Images above 20MB should be rejected at the drop zone (see Error States). Independently of file size, images wider than 2560px should be downsampled to 2560px before being passed to the preprocessing pipeline, regardless of the quality preset chosen. This prevents out-of-memory failures on large retina screenshots without requiring the user to manually resize.

---

## UI Requirements
- Drop zone accepts drag-and-drop and click-to-browse
- Loading state clearly communicated (spinner + "Running inference…" label)
- Overlay opacity slider (0–100%, default ~60%)
- Toggle: heatmap overlay / original / side-by-side
- "First fixation" point marked with a crosshair or dot
- Download button for composited result
- No login, no nav, no settings panel — single focused function

---

## Success Criteria

- A user with no technical background can go from screenshot to heatmap in under 60 seconds
- Inference completes in under 15 seconds on a mid-range laptop at the default (Standard) preset
- The tool runs fully offline after first model weight download
- Output is visually interpretable without explanation — the heatmap is self-evident

---

## Open Questions

1. **Model accuracy on UN/NGO content types** — dense text pages, data visualisations, multilingual layouts are underrepresented in SALICON training data. Validate by running sample PreventionWeb screenshots through both this tool and Attention Insight (free tier) and comparing outputs qualitatively.
2. **Model weight caching UX** — first load will involve a noticeable download. Exact weight size per preset should be measured directly from the Google Cloud Storage bucket on first run (likely 20–80MB depending on quality tier). Need a clear progress indicator and a plain-language explanation of why the first run is slow.
3. **WebGPU availability** — TF.js can use WebGPU where available for significantly faster inference. Fallback to WebAssembly must be seamless and automatic. Test in Chrome and Firefox; Safari is not a V1 target.
4. **Multiple screenshots / viewport comparison** — out of scope for V1 but a high-probability early request (desktop vs mobile). Design V1 layout with a second drop zone slot in mind. Leiva et al. (MobileHCI 2020) on mobile UI saliency is relevant background reading before implementing this.
5. **FastSal licence** — MobileNetV2-based, near real-time on CPU. If MSI-Net proves too slow on low-end hardware this is the most attractive fallback, but the repo has no clear licence file.
6. **Bias disclosure placement** — the MSI-Net model card explicitly notes racial and gender biases. The UI must carry a visible, non-dismissible note that outputs reflect population-average attention patterns.
7. **SUM ONNX conversion feasibility** — the naive PyTorch path for V3 has not been attempted. This is the highest-value unresolved technical question for the roadmap. See investigation log.

---

## Investigation Log

This section documents research conducted during PRD development. Retained for future reference and as source material for a potential technical blog post.

---

### The experiment behind Foveacast

Foveacast started as a question rather than a specification: how much of what organisations pay $150–200 per seat per month for can be replicated as a free, open tool built with AI-assisted development?

Commercial predictive eye-tracking tools are genuinely useful. But their pricing model assumes a professional design or research team with a budget, a procurement process, and an IT-approved SaaS stack. Many of the people who would benefit most from a quick attention check — a communications officer reviewing a campaign page, a web officer checking a new template, a programme team preparing a report — sit outside that model entirely. They either don't have access to the tool, share one account across a team, or skip the check altogether.

The hypothesis was that the underlying science — visual saliency prediction — is well-established, the models are open source, and the browser has become capable enough to run inference locally without a server. If that's true, the main thing the $200/seat is buying is the packaging, the integrations, and the brand — not the core capability.

Foveacast is the test of that hypothesis. It was specified and researched with AI assistance (Claude), will be built with AI coding tools, and is intended to be shared freely with colleagues who can use it without an account, without IT involvement, and without their work leaving their machine. The investigation log documents what was found along the way — both what was easier than expected and what remains genuinely hard.

The honest answer so far: for the core use case (screenshot in, heatmap out, free, private), the hypothesis holds. For the things that matter beyond the core — Figma integration, team collaboration, benchmark comparisons, higher-accuracy models tuned for UI content — the commercial tools still earn their keep.

---

### Why not a bookmarklet or browser extension?

The initial concept was a JS bookmarklet or browser extension. This was set aside for two reasons. First, real saliency models are PyTorch or TensorFlow — not browser-native — so a bookmarklet would need either a backend API (which breaks the offline/private goal) or a very capable WASM runtime. Second, for the screenshot-only input model we settled on, a static web app is simpler, more portable, and avoids the App Store/extension store approval process entirely.

---

### Why screenshots rather than URL input?

URL input would require headless browser rendering (Playwright, Puppeteer) to produce the screenshot that the model actually needs. This reintroduces backend infrastructure, defeats the offline goal, and creates problems with authentication walls, cookie banners, and lazy-loaded content. Screenshots sidestep all of this: the user provides exactly what they want analysed. Desktop vs mobile viewport comparison — a natural follow-on feature — is handled by the user taking two screenshots rather than requiring Foveacast to simulate two viewports.

---

### Actual vs predictive eye tracking

Two fundamentally different approaches exist. **Actual gaze tracking** uses webcam-based tools (WebGazer.js from Brown HCI, or MediaPipe FaceMesh + TensorFlow.js) to infer where a specific user is looking in real time. This requires consent, calibration, and produces noisy data on unconstrained webcams. **Predictive saliency** uses models trained on large fixation datasets to estimate where people will look in an image — no camera, no user, instant results. Foveacast uses the predictive approach throughout.

---

### The saliency model landscape (as of April 2026)

The field is mature and well-benchmarked. Standard evaluation datasets are MIT300 (300 natural images, 39 observers), MIT1003, SALICON (mouse-proxy gaze, MS-COCO images), and CAT2000. The main benchmark leaderboard is maintained at saliency.mit.edu.

Models evaluated during this research, in rough chronological order:

**MSI-Net (Kroner et al., Neural Networks 2020)** — MIT licence. TensorFlow, ~25M parameters. The only model with a proven TF.js browser demo (published by the author). Trained on SALICON. Encoder is VGG16 pretrained on ImageNet. Selected for V1.

**UNISAL (Droste, Jiao & Noble, ECCV 2020)** — Apache 2.0 licence. PyTorch, significantly smaller than MSI-Net. Joint image/video training on SALICON, DHF1K, Hollywood-2, UCF-Sports. State-of-the-art on video saliency; competitive on image saliency. Standard PyTorch ops — clean ONNX export path. Selected for V2.

**FastSal (Hu & McGuinness, 2020)** — Licence unconfirmed. PyTorch, MobileNetV2 backbone, near real-time on CPU (>30fps). Most compelling candidate for browser inference on low-end hardware if licence clears. Not selected pending licence confirmation.

**TranSalNet (Lou et al., Neurocomputing 2022)** — Licence unconfirmed. Transformer-based encoder integrated into CNN via skip connections. Higher accuracy than MSI-Net, significantly heavier. Not selected.

**EML-NET (Jia & Bruce, 2020)** — Licence unconfirmed. Parallel multi-backbone encoder; can combine ImageNet and Places pretrained models. Not selected.

**SalNAS (Termritthikun et al., 2024)** — Licence unconfirmed. Neural Architecture Search-optimised model with self-knowledge distillation. 20.98M parameters. Interesting architecture but no confirmed licence or browser path. Filed for future review.

**SalM² (Zhao et al., AAAI 2025)** — Licence unconfirmed. Mamba-based, extremely small (0.0785M parameters). Trained exclusively for driver attention in traffic scenes. Domain mismatch makes it unsuitable for Foveacast regardless of licence.

**SUM (Hosseini et al., WACV 2025 Oral)** — MIT licence. The most directly relevant model for Foveacast's use case. See separate entry below.

---

### SUM: why it matters and why it's hard

SUM (Saliency Unification through Mamba) was the most significant finding in this research. It is the only model in this survey that treats web/UI screenshots as a first-class training category rather than applying natural-scene priors to interface layouts.

**The UI condition advantage:** SUM uses a Conditional Visual State Space (C-VSS) block to adapt its attention priors based on a condition token passed at inference time. The four conditions are: `0` — natural scenes (mouse proxy), `1` — natural scenes (eye-tracking), `2` — e-commerce images, `3` — user interface images. Passing `--condition 3` means the model applies attention patterns learned from UI screenshots, not from photographs of outdoor scenes. For a tool whose primary use case is checking web page layouts, this is the difference between a model that knows interfaces and one that is guessing by analogy.

**The browser deployment blocker:** SUM's `requirements.txt` includes `mamba-ssm==1.0.1` and `causal-conv1d==1.0.2`. These implement Mamba's selective scan and causal depthwise convolution as compiled CUDA C++ extensions. `torch.onnx.export` cannot trace custom CUDA ops — they have no ONNX operator equivalents. WebAssembly cannot execute compiled CUDA code. This is a hard wall, not a configuration problem.

**The potential workaround:** Mamba includes a pure PyTorch naive implementation (`use_fast_path=False`) that replaces the CUDA kernels with standard tensor operations. Standard tensor ops can be traced to ONNX. The question is whether forcing `use_fast_path=False` throughout SUM's full forward pass — including the VMamba visual encoder, which may have its own kernel dependencies — produces a graph that exports cleanly. This has not been attempted. The investigation steps (documented in the Versions section) are the next concrete action if V3 is prioritised.

**What a working V3 would mean in practice:** Same static web app, same user experience, meaningfully better accuracy on the content type Foveacast's users actually care about. The argument for investing in the SUM conversion is strong if the naive path works. If it doesn't, UNISAL (V2) is a defensible long-term model — it is faster, smaller, and was trained on more diverse content than MSI-Net, even if it lacks SUM's explicit UI condition.

**Looking further ahead:** The Mamba CUDA kernel problem is not unique to SUM. It affects any Mamba-based vision model (SalM², various VMamba variants) that wants to reach browser deployment. As ONNX Runtime Web and WebGPU mature, and as the community builds pure-PyTorch fallback paths for Mamba operations, this blocker is likely to dissolve. SUM or a successor model will eventually be browser-deployable without heroic engineering effort. The PRD should be reviewed against the state of `onnxruntime-web` and `mamba-ssm` CPU fallback support before V3 is scoped.

---

---

## Out of Scope (explicitly)

- URL input and headless rendering
- Video or animated GIF input
- Scanpath / gaze path animation (fixation sequence)
- Demographic or task-based attention variation
- Any form of analytics or usage tracking

---

## References

**Survey and discovery**
- Cartella, G. et al. (2024). Trends, applications, and challenges in human attention modelling. *IJCAI 2024 Survey Track*. [arXiv:2402.18673](https://arxiv.org/abs/2402.18673)
- AImageLab. Awesome Human Visual Attention. [github.com/aimagelab/awesome-human-visual-attention](https://github.com/aimagelab/awesome-human-visual-attention) — curated paper list maintained by the AImageLab group at University of Modena; used during model selection research for this PRD. Last updated May 2025.

**Design-specific saliency — most directly relevant prior work**
- Bylinskii, Z. et al. (2017). Learning visual importance for graphic designs and data visualizations. *UIST 2017*. [arXiv:1708.02660](https://arxiv.org/abs/1708.02660) — code: [github.com/cvzoya/visimportance](https://github.com/cvzoya/visimportance)
- Leiva, L.A. et al. (2020). Understanding visual saliency in mobile user interfaces. *MobileHCI 2020*. [arXiv:2101.09176](https://arxiv.org/abs/2101.09176)
- Fosco, C. et al. (2020). Predicting visual importance across graphic design types. *UIST 2020*. [arXiv:2008.02912](https://arxiv.org/abs/2008.02912) — code: [github.com/diviz-mit/predimportance-public](https://github.com/diviz-mit/predimportance-public)

**Models and implementations**
- Kroner, A. et al. (2020). Contextual encoder-decoder network for visual saliency prediction. *Neural Networks*, 129, 261–270. doi:[10.1016/j.neunet.2020.05.004](https://doi.org/10.1016/j.neunet.2020.05.004) — preprint: [arXiv:1902.06634](https://arxiv.org/abs/1902.06634) — code: [github.com/alexanderkroner/saliency](https://github.com/alexanderkroner/saliency) (MIT)
- Droste, R., Jiao, J., & Noble, J.A. (2020). Unified image and video saliency modeling. *ECCV 2020*. [arXiv:2003.05477](https://arxiv.org/abs/2003.05477) — code: [github.com/rdroste/unisal](https://github.com/rdroste/unisal) (Apache 2.0)
- Hosseini, A. et al. (2025). SUM: Saliency unification through Mamba for visual attention modeling. *WACV 2025 (Oral)*. [arXiv:2406.17815](https://arxiv.org/abs/2406.17815) — code: [github.com/Arhosseini77/SUM](https://github.com/Arhosseini77/SUM) (MIT)
- Hu, F. & McGuinness, K. (2020). FastSal: a computationally efficient network for visual saliency prediction. [arXiv:2008.11151](https://arxiv.org/abs/2008.11151) — code: [github.com/feiyanhu/FastSal](https://github.com/feiyanhu/FastSal) (licence unconfirmed)
- Lou, J. et al. (2022). TranSalNet: towards perceptually relevant visual saliency prediction. *Neurocomputing*. — code: [github.com/LJOVO/TranSalNet](https://github.com/LJOVO/TranSalNet) (licence unconfirmed)
- Termritthikun, C. et al. (2024). SalNAS: efficient saliency-prediction neural architecture search with self-knowledge distillation. *Engineering Applications of Artificial Intelligence*, 136. doi:10.1016/j.engappai.2024.109030 — code: [github.com/chakkritte/SalNAS](https://github.com/chakkritte/SalNAS) (licence unconfirmed)
- Zhao, C. et al. (2025). SalM²: an extremely lightweight saliency Mamba model for real-time cognitive awareness of driver attention. *AAAI 2025*. — code: [github.com/zhao-chunyu/SaliencyMamba](https://github.com/zhao-chunyu/SaliencyMamba)

**Prior research on model accuracy and limitations**
- Kümmerer, M. et al. (2021). Deep saliency models learn low-, mid-, and high-level features to predict scene attention. *Scientific Reports*, 11. doi:[10.1038/s41598-021-97879-z](https://doi.org/10.1038/s41598-021-97879-z)
- Chen, S. et al. (2023). What do deep saliency models learn about visual attention? *NeurIPS 2023*. [arXiv:2310.09679](https://arxiv.org/abs/2310.09679) — code: [github.com/szzexpoi/saliency_analysis](https://github.com/szzexpoi/saliency_analysis)

**Inference runtimes**
- Microsoft. ONNX Runtime Web. [onnxruntime.ai](https://onnxruntime.ai/docs/tutorials/web/) (MIT licence)
- TensorFlow.js. [tensorflow.org/js](https://www.tensorflow.org/js)
- Gu, A. & Dao, T. Mamba: linear-time sequence modeling with selective state spaces. — code: [github.com/state-spaces/mamba](https://github.com/state-spaces/mamba) (Apache 2.0) — relevant to SUM CUDA kernel investigation

**Benchmarks and datasets**
- MIT Saliency Benchmark. [saliency.mit.edu](http://saliency.mit.edu)
- MIT/Tübingen Saliency Benchmark. [bethgelab.org/media/uploads/saliency_benchmark](https://bethgelab.org/media/uploads/saliency_benchmark/)
- SALICON dataset. [salicon.net](http://salicon.net)

**Heatmap rendering**
- heatmap.js. [patrick-wied.at/static/heatmapjs](https://www.patrick-wied.at/static/heatmapjs/) (MIT licence)
