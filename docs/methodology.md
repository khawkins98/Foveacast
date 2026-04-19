# How Foveacast predicts attention

Foveacast estimates where people are likely to look on a page before anyone has actually looked at it. This document explains what that means, how the model works, what the numbers mean, and where the approach falls short.

---

## What predictive attention is (and isn't)

Eye-tracking studies record where individual people look using specialist hardware — cameras that track pupil position at high frequency. They produce reliable, person-specific data, but require a lab, participants, and time.

Predictive attention models take a different approach: given a large dataset of real eye-tracking recordings, they learn which image features tend to attract human gaze — contrast, edges, faces, text, colour, motion, symmetry — and use those patterns to estimate where a *typical person* might look at a *new* image, without any camera hardware.

The result is a heatmap of predicted saliency — a probability distribution over locations, not a recording of any individual. It reflects the average of population-level gaze patterns from the model's training data, applied to your image via learned weights.

The output answers the question: **"Given this image, where would a group of people typically look first?"** It does not answer questions about any specific user, task, or audience segment.

---

## The model: MSI-Net fine-tuned on UEyes

Foveacast runs [MSI-Net](https://github.com/alexanderkroner/saliency) (Kroner et al. 2020), a contextual encoder-decoder architecture with a VGG-16 backbone, fine-tuned on the [UEyes dataset](https://dl.acm.org/doi/10.1145/3544548.3581096) (Jiang et al. 2023).

**MSI-Net** uses a multi-scale feature extraction module (ASPP) to combine local and global context before decoding to a saliency map. It was originally trained on [SALICON](http://salicon.net/) — a large dataset of mouse-movement-as-gaze recorded on MS-COCO images. SALICON mouse tracking has been validated as a reasonable proxy for eye fixations in controlled studies.

**UEyes fine-tuning** adapts the weights for interface screenshots specifically. UEyes collected real eye-tracking data from 34 participants viewing 215 web-page screenshots across six categories (e-commerce, news, educational, landing pages, blogs, portfolios). Foveacast's model was fine-tuned on this data to reduce the mismatch between a natural-scene-trained backbone and the structured visual grammar of web content — columns, headings, whitespace, CTAs, navigation bars.

Fine-tuning was done using the [foveacast-training](https://github.com/khawkins98/foveacast-training) pipeline. The resulting weights are exported to ONNX (FP16) and run in the browser via [ONNX Runtime Web](https://onnxruntime.ai/docs/tutorials/web/) (WASM backend). No data ever leaves your machine.

---

## The three viewing durations

Foveacast runs three separate model variants, each fine-tuned on a different gaze-duration window from UEyes:

| Duration window | Label | What it reflects |
|---|---|---|
| 1 second | First glance | Where the eye is drawn in the first moments — pre-attentive, driven mainly by contrast and visual salience |
| 3 seconds | Quick scan | A short overview, incorporating early semantic features — headings, images, navigation landmarks |
| 7 seconds | Full viewing | A more thorough viewing pass, where task-relevant areas (body text, CTAs, detail) begin to accumulate attention |

The 3-second window loads first (fastest); the 1-second and 7-second variants load in the background. Click the heatmap to cycle between them.

---

## What the output metrics mean

### Attention Spread

A measure of how concentrated or diffuse the predicted attention is across the image. Computed as the entropy of the normalised saliency distribution.

- **Low** — attention concentrates on one or two distinct regions. Common when a single face, high-contrast logo, or prominent CTA dominates the composition.
- **Medium** — attention distributes across several areas. Typical for pages with balanced visual hierarchy.
- **High** — attention scatters widely. May indicate a lack of strong focal points, or a very text-dense layout where nothing dominates.

No spread level is inherently better. A focused layout is effective for a single-action page; a distributed one may serve a navigation or discovery context. The metric is descriptive, not prescriptive.

### First-fixation estimate

The centroid of the highest-saliency region after blurring and normalising the saliency map. Shown as a crosshair overlay on the heatmap. Represents the model's best estimate of where the first voluntary fixation would land — not a guarantee, and not a measurement.

### Inference time

How long the ONNX Runtime WebAssembly execution took on your device. Varies with CPU speed and browser. The model runs single-threaded (WASM multi-threading requires `Cross-Origin-Embedder-Policy: require-corp`, which GitHub Pages cannot set).

---

## Limitations

**The model reflects training population averages.** UEyes participants were a convenience sample. Gaze patterns vary by age, cultural background, task, expertise, and accessibility need. The output is a first approximation — useful for catching obvious issues, not a substitute for user research with your actual audience.

**Fine-tuned on web screenshots, but not your content type.** UEyes covers six web page categories. Performance on niche content types — data visualisations, maps, dense tables, medical imagery — is not validated.

**Free-viewing paradigm.** Eye-tracking data was collected under free-viewing conditions (no task assigned). Task-directed attention (e.g. "find the checkout button") differs substantially from free-viewing saliency.

**Population-level biases.** Saliency models trained on photograph datasets have been shown to exhibit racial and gender biases in cropping applications (Birhane et al. 2021). Fine-tuning on UEyes partially addresses this for web content, but does not eliminate it.

**Not a replacement for real eye-tracking.** If the decision is high-stakes — a campaign landing page, a medical form, a government service — test with real users.

---

## References

Itti, L., Koch, C., & Niebur, E. (1998). A model of saliency-based visual attention for rapid scene analysis. *IEEE Transactions on Pattern Analysis and Machine Intelligence, 20*(11), 1254–1259.

Bylinskii, Z., Kim, N. W., O'Donovan, P., Alsheikh, S., Madan, S., Pfister, H., … Durand, F. (2017). Learning visual importance for graphic designs and data visualizations. *UIST 2017*.

Kroner, A., Senden, M., Driessens, K., & Goebel, R. (2020). Contextual encoder-decoder network for visual saliency prediction. *Neural Networks, 129*, 261–270. doi:[10.1016/j.neunet.2020.05.004](https://doi.org/10.1016/j.neunet.2020.05.004)

Jiang, M., Huang, X., Deng, J., & Zhao, Q. (2023). UEyes: Understanding visual saliency across user interface types. *CHI 2023*. doi:[10.1145/3544548.3581096](https://doi.org/10.1145/3544548.3581096)

Cartella, G., Cuculo, V., D'Amelio, A., Boccignone, G., & Lombardi, L. (2024). Trends, applications, and challenges in human attention modelling. *IJCAI 2024 Survey Track*. arXiv:[2402.18673](https://arxiv.org/abs/2402.18673)
