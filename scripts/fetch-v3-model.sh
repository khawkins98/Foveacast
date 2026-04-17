#!/usr/bin/env bash
# Fetch the V3 MSI-Net ONNX model from the foveacast-training GitHub Release.
#
# The model is NOT committed to this repo (57 MB would bloat the clone).
# Instead it is fetched at deploy time by the GitHub Actions workflow and
# at dev time by running this script manually.
#
# The release artefact is FP16-quantised (57 MB, opset 17). SHA256 is
# checked after download to catch truncation or CDN corruption.
#
# Usage:
#   bash scripts/fetch-v3-model.sh
#
# The script is idempotent: if the file exists and the SHA matches, it
# exits immediately.

set -euo pipefail

RELEASE_TAG="v0.1.0"
REPO="khawkins98/foveacast-training"
ASSET_NAME="foveacast-v3-fp16.onnx"
DEST="docs/models/v3/model.onnx"
EXPECTED_SHA="842a23f97908d146b8749e05f6b220bdb495eae76c75cc7252550825585ef76e"

# Check if already present and valid.
if [ -f "$DEST" ]; then
  ACTUAL_SHA=$(shasum -a 256 "$DEST" | awk '{print $1}')
  if [ "$ACTUAL_SHA" = "$EXPECTED_SHA" ]; then
    echo "✓ $DEST already present and SHA256 matches."
    exit 0
  else
    echo "⚠ $DEST exists but SHA256 mismatch — re-downloading."
  fi
fi

mkdir -p "$(dirname "$DEST")"

echo "→ Downloading $ASSET_NAME from $REPO release $RELEASE_TAG..."
# why: gh release download handles auth + redirect + asset lookup in one
# command. Falls back to curl for environments without gh.
if command -v gh >/dev/null 2>&1; then
  gh release download "$RELEASE_TAG" \
    --repo "$REPO" \
    --pattern "$ASSET_NAME" \
    --output "$DEST" \
    --clobber
else
  URL="https://github.com/$REPO/releases/download/$RELEASE_TAG/$ASSET_NAME"
  curl -L --fail --retry 3 -o "$DEST" "$URL"
fi

# Verify.
ACTUAL_SHA=$(shasum -a 256 "$DEST" | awk '{print $1}')
if [ "$ACTUAL_SHA" != "$EXPECTED_SHA" ]; then
  echo "✗ SHA256 mismatch after download!"
  echo "  expected: $EXPECTED_SHA"
  echo "  actual:   $ACTUAL_SHA"
  rm -f "$DEST"
  exit 1
fi

echo "✓ $DEST downloaded and verified."
echo "  SHA256: $EXPECTED_SHA"
echo "  Size: $(wc -c < "$DEST" | tr -d ' ') bytes"
