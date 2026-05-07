<div align="center">
  <img src="docs/assets/logo.svg" alt="Foveacast logo" width="220">
  <h1>Foveacast</h1>
  <p>Predicted attention heatmaps, right in your browser.</p>

  [![version 0.3.0](https://img.shields.io/badge/version-0.3.0-blue)](CHANGELOG.md) [![model MSI-Net V3](https://img.shields.io/badge/model-MSI--Net_V3-green)](docs/methodology.md#the-model-msi-net-fine-tuned-on-ueyes) [![licence MIT](https://img.shields.io/badge/licence-MIT-lightgrey)](LICENSE)

  **[Try it live →](https://khawkins98.github.io/Foveacast/)**
</div>

---

*fovea centralis*: the retina's point of sharpest focus + *cast*, to project and predict.

Drop a screenshot of a web page and Foveacast shows you where a "typical" viewer is likely to look first. It runs entirely in the browser — nothing you drop ever leaves your device. No account, no upload, no server. Free and open source.

Aimed at those who want a quick sanity check on a layout before publishing, without signing up for a commercial predictive eye-tracking service. The [Reading your results](docs/reading-your-results.md) guide covers what the output can and cannot tell you.

<p align="center">
  <img src="docs/assets/example-screenshot.jpg" alt="Foveacast — screenshot with predicted attention heatmap overlay" width="700">
</p>

## Highlights

- **Runs offline** — model inference happens in your browser; nothing is uploaded
- **Three viewing durations** — first glance (1 s), quick scan (3 s), full viewing (7 s)
- **MSI-Net V3** — fine-tuned on real UI eye-tracking data from the [UEyes dataset](https://doi.org/10.1145/3544548.3581096)
- **Full analysis report** — rule-of-thirds breakdown, fixation sequence, attention zones, centroid trajectory
- **No account needed** — free, open source, drop and go

The first visit downloads about 57 MB of ONNX model weights (one per duration). Subsequent visits load them from your browser cache, so repeat use is fast and stays fully offline.

## Run locally

```sh
pnpm install
pnpm dev
```

Vite serves the `docs/` folder on <http://localhost:5173>. There is no build step — the folder Vite serves is the same folder GitHub Pages publishes. Editing a file reloads the page.

## Run the tests

Three tiers, fastest first.

```sh
pnpm test       # vitest — pipeline, render, UI modules under jsdom
pnpm smoke      # dev-server liveness check (boots Vite, curls index.html)
pnpm test:e2e   # playwright against ?demo=1 in a real chromium browser
```

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

The full architecture notes — including the exported contracts each layer must honour — are in [CONTRIBUTING.md](CONTRIBUTING.md) under "Architecture, briefly". The rule that matters in practice: nothing outside `model/` imports `onnxruntime-web`. The [CHANGELOG.md](CHANGELOG.md) and [LEARNINGS.md](LEARNINGS.md) have the long-form account of how the V2 model swap validated the boundary.

## Attribution

Foveacast stands on open-source work:

- **MSI-Net** (Kroner et al. 2020), fine-tuned on UEyes (Jiang et al. 2023) — the saliency model. [github.com/alexanderkroner/saliency](https://github.com/alexanderkroner/saliency)
- **ONNX Runtime Web** — the inference runtime. MIT. [onnxruntime.ai/docs/tutorials/web/](https://onnxruntime.ai/docs/tutorials/web/)
- **heerich** by [meodai](https://github.com/meodai) — the tiny voxel/SVG renderer behind the loading-time wireframe cube/sphere animation. MIT. [github.com/meodai/heerich](https://github.com/meodai/heerich)

Full licence text for Foveacast itself is in [LICENSE](LICENSE) (MIT, Ken Hawkins).

## Limitations

- Desktop Chromium and Firefox. Mobile browsers are out of scope; many do not have the working memory for this kind of inference.
- The model is fine-tuned on the UEyes web eye-tracking dataset (six web page categories). Accuracy drops on dense text, data tables, maps, and other content types underrepresented in the training set.
- Output is a probabilistic estimate based on population-average gaze patterns, not measured eye-tracking data. Saliency models have documented biases that reflect their training distribution; the UI carries a non-dismissible note to that effect.
- Images above 20 MB are rejected at the drop zone, and anything wider than 2560 px is downsampled before inference to keep memory behaviour predictable on modest hardware.
- Recommended machine is at least 8 GB RAM with a reasonably modern CPU.

## How this was built

Foveacast started as a hypothesis: the underlying science (visual saliency prediction) is well-established, the models are open source, and the browser is now capable enough to run inference locally. The process is documented in [LEARNINGS.md](LEARNINGS.md) — not as a polished case study, but as a running log written at the time the decisions were made. The [CHANGELOG.md](CHANGELOG.md) is the secondary source. A retrospective blog post may eventually draw from both.

## Commercial alternatives

Foveacast covers the "quick sanity check before publish" case. If you need real measured eye-tracking, panel-based studies, or enterprise integrations, these services offer that — note that they are paid, and they send your screenshots to a third party:

- [Attention Insight](https://attentioninsight.com)
- [expoze.io](https://expoze.io)
- [Clueify](https://clueify.com)
- [EyeQuant](https://www.eyequant.com)

## Contributing and maintenance

[CONTRIBUTING.md](CONTRIBUTING.md) covers the practical side — how to set up, the tiers of testing, what goes into a PR, the files that need updating alongside code, and the coding guide (comments, layer discipline, accessibility, dependencies). Read it before opening a PR.

If you work on Foveacast with [Claude Code](https://claude.com/claude-code) or another AI coding assistant, [CLAUDE.md](CLAUDE.md) carries the project-specific instructions for the assistant — testing defaults, commit conventions, pitfalls to avoid, and what needs explicit user confirmation. The assistant reads that file automatically.

A running log of technical decisions, dead ends, and notes for future work lives in [LEARNINGS.md](LEARNINGS.md).
