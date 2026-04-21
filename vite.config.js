// Vite dev-server configuration for Foveacast.
//
// Foveacast ships as a "buildless" static site: the files inside `docs/`
// are exactly what GitHub Pages publishes. There is deliberately no build
// step that copies or transforms the source. Pointing Vite's `root` at
// `docs/` means `pnpm dev` serves that same folder over HTTP with live
// reload, without ever producing a `dist/` directory. Tests do not use
// Vite — they run under Vitest with jsdom — so this file stays minimal.
import { defineConfig } from 'vite';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Custom Vite middleware that short-circuits requests under specific
 * path prefixes and serves the raw bytes directly, bypassing Vite's
 * transform pipeline.
 *
 * Why this exists — two separate dev-server quirks, same fix:
 *
 *   1. `/models/*` — V1's TF.js weight shards had no file extension, and
 *      Vite's import-analysis plugin 500'd trying to parse them as
 *      JavaScript. V2+ serve `.onnx` files which avoids that, but we
 *      keep the passthrough for correct `application/octet-stream` and
 *      to make future multi-file model layouts friction-free.
 *
 *   2. `/vendor/*` — Vite mutates the bytes of some vendored scripts
 *      before serving them (observed 9 KB heatmap.min.js becoming
 *      50 KB with a source-map stub). The mutation breaks the SRI
 *      `integrity=` hashes in index.html, which are computed from
 *      the bytes on disk. The ORT Web vendor files also need the same
 *      guarantee.
 *
 *   3. `coi-sw.js` — the coi-serviceworker script lives at the root
 *      of `docs/` so the service worker scope is `/` (if it were under
 *      `/vendor/`, the SW scope would only cover `/vendor/` paths).
 *      Vite would otherwise transform its bytes, breaking both the SRI
 *      hash and the service worker runtime.
 *
 * GitHub Pages (the production host) serves static files verbatim,
 * so both issues are dev-server-specific. This plugin pre-empts
 * Vite's middleware stack for both path prefixes and responds with
 * the raw file bytes.
 *
 * The conservative `application/octet-stream` is overridden for
 * known extensions (JSON, JS) so the browser and SRI both accept the
 * response.
 */
function servePassthroughStatic() {
  /** Prefixes we handle and the folder each is rooted under. */
  const prefixes = [
    { url: '/models/', dir: 'models', fallbackOn404: false },
    { url: '/vendor/', dir: 'vendor', fallbackOn404: false },
  ];

  /**
   * Exact root-level files that must be served verbatim.
   * `coi-sw.js` acts as both the in-page registration shim and the
   * service worker script; any byte mutation by Vite would (a) break
   * the SRI `integrity=` check and (b) corrupt the SW binary.
   */
  const exactFiles = ['coi-sw.js'];

  return {
    name: 'foveacast-serve-passthrough-static',
    configureServer(server) {
      const root = server.config.root || process.cwd();

      server.middlewares.use((req, res, next) => {
        const url = req.url || '';
        // Strip querystring + hash before matching.
        const pathPart = url.split('?')[0].split('#')[0];

        // Check exact-file list first (e.g. /coi-sw.js at the root).
        const exactName = pathPart.replace(/^\//, '');
        if (exactFiles.includes(exactName)) {
          const filePath = join(resolve(root), exactName);
          if (!existsSync(filePath) || !statSync(filePath).isFile()) {
            res.statusCode = 404;
            res.setHeader('Content-Type', 'text/plain');
            res.end('Not Found');
            return;
          }
          try {
            const bytes = readFileSync(filePath);
            const contentType = pickContentType(filePath);
            res.setHeader('Content-Type', contentType);
            res.setHeader('Content-Length', String(bytes.length));
            res.setHeader('Cache-Control', 'no-cache');
            res.end(bytes);
          } catch (err) {
            res.statusCode = 500;
            res.end(String((err && err.message) || err));
          }
          return;
        }

        const match = prefixes.find((p) => pathPart.startsWith(p.url));
        if (!match) {
          next();
          return;
        }

        const filePath = join(resolve(root, match.dir), pathPart.slice(match.url.length));
        if (!existsSync(filePath) || !statSync(filePath).isFile()) {
          // Respond with a real 404. If we `next()` here, Vite's
          // default handler serves something (often the SPA index
          // fallback) with a 200 — the loader would then think a
          // missing model file exists, ORT would try to parse HTML
          // as an ONNX graph, and the error would surface downstream
          // of the real problem. A 404 tells the client the resource
          // is not there (for `/vendor/`, it surfaces as an SRI /
          // script-load error with a clear console message).
          res.statusCode = 404;
          res.setHeader('Content-Type', 'text/plain');
          res.end('Not Found');
          return;
        }
        try {
          const bytes = readFileSync(filePath);
          const contentType = pickContentType(filePath);
          res.setHeader('Content-Type', contentType);
          res.setHeader('Content-Length', String(bytes.length));
          res.setHeader('Cache-Control', 'no-cache');
          res.end(bytes);
        } catch (err) {
          // Surface the error honestly rather than 500'ing silently.
          res.statusCode = 500;
          res.end(String((err && err.message) || err));
        }
      });
    },
  };
}

/**
 * Pick a sensible Content-Type for pass-through static serving.
 * Vite's own static-file handler normally does this for us; since
 * we are bypassing it, we do it ourselves.
 *
 * @param {string} filePath
 */
function pickContentType(filePath) {
  if (filePath.endsWith('.json')) return 'application/json';
  // `.mjs` MUST be text/javascript — browsers block ESM imports
  // served with any other MIME type ("was blocked because of a
  // disallowed MIME type"). ORT Web reaches for its own glue module
  // (`ort-wasm-simd-threaded.mjs`) via a dynamic import from the
  // browser side, so this is not optional.
  if (filePath.endsWith('.js') || filePath.endsWith('.mjs')) return 'text/javascript';
  if (filePath.endsWith('.wasm')) return 'application/wasm';
  if (filePath.endsWith('.css')) return 'text/css';
  if (filePath.endsWith('.txt') || filePath.endsWith('.md')) return 'text/plain';
  if (filePath.endsWith('.onnx')) return 'application/octet-stream';
  return 'application/octet-stream';
}

export default defineConfig({
  // Serve the GitHub Pages publish folder directly. No intermediate
  // build output, no duplicated source tree.
  root: 'docs',

  plugins: [servePassthroughStatic()],

  server: {
    // Open the browser automatically on `pnpm dev` for a faster
    // inner loop; harmless in headless CI because CI runs vitest,
    // not the dev server.
    open: true,
  },
});
