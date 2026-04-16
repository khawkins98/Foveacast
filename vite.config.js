// Vite dev-server configuration for Foveacast.
//
// Foveacast ships as a "buildless" static site: the files inside `docs/`
// are exactly what GitHub Pages publishes, and exactly what a user gets
// when they download the repo as a zip and double-click `index.html`.
// There is deliberately no build step that copies or transforms the
// source. The promise in the PRD ("unzip and open index.html") is only
// credible if the folder the developer edits is the folder the user
// runs.
//
// Pointing Vite's `root` at `docs/` means `pnpm dev` serves that same
// folder over HTTP with live reload, without ever producing a `dist/`
// directory. Tests do not use Vite — they run under Vitest with jsdom —
// so this file stays minimal.
import { defineConfig } from 'vite';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Custom Vite middleware that short-circuits requests under `/models/`
 * and serves the raw bytes directly.
 *
 * Why this exists: TensorFlow.js loads weight shards (group1-shard1of6,
 * etc.) that have no file extension. Vite's import-analysis plugin sees
 * those extensionless files and attempts to parse them as JavaScript
 * source, which blows up with "Failed to parse source for import
 * analysis". The net effect is a 500 Internal Server Error for every
 * weight shard during `pnpm dev`, which breaks the E2E test that
 * exercises the demo-mode background model load.
 *
 * GitHub Pages (the production host) serves static files unchanged, so
 * the issue is dev-server-specific. This plugin pre-empts Vite's
 * middleware stack for `/models/*` URLs and responds with the raw file
 * bytes and a conservative `application/octet-stream` content type.
 */
function serveModelsAsStatic() {
  return {
    name: 'foveacast-serve-models-as-static',
    configureServer(server) {
      const modelsRoot = resolve(server.config.root || process.cwd(), 'models');
      server.middlewares.use((req, res, next) => {
        const url = req.url || '';
        // Strip querystring + hash before matching.
        const pathPart = url.split('?')[0].split('#')[0];
        if (!pathPart.startsWith('/models/')) {
          next();
          return;
        }
        const filePath = join(modelsRoot, pathPart.slice('/models/'.length));
        if (!existsSync(filePath) || !statSync(filePath).isFile()) {
          // Respond with a real 404. If we `next()` here, Vite's
          // default handler serves something (often the SPA index
          // fallback) with a 200 — `resolveModelUrl`'s HEAD probe
          // then thinks the local mirror exists, tf.js fetches the
          // fallback as JSON, and parsing fails noisily.
          // A 404 tells the client the mirror is not there, so it
          // falls back to GCS instead.
          res.statusCode = 404;
          res.setHeader('Content-Type', 'text/plain');
          res.end('Not Found');
          return;
        }
        try {
          const bytes = readFileSync(filePath);
          const isJson = filePath.endsWith('.json');
          res.setHeader('Content-Type', isJson ? 'application/json' : 'application/octet-stream');
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

export default defineConfig({
  // Serve the GitHub Pages publish folder directly. No intermediate
  // build output, no duplicated source tree.
  root: 'docs',

  plugins: [serveModelsAsStatic()],

  server: {
    // Open the browser automatically on `pnpm dev` for a faster
    // inner loop; harmless in headless CI because CI runs vitest,
    // not the dev server.
    open: true,
  },
});
