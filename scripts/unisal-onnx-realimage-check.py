#!/usr/bin/env python3
"""
Quick qualitative check: run the exported UNISAL ONNX artefact on the
committed example screenshot and compare against the stock PyTorch
model on the same input. Writes saliency maps to /tmp for visual
inspection so a human can confirm "yes, this looks plausible" before
we ever plumb ORT Web into the browser.

Produces:

    /tmp/unisal-check-pytorch.png   — stock PyTorch saliency map
    /tmp/unisal-check-onnx.png      — ORT CPU saliency map
    /tmp/unisal-check-diff.png      — |pytorch − ort| scaled to 0..255

If the two images don't look visually identical, something is wrong
with the export even if the synthetic-input parity check passes.
"""

import sys
from pathlib import Path

import numpy as np
import onnxruntime as ort
import torch
from PIL import Image

sys.path.insert(0, str(Path("/tmp/unisal-source")))
import io, contextlib
with contextlib.redirect_stdout(io.StringIO()):
    from unisal.model import UNISAL


INPUT_H = 288
INPUT_W = 384
RGB_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
RGB_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)


def preprocess(image_path: Path) -> np.ndarray:
    img = Image.open(image_path).convert("RGB").resize((INPUT_W, INPUT_H), Image.BILINEAR)
    arr = np.asarray(img, dtype=np.float32) / 255.0
    arr = (arr - RGB_MEAN) / RGB_STD
    # HWC → CHW
    arr = arr.transpose(2, 0, 1)
    return arr[None, ...]  # [1, 3, H, W]


def saliency_to_png(saliency: np.ndarray, out_path: Path) -> None:
    # saliency is [H, W] or [1, H, W]. Normalise to 0..255 and save.
    sal = saliency.squeeze()
    sal_min, sal_max = float(sal.min()), float(sal.max())
    if sal_max > sal_min:
        sal = (sal - sal_min) / (sal_max - sal_min)
    img = (sal * 255).astype(np.uint8)
    Image.fromarray(img, mode="L").save(out_path)


def main() -> None:
    example = Path("docs/assets/example-screenshot.jpg")
    onnx_path = Path("docs/models/unisal/model.onnx")
    if not example.exists():
        raise SystemExit(f"No sample image at {example}")
    if not onnx_path.exists():
        raise SystemExit(f"No ONNX artefact at {onnx_path} — run the export script first")

    x = preprocess(example)
    print(f"input shape: {x.shape}, dtype: {x.dtype}, range [{x.min():.2f}, {x.max():.2f}]")

    # Stock PyTorch path.
    model = UNISAL(sources=["DHF1K", "Hollywood", "UCFSports", "SALICON"])
    state_dict = torch.load(
        "/tmp/unisal-source/training_runs/pretrained_unisal/weights_best.pth",
        map_location="cpu",
        weights_only=True,
    )
    model.load_state_dict(state_dict)
    model.eval()

    with torch.no_grad():
        x5 = torch.from_numpy(x).unsqueeze(1)  # [B, 1, 3, H, W]
        y_pt = model(x5, source="SALICON", static=True)
        if isinstance(y_pt, tuple):
            y_pt = y_pt[0]
        y_pt = y_pt.squeeze().numpy()  # [H, W]

    # ORT path.
    session = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    y_ort = session.run(None, {"image": x})[0].squeeze()

    diff = np.abs(y_pt - y_ort)
    print(f"pytorch output: shape {y_pt.shape}, range [{y_pt.min():.3f}, {y_pt.max():.3f}]")
    print(f"ort     output: shape {y_ort.shape}, range [{y_ort.min():.3f}, {y_ort.max():.3f}]")
    print(f"max |Δ|        : {diff.max():.2e}   mean |Δ|: {diff.mean():.2e}")

    saliency_to_png(y_pt, Path("/tmp/unisal-check-pytorch.png"))
    saliency_to_png(y_ort, Path("/tmp/unisal-check-onnx.png"))
    saliency_to_png(diff / max(diff.max(), 1e-9), Path("/tmp/unisal-check-diff.png"))

    # UNISAL's raw output is log-probabilities (training loss is KLD
    # against a normalised human-fixation map). Applying exp() and
    # renormalising gives the actual saliency-map interpretation — and
    # usually a much more peaked visualisation than linearly stretching
    # the logits. Save that too so a reviewer can see the real output.
    y_pt_exp = np.exp(y_pt - y_pt.max())
    y_ort_exp = np.exp(y_ort - y_ort.max())
    saliency_to_png(y_pt_exp, Path("/tmp/unisal-check-pytorch-exp.png"))
    saliency_to_png(y_ort_exp, Path("/tmp/unisal-check-onnx-exp.png"))
    print("wrote /tmp/unisal-check-{pytorch,onnx,diff,pytorch-exp,onnx-exp}.png")


if __name__ == "__main__":
    main()
