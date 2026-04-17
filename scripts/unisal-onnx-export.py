#!/usr/bin/env python3
"""
UNISAL → ONNX export script for the Foveacast V2 spike.

This is NOT part of the shipped web app. It is a one-off tool that
reads an UNISAL PyTorch checkpoint and writes an ONNX artefact the
browser can load via onnxruntime-web.

Reproduce:

    uv python install 3.12
    uv venv --python 3.12 .venv
    uv pip install --python .venv/bin/python torch torchvision onnx onnxruntime numpy Pillow
    git clone https://github.com/rdroste/unisal.git /tmp/unisal-source
    .venv/bin/python scripts/unisal-onnx-export.py --unisal-root /tmp/unisal-source

The script does three things:

1. Loads the pretrained UNISAL model with `source="SALICON"`, `static=True`,
   `bypass_rnn=True`. Those three flags mean: the SALICON domain-adaptation
   path is selected, the ConvGRU is bypassed entirely, and the forward()
   method skips the time-step loop. That leaves a pure feed-forward graph
   that torch.onnx.export traces cleanly.

2. Wraps the model in a thin nn.Module adapter that accepts the 4-D input
   shape the browser will hand it (`[1, 3, 288, 384]`) instead of UNISAL's
   native 5-D `[batch, time, channel, h, w]`. The adapter expands/squeezes
   the time dim. The ONNX graph therefore has a clean 4-D input and 3-D
   output.

3. Validates the exported graph by running it under onnxruntime CPU and
   diffing against stock PyTorch output on a handful of synthetic inputs.
   Prints the maximum absolute per-pixel difference.

All paths are configurable via command-line flags. Defaults match the
layout `scripts/fetch-weights.sh` and the shipped app would use if V2
goes ahead.
"""

import argparse
import sys
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn


# UNISAL's SALICON preprocessing, from
# training_runs/pretrained_unisal/SALICONDataset.json:
#   out_size: [288, 384]   (H × W — the model's native input)
#   rgb_mean: [0.485, 0.456, 0.406]  (ImageNet)
#   rgb_std:  [0.229, 0.224, 0.225]  (ImageNet)
# These constants live in the script rather than being read from the
# JSON at runtime so the ONNX-side pre-processing can be ported directly
# into docs/src/pipeline/preprocess.js without cross-referencing a JSON.
INPUT_H = 288
INPUT_W = 384
RGB_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
RGB_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)


def build_unisal_argparser():
    """CLI flags. Kept terse — this is a one-off spike tool."""
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument(
        "--unisal-root",
        type=Path,
        default=Path("/tmp/unisal-source"),
        help="Path to a clone of github.com/rdroste/unisal (default: %(default)s)",
    )
    p.add_argument(
        "--out",
        type=Path,
        default=Path("docs/models/unisal/model.onnx"),
        help="Output ONNX path (default: %(default)s)",
    )
    p.add_argument(
        "--opset",
        type=int,
        default=17,
        help="ONNX opset version (default: %(default)s — covers onnxruntime-web ≥1.15)",
    )
    p.add_argument(
        "--skip-validation",
        action="store_true",
        help="Write the ONNX file but skip the PyTorch-vs-ORT diff at the end",
    )
    return p


def load_unisal_model(unisal_root: Path) -> nn.Module:
    """
    Import the UNISAL model from a cloned repo, load the pretrained
    SALICON checkpoint, and return it ready for inference.

    The UNISAL package is appended to sys.path rather than installed
    because the repo is not packaged as a pip module (no setup.py /
    pyproject.toml that we'd want to trust into site-packages for a
    one-off spike).
    """
    if not unisal_root.exists():
        raise SystemExit(f"UNISAL source not found at {unisal_root}. Clone it first.")
    sys.path.insert(0, str(unisal_root))

    # Silence UNISAL's module-level "torch device set to: ..." print.
    import io, contextlib
    with contextlib.redirect_stdout(io.StringIO()):
        from unisal.model import UNISAL

    model = UNISAL(sources=["DHF1K", "Hollywood", "UCFSports", "SALICON"])
    chkpnt = unisal_root / "training_runs" / "pretrained_unisal" / "weights_best.pth"
    state_dict = torch.load(chkpnt, map_location="cpu", weights_only=True)
    model.load_state_dict(state_dict)
    model.eval()
    return model


class UnisalImageAdapter(nn.Module):
    """
    Wrap UNISAL so that its forward() takes a 4-D `[B, 3, H, W]` input
    and returns a 3-D `[B, H, W]` saliency map.

    UNISAL natively expects `[B, T, 3, H, W]` and returns
    `[B, T, 1, H_out, W_out]`. For static-image inference we always have
    T=1, and downstream code does not need the channel axis. Folding the
    time and channel dims into the adapter keeps the ONNX graph's input
    and output signatures matching what docs/src/model/inference.js
    will send and receive.

    The `source="SALICON"` + `static=True` combination is baked in at
    export time: the export graph is SALICON-only. A separate export
    would be needed to ship MIT1003-tuned weights as a second preset.
    """

    def __init__(self, unisal: nn.Module):
        super().__init__()
        self.unisal = unisal

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # Add the T=1 dim UNISAL expects.
        x5 = x.unsqueeze(1)  # [B, 1, 3, H, W]
        y = self.unisal(
            x5,
            source="SALICON",
            static=True,
        )
        # UNISAL returns either a bare tensor or (tensor, hidden).
        # static=True skips the RNN so no hidden is returned, but
        # belt-and-braces: handle both.
        if isinstance(y, tuple):
            y = y[0]
        # Squeeze time + channel dims. y has shape [B, 1, 1, H, W].
        return y.squeeze(1).squeeze(1)


def export_onnx(wrapped: nn.Module, out_path: Path, opset: int) -> None:
    """
    Run torch.onnx.export with a SALICON-sized dummy input, then
    collapse any externalised weight tensors back into the main .onnx
    file so the artefact is a single self-contained blob.

    Why inlining matters: modern torch.onnx.export writes model weights
    to a sidecar `.onnx.data` file by default when the graph exceeds a
    size threshold. That works fine on the filesystem but complicates
    the browser story — we would have to fetch two files and hope
    onnxruntime-web resolves the external-data reference correctly.
    A single inlined file is cheaper to ship and cheaper to reason
    about.
    """
    import onnx

    out_path.parent.mkdir(parents=True, exist_ok=True)
    dummy = torch.zeros(1, 3, INPUT_H, INPUT_W, dtype=torch.float32)
    with torch.no_grad():
        # dynamic_axes on batch would be nice for parallel batches in
        # the browser, but onnxruntime-web is single-request in the
        # shapes we care about. Keep it static for cleaner graph.
        torch.onnx.export(
            wrapped,
            dummy,
            str(out_path),
            input_names=["image"],
            output_names=["saliency"],
            opset_version=opset,
            do_constant_folding=True,
        )

    # Re-load the model with externals resolved, then re-save inlined.
    # onnx.load resolves external data automatically when `load_external_data`
    # is True (the default). Saving with save_as_external_data=False forces
    # every tensor back into the main proto.
    model = onnx.load(str(out_path))
    sidecar = out_path.with_suffix(out_path.suffix + ".data")
    onnx.save_model(model, str(out_path), save_as_external_data=False)
    if sidecar.exists():
        sidecar.unlink()
    size_mb = out_path.stat().st_size / (1024 * 1024)
    print(f"wrote {out_path} ({size_mb:.1f} MB, opset {opset}, single file)")


def validate_against_pytorch(wrapped: nn.Module, onnx_path: Path) -> None:
    """
    Run the exported ONNX under onnxruntime CPU and compare against the
    stock PyTorch forward pass on a handful of synthetic inputs. Prints
    the max abs difference per sample and a summary.

    Tolerances: torch.onnx.export is deterministic-ish but minor float
    drift is expected. For a saliency map whose output range is ~0–1
    after sigmoid, a max-abs-diff below 1e-4 is "perfect", below 1e-3
    is "good enough", and above 1e-2 is a sign something went wrong
    (usually an op that didn't trace as expected).
    """
    import onnxruntime as ort

    session = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])

    # Three synthetic fixtures at different statistics: a flat grey
    # frame (low variance), white noise (high variance, dense), and a
    # single bright spot on black (sparse salience-like signal). The
    # goal is not to exercise realistic content — just to verify the
    # graph produces the same floats under both runtimes.
    rng = np.random.default_rng(42)
    fixtures = {
        "flat_grey": np.full((1, 3, INPUT_H, INPUT_W), 0.5, dtype=np.float32),
        "white_noise": rng.standard_normal((1, 3, INPUT_H, INPUT_W)).astype(np.float32) * 0.2 + 0.5,
        "bright_spot": np.zeros((1, 3, INPUT_H, INPUT_W), dtype=np.float32),
    }
    fixtures["bright_spot"][:, :, INPUT_H // 3, INPUT_W // 3] = 1.0

    print("\nvalidating ONNX ↔ PyTorch output parity:")
    max_overall = 0.0
    t_total_pt = 0.0
    t_total_ort = 0.0
    for name, arr in fixtures.items():
        t0 = time.perf_counter()
        with torch.no_grad():
            pt_out = wrapped(torch.from_numpy(arr)).numpy()
        t_pt = time.perf_counter() - t0
        t_total_pt += t_pt

        t0 = time.perf_counter()
        ort_out = session.run(None, {"image": arr})[0]
        t_ort = time.perf_counter() - t0
        t_total_ort += t_ort

        diff = float(np.max(np.abs(pt_out - ort_out)))
        max_overall = max(max_overall, diff)
        print(
            f"  {name:12s} pt {t_pt*1000:6.1f} ms  ort {t_ort*1000:6.1f} ms  "
            f"max |Δ| = {diff:.2e}"
        )

    print(
        f"\nsummary: max |Δ| across fixtures = {max_overall:.2e} "
        f"(PT total {t_total_pt*1000:.0f} ms, ORT total {t_total_ort*1000:.0f} ms)"
    )
    if max_overall > 1e-2:
        raise SystemExit(
            f"VALIDATION FAILED: max abs diff {max_overall:.2e} > 1e-2. "
            "Investigate before trusting this artefact."
        )
    print("validation OK: ONNX graph output matches PyTorch within tolerance.")


def main() -> None:
    args = build_unisal_argparser().parse_args()
    print(f"loading UNISAL from {args.unisal_root} …")
    model = load_unisal_model(args.unisal_root)
    print(f"  parameters: {sum(p.numel() for p in model.parameters()):,}")
    wrapped = UnisalImageAdapter(model).eval()
    print(f"exporting to {args.out} (opset {args.opset}) …")
    export_onnx(wrapped, args.out, args.opset)
    if not args.skip_validation:
        validate_against_pytorch(wrapped, args.out)


if __name__ == "__main__":
    main()
