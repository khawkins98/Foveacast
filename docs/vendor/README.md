# Vendored third-party libraries

This folder carries runtime dependencies as their original minified files, so Foveacast works when unzipped and opened directly from the filesystem — no CDN round-trip, no "jsDelivr is down today" failure mode.

| File | Package | Version | Source URL | Licence |
|---|---|---|---|---|
| `tf.min.js` | `@tensorflow/tfjs` | 4.22.0 | https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js | Apache 2.0 |
| `heatmap.min.js` | `heatmap.js` | 2.0.5 | https://cdn.jsdelivr.net/npm/heatmap.js@2.0.5/build/heatmap.min.js | MIT |

## Updating

1. Download the new file from its package source.
2. Replace the vendored copy here.
3. Update the version column in this table.
4. Run `pnpm test` and `pnpm test:e2e` to verify nothing broke.
5. Note the upgrade in `CHANGELOG.md`.

Do not edit these files in place. If you need a patched version of a library, fork it upstream and document the fork in `LEARNINGS.md`.
