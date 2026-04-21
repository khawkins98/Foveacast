# Learnings

A running log of what I found out while building Foveacast. Prose, dated, informal. Author: Ken Hawkins.

This file is not a changelog (that's `CHANGELOG.md`) and it isn't the spec (that's `docs/PRD.md`). It's the place where the things that don't fit in either of those live: dead ends, "oh, that's how that actually works" moments, notes for whoever picks the project up next, and small decisions that would otherwise evaporate.

---

## 2026-04-21 — Extracting boot-time helpers from main.js: modules, deps injection, and bound wrappers

**Why a separate module was necessary.** The obvious first move — pull `reloadModel` and `handleFile` up to module level in main.js so tests could import them directly — does not work. The bottom of main.js calls `boot()` immediately (or queues it on `DOMContentLoaded`). Any `import` of main.js in a test triggers the full boot sequence: DOM queries, dropzone setup, model load kick-off. The extracted functions need their own file so tests can import them cleanly with no side effects.

**Explicit deps instead of closure capture.** Each function receives a `deps` object rather than closing over `boot()` locals. This is dependency injection without a framework: the caller builds one deps object at boot time and the function is stateless beyond what it's handed. Unit tests supply mock deps with `vi.fn()` stubs, covering queueing, banner heuristics, and queued-file drain without touching the DOM or loading ONNX. The pattern is in `docs/src/boot-handlers.js`; tests are in `tests/boot-handlers.test.js`.

**Bound wrappers restore clean call sites.** Accepting `(options, deps)` is fine for tests but verbose at 10+ call sites in boot(). The fix is thin wrappers built once after all deps exist:

```js
const boundHandleFile = (file) => handleFile(file, handleFileDeps);
const boundReloadModel = (opts) => reloadModel(opts, reloadModelDeps);
```

Every call site in boot() uses the bound form. The real functions stay free of implicit state.

**`const` closures and the temporal dead zone.** `fileCallbacks.onFile` (early in boot()) references `boundHandleFile`, which is defined roughly 450 lines later. That looks like a TDZ violation. It's not, because: (a) the callback captures the variable *binding*, not the current value, and (b) the callback only fires when a user drops a file — which is always after `boot()` has run to completion. By then `boundHandleFile` is defined. TDZ only throws if you *read* a `const` before its declaration line executes in the current call stack; a deferred callback is not that.

**`runInferenceOnImage` stays in `boot()`.** It closes over ~10 boot-local names (renderOutput, updateReport, status, hud, outputSection, and more). Extracting it would require an equally large deps object and is a natural follow-up, not part of this pass. The issue only asked for `reloadModel` and `handleFile`.

---

: retiring file:// and unlocking WASM threading

**Why COEP is hard on GitHub Pages.** Pages cannot set `Cross-Origin-Embedder-Policy: require-corp` via its CDN configuration — there is no `_headers` file equivalent. The standard workaround is the [coi-serviceworker](https://github.com/gzuidhof/coi-serviceworker) pattern: a single JS file that doubles as the in-page registration shim *and* the service worker itself. On registration it intercepts every fetch and adds COEP/COOP headers to the responses, making `crossOriginIsolated = true` without any CDN cooperation.

**Dual-role file gotchas.** The file uses `typeof window` to decide which role it is playing — browser page context vs service worker context. That means it must be loaded with a plain `<script src="...">` tag, *not* `type="module"` (module-mode scripts don't have a `document.currentScript` and the registration code uses that to find its own URL). The tag must be the first script in `<head>` so the SW registers before ORT Web is even parsed.

**First-visit reload.** On first visit there is no SW yet. The SW installs, fires `updatefound`, and calls a page reload so that the new SW can serve the first COEP-headers-injected response. The reload is suppressed for subsequent visits via `sessionStorage.coiReloadedBySelf`. Playwright's `page.goto` tracks through the reload because it waits on the final `load` event; the E2E tests add a `crossOriginIsolated` assertion so future regressions surface early.

**Scope placement.** The SW scope covers whatever path it is served from. If the file lived at `docs/vendor/coi-sw.js`, the SW scope would be `/vendor/` — which controls nothing useful. The file must live at the repo root of `docs/` so the scope is `/` (or `/<repo>/` on Pages). The file is documented in `docs/vendor/README.md` (version, SRI, licence) even though it lives outside the vendor directory.

**Performance.** On a four-core laptop, `Math.min(4, navigator.hardwareConcurrency)` = 4. Informal benchmarking: 1-thread → ~6 s for the 3s model on an M1; 4-thread → ~1.5 s. For users on high-core-count desktops, the cap at 4 avoids scheduling overhead that can make more threads slower.

---



**Tap vs drag on the same pointer stream.** The hero voxel logo supports both drag-to-spin and click-to-pause on the same element. Distinguishing them required a `pointerHasMoved` flag: reset on `pointerdown`, set to `true` on `pointermove` when accumulated displacement exceeds 3px. On `pointerup`, if the flag is still false it's a tap and we toggle pause; if true, we treat it as a drag release. One extra case: `pointercancel` (browser interrupts the gesture — incoming notification, scroll takeover). We pre-set `pointerHasMoved = true` in the cancel handler so a cancelled gesture doesn't spuriously fire a pause toggle. Keyboard (Space/Enter) calls `togglePause()` directly with no ambiguity.

**Replacing the wireframe cube/sphere with the same heatmap eye as the hero logo.** The original `voxel-bg.js` had a cube→sphere morph that looked good in isolation but was visually disconnected from the hero logo we built later in the same PR. We replaced it with the same oblate-spheroid heatmap geometry. The main question was timing: `setState('ready')` triggers a 200 ms overlay fade-out, but the element also needs to re-parent into the main column at the end of that fade. Calling `onReady()` first and delaying the DOM re-parent by 250 ms (50 ms headroom past the fade) keeps the spinner visible throughout the transition. If a queued inference run calls `activate()` within that window, the state has already advanced to `'spinning'`, so the delayed re-parent guard (`currentState !== 'ready'`) skips the move and there is no race condition. The cube→sphere morph pattern is preserved in `docs/heerich-notes.md` for reference even though `voxel-bg.js` no longer uses it.

Code in `docs/src/ui/voxel-logo.js` (hero logo) and `docs/src/ui/voxel-bg.js` (loading indicator).

---

## 2026-04-20 — Voxel loading indicator: heerich style shape + CSS-vs-rAF for compositor smoothness

Two related gotchas in turning the heerich wireframe cube into Foveacast's loading indicator.

**heerich's `style` constructor option is flat, not keyed by face.** I cribbed an example that used `style: { default: {...} }`, which is valid as a per-voxel `styles` object (where keys are face names like `default`, `front`, `top`). But the constructor option is the *defaultStyle* itself — a flat `{ fill, stroke, strokeWidth }` map. Wrapping it in `default:` made the renderer emit `default="[object Object]"` as the only attribute on every polygon, with no `fill` or `stroke` attribute at all. SVG defaults take over: black fill, no stroke. Result: invisible cube against the dark backdrop. Fix: drop the wrapper. Confirmed by diffing the SVG output of both shapes side-by-side.

**Main-thread inference freezes JS animations; CSS animations on `transform` keep ticking.** Once the cube morphs to a sphere and the user starts an inference run, we want the sphere to keep spinning as the per-analysis loading indicator. The first attempt used the same rAF loop with a per-frame camera-angle update — and it stuttered to a stop the moment ORT started running, because the rAF callback was queued behind the inference work on the main thread. The fix is to render the sphere SVG once, then apply a CSS keyframes `transform: rotate()` animation. Compositor-thread `transform` animations don't block on the main thread, so the spin stays smooth all the way through inference. We add `will-change: transform` so the SVG gets promoted to its own layer up front. Tradeoff: the analyzing-state spin is a 2D in-plane rotation rather than a 3D camera rotation around an axis (which would require per-frame geometry rebuilds). Visually the difference is negligible because the sphere shell is roughly symmetric.

The cube spin during model load *is* still rAF-driven, because that phase is dominated by network I/O (off the main thread) and the rAF cadence stays smooth.

Code in `docs/src/ui/voxel-bg.js`. Vendored renderer at `docs/vendor/heerich.js` (heerich 0.14.0, MIT, [meodai/heerich](https://github.com/meodai/heerich)).

## 2026-04-20 — GitHub Pages HTTP cache TTL is 10 minutes, not "permanent"

The model `.onnx` files are served by GitHub Pages with `Cache-Control: max-age=600`. That's 10 minutes. After every 10-minute window the browser must revalidate. If a new deployment happened (changing the ETag), the browser re-downloads the full file — 57 MB for each V3 duration model.

This showed up as "the model keeps re-downloading on every visit" after a routine UI-only re-deploy. Users noticed it as a long loading spinner on what they thought was a returning visit.

The fix is the **Cache API** (`caches.open()`). Unlike the HTTP cache, Cache API storage has no automatic TTL. The model stays cached until the user clears site data or the ETag changes. We use a stale-while-revalidate approach:

- On a cache hit: return the cached bytes immediately (no network wait), then fire a background HEAD request to check the ETag.
- If the ETag changed: evict the stale entry. The *next* page load re-downloads the fresh model. The current session is unaffected — the bytes are already in memory and ORT has its session.
- If the HEAD fails (offline): use the stale cache entry anyway. This is intentional — offline capability is a stated product property.
- Only cache responses that carry an ETag. Without a validator we'd have no way to detect future model updates, and the entry would sit in CacheStorage forever.

Key implementation detail: `writeToModelCache` creates a `new Response(buf.slice(0), { headers })`. The `buf.slice(0)` gives the Response its own copy so the original `ArrayBuffer` remains valid for ORT inference. The 57 MB copy spike is brief and bounded to the initial download path (subsequent visits load from cache with no copy).

Code lives in `docs/src/model/loader.js` in `readFromModelCache`, `revalidateCachedModel`, and `writeToModelCache`. Tests are in `tests/model.loader.test.js` under "Cache API caching".

## 2026-04-16 — Initial V1 build

V1 shipped as a buildless static site. The source tree under `docs/` is the same folder that GitHub Pages publishes and the same folder a user gets when they unzip the repo and double-click `index.html`. There is no bundler step between edit and publish. Vite is in the project as a dev-time convenience only — it serves `docs/` on localhost and reloads on change, but it is never asked to produce a `dist/` folder. TF.js and heatmap.js come in through `<script>` tags from jsDelivr; everything else is plain ES modules loaded with `type="module"`. No framework. The promise in the PRD about "unzip and open index.html" is only credible if the folder the developer edits is literally the folder the user runs, and this layout makes that true by construction.

## 2026-04-16 — The MSI-Net TF.js weights are not on HuggingFace

The PRD assumed the browser-loadable weights lived at `huggingface.co/alexanderkroner/MSI-Net`. They do not. HuggingFace only hosts the original Keras SavedModel (`saved_model.pb`, roughly 100 MB), which is not loadable in a browser without a conversion step that no one wants to run at page-load time.

The actual TF.js Graph Model weights — already converted by the model author — live at:

```
https://storage.googleapis.com/msi-net/model/{preset}/model.json
```

with `{preset}` in `{very_low, low, medium, high, very_high}`. Each preset ships its own `model.json` and a set of sharded binary weight files alongside it. V1 loads directly from that bucket and lets the browser cache take care of everything after the first run.

This is a resilience risk. If Google deprecates the bucket, or the model author decides to move things, Foveacast breaks for every user whose cache has been evicted. The right follow-up is one of: a small script that pulls the five preset bundles out of GCS into `docs/models/` and commits them, if the total repo size stays reasonable; or a Hugging Face Spaces mirror maintained alongside the upstream. Neither was in V1 scope, but both are cheap to add later and I'd rather do it before the first "why is the tool broken?" issue lands.

## 2026-04-16 — Modernising from TF.js 1.1.2 to 4.x

The reference MSI-Net browser demo pins `@tensorflow/tfjs@1.1.2`. That release is seven years old at this point, which means no WebGPU backend, no SIMD-enabled WASM, and a pile of CDN-hygiene warnings. I bumped it to `@tensorflow/tfjs@4.22.0` and expected breakage.

None appeared. The two APIs Foveacast depends on — `tf.loadGraphModel(url)` and `model.predict(tensor)` — have been stable across that whole window. The preprocessing primitives I use (`fromPixels`, `toFloat`, `expandDims`, `resizeBilinear`, `clipByValue`, `reverse`) behave identically. The only visible difference is that 4.x picks a sensible backend automatically where 1.1.2 needed nudging. I took the quiet upgrade as a gift and moved on.

## 2026-04-16 — WebGPU, WebGL, and CPU fallbacks

Foveacast does not probe for a backend. It calls into TF.js and trusts TF.js to pick one. In the headless gstack browser that ran the integration checks during Phase D, WebGL was unavailable and WebGPU wasn't there either; TF.js fell back to the plain CPU backend without any code on my side. Inference was slower than it would be on a real desktop, but it produced the same tensors. On a real desktop Chrome, WebGL or WebGPU gets picked without any work from us.

The lesson: the PRD was right to insist the fallback be automatic and silent. Anything like "your browser doesn't support WebGPU, please enable…" would be a user-facing bug for a tool that has to work on whatever hardware lands on it.

## 2026-04-16 — The detached-container bug and what it taught us about testing

V1 shipped with a rendering bug: the first time anyone dropped a real screenshot onto the drop zone, heatmap.js threw `IndexSizeError: Failed to execute 'getImageData' on 'CanvasRenderingContext2D': The source height is 0`. Nothing in the vitest suite, the smoke script, or the headless browser check during Phase D caught it. A user caught it on the first drop.

The root cause was that the render wrapper created a `<div>` off-screen, never attached it to the document, and then called `h337.create({ container })`. heatmap.js sizes its internal canvas from `container.offsetWidth` / `offsetHeight`, and both are zero on a detached element. The canvas came out at 0×0, and the library's own `getImageData` call blew up downstream. The fix — attach the container hidden to `document.body` for the duration of the `create` call, then detach — is a couple of lines. The interesting part is how the bug travelled through three layers of "testing" without hitting anything.

**Vitest mocked at exactly the wrong layer.** The unit test replaced `globalThis.h337` with a stub that reflected `container.style.width` back as the canvas size. That passes because it never observes the real `offsetWidth` behaviour. The mock hid the interaction with the DOM that the bug depended on. Mocks should stay as close to the library boundary as possible and should, wherever feasible, be exercised against the real library at least once.

**The "browser" check during Phase D wasn't really a browser check.** Playwright-through-gstack timed out during model download and never reached the drop path. The agent reporting honestly logged this but the PR still read as "gstack verified". That's a framing problem as much as a tooling problem — a partial check should not pattern-match as full coverage.

**The smoke script only verified the server was serving HTML.** Its header now says so loudly. It's still useful as a fast pre-flight, but it should not carry the "E2E" label.

The response to all of this is on-branch and landed in two commits:

- `?demo=1` **as a user feature that doubles as a test surface.** Demo mode loads the committed example screenshot, synthesises a two-blob Gaussian saliency map, and runs it through the real postprocess → fixation → render → composite pipeline. It marks the output section ready via `data-foveacast-ready="true"` so automated tests can wait on a single attribute without racing. It skips the 40–60 s GCS model download, so a reviewer or a hiring manager can see output in under a second. The banner above the output keeps nobody from confusing synthetic preview for real inference.
- **Playwright against demo mode.** A small chromium suite that exercises the actual render pipeline against the actual heatmap.js library. Three assertions: the output canvas has non-zero dimensions, `getImageData` on it round-trips without throwing (the exact failure we shipped), and a pixel-grid sample finds non-trivial colour spread (a liveness probe that heatmap.js actually drew something). The suite runs in under four seconds and fails loudly if the render layer regresses in the same way again.

Playwright is deliberately kept out of the GitHub Actions CI for now. The browser image adds weight to every build, and the render layer changes rarely enough that running the suite before a render or demo-path change is adequate coverage. That tradeoff is worth revisiting once there are external contributors who won't have Playwright installed locally.

A secondary lesson: macOS Vite binds IPv6-only by default. The first Playwright webServer configuration polled `http://127.0.0.1:5173` and timed out because the server only answered on `[::1]:5173`. The config now uses `localhost` and `--strictPort`; both choices are commented in `playwright.config.js` so the next person who hits this doesn't have to rediscover it.

## 2026-04-16 — Four parallel reviewers, one afternoon

After the core V1 landed and before shipping, I spawned four sub-agents as reviewers in parallel — UX consultant, frontend developer / developer advocate, technical writer, and code maintainer — each with their own lens, their own prompt, and strict instructions not to change code. Each wrote a structured review to `/tmp/foveacast-review-{role}.md` and returned a short summary ranking their findings P0/P1/P2. I consolidated the summaries into a single list for the user, we agreed on which batches to execute, and then I handed each batch to another sub-agent for the actual work.

This was the single highest-leverage move in the build. A few observations worth retaining:

- **The lenses compounded.** The UX reviewer flagged "drop anywhere on the page" and "watermark the demo output" as P0. The maintainer flagged the same ship as a "render-layer bug can ship again because Playwright is opt-in". The tech writer found a `<owner>` placeholder in the README. None of those would have been caught by the same reviewer — the diversity of lenses is what caught the diversity of bugs.
- **"Read-only, write findings to /tmp/" is the right contract.** Reviews that try to fix on the way surface fewer problems, because the reviewer mentally optimises for "can I fix this quickly" rather than "what's actually wrong here." Separating reviewing from fixing made the reviews blunter and more useful.
- **Structured summaries outrank prose reports.** Asking each agent to return the top 5 findings ranked P0→P2 plus one sentence per finding made the consolidation trivial. A 3,000-word review document is useful for depth; a 400-word ranked summary is what a decision gets made against.
- **The "three things the project does well" section in each review is load-bearing.** Reviews that only list problems leave the maintainer guessing what to preserve. Asking each reviewer to name positive choices gave me a check against over-correction.

The whole loop — from "review the project" to "here are 15 prioritised findings" to "acted on 8 of them in 3 commits" — took roughly two hours of wall time. For a V1 ship it was cheap insurance against the class of mistake that comes from reviewing your own work.

## 2026-04-16 — UX iteration after the reviews

Three findings from the UX review compounded into a single interaction design rethink that made the product meaningfully better.

**Drop anywhere on the page.** The drop zone was a rectangle. A file dropped one pixel outside that rectangle caused the browser to navigate away from Foveacast and open the file in the tab — the worst possible failure mode for a one-purpose tool. The fix is six lines: document-level `dragover`/`drop` handlers in capture phase, always `preventDefault()`. But it took the UX reviewer to point out that "drop zone" as a UI metaphor has to match "drop zone" as a DOM contract, and the body is a better drop zone than any rectangle inside it.

**Progressive disclosure.** The pre-drop UI showed the opacity slider, view toggle, preset picker, and Download button — all disabled, all competing with the drop zone for the user's first glance. Once the drop zone was clearly the next step, everything else was noise. Hiding those controls until the first heatmap renders turned the pre-drop page into "drop zone + one-line promise + attribution footer" — clearer about what to do next without removing any capability.

**Watermark the demo output.** The synthetic-saliency demo mode was visually indistinguishable from a real MSI-Net prediction once you cropped the banner away. A tiled diagonal `FOVEACAST DEMO — SYNTHETIC` watermark baked into the canvas means a social-media crop of a demo screenshot still reads as a demo. The banner still matters for screen-reader users and for honesty on first view; the watermark is defence in depth.

Shared thread: all three are tiny in code (a handler, a `setVisible`, a `drawText` grid) and large in felt quality. The lesson for a V2-sized effort is to not under-budget UX iteration after feature-complete. The ratio of "time spent" to "product quality gained" on those three commits was easily the best of the whole build.

## 2026-04-16 — Resilience trilogy: vendoring, weight mirroring, SRI

The maintainer review called out three single points of failure that were all invisible while the code worked. Fixing them turned Foveacast from "depends on three external services" into "depends only on GitHub Pages."

1. **Vendoring** `@tensorflow/tfjs` and `heatmap.js` under `docs/vendor/`. Previously both loaded from jsDelivr; a CDN outage or a silent compromise would take every user down. The minified bytes are ~1.4 MB for TF.js and ~12 KB for heatmap.js, committed verbatim. The "unzip and open `index.html`" promise now actually holds offline.

2. **Weight mirroring** via `scripts/fetch-weights.sh` and the `docs/models/` folder. The MSI-Net author's Google Cloud Storage bucket is now a fallback, not a runtime dependency. The deploy workflow runs the fetch script before uploading the Pages artefact; the hosted build serves all five presets from its own origin. `docs/models/` is gitignored locally — the mirror is either populated on demand (`pnpm weights`) or reconstructed at deploy time — so the repo stays small.

3. **Subresource integrity** hashes on the vendored scripts. An attacker who somehow got a commit through could silently replace `docs/vendor/tf.min.js`; the sha384 `integrity=` attribute in `index.html` means the browser refuses to execute bytes that don't match. Reviewers can diff the hash table in `docs/vendor/README.md` against the files on disk without running a tool.

Each of these is small on its own. Together they shifted the trust surface from "three external parties have to stay trustworthy" to "this repo has to stay trustworthy." For a product whose positioning is "nothing leaves your machine," that shift matters — the user's trust in Foveacast's privacy stance is only as strong as the weakest link in the chain of things that have to cooperate for the tool to run.

## 2026-04-16 — Vite's dev server was a persistent small tax

Three unrelated-looking bugs had the same root cause: Vite's dev middleware assumed everything under the root directory was source code, and kept tripping on files that were not.

- **Extensionless binary files (weight shards) 500'd.** Vite's import-analysis plugin saw `group1-shard1of6` and tried to parse it as JavaScript. Every shard fetch became a 500.
- **Missing files returned HTML.** When `docs/models/` wasn't populated, the loader's HEAD-probe to `./models/medium/model.json` hit Vite's SPA-fallback and got the index page with status 200 back. `resolveModelUrl` thought the mirror existed, tf.js fetched the HTML as JSON, and parsing failed with a confusing error.
- **Vendored files were mutated in transit.** Vite injected a source-map stub into `heatmap.min.js` (9 KB on disk became 50 KB served) which broke the SRI hash check.

Same fix for all three: a small custom Vite plugin (`servePassthroughStatic` in `vite.config.js`) that short-circuits specific path prefixes and serves the raw bytes with a correct Content-Type. The plugin handles `/vendor/*` and `/models/*`; adding a new passthrough is one line in the `prefixes` array.

A secondary lesson: Vite's dev-server behaviour is not the same as the Pages production behaviour. GitHub Pages is a dumb static file server; Vite's dev is an opinionated middleware stack. That mismatch is why "works locally" and "works on Pages" diverged. The fix isn't to make Vite behave like Pages — it's to have CI exercise the dev server directly so the mismatch surfaces before a user hits it.

## 2026-04-16 — Shipping day: the last-mile GitHub Pages flow

Merging V1 to `main` should have triggered the deploy workflow and put the site up. It didn't, for two reasons I hadn't anticipated.

**Pages has to be enabled on the repo before the first deploy.** `actions/deploy-pages@v4` returned 404 with a helpful message pointing at Settings → Pages, but the message only helps if you can get to that screen. For a fresh repo, enabling via `gh api -X POST /repos/{owner}/{repo}/pages -f "build_type=workflow"` is one command. Then the next push to `main` deploys. This is now documented in CLAUDE.md so a future repo modelled on this one doesn't rediscover it.

**`gh run rerun --failed` on a deploy job has an artefact-collision trap.** The failed run uploaded a `github-pages` artefact (before the deploy step failed); the re-run uploaded a second one. `actions/deploy-pages@v4` looks up artefacts by name and refuses to choose when it finds more than one. The fix is to dispatch a fresh workflow via `gh workflow run deploy.yml --ref main` rather than re-running the failed one. Different run number, single artefact, clean deploy.

Both of these are one-time papercuts that don't recur once the project is past the first ship. I'm keeping the notes anyway because the shape of them — "a thing you only do once, which means you only hit the edge case once" — is exactly the shape a future-me (or a future Claude session) will Google for and not find.

## 2026-04-16 — The four testing tiers that emerged

I didn't set out to design a testing taxonomy. It arrived one bug at a time, each tier filling a hole the previous one didn't cover.

- **Vitest unit** (`tests/*.test.js`) — 106 cases, runs in ~700 ms, gate on every PR and push. Covers pure logic in `pipeline/`, the loader's error classification, file validation, demo helpers. This is the feedback loop; it has to stay fast and green.
- **Smoke** (`scripts/smoke-test.sh`, invoked via `pnpm smoke`) — a curl-based liveness check. Boots the dev server, confirms HTTP 200 and the expected mount-point markers. It exists to catch "I broke the dev server" failures before they take up a Playwright slot. Explicitly labelled a liveness check in its header, to prevent a repeat of the "the smoke passed, therefore E2E is covered" mistake that shipped the detached-container bug.
- **Playwright chromium against demo mode** (`tests/e2e/*.spec.js`, `pnpm test:e2e`) — 6 cases, runs in ~10 s, gate on every PR and push. Exercises the real render pipeline against the real heatmap.js library. This is the tier that catches the class of bug that vitest mocks hide.
- **Playwright against a simulated CI environment** (`pnpm test:e2e:no-mirror`) — moves `docs/models/` aside and runs the Playwright suite. This is the only command that reliably predicts whether CI's Playwright job will pass, because CI's runtime state (no mirror populated) differs from a local dev's (mirror populated by a previous `pnpm weights`).

The tiers answer four different questions: "is my pure logic correct?", "does the dev server start?", "does the real library behave as I think?", "will CI pass?" Running only the first would have shipped the detached-container bug. Running all four takes under 30 seconds of wall time and is cheap insurance.

Worth restating because it was the most expensive lesson of the build: a test that mocks the library you're testing against is worse than no test. A green suite communicates "covered"; if the coverage is illusory, the green is a lie.

## 2026-04-16 — Running Foveacast on itself

The first thing anyone builds a predictive-attention tool for is themselves. I dropped a screenshot of the Foveacast landing page into Foveacast and looked at where it said people were likely to look first.

The heatmap was mostly encouraging and slightly humbling:

- **The status banner and the drop zone were the two hotspots.** That's what they should be. "Model loaded — drop a screenshot to start." pulled real attention, and the drop zone itself was high-heat — the first-fixation crosshair landed on its top edge, which is the one thing the user needs to notice.
- **The `<h1>` and the tagline under it ate a noticeable share of first attention.** For a one-purpose tool that is actually a cost: every fixation on the brand is a fixation not on the drop zone. The header can stand down a little.
- **The one-line promise — "Free. No account. Nothing leaves your machine." — attracted more heat than I expected.** That line is doing the work I hoped it would. Keep it prominent; don't bury it.
- **The right margin had drifting green patches over empty space.** Nothing to look at, but the model's learned priors for web layouts assume symmetry, and our single-column layout leaves that symmetric space unused. Not a bug — a nudge that a two-column treatment at wider viewports could absorb that wandering attention usefully, perhaps with a small "what this does" helper block.
- **The attribution footer and bias disclosure got warm.** Good: those need to be seen, and they are, without stealing from the primary action.

The general lesson — and the reason this entry exists — is that a predictive tool used on its own UI is a near-free UX audit. The heatmap doesn't give you answers, but it tells you where the eye is working and where it is wasted, in the same way you'd otherwise have to pay a UX researcher to tell you. If anything about the landing page changes in a future release, the new version should be run through Foveacast before merging.

Changes that came directly out of this audit shipped in the 0.1.1 patch: a tighter header, a small "what this does" helper block to use the empty right-hand space at wider viewports, and a visually stronger drop zone so the ratio of "first-fixation on the actual target" to "first-fixation on chrome" improves.

## 2026-04-16 — Structured errors beat string-sniffing

`main.js` used to classify model-load failures by calling `.includes('fetch')` on the TF.js error message. That was a tripwire for every TF.js minor bump — the library's error wording has changed before and will change again. The maintainer review flagged this as High severity; the fix was to classify at the source (inside `loader.js`) and attach a structured `code` property to the thrown error.

Classifier heuristics, in order of reliability:

1. A `TypeError` in the error or anywhere in its `cause` chain. Browsers throw `TypeError` on network-unreachable `fetch` failures, across vendors and across versions. This is the most stable signal.
2. "Request failed with status" substring — the shape TF.js uses for non-2xx responses. Still a string match, but a much narrower surface than the old code.
3. Everything else → `MODEL_LOAD_FAILED` (parse error, incompatible format, etc.).

The returned error carries `cause` (original error) and `url` (what we were loading from). main.js reads `.code` directly — no wording-dependent logic.

The general lesson for future code: when you need to branch on the cause of a failure, assign the failure a code at the seam where the classification is cheapest, not at the point where the UI needs the answer. String-sniffing in the UI layer is a sign you skipped a refactor two layers deep.

## 2026-04-16 — heatmap.js is old and quirky

heatmap.js does its job but its job description is from 2013. It stores its backing canvas on a private `_renderer.canvas` field; there's no documented way to reach into the buffer it draws into, and what looks like the official accessor isn't stable across versions. It has no OffscreenCanvas mode. At the top two presets, the output saliency map has more points than the library can render quickly, so Foveacast strides over the map and feeds in a downsampled point set rather than every pixel.

It works. The tests pass, the overlays look correct, and performance is fine once the model has run. But the private-field access and the manual stride are the kind of thing that rots quietly when the library updates, so I am flagging it here as technical debt to revisit for V2. If we're rewriting the model layer for ONNX anyway, that's a natural moment to look at alternatives — a small custom Canvas 2D renderer would probably be less code than the heatmap.js glue plus its workarounds.

**Resolved in V3 (2026-04-17).** The V3 cleanup removed heatmap.js entirely. `render/saliency-canvas.js` now uses a direct Canvas 2D inferno colormap — no private-field access, no stride workaround, no external library. The vendor directory and `<script>` tag are gone. The TODO item tracking this debt was also removed. See CHANGELOG 0.3.0 and PR #7 for the full diff.

## 2026-04-16 — V2 UNISAL investigation (no code)

The PRD's V2 path is UNISAL (Apache 2.0, ECCV 2020) through ONNX Runtime Web. The reason UNISAL rather than a direct accuracy-per-pixel contender is partly licence clarity, partly ecosystem fit: it's pure PyTorch with standard ops, no custom CUDA kernels, which is exactly the profile that `torch.onnx.export` handles cleanly. No code was written for this investigation; what follows is the plan and the open questions.

The migration shape is: keep `pipeline/`, `render/`, and `ui/` untouched; rewrite `model/loader.js` and `model/inference.js` against `onnxruntime-web`; update the preset-to-URL mapping to point at an ONNX artefact instead of a TF.js Graph Model. The `runInference` contract the PRD defines should carry over without changes.

Open questions before committing effort:

- What does the ORT Web WASM bundle add to first-load size compared with the TF.js budget we are paying today?
- Does the WebGPU execution provider cover UNISAL's specific op set (depthwise separable convolution, GRU for the video path)? If not, we fall back to the WASM CPU provider, which is still fine but changes the speed story.
- Is there an existing community-exported UNISAL ONNX model we can start from, or do we own the export end-to-end?

Suggested spike as a separate piece of work: run `torch.onnx.export` on a stock UNISAL checkpoint, validate the resulting graph in ORT on CPU first, and only then try it in ORT Web. That ordering catches export problems without the browser-runtime variable layered on top.

## 2026-04-16 — UNISAL ONNX desk-research spike

Went back and answered the three open questions from the V2 investigation entry. The full write-up is [`docs/spikes/unisal-onnx-research.md`](docs/spikes/unisal-onnx-research.md). The short version:

The ONNX export itself should be clean. Every op UNISAL uses is standard PyTorch. The convolutional GRU is implemented from Conv2d + sigmoid + tanh rather than `nn.GRUCell`, and — more importantly — the image-only path bypasses the GRU entirely when `static=True` and `bypass_rnn=True`. That removes the one construct (the Python `for t in range(T)` loop) that would have forced us to deal with ONNX Loop ops or unrolling. Two things to handle at export time: the forward signature is 5-D (`[batch, time, channel, h, w]`), and the `source` string argument drives Python-side attribute lookups that will hard-code whichever dataset we pass at export. Neither is a blocker; both are scope for the export script.

The ORT Web runtime cost is larger than expected. The default WebGPU-capable build is around 20 MB of WASM (~6 MB gzipped); a size-optimised source build drops to ~8 MB; the minimal-build path gets to ~3 MB but requires converting the model to ORT format and a local build that only links the ops UNISAL needs. TF.js today is 1.4 MB vendored. The weight-file side moves in the opposite direction — UNISAL is 5–20× smaller than MSI-Net per the PRD, so a single preset weight file is probably 5–15 MB against MSI-Net's ~24 MB. Net first-run total is a wash or slightly worse for the default build and clearly better for the minimal build.

ORT Web falls back to single-threaded WASM without COEP headers, which is the behaviour we need for GitHub Pages. Not an error path, not a warning — just slower than it would be with cross-origin isolation. Given GitHub Pages cannot set COEP, this is the permanent browser-side performance floor for any V2 built on ORT Web.

No community ONNX export exists. Searches across GitHub and HuggingFace turn up the reference PyTorch repo and the KDSalBox knowledge-distillation toolbox, nothing else. We own the export end-to-end.

Recommendation going forward: proceed to a hands-on export spike on a one-day time box. Do *not* schedule a V2 integration until that spike validates the export and until a separate qualitative comparison confirms UNISAL actually outperforms MSI-Net on Foveacast's target content types. "UNISAL was trained on more diverse data" is a reason to look, not a reason to ship; accuracy on the actual screenshots is the metric that matters.

## 2026-04-16 — UNISAL ONNX hands-on export

Ran the export. Everything worked on the first pass end-to-end, which is not something I often get to write about this kind of integration. Full write-up in [`docs/spikes/unisal-onnx-research.md`](docs/spikes/unisal-onnx-research.md) §Option B; short form here.

Set up a Python 3.12 venv via `uv`, installed torch 2.11, onnx, onnxruntime, onnxscript, plus the UNISAL runtime dependencies its `__init__.py` drags in (opencv-python, tensorboardX, fire, scipy) even when you only want the model class. Cloned `rdroste/unisal` into `/tmp`. Wrote `scripts/unisal-onnx-export.py`, which loads the SALICON checkpoint, wraps the model in a thin `nn.Module` adapter that accepts `[1, 3, 288, 384]` and squeezes out UNISAL's native time and channel dims, and calls `torch.onnx.export` with `source="SALICON"` and `static=True` baked in.

Three things from the desk spike that turned out right: every op traced cleanly, the image path skipped the convolutional GRU entirely, no `torch.jit` or custom autograd to fight. One thing the desk spike missed: UNISAL's forward() returns **log-probabilities**, not a sigmoid'd 0–1 saliency map. Raw output on the surfer test image lives in `[-23.537, -7.732]`. You can see this either by reading the training loss (KLD + NSS + CC; KLD implies log-softmax output) or just by printing the tensor after a forward pass. A browser port will need an `exp()` step before the heatmap rendering path.

The exported artefact is 12.5 MB as a single self-contained `.onnx` file after forcing `onnx.save_model(save_as_external_data=False)`. The first export pass wrote weights to a sidecar `.onnx.data`, which the modern torch exporter does by default. For the browser we want one file; the script handles the rewrite in-place.

Parity is essentially perfect: max |Δ| between ORT CPU and stock PyTorch across three synthetic fixtures and one real photo is 5.3e-05. For context, "good enough" is 1e-3 and "something went wrong" is 1e-2. ORT CPU inference time on macOS ARM64 is ~27 ms per frame, which is more than fast enough for a one-at-a-time drop-and-render interaction in the browser.

Net: the technical story for V2 is no longer "can we get UNISAL into the browser". It is "do we want to pay 8–20 MB of extra ORT Web wasm for a 12.5 MB weight file and potentially better content generalisation". That is a product judgement and should be informed by an actual qualitative comparison between MSI-Net and UNISAL output on representative Foveacast screenshots. The "Model-quality benchmarking" roadmap item is the gate, not another engineering spike.

The ONNX artefact itself is committed to `docs/models/unisal/model.onnx` on the spike branch. If V2 ships, this is already the production artefact; if the spike branch gets archived, nothing is lost because the recipe in `scripts/unisal-onnx-export.py` is reproducible.

## 2026-04-16 — V1 vs V2 qualitative benchmark (with ground truth)

The spike doc said a qualitative MSI-Net vs UNISAL benchmark was the gate before committing to V2. We shipped V2 without it. After shipping, I ran the A/B on four screenshots — two without ground truth and two with real eye-tracking data from a published usability study. The result is strong enough that it deserves a record separate from the PR comment thread.

**Ground-truth source.** The two ACS (American Community Survey) screens in the comparison folder come from [ResearchGate figure 4, "Round 1 Welcome Screen"](https://www.researchgate.net/figure/Round-1-Welcome-Screen_fig4_235343733) — a published Census Bureau usability study with participant eye-tracking heatmaps overlaid. The "counts" legend in the ground-truth images is participant fixation counts, which makes them directly comparable to a saliency prediction: where the real users looked, and how intensely. For UI content specifically, this is the kind of signal that would take weeks to collect in-house — having someone else's study already on the internet is a gift, and we should use it.

**Comparison screenshots, all in `docs/spikes/comparison/`:**

- `undrr-gar-*` — UNDRR Global Assessment Report page. Dense UN/NGO text content. No ground truth.
- `youtube-home-*` — YouTube logged-out home page. Thumbnail grid, category chips, Shorts reel. No ground truth.
- `acs-welcome-*` — ACS welcome screen with Begin button. Ground truth present.
- `acs-question-*` — ACS survey question page with sidebar navigation. Ground truth present.

**What the no-ground-truth screens showed.** MSI-Net produces a visibly more granular output on both — individual page elements register as distinct hotspots; UNISAL produces a central blob. For a designer reviewing a layout, "which of these elements competes for attention" is the question being asked, and MSI-Net answers it with more resolution. That alone is a readable product win, but it is subjective.

**What the ACS welcome screen showed.** Both models miss the Begin button that real participants fixated on most. MSI-Net's fixation falls on the title; UNISAL's lands in the negative space between text lines. Neither prediction is "right" — they both behave like natural-scene models, weighing text and faces over CTAs, because that is what they were trained to do. This is the strongest evidence that the SALICON-training-data limit is the ceiling for this kind of content regardless of which SALICON-trained model we pick.

**What the ACS question screen showed.** This is where the comparison got interesting. Real-participant fixations clustered on (a) the question "What is your sex?" with its radio buttons, (b) the right-hand "Where You Are" navigation box, and (c) the Previous/Next buttons. MSI-Net's predicted heatmap has clear hotspots on the first two — the question area AND the right sidebar — plus visible warmth on the button row. UNISAL's predicted heatmap is one large central blob with barely any sidebar activation. **MSI-Net's prediction tracks the real eye-tracking data meaningfully better than UNISAL's on this screen.** Whatever slight "newer model" theoretical advantage UNISAL has on natural scenes does not carry over to UI forms.

**The pattern across all four:**

| Screen | Content type | Ground truth? | MSI-Net | UNISAL |
|---|---|---|---|---|
| UNDRR GAR | Dense text | No | Granular hotspots on accordion items | Single central blob |
| YouTube home | Thumbnail grid | No | Each tile resolves separately | Uniform red over upper 2/3 |
| ACS welcome | Form CTA | Yes | Diffuse, misses Begin | Diffuse, misses Begin |
| ACS question | Form + sidebar | Yes | **Tracks ground truth hotspots** | Central blob, weak sidebar |

**Conclusion.** The architectural wins of V2 (12.5 MB in-repo artefact, no GCS dependency, single-file ONNX, proof that the layer boundary cleanly supports a model swap) are real and measurable. The output-quality argument for V2 is not landing. On the one comparison with ground-truth signal and enough structure to differentiate, MSI-Net is materially closer to what real users looked at.

**What this changes about the V2 decision.** At minimum: the "no clear winner" framing the PR comment offered after n=2 was too generous. With n=4 and two ground-truth comparisons, MSI-Net looks better for Foveacast's target content (UI screenshots). The reasonable paths forward are (1) revert V2 and keep the architecture work + ONNX artefact as proof-of-concept, (2) ship both and expose a model toggle, or (3) ship V2 anyway because the architectural discipline wins are worth more than the output-quality loss on this specific content class. None of these three is obviously right, and the call is a product judgement the maintainer has to make with eyes open rather than by default. This LEARNINGS entry is the eyes-open record.

**What this reinforces about V3.** SUM's value proposition — a model explicitly trained on UI screenshots — becomes more compelling after seeing how badly SALICON-trained models miss UI-specific attention targets like CTAs. The Mamba CUDA-kernel blocker stays the same, but the urgency of cracking it is higher than the V1 build suggested.

## 2026-04-16 — Wider model survey; V3 pivots from SUM to UMSI++

After the V1-vs-V2 benchmark made clear that both shipped-candidate models were SALICON-limited, cast a wider net. Full write-up in [`docs/spikes/model-survey-2026-04.md`](docs/spikes/model-survey-2026-04.md); short version here.

The survey looked for post-2023 saliency models that were (a) permissively licensed, (b) ONNX-exportable, and (c) ideally evaluated on UI / web / document content rather than natural scenes. Ten candidates came back, most of which fall out immediately — closed-source (UniAR), non-commercial licence (ViNet-S), or no UI evidence (SalTR, MDS-ViTNet). Two survive the filter.

**UMSI++ (the model UEyes actually ships)** is the surprise of the survey. It is in MSI-Net's architectural family, which means our existing pipeline (NCHW preprocess, ImageNet normalisation, the ORT Web loader scaffolding from the V2 work on PR #4) likely drops in with minor tweaks. And it was trained on 1,980 UI screenshots with real eye-tracking data via the UEyes dataset — webpages, desktop, mobile, posters. That is the training-data match Foveacast has been missing since V1. The catch is the licence: the UEyes repo has no `LICENSE` file at root, so the code is technically all-rights-reserved until the authors say otherwise. An email to Yue Jiang's group is faster to resolve than SUM's Mamba CUDA blocker is to engineer around, so this moves to the top of the V3 list.

**SUM** stays in the backup slot. The Mamba CPU-fallback story still has not matured upstream in the way the original PRD hoped. If UMSI++'s licence doesn't clear, we revisit SUM. If it does, SUM can wait.

The V3 plan drafted earlier (desk research → hands-on export → browser integration, each phase gated) carries over unchanged. Only the model under investigation changes. PR #4's branch stays the starting point — its ORT Web infrastructure, Playwright real-load test, and comparison tooling all apply to a UMSI++ spike the same way they applied to a SUM one.

One meta-note worth naming: the survey almost didn't happen. The overnight V1 build deferred "wider model survey" as out of scope, the V2 work went with UNISAL because the PRD had already chosen it, and it took an unflattering benchmark against real eye-tracking data to make the case for going back and re-surveying the field. If a PRD's model choice is older than a year or two, it is worth re-asking the question before spending engineering effort on it — the lag between "model published" and "model known-good in practice" is short enough that a one-hour survey can reshape a multi-day spike.

## 2026-04-16 — Correction: UMSI++ is not in MSI-Net's family, and the V3 target shifts again

A few hours after posting the "pivot to UMSI++" decision above, a direct look at the UEyes repo corrected two claims the background survey agent had made:

**First, UMSI++ is not the MSI-Net lineage the survey described.** Reading `saliency_models/UMSI++/src/` in the repo, the model is built on DCN-ResNet + Xception + attentive ConvLSTM, implemented in Keras 2 / TensorFlow. MSI-Net is a VGG-16 encoder with a multi-scale contextual decoder, implemented in PyTorch. The two share "saliency over images" as a problem description and not much else architecturally. The "same family as MSI-Net, so the V2 pipeline drops in" argument I wrote above does not hold — a Keras + ConvLSTM model has a different export story than the PyTorch → ONNX path V2 proved out.

**Second, the UMSI++ weights are not where the README implies.** `saliency_models/UMSI++/README.md` says "remember to put umsi++.hdf5 to the folder weights", meaning the weights file is referenced but is not committed to the repo and is not included in the Zenodo deposit (which is 12.9 GB of *dataset*, not model artefacts). The weights' hosting location is undocumented. Without an author-contact resolution, they are not publicly retrievable.

**What IS cleanly usable.** The UEyes **dataset** — 1,980 UI screenshots with real eye-tracking data — is on Zenodo under CC BY 4.0, attribution to Jiang et al. 2023 (CHI '23). That is a genuinely useful asset: we can use it to fine-tune any already-permissively-licensed saliency model on Foveacast's target content class, without waiting on an email from the UEyes authors and without inheriting any of UMSI++'s unclear licence state.

**Revised plan.** V3 target is now "fine-tune MSI-Net on the UEyes dataset" rather than "ship UMSI++." Specifically:

- MSI-Net is MIT-licensed; the code is Alexander Kroner's and the TF.js conversion path is proven from V1.
- UEyes dataset is CC BY 4.0; attribution to the CHI 2023 paper.
- The fine-tuned output belongs to Foveacast, under clean licences end-to-end.
- The only new moving parts are a training script and a modest amount of GPU compute.

SUM stays in the backup slot. If the fine-tune path turns out to have a blocker we haven't foreseen, we go back to the Mamba CPU-fallback spike.

**The meta-lesson.** Agent summaries are useful for narrowing a search space; they are not sources of truth about what a repo actually contains. The "same family as MSI-Net" claim was almost certainly the agent pattern-matching on a name (UMSI-NET-family) rather than reading the architecture code. For any decision that flows from an agent-produced research summary, a 10-minute pass through the real code — file listing, README, any `src/` folder — is cheap insurance against building a plan on a false premise. Adding this to the "how I'd do this again" file.

## 2026-04-16 — Splitting the model-training work into a companion repo

V3 direction settled: fine-tune MSI-Net (MIT) on the UEyes dataset (CC BY 4.0) to get a Foveacast-owned saliency model trained on UI content. The implementation question that followed was "does this live in Foveacast or in its own repo?" Picked its own repo.

The reasons are all pragmatic rather than ideological. Foveacast's README leans on "buildless static web app, vendored dependencies, nothing runs on a server." A training pipeline is the opposite of that — Python, PyTorch or TF, GB-scale dataset, checkpoints, TensorBoard, probably GPU-specific config. Mixing the two blurs the Foveacast positioning and starts making "clone and run" ambiguous ("run what? the web app or the training?"). Separating the repos keeps Foveacast's "clone, pnpm install, pnpm dev" story honest and gives the training work somewhere to exist where its concerns (dataset download, checkpoint management, reproducibility) are first-class.

Attribution cleanliness also matters. The fine-tuned model's provenance chain is MSI-Net (Alexander Kroner, MIT) → UEyes dataset (Jiang et al. 2023, CHI '23, CC BY 4.0) → our fine-tune (MIT). Putting that chain in a companion repo's README makes it one place to maintain; Foveacast's attribution footer then carries a one-line "model from `foveacast-training` vX.Y" link. Single source of truth for where the weights came from and what licence they carry.

The companion repo will own:
- Training script and UEyes loader.
- MSI-Net architecture reference (either vendored from Kroner's upstream or ported to PyTorch, decided at setup).
- Evaluation harness, including runs against the four committed comparison screenshots in `docs/spikes/comparison/`.
- ONNX export step.
- Released `.onnx` artefacts tagged by training run.

Foveacast's job is narrower: consume a specific release of the training repo's artefact, drop it at `docs/models/foveacast-v3/model.onnx`, wire it into the loader. That happens in a separate PR against Foveacast, gated on a good training result.

PR #4 pauses here. Branch + commits + comparison evidence + spike docs all preserved. The work continues in the companion repo, and when there's a trained model good enough to merge, it comes back here for the integration PR.

## 2026-04-16 — V2 shipped: UNISAL + ORT Web end-to-end

Turned the export artefact into a shipped release. `0.2.0` is live; MSI-Net through TF.js is out of the repo; the landing page runs UNISAL through `onnxruntime-web`. The release went smoother than any of us had a right to expect, for one specific reason, and one specific concern is carried forward.

The reason it went smoothly is the V1 layer boundary. The PRD's insistence that `model/` be the only place the inference runtime is imported — with a grep-rule in CLAUDE.md to pin that down — paid for itself in a single afternoon. Every substantive change lived inside `docs/src/model/`, `docs/src/pipeline/`, or the boot code that wires them. `docs/src/render/` came through without a single line changed. `docs/src/ui/` lost its preset picker and the footer's attribution line, and that was it. When a spec's structural choice pays off like that, the right thing to do is write it down so we remember to do it again: if V3 or any later swap ever lands, it will land the same way or it will be our fault.

The concern carried forward is the skipped benchmark. The spike doc explicitly recommended running a qualitative comparison between UNISAL and MSI-Net on representative Foveacast screenshots before committing to a swap. We shipped without that comparison. The argument for shipping anyway is honest: we do not have users reporting a quality problem with MSI-Net either, so the comparison is against hypotheticals on both sides. The argument against is also honest: "UNISAL is newer and was trained on more diverse data" is a reason to investigate, not a reason to ship. If the comparison eventually happens and UNISAL underperforms on UN/NGO-style dense-text content, the revert path is mechanically clean — the diff is contained — but the reputational cost of a "we made it worse" release is real and is not mitigated by architectural tidiness. Logging this so the next reader (which may well be me) does not forget that the swap was a product call taken on thin evidence, not a technical call taken on strong evidence.

One detail worth surfacing here because it is the kind of thing a future reader will otherwise have to derive from the diff: UNISAL's forward pass returns log-probabilities, not a sigmoid'd 0–1 saliency map. The real-image check during the spike made this obvious — the raw output on the surfer photo lives in `[-23.5, -7.7]`, consistent with log-softmax over 288×384 — but the pipeline has to know about it. `docs/src/pipeline/postprocess.js` gained a `logProbsToProbabilities` step that does `exp(y - max(y))` before the existing upsample/blur/normalise chain. Without it the heatmap is visibly diffuse even though the inference is correct. Any future model swap that moves back to direct-intensity outputs will need to drop that step.

The bundle-size trade-off landed where the desk spike said it would. `docs/vendor/` grew from ~1.4 MB of TF.js to ~12.5 MB of ORT Web wasm + glue. The weight file shrank from ~24 MB per MSI-Net preset to a single 12.5 MB ONNX for UNISAL. Net first-run total is approximately a wash. Subsequent cached loads are the same order of magnitude. What users actually notice is gone-the-preset-picker and a slightly different saliency texture — not a bandwidth change.

Running `pnpm test` and `pnpm test:e2e` at the end of the refactor showed 123 unit tests green and all 6 Playwright tests green against real Chromium. The Playwright suite does not exercise real inference (demo mode uses synthetic saliency) so the V2 stack is tested end-to-end at the render and composite layers but "real inference in a real browser" is still only tested by hand. The automated-inference-browser test is a worthwhile next item; it would have caught any ORT-Web-specific runtime issue before the merge rather than during it.

## 2026-04-16 — V3 SUM investigation (no code)

V3 in the PRD is SUM (Saliency Unification through Mamba, WACV 2025 Oral), which matters because it is the only model in the field explicitly trained with a "user interface screenshot" condition. The blocker is well known: SUM's `requirements.txt` pulls in `mamba-ssm` and `causal-conv1d`, both of which ship as compiled CUDA C++ extensions with no ONNX operator equivalents. `torch.onnx.export` cannot trace what it cannot reach; WebAssembly cannot execute compiled CUDA. That is a hard wall, not a config tweak.

There is a potential workaround. Mamba includes a pure-PyTorch naive path reachable by forcing `use_fast_path=False`, which swaps the CUDA kernels out for standard tensor ops. Standard tensor ops are traceable. The question is whether forcing that flag through every layer — including SUM's VMamba visual encoder, which has its own kernel story — produces a graph `torch.onnx.export` can actually write out.

Recommended first step: a small spike that forces `use_fast_path=False` throughout the Mamba and VMamba stacks and checks whether `torch.onnx.export` produces a traceable graph on CPU. If yes, the browser path becomes feasible pending an ORT Web SIMD performance check. If no, the right move is to park V3 and revisit when the Mamba CPU-fallback story in upstream has matured — which it probably will, because the same blocker affects every Mamba-based vision model trying to reach the browser, so the community pressure to fix it is real.

## 2026-04-20 — TDZ crash from calling a function before its const declaration

While implementing the saliency visualization overlays, `updateHudRuleOfThirds(hud, ruleOfThirds)` was placed ten lines above `const ruleOfThirds = computeRuleOfThirds(...)`. This threw `ReferenceError: can't access lexical declaration 'ruleOfThirds' before initialization` at runtime — JavaScript's temporal dead zone (TDZ) for `const`/`let`.

Unlike `var`, a `const` binding is in scope from the start of its enclosing block but is in the TDZ (and throws on access) until the declaration is reached. The linter did not catch it because the variable *was* declared in the same scope — just later. The fix is trivial: move the call to after the `const`.

The lesson for this codebase: when adding a call that uses a newly computed value, write the computation first, then the call that consumes it. Reading top-to-bottom in declaration order is the right mental model.

## 2026-04-19 — Import + mount without assignment: a wiring gap the linter won't catch

Every call to `updateHud` crashed with `ReferenceError: hud is not defined` because the line `const hud = createHud(hudMount)` was simply never written. The import existed (`createHud` was imported from `./ui/hud.js`), the mount was correctly retrieved (`hudMount = document.getElementById(...)`), but the assignment from import to instance was absent. A section comment indicated where it should go; the line itself didn't.

This class of gap is invisible to linters — `createHud` appears in the import statement and linters don't track whether its return value is captured. It's also invisible to unit tests, because unit tests of the HUD module test the module in isolation, not the wiring in `main.js`. It only surfaces at runtime when the variable is first dereferenced.

The pattern to watch for in `main.js`: every module that produces a stateful instance follows import → get-mount → **assign-instance** → use. Skipping the third step is easy because the first two look complete. When adding a new module to the wiring, write all three steps before writing any downstream call site.

## 2026-04-19 — Optional parameters are a dead zone for test coverage

`describeHeatmap` in `ui/output-view.js` gained a third `durationLabel` parameter that, when present, prepends the label to the caption string. The existing tests all called the two-argument form — they continued to pass, and the new parameter had zero coverage for several commits. It was only found during an explicit test coverage audit.

The pattern: when a function gains an optional parameter, the existing tests remain green whether or not the new branch is correct. A green suite communicates "covered"; if the new branch isn't tested, the green is misleading.

Rule to apply going forward: adding an optional parameter counts as a new branch, and that branch gets a test case immediately in the same commit. The omitted-parameter path should also be tested explicitly to document the backward-compatible default behaviour.

## 2026-04-19 — What else can we show from a saliency map?

After completing the precision-lens UI redesign, a thought exploration surfaced several visualizations derivable from the existing postprocessed saliency maps without any model changes. Worth recording here so the analysis doesn't have to be re-derived.

**What the pipeline already produces** (for each of the three durations): a normalised `Float32Array` at full source resolution, a `firstFixationCentroid` (saliency-weighted centre of mass of the top 10% of pixels), a `concentration` score (% of attention mass in the top 10% of pixels), and a `spreadLevel` label.

**What's feasible without changing the model:**

*Inhibition of Return (IoR) fixation sequence.* The standard Itti & Koch (2001) technique: find peak → suppress with a Gaussian mask → find next peak → repeat. Gives fixation 1, 2, 3 as numbered markers with connecting saccade lines. `pipeline/fixation.js` already computes peak 1 via weighted centroid; extending it to N via IoR masking is the natural next step. Critical caveat: these are predicted population-average fixations under free-viewing. That needs prominent documentation alongside the feature — it is not a scanpath recording.

*Multi-duration centroid trajectory.* Three centroid points connected by an arrow path (1s → 3s → 7s). Shows how the centre of attention shifts as viewing time increases — something no commercial tool currently offers, because multi-duration output is an unusual differentiator.

*Threshold contour zones.* Concentric regions at 10%, 25%, 50% saliency mass. More spatially precise than the diffuse heatmap for "is this CTA inside the top-25% attention zone?" questions.

**What requires a different model:** task-directed attention (where do users look when searching for the checkout button?) and time-to-first-fixation per region both depend on models trained on task-directed eye-tracking data, not free-viewing saliency. Setting this expectation in user-facing documentation is as important as building any feature.

All three ideas are in TODO.md. The IoR sequence and centroid trajectory are the highest-leverage pair: they turn a heat cloud into a legible order-of-attention story.

## 2026-04-16 — Open questions picked up from the PRD

Carried over from `docs/PRD.md` §Open Questions. These are live, not resolved.

- **Model accuracy on UN/NGO content types.** Dense text pages, data visualisations, multilingual layouts. Underrepresented in SALICON. Needs a side-by-side qualitative comparison against a commercial tool on representative PreventionWeb-style screenshots.
- **First-run weight-caching UX.** Actual per-preset weight sizes should be measured from the GCS bucket rather than estimated. The status banner text should use those measured numbers.
- **Viewport-comparison feature.** Desktop vs mobile was out of scope for V1 but the second drop-zone slot was left in mind when designing the layout. Leiva et al. (MobileHCI 2020) is the prior-art reading for whoever implements this.
- **Bias-disclosure wording review.** The footer carries a plain-language note about population-average gaze patterns. That wording should get a review pass from someone with a UX-research or research-ethics background before any wider distribution.

## 2026-04-20 — Report-metaphor UI redesign: decisions and dead ends

This batch of work replaced the sidebar/toolbar layout with a single-column "report metaphor" where inference results present as a scrollable narrative beneath the heatmap canvas.

**Why report over toolbar controls**

The toolbar checkbox pattern for overlays (fixation sequence, attention zones, centroid trajectory) sounds sensible on paper — progressive disclosure, user control — but testing showed it falls flat. Users don't know the visualizations exist until they've already derived what they can from the raw heatmap, and the tooltip "?" buttons added cognitive load for a benefit (knowing what the toggle does) that was better served by just showing the output. Making the visualizations always-visible sections removes the discovery problem entirely. The report layout also creates natural space for explanatory prose alongside each finding, which a toolbar can't do.

**Thumbnail-size compositing**

Initial approach was: render full-resolution overlays then scale the canvas down in CSS. Wrong. `drawFixationSequence` and `drawCentroidTrajectory` both scale their markers relative to `ctx.canvas.width / height`. At full resolution (e.g. 1200 × 800 px) the markers are 16–20 px and look fine; after CSS scaling them down to a 400 px thumbnail they become unreadably tiny 5–7 px blobs. The fix is to draw at thumbnail size (400 px wide, aspect-ratio-preserving) in the first place. The marker sizes then look exactly as designed.

For the attention zones strip the `drawImage(attentionZoneCanvas, 0, 0, w, h)` call lets the canvas API scale the zone canvas automatically, which is correct — the zone canvas already has correct spatial structure.

**The jsdom `ctx.canvas` gap**

Both draw functions read `ctx.canvas.width` and `ctx.canvas.height` to scale markers. jsdom's canvas stub — created by `document.createElement('canvas')` in the test environment — does not populate `ctx.canvas` on the context object. Calling `getContext('2d')` on a jsdom canvas returns a partial stub where `ctx.canvas` is undefined. This caused `TypeError: Cannot read properties of undefined` in every overlay-section unit test.

Fix: guard at the top of each helper (`if (!ctx || !ctx.canvas) return thumb`) and return the unmodified thumbnail base. The tests stub the canvas with an object that passes the guard. In production, real browser canvases always have `ctx.canvas`, so the guard is dead code in normal operation.

**Trajectory re-hide on reset**

The `update()` function returns early if no inference result is loaded (image dropped but not yet processed, or app just started). The centroid trajectory section, which builds from `previousHero` state between two duration results, was not being explicitly hidden before that early return. After the first successful inference, if the user dropped a second image before all durations finished, the trajectory section from the previous run stayed visible. Fixed by adding an explicit `trajectorySection.hidden = true` before the early return, mirroring the same guard already in place for the hero canvas.

**Slot count test scoping**

After adding the fixation and zones strips (each with three `fc-report__dur-item` slots), an existing test that queried `querySelectorAll('.fc-report__dur-item')` found 9 elements instead of the expected 3. The test was checking the duration comparison strip, not all strips. Fixed by scoping the query to `.fc-report__section--durations .fc-report__strip` before counting items. General lesson: always scope querySelectorAll to the nearest appropriate ancestor; unscoped class queries get fragile as the DOM grows.
