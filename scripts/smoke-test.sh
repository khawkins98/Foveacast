#!/usr/bin/env bash
# Foveacast liveness smoke test (NOT an end-to-end test).
#
# Scope: confirms the dev server boots, serves HTTP 200, and the
# shipped index.html contains the mount points and CDN script tags the
# app needs to come up. It does NOT execute any JavaScript, does NOT
# render anything, and would not catch a rendering regression like the
# detached-container bug fixed in 96c81d8. That class of failure is
# what the Playwright suite under `tests/e2e/` covers — run it with
# `pnpm test:e2e`.
#
# Keep this script in the workflow because it's fast (sub-second),
# dependency-free (curl + bash), and catches the cheapest class of
# "I broke the dev server" failure before the heavier Playwright suite
# has to spin up a browser. Think of it as the fire-alarm test; the
# Playwright suite is the fire drill.
#
# What it does, in order:
#   1. Starts `pnpm dev` in the background on a chosen port.
#   2. Polls until the dev server answers HTTP 200 (or times out).
#   3. Fetches the index page and asserts the expected root elements
#      and CDN script tags are present.
#   4. Shuts the dev server down (trap-cleans on any exit path).
#
# This test is NOT run by `pnpm test`. It requires a live network to
# the jsDelivr CDN to actually render in a browser, and CI is expected
# to stay green without it. Invoke it by hand with `pnpm smoke`.

set -euo pipefail

# --- configuration -----------------------------------------------------------

# Pick an uncommon port so this never collides with a developer's own
# `pnpm dev` session.
readonly PORT=5199
readonly URL="http://127.0.0.1:${PORT}/"
readonly LOG_FILE="/tmp/foveacast-smoke-dev.log"
readonly PAGE_FILE="/tmp/foveacast-smoke-index.html"
readonly TIMEOUT_SECONDS=30

# --- helpers -----------------------------------------------------------------

log() { printf '[smoke] %s\n' "$*"; }
fail() { printf '[smoke] FAIL: %s\n' "$*" >&2; exit 1; }

# --- preflight ---------------------------------------------------------------

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

command -v pnpm >/dev/null 2>&1 || fail "pnpm not on PATH"
command -v curl >/dev/null 2>&1 || fail "curl not on PATH"

# --- start dev server --------------------------------------------------------

log "starting dev server on port ${PORT} (logs: ${LOG_FILE})"
# --host so curl can reach it by loopback IP; --strictPort so we fail
# loudly if something else is already on that port rather than silently
# sliding to a different one.
pnpm dev --port "${PORT}" --strictPort --host 127.0.0.1 >"${LOG_FILE}" 2>&1 &
DEV_PID=$!

# Always shut the dev server down, even on failure.
cleanup() {
  if kill -0 "${DEV_PID}" 2>/dev/null; then
    log "stopping dev server (pid ${DEV_PID})"
    kill "${DEV_PID}" 2>/dev/null || true
    wait "${DEV_PID}" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# --- wait for readiness ------------------------------------------------------

log "waiting for ${URL} (timeout ${TIMEOUT_SECONDS}s)"
ready=0
for _ in $(seq 1 "${TIMEOUT_SECONDS}"); do
  if curl --silent --fail --max-time 2 --output /dev/null "${URL}"; then
    ready=1
    break
  fi
  sleep 1
done
[ "${ready}" -eq 1 ] || {
  log "--- dev server log ---"
  cat "${LOG_FILE}" >&2 || true
  fail "dev server did not respond within ${TIMEOUT_SECONDS}s"
}
log "dev server is up"

# --- fetch + assert ----------------------------------------------------------

curl --silent --fail --max-time 5 --output "${PAGE_FILE}" "${URL}" \
  || fail "could not GET ${URL}"

# Mount points main.js expects. If any of these disappear the whole
# app silently no-ops, so they're the cheapest set of assertions that
# catches a real regression.
required_markers=(
  'id="fc-app"'
  'id="fc-status-mount"'
  'id="fc-dropzone-mount"'
  'id="fc-controls-mount"'
  'id="fc-output"'
  'src="./src/main.js"'
  'tfjs@4.22.0'
  'heatmap.js@2.0.5'
)

for marker in "${required_markers[@]}"; do
  if ! grep -q -- "${marker}" "${PAGE_FILE}"; then
    log "--- fetched page ---"
    cat "${PAGE_FILE}" >&2 || true
    fail "expected marker not found in index.html: ${marker}"
  fi
done

log "page served at ${URL} and contains all required markers"
log "saved: ${PAGE_FILE}"
log "PASS"
