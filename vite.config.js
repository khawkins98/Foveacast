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

export default defineConfig({
  // Serve the GitHub Pages publish folder directly. No intermediate
  // build output, no duplicated source tree.
  root: 'docs',

  server: {
    // Open the browser automatically on `pnpm dev` for a faster
    // inner loop; harmless in headless CI because CI runs vitest,
    // not the dev server.
    open: true,
  },
});
