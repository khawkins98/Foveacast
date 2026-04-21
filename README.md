# Foveacast

<p align="center">
  <img src="docs/assets/logo.svg" alt="Foveacast" width="240">
</p>

Predicted attention heatmaps, right in your browser.

![version 0.2.0](https://img.shields.io/badge/version-0.2.0-blue) ![status V3](https://img.shields.io/badge/status-V3-green) ![licence MIT](https://img.shields.io/badge/licence-MIT-lightgrey)

## What it is

*fovea centralis*: the retina's point of sharpest focus + *cast*, to project and predict.

Foveacast takes a screenshot of a web page and shows you where a typical viewer is likely to look first. It runs entirely in the browser on your own machine, so nothing you drop on it ever leaves the device — no account, no upload, no server. It is free and open source.

It is aimed at comms staff, web officers, and UX-aware developers who want a quick sanity check on a layout before publish, without signing up for a commercial predictive-eye-tracking service. Foveacast is a predictive tool, not a real eye-tracking study; the [Reading your results](docs/reading-your-results.md) guide covers what the output can and cannot tell you.

## Try it

**Live at <https://khawkins98.github.io/Foveacast/>** — open it in desktop Chrome or Firefox, drop a screenshot, wait for the one-time model download, read the heatmap.

### Instant preview with demo mode

Don't want to wait on the one-time ~13 MB model download just to see what the tool looks like? Append `?demo=1` to the URL:

```
https://khawkins98.github.io/Foveacast/?demo=1
```

Demo mode loads a committed example screenshot and renders a synthetic saliency map through the real postprocess → fixation → heatmap → composite pipeline. You see output in under a second, no network round-trip to the model file. The banner above the output says plainly that demo output is a synthetic preview, not a real model prediction — drop your own screenshot or remove `?demo=1` to run real inference.

Demo mode also doubles as the target for the Playwright end-to-end test suite (see [Run the tests](#run-the-tests)).

## Run locally

Three ways, in order of how quickly you want to be looking at a heatmap.

### 1. Dev server (quick start)

```sh
pnpm install
pnpm dev
```

Vite serves the `docs/` folder on <http://localhost:5173>. There is no build step — the folder Vite serves is the same folder GitHub Pages publishes. Editing a file reloads the page.

> **Note:** Foveacast requires a proper HTTP/S origin (localhost, GitHub Pages, or similar). Opening `docs/index.html` directly as a `file://` URL no longer works — the service worker that enables WASM threading cannot register from a `file://` origin.

### 3. From a clone

```sh
git clone https://github.com/khawkins98/Foveacast.git
cd Foveacast
pnpm install
pnpm dev
```

## Run the tests

Three tiers, fastest first.

```sh
pnpm test       # vitest — pipeline, render, UI modules under jsdom
pnpm smoke      # dev-server liveness check (boots Vite, curls index.html)
pnpm test:e2e   # playwright against ?demo=1 in a real chromium browser
```

Vitest is the tight feedback loop and runs on every push via GitHub Actions. The smoke script is a sub-second "is the dev server even up" check — useful locally, not in CI. Playwright is the end-to-end surface: it navigates to demo mode in a real browser, waits for the render-ready attribute, and asserts the composited canvas is non-zero and its `getImageData` does not throw. That last check is the regression test for a detached-container bug we shipped in V1 (heatmap.js sized its internal canvas from `offsetWidth`, which is zero on a detached element); the mocked vitest suite could not have caught it, because the bug lived in the gap between our mock and the real library. In V3 we dropped heatmap.js entirely, but the E2E check still serves as the broadest liveness probe for the render pipeline.

Playwright needs chromium installed once:

```sh
pnpm exec playwright install chromium
```

The E2E suite is opt-in rather than part of CI because the browser image adds weight to every build and the suite is already exercised whenever a contributor touches the render or demo path.

## Architecture

Four layers, laid out so the model backend can be swapped without touching anything else:

| Layer | Location | What it does |
|---|---|---|
| `model/` | `docs/src/model/` | Loads the MSI-Net ONNX graph and runs inference. The only place ONNX Runtime Web is imported. |
| `pipeline/` | `docs/src/pipeline/` | Pure functions: preprocess an image to the model's input tensor, upsample → blur → normalise the saliency map, compute the first-fixation centroid. |
| `render/` | `docs/src/render/` | Direct canvas inferno colormap renderer, composites the overlay onto the original image, exports a PNG. |
| `ui/` | `docs/src/ui/` | DOM interaction: drop zone, controls, status banner, mobile-browser guard. |

```
+-----------+     +------------+     +----------+     +----+
|   model   | --> |  pipeline  | --> |  render  | --> | ui |
+-----------+     +------------+     +----------+     +----+
  ORT Web         pure functions   Canvas 2D           DOM
                                   (inferno colormap)
```

The full architecture notes — including the exported contracts each layer must honour — are in [CONTRIBUTING.md](CONTRIBUTING.md) under "Architecture, briefly". The rule that matters in practice: nothing outside `model/` imports `onnxruntime-web`. That is what let V2 swap the model backend without touching anything below — see the 0.2.0 diff in [CHANGELOG.md](CHANGELOG.md) and the long-form account in [LEARNINGS.md](LEARNINGS.md).

## Model history

V1 (0.1.0 / 0.1.1) shipped with MSI-Net through TensorFlow.js — the path the model's author had already proven with a working TF.js Graph Model and five quality presets. V2 (0.2.0) swapped to UNISAL through ONNX Runtime Web. The migration was smaller than expected: every change lived inside `model/`, `pipeline/`, or the boot wiring, and the `render/` + `ui/` layers came through untouched. That outcome is the best-case argument for layer boundary discipline.

The desk-research and hands-on export spike that preceded the V2 merge is preserved at [docs/spikes/unisal-onnx-research.md](docs/spikes/unisal-onnx-research.md). It documents the questions the swap answered and the ones it deliberately left open — most notably, the qualitative comparison between MSI-Net and UNISAL on Foveacast's target content, which the roadmap flags as its own work item. [LEARNINGS.md](LEARNINGS.md) carries the running commentary for both versions.

V3 (0.3.0) switched the model to MSI-Net fine-tuned on UEyes — a web page eye-tracking dataset — still via ORT Web. Three duration variants (1 s / 3 s / 7 s) run in parallel; the Precision Lens redesign rebuilt the UI around the results. The V2 → V3 layer discipline held: again only `model/` and the inference wiring changed; everything below was untouched.

## Attribution

Foveacast stands on two pieces of open-source work:

- **MSI-Net** (Kroner et al. 2020), fine-tuned on UEyes (Jiang et al. 2023) — the saliency model. [github.com/alexanderkroner/saliency](https://github.com/alexanderkroner/saliency)
- **ONNX Runtime Web** — the inference runtime. MIT. [onnxruntime.ai/docs/tutorials/web/](https://onnxruntime.ai/docs/tutorials/web/)
- **heerich** by [meodai](https://github.com/meodai) — the tiny voxel/SVG renderer behind the loading-time wireframe cube/sphere animation. MIT. [github.com/meodai/heerich](https://github.com/meodai/heerich)

Prior to V3, UNISAL (Droste et al., Apache 2.0) was the inference model, and heatmap.js by Patrick Wied (MIT) handled the overlay renderer. Both were removed in 0.3.0.

Full licence text for Foveacast itself is in [LICENSE](LICENSE) (MIT, Ken Hawkins).

## Limitations

- Desktop Chrome and Firefox only. Mobile browsers are out of scope; they do not have the working memory for this kind of inference, and users get a friendly "use a desktop" message instead (now dismissible via a "Proceed anyway" button, at the user's own risk).
- The model was fine-tuned on the UEyes web eye-tracking dataset (six web page categories). Accuracy drops on dense text, data tables, maps, and other content types underrepresented in the training set.
- Output is a probabilistic estimate based on population-average gaze patterns, not measured eye-tracking data. Saliency models have documented biases that reflect their training distribution; the UI carries a non-dismissible note to that effect.
- Images above 20 MB are rejected at the drop zone, and anything wider than 2560 px is downsampled before inference to keep memory behaviour predictable on modest hardware.
- Recommended machine is 8 GB RAM with a reasonably modern CPU. V3 inference is single-threaded on GitHub Pages (the origin cannot set the `Cross-Origin-Embedder-Policy` header that ORT Web threading needs), so performance on an older CPU is slower than V1 was in comparable settings.

## How this was built

Foveacast started as a hypothesis: the underlying science (visual saliency prediction) is well-established, the models are open source, and the browser is now capable enough to run inference locally. If all three are true, the thing a $200-per-seat SaaS sells is packaging and integrations — not the core capability.

V1 was the test of that hypothesis. V2 is the test of whether the V1 architecture bet — strict layer boundaries so the model backend could be swapped cleanly — actually paid off. Both versions were specified, researched, reviewed, and built with heavy AI assistance (Claude Code, Claude Sonnet/Opus). The process is documented in [LEARNINGS.md](LEARNINGS.md) — not as a polished case study, but as a running log written at the time the decisions were made. That file carries: the moment we discovered the MSI-Net TF.js weights were not where the PRD said they were, the bug that shipped because vitest mocked at exactly the wrong layer and was only caught by a user on first drop, the four-reviewer loop that pointed at the UX cliffs we didn't see in our own work, the ship-day pitfalls with GitHub Pages enablement and deploy retry, the moment we ran Foveacast on its own landing page and used the heatmap to inform the next layout pass, and — for V2 — the desk-research-then-hands-on spike that turned a "3–7 day investigation" into a one-day export.

If you're curious about the shape of AI-assisted development on a small, opinionated project, [LEARNINGS.md](LEARNINGS.md) is the primary source. The [CHANGELOG.md](CHANGELOG.md) is the secondary source. A retrospective blog post may eventually draw from both.

## Commercial alternatives

Foveacast covers the "quick sanity check before publish" case. If you need real measured eye-tracking, panel-based studies, or enterprise integrations, these services offer that — note that they are paid, and they send your screenshots to a third party:

- [Attention Insight](https://attentioninsight.com)
- [expoze.io](https://expoze.io)
- [Clueify](https://clueify.com)
- [EyeQuant](https://www.eyequant.com)

## Contributing and maintenance

[CONTRIBUTING.md](CONTRIBUTING.md) covers the practical side — how to set up, the tiers of testing, what goes into a PR, the files that need updating alongside code, and the coding guide (comments, layer discipline, accessibility, dependencies). Read it before opening a PR.

If you work on Foveacast with [Claude Code](https://claude.com/claude-code) or another AI coding assistant, [CLAUDE.md](CLAUDE.md) carries the project-specific instructions for the assistant — testing defaults, commit conventions, pitfalls to avoid, and what needs explicit user confirmation. The assistant reads that file automatically.

A running log of technical decisions, dead ends, and notes for future work lives in [LEARNINGS.md](LEARNINGS.md). [TODO.md](TODO.md) is the prioritised list of known follow-ups — the cheap ones, the ones that matter for resilience, and the ones we explicitly declined. Release history is in [CHANGELOG.md](CHANGELOG.md). [CONTRIBUTING.md](CONTRIBUTING.md) carries the architectural contracts. [docs/methodology.md](docs/methodology.md) is the user-facing explanation of how the model works.
