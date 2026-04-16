# Saliency-model survey — April 2026

Background investigation launched after the V1-vs-V2 qualitative benchmark made clear that picking between MSI-Net and UNISAL was moving deck chairs — both are SALICON-trained and neither was designed for UI content. The survey cast a wider net for post-2023 saliency / attention-prediction models with plausible browser deployment paths and evidence of UI-content performance.

Scope was deliberately narrow: permissively licensed, ONNX-exportable, published 2023 or later, and preferably with some UI-content evaluation. Models already surveyed in the original PRD (MSI-Net, UNISAL, SUM, FastSal, TranSalNet, EML-NET, SalNAS, SalM², DeepGaze IIE) were excluded from the "new leads" pass.

## Comparison table

| Model | Year | Licence | Params | Backbone | Training data | Browser-deploy | UI evidence |
|---|---|---|---|---|---|---|---|
| **UniAR** (Google) | NeurIPS 2024 | Closed (not released as of Apr 2026) | ~848M | ViT-B/16 + T5-base | SALICON, OSIE, CAT2000, WS-Saliency, FiWI, Imp1k, Mobile UI, COCO-Search18, Koniq-10k | Unlikely (no weights; too large anyway) | **Strong** — explicitly trained on webpages, mobile UIs, graphic designs |
| **SUM** (Hosseini et al.) | WACV 2025 Oral | MIT | ~? (Mamba U-Net) | VMamba + U-Net | SALICON + domain-conditional (natural / e-commerce / UI) | Blocked on Mamba CUDA kernels (known) | **Strong** — explicit UI condition token |
| **UMSI / UMSI++** (Jiang et al., UEyes) | 2020 / 2023 extension | Unclear — UEyes repo has no LICENSE file (verified 404 on `/LICENSE`) | ~25–30M est. | Encoder-decoder (MSI-Net lineage) | Imp1k + UEyes (webpages, desktop, mobile, posters) | Plausible (same family as MSI-Net which already has TF.js demo) | **Strong** — UEyes dataset is 1,980 UI screenshots with real eye-tracking |
| **SalTR** (Djilali et al.) "Learning Saliency From Fixations" | WACV 2024 | Not stated in paper; repo licence unconfirmed | ~? transformer | Transformer encoder + fixation-to-heatmap decoder | SALICON + MIT1003 | Plausible (standard ops) | None claimed — natural images |
| **MDS-ViTNet** (Ignatyev et al.) | 2024 (arXiv 2405.19501) | CC BY 4.0 (paper); code licence unclear | ~28M | Swin-T + multi-decoder CNN | SALICON, MIT1003, CAT2000 | Plausible (Swin has ONNX precedent) | None — natural images |
| **DeepGaze MSDB** (Kümmerer, Bethge lab) | 2025 (arXiv 2505.10169) | Matthias-k/DeepGaze historically MIT; this checkpoint's licence not yet stated on landing | Decoder tiny; CLIP + DINOv2 backbones | CLIP + DINOv2 + simple decoder | SALICON + multi-dataset bias adaptation | Plausible for decoder; CLIP/DINOv2 are heavy but have browser precedent | None explicit; dataset-bias framing could help cross-domain |
| **FastSal** | 2020 (for reference) | Apache 2.0 (confirmed) | ~1M | MobileNetV2 | SALICON | Proven (MobileNetV2 → ONNX is routine) | None — natural images |
| **TranSalNet on WIC640** | 2025 fine-tune study | Ambiguous (paper CC BY 4.0; fine-tuned weights not clearly released) | ~90–100M | ResNet-50 / DenseNet-161 + transformer | SALICON + WIC640 fine-tune | Plausible | **Indirect** — CC=0.78 on webpages in a gender-aware study |
| **ViNet-S / ViNet v2** | ICASSP 2025 | CC BY-NC-SA 4.0 (non-commercial) | 36 MB | U-Net lightweight decoder | DHF1K, UCF-Sports, DIEM (**video**) | Plausible but wrong domain + non-permissive | None — video |

## Ranked shortlist

Ordered by match to Foveacast's actual purpose (UI-screenshot attention prediction shippable as a free, browser-only tool):

1. **UMSI++ (the UEyes saliency_models/ checkpoint).** Trained on 1,980 UI screenshots with real eye-tracking data across webpages, desktop, mobile, and posters — the best training-data match of anything surveyed. Same architectural family as MSI-Net, which already has a proven browser path. Licence is the only gate; repo has no `LICENSE` file at root. Resolve via direct contact with the UEyes authors before spiking.
2. **SUM.** Strongest model on paper (explicit UI condition token), MIT-licensed. Blocked upstream on Mamba CUDA kernels. Worth keeping as the fallback if UMSI++ licence cannot be cleared, but the engineering risk is higher than UMSI++'s licence risk.
3. **MSI-Net (current V1 baseline).** Confirmed shippable, empirically better on UI content than UNISAL in our four-screenshot benchmark. The "do nothing" option and the floor to beat.
4. **TranSalNet fine-tuned on WIC640.** Evidence-based case (CC=0.78 on webpages) but fine-tuned weights are not publicly released. Email-ware, same structural blocker as UMSI++.
5. **UniAR.** Watch item. If Google releases weights, it is the strongest multi-domain UI-aware saliency model by a wide margin, but at 848M parameters a distilled variant would be needed for the browser.

## Caveats

- **UEyes-CHI2023 licence:** repository has no `LICENSE` file at the root (verified — `/LICENSE` returns 404). Code is effectively "all rights reserved" by default. The Aalto group is generally permissive in practice, but redistribution is blocked until confirmed in writing.
- **SUM licence clarity:** README states MIT, but the pretrained weights are hosted on Google Drive and may be separately licensed. Worth checking before bundling the weights in `docs/models/`.
- **Code-level vs paper-level licences:** SalTR, MDS-ViTNet, and DeepGaze MSDB all have paper-level licences (e.g. CC BY 4.0) that do not govern the code repository. A direct `LICENSE` check on each repo is a prerequisite for any spike.
- **UniAR "closed-source" claim:** inferred from a comparative-study note found via search. Not independently verified that Google Research has not released weights since NeurIPS 2024.
- **ViNet-S CC BY-NC-SA 4.0:** explicitly non-commercial, therefore incompatible with a permissively-licensed open-source product. Excluded.
- **VLM-based saliency (Voila-A, GAZE-VLM):** these use gaze *as input to* the VLM rather than predicting it from a screenshot. Not a drop-in replacement.
- **Commercial tools (Attention Insight, expoze.io, Clueify):** closed-source; not actionable for Foveacast.

## Decision

Pivoting V3 from SUM-first to **UMSI++-first, SUM as fallback**. The licence email to the UEyes authors is cheaper to resolve than the Mamba CUDA blocker is to engineer around, and the training-data match is directly what our four-screenshot benchmark said was missing.

The V3 plan sketched earlier (desk research → hands-on export → browser integration, each phase gated) carries over unchanged; only the model under investigation changes.

## Sources

- [UEyes / UMSI++ repo (YueJiang-nj/UEyes-CHI2023)](https://github.com/YueJiang-nj/UEyes-CHI2023)
- [SUM repo (Arhosseini77/SUM)](https://github.com/Arhosseini77/SUM)
- [UniAR paper (arXiv 2312.10175)](https://arxiv.org/html/2312.10175v3) / [Google Research blog](https://research.google/blog/towards-a-unified-model-for-predicting-human-responses-to-diverse-visual-content/)
- [SalTR WACV 2024 PDF](https://openaccess.thecvf.com/content/WACV2024/papers/Djilali_Learning_Saliency_From_Fixations_WACV_2024_paper.pdf)
- [MDS-ViTNet (arXiv 2405.19501)](https://arxiv.org/abs/2405.19501)
- [DeepGaze MSDB (arXiv 2505.10169)](https://arxiv.org/html/2505.10169v2) / [matthias-k/DeepGaze repo](https://github.com/matthias-k/DeepGaze)
- [FastSal repo (Apache-2.0)](https://github.com/feiyanhu/FastSal)
- [ViNet v2 repo (CC BY-NC-SA 4.0)](https://github.com/ViNet-Saliency/vinet_v2)
- [WIC640 gender-aware TranSalNet study (2025)](https://braininformatics.springeropen.com/articles/10.1186/s40708-025-00274-x)
- [Cartella et al. awesome-human-visual-attention tracker](https://github.com/aimagelab/awesome-human-visual-attention)
