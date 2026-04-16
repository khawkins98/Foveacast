#!/usr/bin/env bash
# Mirror MSI-Net TF.js weights from Google Cloud Storage into
# `docs/models/` so the Pages deploy can serve them same-origin.
#
# Why this exists:
#   The author-hosted GCS bucket is a single point of failure for
#   every Foveacast user. If the bucket is renamed, removed, or goes
#   down, every cache-evicted visitor hits a broken app. Mirroring the
#   weights into the deployed Pages artefact makes Foveacast depend on
#   its own origin for both app and data.
#
# When this runs:
#   - CI: the deploy workflow invokes this before packaging the Pages
#     artefact. `docs/models/` is gitignored so we don't commit the
#     weights into the repo.
#   - Locally: a developer can run `pnpm weights` once to keep an
#     offline copy. After fetching, the dev server serves the mirror
#     and no longer needs a working route to GCS.
#
# Exit codes:
#   0  everything fetched (or already cached locally).
#   1  a fetch failed (network issue or the bucket rejected us).

set -euo pipefail

readonly PRESETS=(very_low low medium high very_high)
readonly BASE_URL="https://storage.googleapis.com/msi-net/model"
readonly OUT_DIR="docs/models"

# Resolve the repo root so this works whether invoked from the root
# or from scripts/ directly.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

mkdir -p "${OUT_DIR}"

echo "Fetching MSI-Net weights from ${BASE_URL} into ${OUT_DIR}..."
echo

for preset in "${PRESETS[@]}"; do
  preset_dir="${OUT_DIR}/${preset}"
  mkdir -p "${preset_dir}"

  model_json="${preset_dir}/model.json"
  model_url="${BASE_URL}/${preset}/model.json"

  if [[ -f "${model_json}" ]]; then
    echo "  [${preset}] model.json already present, skipping."
  else
    echo "  [${preset}] fetching model.json..."
    if ! curl -fsSL "${model_url}" -o "${model_json}"; then
      echo "ERROR: failed to fetch ${model_url}" >&2
      exit 1
    fi
  fi

  # The TF.js Graph Model references weight shards via `paths` entries
  # inside `model.json`. We parse them out so the script works even if
  # the shard naming changes upstream. No jq dependency — a tiny
  # Python one-liner reads the JSON.
  shards=$(
    python3 - "${model_json}" <<'PY'
import json, sys
with open(sys.argv[1]) as f:
    m = json.load(f)
for group in m.get('weightsManifest', []):
    for p in group.get('paths', []):
        print(p)
PY
  )

  for shard in ${shards}; do
    shard_path="${preset_dir}/${shard}"
    if [[ -f "${shard_path}" ]]; then
      echo "    - ${shard} already present, skipping."
      continue
    fi
    echo "    - fetching ${shard}..."
    if ! curl -fsSL "${BASE_URL}/${preset}/${shard}" -o "${shard_path}"; then
      echo "ERROR: failed to fetch ${BASE_URL}/${preset}/${shard}" >&2
      exit 1
    fi
  done
done

total_bytes=$(du -sh "${OUT_DIR}" | awk '{print $1}')
echo
echo "Done. Mirrored weights total: ${total_bytes}."
