# Vendored third-party libraries

This folder carries runtime dependencies as their original minified files so Foveacast works without a CDN round-trip. Scripts are pinned to reviewed bytes and protected by SRI hashes.

Note: `coi-sw.js` must live at the root of the served site (`docs/coi-sw.js`) rather than
under `docs/vendor/` because a service worker's scope is determined by its URL. A SW at
`/vendor/coi-sw.js` would only control requests under `/vendor/`, not the whole app.
Its source, version, licence, and SRI are tracked here even though the file is at the root.

| File | Package | Version | Source URL | Licence | Licence file | SRI (sha384) |
|---|---|---|---|---|---|---|
| `../coi-sw.js` | `coi-serviceworker` | 0.1.7 | https://github.com/gzuidhof/coi-serviceworker | MIT | [LICENCE-COI-SW.txt](LICENCE-COI-SW.txt) | `YipJyYgokClYMywyER53bs1C8eZ33vS1UWzn11T726UMKtvr8yMUFqe0xIhrY076` |
| `ort.wasm.min.js` | `onnxruntime-web` | 1.24.3 | https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/ort.wasm.min.js | MIT | [LICENCE-ORT-WEB.txt](LICENCE-ORT-WEB.txt) | `1SBQgvQsxJRGAOAJ6K2nPaLO1SKelZwoF+biXgv2/D9fPspYLhvG4WIMDb/BUoJC` |
| `ort-wasm-simd-threaded.mjs` | `onnxruntime-web` | 1.24.3 | https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/ort-wasm-simd-threaded.mjs | MIT | [LICENCE-ORT-WEB.txt](LICENCE-ORT-WEB.txt) | `/xM/eq8aUBJZgBuVwTQcLA5KlNmP6HOaENdJVgCkA/06cOMdL9EIQtmMuXOlMZEd` |
| `ort-wasm-simd-threaded.wasm` | `onnxruntime-web` | 1.24.3 | https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/ort-wasm-simd-threaded.wasm | MIT | [LICENCE-ORT-WEB.txt](LICENCE-ORT-WEB.txt) | `sZw0EVBgUn+dNhQfjHDg8lwtmicKMm1bTvWS4rIRNxoVN1S9HkVyJ2nreMpYruEZ` |
| `heatmap.min.js` | `heatmap.js` | 2.0.5 | https://cdn.jsdelivr.net/npm/heatmap.js@2.0.5/build/heatmap.min.js | MIT | [LICENCE-HEATMAPJS.txt](LICENCE-HEATMAPJS.txt) | `BlRWQS67hrnZlggSB+aRUTIWyxdjmsWxRnta6UvociBjKrx7/QuODVy7TJ0ov3Pi` |

Licence terms require the full licence text to travel with the code. The files above are the verbatim upstream copies — do not edit them. If you bump a vendored library to a new version, refresh the matching licence file from the upstream repository at the matching tag, and update the SRI hash.

## Why the WASM-only ORT Web build

`onnxruntime-web` ships several entry points. We use `ort.wasm.min.js` rather than `ort.all.min.js` because WebGPU has not yet been evaluated — the binary is larger and WebGPU inference performance needs its own benchmarking before enabling. `ort.wasm.min.js` is the CPU-only build: one 12 MB WASM file, one small JS entry, one small glue module.

The WASM binary (`ort-wasm-simd-threaded.wasm`) supports both single- and multi-threaded execution. `loader.js` sets `numThreads` conditionally: multi-threaded when `crossOriginIsolated` is true (which `coi-sw.js` ensures), single-threaded otherwise. The threaded path gives a typical 2–4× speedup on desktop hardware.

## Updating a vendored file (with SRI)

The `integrity=` attributes in `docs/index.html` must match the bytes on disk exactly. The browser refuses to execute a script whose hash does not match. Recompute after any change:

```sh
openssl dgst -sha384 -binary docs/vendor/ort.wasm.min.js                | openssl base64 -A
openssl dgst -sha384 -binary docs/vendor/ort-wasm-simd-threaded.mjs     | openssl base64 -A
openssl dgst -sha384 -binary docs/vendor/ort-wasm-simd-threaded.wasm    | openssl base64 -A
openssl dgst -sha384 -binary docs/vendor/heatmap.min.js                 | openssl base64 -A
```

Prefix the output with `sha384-` when writing it into the `integrity=` attribute. Update the table above at the same time — reviewers should be able to diff the table against the bytes on disk without running a command.

The WASM file does not have an `integrity=` attribute in HTML because it is loaded by ORT Web's own glue code rather than by a `<script>` tag. Its SRI hash in this table is recorded for manual reviewers rather than enforced by the browser; if you bump ORT Web, verify the wasm hash matches the upstream release bytes before committing.

## Updating

1. Download the new file from its package source.
2. Replace the vendored copy here.
3. Update the version column in this table.
4. Run `pnpm test` and `pnpm test:e2e` to verify nothing broke.
5. Note the upgrade in `CHANGELOG.md`.

Do not edit these files in place. If you need a patched version of a library, fork it upstream and document the fork in `LEARNINGS.md`.
