# UNISAL → ONNX Runtime Web — desk-research spike

**Date:** 2026-04-16
**Scope:** Research-only. No code, no model download, no export attempt.
**Purpose:** Answer the open questions in [LEARNINGS.md §V2 UNISAL investigation](../../LEARNINGS.md) cheaply enough that we can decide whether to commit to a hands-on export spike.

## TL;DR

UNISAL exports to ONNX should work mechanically — every op the model uses is standard PyTorch, the image-only path cleanly bypasses the convolutional GRU, and there is no `torch.jit` or custom-autograd machinery in the way. The real cost is at the runtime layer: ORT Web ships a much larger WebAssembly binary than TensorFlow.js does, and the saving on the weight-file side is meaningful but not dramatic. The research unblocks a hands-on export spike (option B). It does not, on its own, justify committing to a V2 swap.

**Recommendation:** Proceed to option B on a one-day time box. Do not plan a `0.2.0` UNISAL integration until B validates the export and a separate qualitative comparison confirms UNISAL is actually better than MSI-Net on the screenshots Foveacast's users care about.

**Confidence:** high that export will work, medium on weight-file size (needs B to confirm), low on whether the trade-off is worth it absent user complaints about MSI-Net quality.

---

## Open questions, answered

### 1. Op-set coverage — will the model export cleanly?

Yes, with one shape gotcha and one Python-side branching quirk to handle at export time.

**What the model actually uses** (from [`unisal/model.py`](https://github.com/rdroste/unisal/blob/master/unisal/model.py) and [`unisal/models/cgru.py`](https://github.com/rdroste/unisal/blob/master/unisal/models/cgru.py)):

- Backbone: MobileNetV2 (the vendored `unisal/models/MobileNetV2.py`, not torchvision's — but the op set is the same).
- Decoder: `nn.Conv2d` + `nn.BatchNorm2d` + `nn.ReLU6` / `nn.ReLU` + `nn.Upsample` (bilinear) + `nn.Dropout2d`, glued with `F.interpolate` and `F.pad`.
- Convolutional GRU: manual gate math implemented as `Conv2d` + `sigmoid` + `tanh`, not `torch.nn.GRUCell`. Python `for t in range(T)` loop over time steps.
- Domain adaptation: a custom `DomainBatchNorm2d` that holds one `BatchNorm2d` per source dataset, plus per-source `adaptation` 1×1 conv, per-source Gaussian priors, per-source smoothing kernels.
- Output: sigmoid on the final saliency map.

No custom CUDA kernels. No `torch.jit` anywhere. No custom `autograd.Function`.

**The image path bypasses the GRU entirely.** `model.py` has:

```python
if not (static and self.bypass_rnn):
    rnn_feat_seq, hidden = self.rnn(feat_seq_1x, hidden=h0)
```

So an export that fixes `static=True` and `bypass_rnn=True` never enters the time-step loop. That eliminates the one construct in the model that would have needed either unrolling or ONNX Loop-op support.

**Two things to resolve at export time:**

1. **Five-dimensional input.** UNISAL's forward signature is `(batch, time, channel, h, w)`. For single-image inference we pass `[1, 1, 3, H, W]` and take `[1, 1, 1, H, W]` back out. The export wrapper should either squeeze the time dim inside a thin nn.Module adapter, or the browser-side pre-/post-processing does the extra reshape. Neither is hard; naming it here so the export script doesn't paper over it.

2. **Source-string branching.** `forward(..., source="DHF1K")` does dataset-name string manipulation:

   ```python
   source_str = f"_{source.lower()}"
   self.__getattr__("adaptation" + source_str)
   ```

   `torch.onnx.export` traces a single execution path, so the exported graph will hard-code whatever `source` was passed at export time. That is fine for our use case — we want the SALICON path (images, static content) — but it means the exported artefact is source-specific. If we ever wanted both SALICON- and MIT1003-tuned outputs we would export once per source.

**Verdict on op coverage:** clean. Every op is on the ORT-Web "fully supported" list for both WASM (CPU) and WebGPU execution providers. No custom contrib ops required.

### 2. Bundle size — what does ORT Web cost us?

Significantly more than TF.js. Numbers below are from Microsoft's own discussions, rounded for legibility:

| Build | WASM size | Gzipped | Notes |
|---|---|---|---|
| Default WebGPU-capable (`ort-wasm-simd-threaded.jsep.wasm`) | ~20 MB | ~6 MB | What you get out of the box from `onnxruntime-web@latest` |
| MinSizeRel optimised | ~8 MB | ~3 MB | Source-build flags, slower inference |
| Minimal (ORT-format) | ~3 MB | ~1 MB | Requires converting the model to `.ort`, only the ops your model uses are linked |
| CPU-only WASM (`ort-wasm-simd-threaded.wasm`) | ~10 MB | ~3 MB | Drop WebGPU support, CPU-only inference |

The main JavaScript bundle (`ort.all.min.js`) sits above 500 KB by itself; a tree-shaken import of just `onnxruntime-web/wasm` reportedly reduces that meaningfully, though the exact figure depends on the version and bundler.

**Compared to today:**

| Asset | V1 today (TF.js) | V2 likely (ORT Web, WebGPU-capable) |
|---|---|---|
| Runtime (JS + WASM) | 1.4 MB (`tf.min.js`) | 8–20 MB (WASM) + ~0.5 MB (JS) |
| First-run weight download (medium preset) | ~24 MB | est. 5–15 MB (UNISAL is 5–20× smaller than MSI-Net per PRD) |
| **First-run total** | **~25 MB** | **~15–35 MB** |

In other words: the runtime budget gets worse, the weights budget gets better, the net first-run total is probably a wash or slightly worse for the default build. The minimal build would come out clearly ahead, but it requires converting UNISAL to `.ort` format locally and an ORT-Web build that only contains the ops UNISAL needs — doable, but it moves the project out of "fetch a prebuilt runtime from a CDN" territory.

Sources: [ORT discussion #24161 on WebGPU WASM size](https://github.com/microsoft/onnxruntime/discussions/24161), [ORT issue #14817 on WASM size](https://github.com/microsoft/onnxruntime/issues/14817), [ORT Web deploy docs](https://onnxruntime.ai/docs/tutorials/web/deploy.html).

### 3. COEP, threading, and GitHub Pages compatibility

ORT Web falls back to single-threaded WASM on origins that do not serve `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp`. It does not error — it just runs slower. That matches the product's "nothing leaves your machine, `/docs` folder is what GitHub Pages serves" positioning: we would be shipping ORT Web in single-threaded mode and accepting whatever perf hit that implies.

GitHub Pages cannot set COEP headers. That constraint is real and permanent for this project. Sources: [ORT issue #19148](https://github.com/microsoft/onnxruntime/issues/19148), [web.dev cross-origin-isolation guide](https://web.dev/articles/cross-origin-isolation-guide).

### 4. Community ONNX exports

None found. Searches across GitHub and HuggingFace ([UNISAL on GitHub search](https://github.com/search?q=UNISAL+onnx)) turn up the original PyTorch repo and KDSalBox (a distilled-model toolbox that includes UNISAL) but no community-contributed ONNX artefact.

One adjacent lead: [KDSalBox](https://github.com/ardkastrati/KDSalBox) ships knowledge-distilled versions of several saliency models, UNISAL included. If the distilled variant is small enough and preserves UNISAL's behaviour well, it could be a more efficient export target than the stock checkpoint. Flagging this as a side-investigation for option B, not as a dependency.

**Implication:** we own the ONNX export end-to-end. There is no "download someone else's artefact, wire it up, done" shortcut.

### 5. Integration shape (if V2 goes ahead)

The module architecture in [`docs/PRD.md`](../PRD.md) was drafted with this swap in mind. Concretely, a V2 merge would:

- Rewrite `docs/src/model/loader.js` against `onnxruntime-web` instead of `@tensorflow/tfjs`. `ort.InferenceSession.create(url, { executionProviders: ['webgpu', 'wasm'] })` is the shape.
- Rewrite `docs/src/model/inference.js` to build an `ort.Tensor`, call `session.run`, and pull the output back. Contract stays `runInference(image) → { saliency, width, height }`.
- Replace `docs/src/pipeline/preprocess.js`'s MSI-Net-specific pre-processing (BGR reverse, 0–255 range, no normalisation) with UNISAL's (likely ImageNet mean/std + 0–1 range — confirm in option B).
- Collapse or re-label the preset picker. UNISAL is a single checkpoint, not a five-preset family. One natural mapping: one "fast" preset that resizes to a smaller input, one "quality" preset at the model's native resolution.
- Drop the Google Cloud Storage dependency entirely. UNISAL's weight file should be small enough (est. 5–15 MB) to commit directly into `docs/models/`, eliminating the runtime bucket-hostage problem that motivated the vendoring work in 0.1.1.
- Keep `docs/src/pipeline/postprocess.js`, `pipeline/fixation.js`, `render/heatmap.js`, `render/download.js`, `ui/*` — all unchanged. The layer boundary the PRD insists on pays off here.

Files that would see **no diff** in a V2 merge: everything under `docs/src/pipeline/`, `docs/src/render/`, `docs/src/ui/`, `docs/src/demo.js`, and the Playwright suite. That is the best possible outcome for a model-backend swap and vindicates the V1 architecture choice.

---

## Trade-off matrix

| Dimension | MSI-Net (V1, today) | UNISAL (V2 candidate) |
|---|---|---|
| Runtime bytes (JS + WASM) | ~1.4 MB | 8–20 MB |
| Weights per preset | ~24 MB | est. 5–15 MB (needs export to confirm) |
| Preset count | 5 (48×64 → 240×320) | 1 (or 2 if we resize at input time) |
| Weight hosting | GCS dependency, mirrored to `docs/models/` at deploy | Likely committable directly into the repo |
| Single-threaded WASM fallback | Not applicable (TF.js handles this differently) | Yes, graceful, slower |
| WebGPU path | TF.js has it; used in practice on Chromium | ORT Web has it via jsep build |
| Content-type generalisation | Poor on dense text / dashboards (PRD §Open Questions) | Better in principle — trained on more varied data — but unverified on our content |
| Licence | MIT | Apache 2.0 |
| Known failure modes | Narrow-content bias, WebGL fallback quirks on older GPUs | Unknown at browser scale; nobody has shipped this yet |

---

## Recommendation

1. **Proceed to option B on a one-day time box.** The export is almost certainly going to work mechanically. What option B actually proves is: what the exported file size is, whether ORT Web (Node or CPU) produces outputs that match stock UNISAL, and whether the single-threaded browser inference speed is acceptable on a realistic screenshot.

2. **Do not commit UNISAL as V2 before a qualitative comparison.** The argument for V2 is "UNISAL is better for Foveacast's actual content." That argument is currently a speculation grounded in "UNISAL was trained on more diverse data." Before rewriting the model layer, run the separate ["Model-quality benchmarking" roadmap item](../ROADMAP.md) on ~20 representative screenshots against both models. If UNISAL doesn't measurably help on UN/NGO-style dense-text pages, we are paying 6–15 MB of extra wasm for nothing.

3. **Re-evaluate after B and after the benchmark.** Plausible outcomes from the combination:
   - Both green → plan a `0.3.0` that lands V2 with the preset picker collapsed.
   - Export green, benchmark equivocal → write the findings up, keep V1, revisit only if a user reports a real accuracy problem.
   - Export blocked by a surprise → update this doc, keep V1, consider FastSal as the next candidate pending licence clarification.

4. **Consider the minimal-build path separately.** If V2 is eventually chosen, there is a second spike worth doing on shipping a minimal ORT-format build containing only UNISAL's ops. That path cuts the runtime from ~8 MB down to ~3 MB of wasm. It requires a local ORT build, which is a meaningful one-time setup, but it brings the runtime budget back into the same order of magnitude as TF.js today. Not required for an initial V2, but a natural follow-up.

---

## What option B would produce

Scoping option B ahead of time so we know what "done" looks like if we pull the trigger on it:

- A one-off Python script (`scripts/unisal-onnx-export.py`, kept out of the shipped `docs/` tree) that:
  - Clones `rdroste/unisal` into `/tmp` or a sibling directory.
  - Loads `training_runs/pretrained_unisal/weights_best.pth` into the stock `UNISAL` class, patched to fix `source="SALICON"` and `static=True` and drop the `bypass_rnn` conditional.
  - Calls `torch.onnx.export` with a `[1, 1, 3, 384, 288]`-ish dummy input (confirm input resolution from `run.py` / `Trainer` in B).
  - Validates the resulting `.onnx` file by loading it in `onnxruntime` (CPU) and diffing the output against stock UNISAL on 2–3 sample images.
- An ONNX artefact (not committed) plus a report in this same `docs/spikes/` folder with:
  - Final exported file size.
  - Output-diff numbers (per-pixel, or some reasonable summary statistic).
  - Inference time in `onnxruntime` CPU on a test laptop.
  - Any export gotchas encountered.
- A go / no-go recommendation for the ORT Web browser-integration spike that would follow.

Explicitly out of scope for option B: running the exported model in a browser. That is a separate piece of work; it doesn't make sense to spend the ORT Web integration budget before we know the export itself produces sensible output.

---

## Out of scope for this spike (explicit)

- Running PyTorch locally. This is a desk-research spike only.
- Downloading UNISAL weights. The pretrained checkpoint is ~60 MB and requires the repo's conda env to load — that is option B territory.
- Any code changes to `docs/src/`. The V1 layer boundaries are load-bearing for a future swap; they do not need changes to *prepare* for V2.
- A qualitative comparison between MSI-Net and UNISAL output. That is a separate roadmap item and should be done with both models running, not from reading papers.

## Open questions deferred to option B

- Exact UNISAL input resolution for stock SALICON inference (hinted at in `run.py` but not confirmed from this desk research).
- Pre-processing normalisation (ImageNet mean/std? 0–1? BGR?).
- Post-processing — the model output has a sigmoid applied; does it need further smoothing before overlay rendering, or does `docs/src/pipeline/postprocess.js` cover it?
- Whether the KDSalBox distilled UNISAL variant is worth exporting as a second candidate.

## Sources

- [rdroste/unisal](https://github.com/rdroste/unisal) — UNISAL reference PyTorch implementation.
- [`unisal/model.py`](https://github.com/rdroste/unisal/blob/master/unisal/model.py) — main model definition.
- [`unisal/models/cgru.py`](https://github.com/rdroste/unisal/blob/master/unisal/models/cgru.py) — convolutional GRU implementation.
- [Droste, Jiao & Noble (2020). "Unified Image and Video Saliency Modeling." ECCV 2020. arXiv:2003.05477](https://arxiv.org/abs/2003.05477).
- [ORT Web deploy docs](https://onnxruntime.ai/docs/tutorials/web/deploy.html).
- [ORT discussion #24161 — WebGPU WASM file size](https://github.com/microsoft/onnxruntime/discussions/24161).
- [ORT issue #14817 — reducing WASM size](https://github.com/microsoft/onnxruntime/issues/14817).
- [ORT issue #19148 — numThreads + crossOriginIsolated warning](https://github.com/microsoft/onnxruntime/issues/19148).
- [web.dev cross-origin isolation guide](https://web.dev/articles/cross-origin-isolation-guide).
- [KDSalBox](https://github.com/ardkastrati/KDSalBox) — distilled saliency-model toolbox including UNISAL.
