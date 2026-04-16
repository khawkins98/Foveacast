# Saliency-model survey — April 2026

Background investigation launched after the V1-vs-V2 qualitative benchmark made clear that picking between MSI-Net and UNISAL was moving deck chairs — both are SALICON-trained and neither was designed for UI content. The survey cast a wider net for post-2023 saliency / attention-prediction models with plausible browser deployment paths and evidence of UI-content performance.

Scope was deliberately narrow: permissively licensed, ONNX-exportable, published 2023 or later, and preferably with some UI-content evaluation. Models already surveyed in the original PRD (MSI-Net, UNISAL, SUM, FastSal, TranSalNet, EML-NET, SalNAS, SalM², DeepGaze IIE) were excluded from the "new leads" pass.

## Comparison table

| Model | Year | Licence | Params | Backbone | Training data | Browser-deploy | UI evidence |
|---|---|---|---|---|---|---|---|
| **UniAR** (Google) | NeurIPS 2024 | Closed (not released as of Apr 2026) | ~848M | ViT-B/16 + T5-base | SALICON, OSIE, CAT2000, WS-Saliency, FiWI, Imp1k, Mobile UI, COCO-Search18, Koniq-10k | Unlikely (no weights; too large anyway) | **Strong** — explicitly trained on webpages, mobile UIs, graphic designs |
| **SUM** (Hosseini et al.) | WACV 2025 Oral | MIT | ~? (Mamba U-Net) | VMamba + U-Net | SALICON + domain-conditional (natural / e-commerce / UI) | Blocked on Mamba CUDA kernels (known) | **Strong** — explicit UI condition token |
| **UMSI / UMSI++** (Jiang et al., UEyes) | 2020 / 2023 extension | Repo code: no LICENSE file at root (default: all-rights-reserved). Dataset: CC BY 4.0 on Zenodo. Weights: not in repo, location undocumented. | ~25–30M est. | DCN-ResNet + Xception + attentive ConvLSTM (**Keras/TensorFlow**, not PyTorch) | Imp1k + UEyes (webpages, desktop, mobile, posters) | Harder than first thought — Keras backbone, ConvLSTM recurrence, custom Xception. ORT Web path is not a drop-in from V2's UNISAL plumbing. | **Strong (dataset)** — UEyes is 1,980 UI screenshots with real eye-tracking, CC BY 4.0, directly usable for fine-tuning or evaluation even without the UMSI++ model itself |
| **SalTR** (Djilali et al.) "Learning Saliency From Fixations" | WACV 2024 | Not stated in paper; repo licence unconfirmed | ~? transformer | Transformer encoder + fixation-to-heatmap decoder | SALICON + MIT1003 | Plausible (standard ops) | None claimed — natural images |
| **MDS-ViTNet** (Ignatyev et al.) | 2024 (arXiv 2405.19501) | CC BY 4.0 (paper); code licence unclear | ~28M | Swin-T + multi-decoder CNN | SALICON, MIT1003, CAT2000 | Plausible (Swin has ONNX precedent) | None — natural images |
| **DeepGaze MSDB** (Kümmerer, Bethge lab) | 2025 (arXiv 2505.10169) | Matthias-k/DeepGaze historically MIT; this checkpoint's licence not yet stated on landing | Decoder tiny; CLIP + DINOv2 backbones | CLIP + DINOv2 + simple decoder | SALICON + multi-dataset bias adaptation | Plausible for decoder; CLIP/DINOv2 are heavy but have browser precedent | None explicit; dataset-bias framing could help cross-domain |
| **FastSal** | 2020 (for reference) | Apache 2.0 (confirmed) | ~1M | MobileNetV2 | SALICON | Proven (MobileNetV2 → ONNX is routine) | None — natural images |
| **TranSalNet on WIC640** | 2025 fine-tune study | Ambiguous (paper CC BY 4.0; fine-tuned weights not clearly released) | ~90–100M | ResNet-50 / DenseNet-161 + transformer | SALICON + WIC640 fine-tune | Plausible | **Indirect** — CC=0.78 on webpages in a gender-aware study |
| **ViNet-S / ViNet v2** | ICASSP 2025 | CC BY-NC-SA 4.0 (non-commercial) | 36 MB | U-Net lightweight decoder | DHF1K, UCF-Sports, DIEM (**video**) | Plausible but wrong domain + non-permissive | None — video |

## Ranked shortlist

Ordered by match to Foveacast's actual purpose (UI-screenshot attention prediction shippable as a free, browser-only tool):

1. **UEyes dataset as a fine-tuning corpus.** The survey's first instinct was "spike UMSI++ directly." A closer look at the `saliency_models/UMSI++/` code in the repo makes that harder than it initially seemed: UMSI++ is a Keras/TensorFlow model built on DCN-ResNet + Xception + attentive ConvLSTM, not the MSI-Net family as the initial survey claimed. The weights file (`umsi++.hdf5`) is referenced in the repo's README but not committed there and not present on Zenodo — its hosting is undocumented. What IS cleanly licensed is the **UEyes dataset itself**, at CC BY 4.0 on Zenodo (12.9 GB, 1,980 UI screenshots with real eye-tracking). That is the more actionable asset: it lets us fine-tune any already-permissively-licensed model (e.g. MSI-Net, MIT) on Foveacast's target content class without having to resolve UMSI++'s unclear code/weights licences.
2. **SUM.** Strongest model on paper (explicit UI condition token), MIT-licensed. Blocked upstream on Mamba CUDA kernels. Worth keeping as the fallback if UMSI++ licence cannot be cleared, but the engineering risk is higher than UMSI++'s licence risk.
3. **MSI-Net (current V1 baseline).** Confirmed shippable, empirically better on UI content than UNISAL in our four-screenshot benchmark. The "do nothing" option and the floor to beat.
4. **TranSalNet fine-tuned on WIC640.** Evidence-based case (CC=0.78 on webpages) but fine-tuned weights are not publicly released. Email-ware, same structural blocker as UMSI++.
5. **UniAR.** Watch item. If Google releases weights, it is the strongest multi-domain UI-aware saliency model by a wide margin, but at 848M parameters a distilled variant would be needed for the browser.

## Caveats

- **UEyes-CHI2023 repo:** no `LICENSE` file at the root (verified — `/LICENSE` returns 404). Code is effectively "all rights reserved" by default. The Aalto group is generally permissive in practice, but redistribution is blocked until confirmed in writing.
- **UEyes dataset vs UMSI++ model:** these are separate artefacts with separate licence statuses. The dataset is CC BY 4.0 on Zenodo (record 8010312), which is cleanly usable. The UMSI++ model code is in the GitHub repo under no explicit licence. The UMSI++ pretrained weights (`umsi++.hdf5`) are referenced in the repo README but not committed there and not included in the Zenodo deposit — their hosting location is not documented.
- **UMSI++ architecture:** the original survey claimed UMSI++ was "same family as MSI-Net." That is not correct. Reading the code under `saliency_models/UMSI++/src/`, UMSI++ is built on DCN-ResNet + Xception + attentive ConvLSTM, implemented in Keras 2 / TensorFlow. That is a meaningfully different export story than the PyTorch → ONNX path our UNISAL V2 work proved out. Noting this here so a future reader does not take the comparison-table row at face value the way the pivot decision initially did.
- **SUM licence clarity:** README states MIT, but the pretrained weights are hosted on Google Drive and may be separately licensed. Worth checking before bundling the weights in `docs/models/`.
- **Code-level vs paper-level licences:** SalTR, MDS-ViTNet, and DeepGaze MSDB all have paper-level licences (e.g. CC BY 4.0) that do not govern the code repository. A direct `LICENSE` check on each repo is a prerequisite for any spike.
- **UniAR "closed-source" claim:** inferred from a comparative-study note found via search. Not independently verified that Google Research has not released weights since NeurIPS 2024.
- **ViNet-S CC BY-NC-SA 4.0:** explicitly non-commercial, therefore incompatible with a permissively-licensed open-source product. Excluded.
- **VLM-based saliency (Voila-A, GAZE-VLM):** these use gaze *as input to* the VLM rather than predicting it from a screenshot. Not a drop-in replacement.
- **Commercial tools (Attention Insight, expoze.io, Clueify):** closed-source; not actionable for Foveacast.

## Decision

Pivoting V3 from SUM-first to **"fine-tune MSI-Net on the UEyes dataset"-first**. This was the destination after one further layer of verification: the first pivot (SUM → UMSI++ drop-in) rested on an agent-summary claim that UMSI++ was in MSI-Net's architectural family. Reading the repo's actual code showed that is not true (Keras + DCN-ResNet + Xception + attentive ConvLSTM), and the UMSI++ weights themselves are not in the repo or on Zenodo. What IS cleanly licensed is the UEyes dataset (CC BY 4.0, 1,980 UI screenshots with real eye-tracking) — and that is the thing the benchmark actually showed Foveacast was missing. Fine-tuning MSI-Net (MIT) on the UEyes dataset (CC BY 4.0) is the shortest path to a UI-aware Foveacast model under clean licences end-to-end, with no author emails to wait on and no Mamba kernels to fight.

SUM remains the second-line fallback if the fine-tune path turns out to be blocked for reasons we cannot foresee.

The V3 plan shape (research → hands-on → integration, each phase gated) carries over; only the target changes.

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
