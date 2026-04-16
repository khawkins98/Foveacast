# Learnings

A running log of what I found out while building Foveacast. Prose, dated, informal. Author: Ken Hawkins.

This file is not a changelog (that's `CHANGELOG.md`) and it isn't the spec (that's `docs/PRD.md`). It's the place where the things that don't fit in either of those live: dead ends, "oh, that's how that actually works" moments, notes for whoever picks the project up next, and small decisions that would otherwise evaporate.

---

## 2026-04-16 — Initial V1 build

V1 shipped as a buildless static site. The source tree under `docs/` is the same folder that GitHub Pages publishes and the same folder a user gets when they unzip the repo and double-click `index.html`. There is no bundler step between edit and publish. Vite is in the project as a dev-time convenience only — it serves `docs/` on localhost and reloads on change, but it is never asked to produce a `dist/` folder. TF.js and heatmap.js come in through `<script>` tags from jsDelivr; everything else is plain ES modules loaded with `type="module"`. No framework. The promise in the PRD about "unzip and open index.html" is only credible if the folder the developer edits is literally the folder the user runs, and this layout makes that true by construction.

## 2026-04-16 — The MSI-Net TF.js weights are not on HuggingFace

The PRD assumed the browser-loadable weights lived at `huggingface.co/alexanderkroner/MSI-Net`. They do not. HuggingFace only hosts the original Keras SavedModel (`saved_model.pb`, roughly 100 MB), which is not loadable in a browser without a conversion step that no one wants to run at page-load time.

The actual TF.js Graph Model weights — already converted by the model author — live at:

```
https://storage.googleapis.com/msi-net/model/{preset}/model.json
```

with `{preset}` in `{very_low, low, medium, high, very_high}`. Each preset ships its own `model.json` and a set of sharded binary weight files alongside it. V1 loads directly from that bucket and lets the browser cache take care of everything after the first run.

This is a resilience risk. If Google deprecates the bucket, or the model author decides to move things, Foveacast breaks for every user whose cache has been evicted. The right follow-up is one of: a small script that pulls the five preset bundles out of GCS into `docs/models/` and commits them, if the total repo size stays reasonable; or a Hugging Face Spaces mirror maintained alongside the upstream. Neither was in V1 scope, but both are cheap to add later and I'd rather do it before the first "why is the tool broken?" issue lands.

## 2026-04-16 — Modernising from TF.js 1.1.2 to 4.x

The reference MSI-Net browser demo pins `@tensorflow/tfjs@1.1.2`. That release is seven years old at this point, which means no WebGPU backend, no SIMD-enabled WASM, and a pile of CDN-hygiene warnings. I bumped it to `@tensorflow/tfjs@4.22.0` and expected breakage.

None appeared. The two APIs Foveacast depends on — `tf.loadGraphModel(url)` and `model.predict(tensor)` — have been stable across that whole window. The preprocessing primitives I use (`fromPixels`, `toFloat`, `expandDims`, `resizeBilinear`, `clipByValue`, `reverse`) behave identically. The only visible difference is that 4.x picks a sensible backend automatically where 1.1.2 needed nudging. I took the quiet upgrade as a gift and moved on.

## 2026-04-16 — WebGPU, WebGL, and CPU fallbacks

Foveacast does not probe for a backend. It calls into TF.js and trusts TF.js to pick one. In the headless gstack browser that ran the integration checks during Phase D, WebGL was unavailable and WebGPU wasn't there either; TF.js fell back to the plain CPU backend without any code on my side. Inference was slower than it would be on a real desktop, but it produced the same tensors. On a real desktop Chrome, WebGL or WebGPU gets picked without any work from us.

The lesson: the PRD was right to insist the fallback be automatic and silent. Anything like "your browser doesn't support WebGPU, please enable…" would be a user-facing bug for a tool that has to work on whatever hardware lands on it.

## 2026-04-16 — heatmap.js is old and quirky

heatmap.js does its job but its job description is from 2013. It stores its backing canvas on a private `_renderer.canvas` field; there's no documented way to reach into the buffer it draws into, and what looks like the official accessor isn't stable across versions. It has no OffscreenCanvas mode. At the top two presets, the output saliency map has more points than the library can render quickly, so Foveacast strides over the map and feeds in a downsampled point set rather than every pixel.

It works. The tests pass, the overlays look correct, and performance is fine once the model has run. But the private-field access and the manual stride are the kind of thing that rots quietly when the library updates, so I am flagging it here as technical debt to revisit for V2. If we're rewriting the model layer for ONNX anyway, that's a natural moment to look at alternatives — a small custom Canvas 2D renderer would probably be less code than the heatmap.js glue plus its workarounds.

## 2026-04-16 — V2 UNISAL investigation (no code)

The PRD's V2 path is UNISAL (Apache 2.0, ECCV 2020) through ONNX Runtime Web. The reason UNISAL rather than a direct accuracy-per-pixel contender is partly licence clarity, partly ecosystem fit: it's pure PyTorch with standard ops, no custom CUDA kernels, which is exactly the profile that `torch.onnx.export` handles cleanly. No code was written for this investigation; what follows is the plan and the open questions.

The migration shape is: keep `pipeline/`, `render/`, and `ui/` untouched; rewrite `model/loader.js` and `model/inference.js` against `onnxruntime-web`; update the preset-to-URL mapping to point at an ONNX artefact instead of a TF.js Graph Model. The `runInference` contract the PRD defines should carry over without changes.

Open questions before committing effort:

- What does the ORT Web WASM bundle add to first-load size compared with the TF.js budget we are paying today?
- Does the WebGPU execution provider cover UNISAL's specific op set (depthwise separable convolution, GRU for the video path)? If not, we fall back to the WASM CPU provider, which is still fine but changes the speed story.
- Is there an existing community-exported UNISAL ONNX model we can start from, or do we own the export end-to-end?

Suggested spike as a separate piece of work: run `torch.onnx.export` on a stock UNISAL checkpoint, validate the resulting graph in ORT on CPU first, and only then try it in ORT Web. That ordering catches export problems without the browser-runtime variable layered on top.

## 2026-04-16 — V3 SUM investigation (no code)

V3 in the PRD is SUM (Saliency Unification through Mamba, WACV 2025 Oral), which matters because it is the only model in the field explicitly trained with a "user interface screenshot" condition. The blocker is well known: SUM's `requirements.txt` pulls in `mamba-ssm` and `causal-conv1d`, both of which ship as compiled CUDA C++ extensions with no ONNX operator equivalents. `torch.onnx.export` cannot trace what it cannot reach; WebAssembly cannot execute compiled CUDA. That is a hard wall, not a config tweak.

There is a potential workaround. Mamba includes a pure-PyTorch naive path reachable by forcing `use_fast_path=False`, which swaps the CUDA kernels out for standard tensor ops. Standard tensor ops are traceable. The question is whether forcing that flag through every layer — including SUM's VMamba visual encoder, which has its own kernel story — produces a graph `torch.onnx.export` can actually write out.

Recommended first step: a small spike that forces `use_fast_path=False` throughout the Mamba and VMamba stacks and checks whether `torch.onnx.export` produces a traceable graph on CPU. If yes, the browser path becomes feasible pending an ORT Web SIMD performance check. If no, the right move is to park V3 and revisit when the Mamba CPU-fallback story in upstream has matured — which it probably will, because the same blocker affects every Mamba-based vision model trying to reach the browser, so the community pressure to fix it is real.

## 2026-04-16 — Open questions picked up from the PRD

Carried over from `docs/PRD.md` §Open Questions. These are live, not resolved.

- **Model accuracy on UN/NGO content types.** Dense text pages, data visualisations, multilingual layouts. Underrepresented in SALICON. Needs a side-by-side qualitative comparison against a commercial tool on representative PreventionWeb-style screenshots.
- **First-run weight-caching UX.** Actual per-preset weight sizes should be measured from the GCS bucket rather than estimated. The status banner text should use those measured numbers.
- **Viewport-comparison feature.** Desktop vs mobile was out of scope for V1 but the second drop-zone slot was left in mind when designing the layout. Leiva et al. (MobileHCI 2020) is the prior-art reading for whoever implements this.
- **Bias-disclosure wording review.** The footer carries a plain-language note about population-average gaze patterns. That wording should get a review pass from someone with a UX-research or research-ethics background before any wider distribution.
