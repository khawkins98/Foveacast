# Reading your results

This guide helps you use Foveacast's output to make design decisions. It covers what the heatmap shows, what the metrics mean, how to work with the three duration windows, and — just as importantly — what the output cannot tell you.

If you want to understand *how* the model works, read [How Foveacast predicts attention](methodology.md) first.

---

## The heatmap

The colourmap runs from dark violet (low predicted attention) through orange to bright yellow (highest predicted attention). The brighter the area, the more attention the model predicts will land there.

A few things to bear in mind when reading it:

- **The scale is relative to your image.** Every heatmap is normalised so the most-salient region in your screenshot always renders at full brightness, regardless of how strong the signal actually is. A screenshot where nothing dominates will still have a "hotspot" — it's just the best candidate in a weak field.
- **The crosshair marks the first-fixation estimate.** That is the model's best guess at where the first voluntary fixation will land. It is the centroid of the highest-saliency region, not a guarantee.
- **Click the heatmap to cycle between the three duration views.** Each view reflects a different gaze-duration window (see below).

---

## The three duration windows

| Label | Window | Practical meaning |
|---|---|---|
| First glance (1 s) | 0–1 second | Pre-attentive capture — what jumps out before the viewer has had time to process meaning. Driven by contrast, edges, motion, faces. |
| Quick scan (3 s) | 0–3 seconds | A brief overview. Semantic features start to register: headings, navigation landmarks, large images, calls to action. |
| Full viewing (7 s) | 0–7 seconds | A thorough pass. Task-relevant regions (body text, forms, detail areas) begin to accumulate attention. |

**How to use them together.** Compare the 1s and 7s views side by side. If an element you want people to notice only appears in the 7s view, it's competing poorly for early attention — that's a candidate for a contrast boost, repositioning, or size increase. If an element you want people to *ignore* is hot in the 1s view, it may be stealing attention from the primary action.

---

## Attention Spread

The spread metric describes whether predicted attention is concentrated or scattered.

| Level | What it means |
|---|---|
| **Low spread** | Attention clusters on one or two distinct regions. Strong focal points — good for single-action pages, hero images, CTAs. |
| **Medium spread** | Attention distributes across a few areas. Typical for pages with balanced visual hierarchy. |
| **High spread** | Attention scatters widely. May indicate a lack of strong focal points, or a text-heavy layout where nothing dominates. |

No spread level is inherently better. A focused layout serves a single-action page; a distributed one may serve exploration and discovery. Use the level as a prompt, not a verdict.

---

## Practical questions you can answer

**"Will anyone see my CTA before scrolling away?"**
Check the 1s view. If the CTA region is cool/dark, it's not capturing attention in the first glance window. Try increasing contrast, size, or whitespace around it.

**"Is my headline doing its job?"**
A headline should appear in all three duration views. If it only warms up in the 3s or 7s view, it may be undersized or too close in contrast to surrounding elements.

**"Are two elements fighting for attention?"**
Two adjacent hotspots of similar brightness in the 1s view is a sign of visual competition. Decide which element needs to win, and adjust weight accordingly.

**"Does the layout guide the eye through the intended reading order?"**
Compare the centroid position across 1s → 3s → 7s. A centroid that moves down the page in logical content order suggests the layout is working as a sequence.

**"Is the footer consuming too much attention?"**
A hot footer in the 1s view is a common symptom of high-contrast elements near the bottom of a long page (borders, social icons, certifications). If the footer is warm on glance but your primary content isn't, the visual weight balance needs adjusting.

---

## What this output cannot tell you

**It is not a recording of your users.** The model was trained on eye-tracking data from study participants viewing web pages under free-viewing conditions (no specific task). Your users may have different demographics, goals, and reading habits.

**It doesn't know what your users are trying to do.** Task-directed attention — where someone looks when searching for the "Add to cart" button — differs substantially from free-viewing saliency. If you need task-directed data, there is no shortcut to a real usability study with representative participants.

**It reflects population averages.** One heatmap reflects one model's generalisation over many people. Individual attention patterns vary significantly by age, expertise, cultural background, and accessibility need.

**The model was fine-tuned on web screenshots, but not necessarily your content type.** UEyes covers six web page categories. Accuracy is not validated for data visualisations, maps, dense tables, medical imagery, or niche content.

**Not a replacement for real eye-tracking on high-stakes work.** If the decision matters — a government service, a medical form, a campaign landing page — test with real users. Foveacast is a cheap first check, not a substitute for user research.

---

## When results look surprising

If the model highlights a region you don't expect, consider:

- **Centre bias.** Saliency models trained on web photography have a known tendency to predict attention toward the image centre. Centre-heavy results on symmetric layouts are often accurate; they may also reflect model prior rather than real signal.
- **Face and text magnets.** Human faces and large, high-contrast text draw strong saliency responses across all training datasets. If faces or prominent text anchor the heatmap, that matches what real eye-tracking studies also find.
- **Low-complexity images.** A near-uniform screenshot (all white background, minimal content) may produce a heatmap that looks like noise at low saliency. The model is estimating relative salience within your image; it can't invent signal that isn't there.

If results consistently seem off for your content type, the [methodology page](methodology.md) explains the model's training distribution and known limitations.
