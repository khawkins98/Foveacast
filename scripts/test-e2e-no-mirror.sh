#!/usr/bin/env bash
# Run the Playwright E2E suite against a simulated CI environment
# — one where `docs/models/` has not been populated by
# `scripts/fetch-weights.sh`.
#
# Why this exists:
#   A class of bug on this project only reproduces when the local
#   mirror is absent: the loader's HEAD-probe fallback, the Vite
#   middleware's 404 behaviour, and any new code path that reads
#   from `./models/`. Locally, `docs/models/` is populated after the
#   first `pnpm weights`, so the silent assumption "it's there"
#   accumulates over time and bites in CI.
#
#   This script moves `docs/models/` aside, runs `pnpm test:e2e`,
#   and restores the folder afterwards — even if the suite fails.
#   Effect: a developer can verify "will this pass CI Playwright?"
#   in one command before pushing.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${REPO_ROOT}"

readonly MIRROR_DIR="docs/models"
readonly BACKUP_DIR="/tmp/foveacast-models-backup-$$"

cleanup() {
  # Restore the mirror on any exit path — success, test failure, or
  # interruption via Ctrl-C. Without this, a failed run would leave
  # the developer's local mirror missing and surprise the next
  # `pnpm dev`.
  if [[ -d "${BACKUP_DIR}" ]]; then
    if [[ -d "${MIRROR_DIR}" ]]; then
      # Shouldn't happen, but be safe — don't clobber whatever
      # ended up back in place.
      echo "WARN: ${MIRROR_DIR} reappeared during the run; backup left at ${BACKUP_DIR}" >&2
    else
      mv "${BACKUP_DIR}" "${MIRROR_DIR}"
      echo "Mirror restored from ${BACKUP_DIR}."
    fi
  fi
}
trap cleanup EXIT INT TERM

if [[ -d "${MIRROR_DIR}" ]]; then
  echo "Moving ${MIRROR_DIR} aside to ${BACKUP_DIR} for the no-mirror run..."
  mv "${MIRROR_DIR}" "${BACKUP_DIR}"
else
  echo "${MIRROR_DIR} not present — running against a naturally no-mirror state."
fi

echo
echo "Running Playwright against the no-mirror environment..."
echo "------------------------------------------------------"
pnpm test:e2e
exit_code=$?

echo
if [[ ${exit_code} -eq 0 ]]; then
  echo "No-mirror E2E passed."
else
  echo "No-mirror E2E FAILED. CI's Playwright job is likely to fail too." >&2
fi

exit ${exit_code}
