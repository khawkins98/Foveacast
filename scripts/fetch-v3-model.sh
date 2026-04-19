#!/usr/bin/env bash
# Fetch the V3 MSI-Net ONNX models from the foveacast-training GitHub Release.
#
# V3 ships three duration-specific models (1s, 3s, 7s viewing windows),
# each fine-tuned on the corresponding UEyes ground-truth heatmap. All
# three are fetched by default; pass a duration argument to fetch only
# one (useful for local experiments where bandwidth matters):
#
#   bash scripts/fetch-v3-model.sh          # all three
#   bash scripts/fetch-v3-model.sh 3s       # just the 3s model
#
# The models are NOT committed to this repo (57 MB each would bloat the
# clone). They are fetched at deploy time by the GitHub Actions workflow
# and at dev time by running this script manually.
#
# The release artefacts are FP16-quantised (57 MB, opset 17). SHA256 is
# checked after download to catch truncation or CDN corruption.
#
# The script is idempotent: if a file exists and the SHA matches, it
# skips that model.

set -euo pipefail

RELEASE_TAG="v0.2.0"
REPO="khawkins98/foveacast-training"

# Per-model metadata as parallel arrays. Positional indexing keeps this
# compatible with macOS's ancient bash 3.2 (no associative arrays).
DURATIONS=(  "1s"    "3s"    "7s"  )
ASSETS=(
  "foveacast-v3-1s-fp16.onnx"
  "foveacast-v3-3s-fp16.onnx"
  "foveacast-v3-7s-fp16.onnx"
)
DESTS=(
  "docs/models/v3/1s/model.onnx"
  "docs/models/v3/3s/model.onnx"
  "docs/models/v3/7s/model.onnx"
)
SHAS=(
  "4b9fdc2734e36c612a120ab7b0050ae276723160ccc625c6f554e906dd6345d5"
  "842a23f97908d146b8749e05f6b220bdb495eae76c75cc7252550825585ef76e"
  "cf66388dc6fe5db4712c77cf3929d04380ed73ac963677b8c9de2b6380fb51e0"
)

# Build the list of indices to fetch (all by default, or just the one
# matching the CLI argument).
indices_to_fetch=()
if [ $# -ge 1 ]; then
  requested="$1"
  found=0
  for i in "${!DURATIONS[@]}"; do
    if [ "${DURATIONS[$i]}" = "$requested" ]; then
      indices_to_fetch+=("$i")
      found=1
      break
    fi
  done
  if [ "$found" -eq 0 ]; then
    echo "✗ Unknown duration: $requested (expected one of: ${DURATIONS[*]})"
    exit 1
  fi
else
  for i in "${!DURATIONS[@]}"; do
    indices_to_fetch+=("$i")
  done
fi

failures=0

for i in "${indices_to_fetch[@]}"; do
  dur="${DURATIONS[$i]}"
  asset="${ASSETS[$i]}"
  dest="${DESTS[$i]}"
  expected_sha="${SHAS[$i]}"

  echo "--- $dur model ---"

  # Check if already present and valid.
  if [ -f "$dest" ]; then
    actual_sha=$(shasum -a 256 "$dest" | awk '{print $1}')
    if [ "$actual_sha" = "$expected_sha" ]; then
      echo "✓ $dest already present and SHA256 matches."
      continue
    else
      echo "⚠ $dest exists but SHA256 mismatch — re-downloading."
    fi
  fi

  mkdir -p "$(dirname "$dest")"

  echo "→ Downloading $asset from $REPO release $RELEASE_TAG..."
  # why: gh release download handles auth + redirect + asset lookup in one
  # command. Falls back to curl for environments without gh.
  # The `|| { ... continue; }` guard ensures a download failure for one
  # model does not abort the entire script under `set -e` — the other
  # models still get a chance to download.
  if command -v gh >/dev/null 2>&1; then
    gh release download "$RELEASE_TAG" \
      --repo "$REPO" \
      --pattern "$asset" \
      --output "$dest" \
      --clobber \
    || { echo "✗ Download failed for $asset"; failures=$((failures + 1)); continue; }
  else
    url="https://github.com/$REPO/releases/download/$RELEASE_TAG/$asset"
    curl -L --fail --retry 3 -o "$dest" "$url" \
    || { echo "✗ Download failed for $asset"; failures=$((failures + 1)); continue; }
  fi

  # Verify.
  actual_sha=$(shasum -a 256 "$dest" | awk '{print $1}')
  if [ "$actual_sha" != "$expected_sha" ]; then
    echo "✗ SHA256 mismatch after download!"
    echo "  expected: $expected_sha"
    echo "  actual:   $actual_sha"
    rm -f "$dest"
    failures=$((failures + 1))
    continue
  fi

  echo "✓ $dest downloaded and verified."
  echo "  SHA256: $expected_sha"
  echo "  Size: $(wc -c < "$dest" | tr -d ' ') bytes"
done

if [ "$failures" -gt 0 ]; then
  echo ""
  echo "✗ $failures model(s) failed verification."
  exit 1
fi

echo ""
echo "✓ All requested models present and verified."
