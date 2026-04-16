# Foveacast

Predicted attention heatmaps, right in your browser.

![version 0.1.0](https://img.shields.io/badge/version-0.1.0-blue) ![status V1](https://img.shields.io/badge/status-V1-green) ![licence MIT](https://img.shields.io/badge/licence-MIT-lightgrey)

## What it is

Foveacast takes a screenshot of a web page and shows you where a typical viewer is likely to look first. It runs entirely in the browser on your own machine, so nothing you drop on it ever leaves the device — no account, no upload, no server. It is free and open source.

It is aimed at comms staff, web officers, and UX-aware developers who want a quick sanity check on a layout before publish, without signing up for a commercial predictive-eye-tracking service. Foveacast is a predictive tool, not a real eye-tracking study; the full positioning, and a short list of commercial alternatives worth knowing, lives in [docs/PRD.md](docs/PRD.md).

## Try it

A hosted build is served from GitHub Pages:

<https://khawkins98.github.io/Foveacast/>

### Instant preview with demo mode

Don't want to wait on the ~60 MB first-run model download just to see what the tool looks like? Append `?demo=1` to the URL:

```
https://khawkins98.github.io/Foveacast/?demo=1
```

Demo mode loads a committed example screenshot and renders a synthetic saliency map through the real postprocess → fixation → heatmap → composite pipeline. You see output in under a second, no network round-trip to the model CDN. The banner above the output says plainly that demo output is a synthetic preview, not a real MSI-Net prediction — drop your own screenshot or remove `?demo=1` to run real inference.

Demo mode also doubles as the target for the Playwright end-to-end test suite (see [Run the tests](#run-the-tests)).

## Run locally

Three ways, in order of how quickly you want to be looking at a heatmap.

### 1. Zero install

Download or unzip the repo, open `docs/index.html` directly in Chrome or Firefox, and drop a screenshot onto the drop zone. That's the whole flow. The first run downloads the model weights from Google Cloud Storage; after that the browser cache handles it and the tool works offline.

### 2. Dev server (hot reload)

```sh
pnpm install
pnpm dev
```

Vite serves the `docs/` folder on <http://localhost:5173>. There is no build step — the folder Vite serves is the same folder GitHub Pages publishes, which is the same folder you open when you double-click `index.html`. Editing a file reloads the page.

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

Vitest is the tight feedback loop and runs on every push via GitHub Actions. The smoke script is a sub-second "is the dev server even up" check — useful locally, not in CI. Playwright is the end-to-end surface: it navigates to demo mode in a real browser, waits for the render-ready attribute, and asserts the composited canvas is non-zero and its `getImageData` does not throw. That last check is the regression test for the detached-container bug we shipped and then caught through user testing; the mocked vitest suite could not have caught it, because the bug lived in the gap between our mock and the real library.

Playwright needs chromium installed once:

```sh
pnpm exec playwright install chromium
```

The E2E suite is opt-in rather than part of CI because the browser image adds weight to every build and the suite is already exercised whenever a contributor touches the render or demo path.

## Architecture

Four layers, laid out so the model backend can be swapped without touching anything else:

| Layer | Location | What it does |
|---|---|---|
| `model/` | `docs/src/model/` | Loads the MSI-Net Graph Model and runs inference. The only place TF.js is imported. |
| `pipeline/` | `docs/src/pipeline/` | Pure functions: preprocess an image to the model's input tensor, upsample and normalise the saliency map, compute the first-fixation centroid. |
| `render/` | `docs/src/render/` | Wraps heatmap.js, composites the overlay onto the original image, exports a PNG. |
| `ui/` | `docs/src/ui/` | DOM interaction: drop zone, controls, status banner, mobile-browser guard. |

```
+-----------+     +------------+     +----------+     +----+
|   model   | --> |  pipeline  | --> |  render  | --> | ui |
+-----------+     +------------+     +----------+     +----+
     TF.js        pure functions     heatmap.js +       DOM
                                     Canvas 2D
```

The full architecture notes — including the exported contracts each layer must honour — are in [docs/PRD.md](docs/PRD.md) under "Code architecture". The rule that matters in practice: nothing outside `model/` imports `@tensorflow/tfjs`. That is what makes swapping the backend a contained change.

## Model swap notes

V1 uses MSI-Net through TensorFlow.js because the model's author has already published a working TF.js Graph Model with five quality presets. V2, per the PRD, is meant to move to UNISAL through ONNX Runtime Web. The migration looks small on paper: keep the `pipeline/`, `render/`, and `ui/` layers untouched, rewrite `model/loader.js` and `model/inference.js` against `onnxruntime-web`, and update the preset-to-URL mapping to point at an ONNX artefact instead of a TF.js Graph Model. Both backends expose a "load a graph, feed a tensor, get a tensor back" shape, so the module contract documented in the PRD should carry over.

The open questions are less about code and more about the runtime: ORT Web's bundle size compared with TF.js's, whether the WebGPU execution provider covers UNISAL's depthwise separable convolutions, and how the first-run download UX changes if the model is hosted somewhere other than the existing Google Cloud bucket. Those investigations are the subject of [LEARNINGS.md](LEARNINGS.md) — that file is also where the V3 (SUM) CUDA-kernel blocker is written up. Read it before starting on either a UNISAL or a SUM migration; it will save you rediscovering things the hard way.

## Attribution

Foveacast stands on three pieces of open-source work:

- **MSI-Net** by Alexander Kroner — the saliency model. MIT licence. [github.com/alexanderkroner/saliency](https://github.com/alexanderkroner/saliency)
- **TensorFlow.js** — the inference runtime. Apache 2.0. [tensorflow.org/js](https://www.tensorflow.org/js)
- **heatmap.js** by Patrick Wied — the overlay renderer. MIT licence. [patrick-wied.at/static/heatmapjs](https://www.patrick-wied.at/static/heatmapjs/)

Full licence text for Foveacast itself is in [LICENSE](LICENSE) (MIT, Ken Hawkins).

## Limitations

- Desktop Chrome and Firefox only. Mobile browsers are out of scope; they do not have the working memory for this kind of inference, and users get a friendly "use a desktop" message instead.
- MSI-Net was trained primarily on natural scenes, so accuracy drops on dense text, data tables, maps, and other content types that are underrepresented in the SALICON dataset.
- Output is a probabilistic estimate based on population-average gaze patterns, not measured eye-tracking data. Saliency models have documented biases that reflect their training distribution; the UI carries a non-dismissible note to that effect.
- Images above 20 MB are rejected at the drop zone, and anything wider than 2560 px is downsampled before inference to keep memory behaviour predictable on modest hardware.
- Recommended machine is 8 GB RAM with a reasonably modern CPU; the High and Very high presets are slow on anything smaller. Pick Fast or Low on older hardware.

## Contributing and maintenance

[CONTRIBUTING.md](CONTRIBUTING.md) covers the practical side — how to set up, the tiers of testing, what goes into a PR, and the files that need updating alongside code. Read it before opening a PR.

A running log of technical decisions, dead ends, and notes for future work lives in [LEARNINGS.md](LEARNINGS.md). [TODO.md](TODO.md) is the prioritised list of known follow-ups — the cheap ones, the ones that matter for resilience, and the ones we explicitly declined. Release history is in [CHANGELOG.md](CHANGELOG.md). The PRD at [docs/PRD.md](docs/PRD.md) is the source of truth for scope, non-goals, and the model roadmap — read it before proposing anything larger than a bug fix.
