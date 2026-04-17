# Foveacast Expert — Persistent Memory

This file is loaded into the agent's system prompt on every session. Keep it under 200 lines.
Create topic files for detailed notes and link to them from here.

## Project status (last updated: April 2026)

- V3 MSI-Net model is in use. V2 UNISAL is gone (deleted from repo April 2026).
- `logProbsToProbabilities` no longer exists — V3 outputs [0,1] directly.
- 137 Vitest tests passing. E2E requires `scripts/fetch-v3-model.sh` to have run.
- Issue #8 tracks deferred refactors: `boot()` decomposition, E2E preflight, diagnostics DOM.

## Patterns to remember

*(Add entries here as you discover them across sessions.)*
