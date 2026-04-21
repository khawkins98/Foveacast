# CLAUDE.md

Instructions for Claude Code (and other AI assistants following the same convention) working in this repo. Think of this as project-specific context that should load before you read any other file.

If you are a human reader: this file tells the assistant how we want it to behave on Foveacast. You can skim it to see what the expectations are. The long-form equivalents for humans are [CONTRIBUTING.md](CONTRIBUTING.md) (how we work), [docs/PRD.md](docs/PRD.md) (what we're building), and [LEARNINGS.md](LEARNINGS.md) (what we've figured out along the way).

---

## What this project is

Foveacast is a free, open-source, offline-capable predictive attention-heatmap tool. User drops a screenshot, gets back a heatmap of where people are likely to look first. Runs entirely in the browser; nothing leaves the user's machine.

Read these before making substantive changes:

- [docs/methodology.md](docs/methodology.md) — user-facing science page covering the model, data, metrics, and limitations.
- [README.md](README.md) — how the project runs and is tested.
- [CONTRIBUTING.md](CONTRIBUTING.md) — coding guide, testing tiers, documentation expectations.
- [LEARNINGS.md](LEARNINGS.md) — prior decisions and dead ends. Check this before re-deriving something.
- [TODO.md](TODO.md) — known follow-ups, prioritised.
- [docs/heerich-notes.md](docs/heerich-notes.md) — heerich.js (voxel → SVG engine) API cheatsheet, gotchas, and patterns. Read before touching anything under `docs/src/ui/voxel-*.js` or the vendored `docs/vendor/heerich.js`.

---

## Project-specific overrides to your defaults

These override whatever your default guidance says. They are deliberate choices for this codebase.

### Write ample comments

Default to writing comments, not omitting them. Every exported function gets JSDoc (purpose, params, return). Every non-obvious branch gets an inline `// why:` comment. Every module gets a header that explains what lives there and why.

This is the opposite of the common "self-documenting code" rule and it is intentional: Foveacast is expected to be picked up by people who did not build it, often months after the original context has decayed. Comments that capture *why* are more useful than diffs a reader has to reverse-engineer.

What not to comment: obvious restatements of the code, changelog chatter, PR context, commented-out code.

### Tests are not optional

Write them alongside the code, not after. Three tiers:

| Tier | Tool | Where |
|---|---|---|
| Pure-function unit | Vitest + jsdom | `tests/*.test.js` |
| Liveness | bash + curl | `scripts/smoke-test.sh` |
| End-to-end in a real browser | Playwright chromium | `tests/e2e/*.spec.js` |

Bug fixes land with a regression test that fails without the fix. Don't mock out the thing you should be testing — the detached-container bug shipped because vitest mocked heatmap.js at exactly the layer that hid the behaviour. Use Playwright when the bug lives in the gap between our mock and the real library.

Never disable a failing test as part of unrelated work. If you think a test is wrong, open a separate PR and explain why.

### Layer discipline

The `model / pipeline / render / ui` boundary is load-bearing. In particular:

- Nothing outside `docs/src/model/` imports the inference runtime. For V3 that is `onnxruntime-web` (the `ort` global). Grep test: `grep -rn "\\bort\\b\\|onnxruntime-web" docs/src/ | grep -v "docs/src/model/"` should return nothing meaningful.
- `docs/src/pipeline/` is pure JS — no DOM, no browser APIs, no library imports.

If you are about to reach for `ort` from a file outside `model/`, stop. The fix is a new function in the owning layer. This rule paid for itself on the V1→V2 swap: every change lived inside `model/`, `pipeline/`, or the boot wiring, and `render/` + `ui/` came through untouched. (V1/V2 also had the rule that nothing outside `render/` imports `heatmap.js` — that's no longer needed since V3 removed heatmap.js.)

### Accessibility is non-negotiable

Every UI change has to clear WCAG 2.1 AA. Keyboard operable, screen-reader labels, `prefers-reduced-motion` respected, AA contrast. `?demo=1` is the fastest way to exercise the UI; use it during manual testing.

### Humanizer pass on prose

Anything humans read (README, CHANGELOG, LEARNINGS, CONTRIBUTING, PRD, in-UI copy, commit messages) should sound like a human wrote it. Before committing long-form prose, run the `humanizer` skill — or at minimum, re-read the changed text and strip the AI-register tells: "seamlessly", "delightfully", "robust solution", "leverage", "best-in-class", "simply", rule-of-three filler.

### Buildless ship model

The files in `docs/` are what GitHub Pages publishes. No bundler step, no transforms. Runtime dependencies (`onnxruntime-web`) are vendored under `docs/vendor/`, and `docs/coi-sw.js` is the service worker shim at the repo root. The V3 MSI-Net ONNX models live at `docs/models/v3/{1s,3s,7s}/model.onnx` (gitignored; see `scripts/fetch-v3-model.sh`). If your change would require a build step for the shipped artefact, stop and discuss first. Note: the app requires a real HTTP/S origin — `file://` is no longer supported because the service worker cannot register from a `file://` URL.

Vite is in the project as a dev-time convenience only. It is never asked to produce a `dist/`.

### Commit-by-commit hygiene

Every commit builds green, passes tests, and does one conceptual thing. Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`, `ci:`) with scopes where useful. The body should explain *why*, not *what* — the diff already shows what.

If Claude co-authored the commit, add this trailer via HEREDOC:

```
Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

---

## Workflow expectations

### Before starting substantive work

1. Read the PRD section relevant to the change, plus `LEARNINGS.md` for any related prior investigation.
2. If you are about to write code that touches multiple layers, sketch the approach first and confirm with the user before implementing.
3. If the user asks for an "overnight build" or any multi-commit task, write out the commit plan first and get approval before beginning.

### While working

- Keep commits atomic. A commit that does three things at once is harder to review and harder to revert.
- Run `pnpm test` after every commit. It should stay green commit-by-commit, not only at the end.
- When touching the render layer or the demo flow, also run `pnpm test:e2e` — the Playwright suite is the only thing that exercises the real render pipeline.
- If a test fails, investigate the root cause. Do not disable the test. Do not add `--no-verify`.

### Documentation lockstep

Changes to the product typically need to move several files together. Check each of these when your change is not purely internal:

- **README.md** — if you added a command, flag, mode, dependency, or supported browser.
- **docs/methodology.md** — if you changed how the model works, the limitations stated, or the user-facing description of the inference. The methodology page is the user-facing spec for the model; drift between it and actual behaviour is a bug.
- **CHANGELOG.md** — user-visible changes get an entry under `[Unreleased]`.
- **LEARNINGS.md** — add a dated prose entry for any decision that took more than an hour to figure out, any dead end worth documenting, or any "oh, that's how that actually works" moment.
- **TODO.md** — if your change surfaces a new follow-up you are deliberately not doing in this PR.
- **CONTRIBUTING.md** — if your change alters the expectations documented there.

### Risky actions

These require explicit user confirmation before you run them:

- `git push --force` or anything that rewrites published history.
- `git reset --hard`, `git checkout .`, or any bulk discard of uncommitted work.
- `rm -rf` on anything inside the repo beyond `node_modules` and `test-results/`.
- Modifying `.github/` workflows beyond adding a step the user asked for.
- Committing binaries over 1 MB (check with `du -h`).
- Publishing to GitHub Pages, npm, or any other registry.

Creating local commits, running tests, running the dev server, and pushing a non-main branch are routine and do not need confirmation — but push only when the user asked you to.

### When asked to spawn sub-agents

The user sometimes asks for work to be broken across multiple Claude Code sub-agents running in parallel or sequentially. When you do this:

- Give each sub-agent a self-contained brief including the file paths they will touch and the commit messages they should use.
- Tell them explicitly whether to push or not (the default is not to push; the parent agent handles that).
- Have them report back the commit SHAs and test results.
- Verify the commits exist and tests pass after the sub-agent returns. Sub-agents sometimes time out or partially complete; don't trust the summary without checking.

### When asked to review

If the user asks for a "review", "audit", or "critique" of the project, they usually want findings written up, not code changes applied. Produce a review document at `/tmp/` and return a short summary. Don't start fixing things until the user has seen the review and decided what to apply.

---

## Common pitfalls observed on this project

These have burned us before. Learn from the scars.

- **macOS Vite binds IPv6-only by default.** Playwright `webServer.url` must use `localhost`, not `127.0.0.1`.
- **WASM threading requires cross-origin isolation.** `docs/coi-sw.js` (coi-serviceworker v0.1.7) registers as a service worker and injects `Cross-Origin-Embedder-Policy: require-corp` + `Cross-Origin-Opener-Policy: same-origin` response headers, making `crossOriginIsolated = true`. On first visit the SW installs, triggers one page reload, then `crossOriginIsolated` is true for all subsequent loads. The site therefore **requires an HTTP/S origin** — `file://` URLs are not supported. Do not remove `coi-sw.js` without a replacement COEP strategy. The `<script src="./coi-sw.js">` tag must remain the FIRST script in `<head>`. Do not "optimise" by shipping the `.jsep.wasm` WebGPU build — its WebGPU EP also needs COEP and cross-origin isolation, but the WASM file is larger.
- **`ort.env.wasm.wasmPaths` must be set before `InferenceSession.create`.** If you leave it default, ORT resolves wasm relative to the document base, which breaks when the site is served from a subpath (GitHub Pages does this). `loader.js` pins it to `./vendor/`.
- **Vite's import-analysis plugin 500s on extensionless binary files** (the MSI-Net ONNX is named `model.onnx`, which works, but any shard-style layout would trip this). The fix is the custom middleware in `vite.config.js` — don't remove it. It also serves `/vendor/*` raw so SRI hashes on the ORT Web scripts survive dev.
- **jsdom does not implement `HTMLCanvasElement.prototype.getContext`.** Tests that rely on this must mock it or be routed via Playwright.
- **The V3 MSI-Net ONNX models are NOT committed to the repo.** Three duration variants (1s, 3s, 7s) live at `docs/models/v3/{1s,3s,7s}/model.onnx` (gitignored, 57 MB each). For local dev, run `scripts/fetch-v3-model.sh`. The deploy workflow fetches all three before the Pages upload. Do not commit them — they would bloat the clone.
- **Chromium console-error captures miss URLs.** Playwright's `ConsoleMessage.text()` does not include the URL for network-layer errors (e.g. 404s); the URL is in `msg.location().url`. Tests that whitelist expected errors must inspect both fields.
- **Before pushing a change that touches env-dependent code paths, run the test that most resembles CI's environment.** "Works on my machine" failures on this project have mostly come from local state (cached browser state, ambient `pnpm dev` server on :5173) that the CI does not have. When in doubt, teardown and re-run.
- **GitHub Pages has to be enabled before the first `deploy.yml` run.** Until it's enabled, the workflow fails with `Failed to create deployment (status: 404)` pointing at Settings → Pages. Enable via `gh api -X POST /repos/{owner}/{repo}/pages -f "build_type=workflow"` (one-time, needs the `repo` scope) or through the UI at Settings → Pages → Source → "GitHub Actions".
- **Do not `gh run rerun --failed` on a `deploy.yml` job.** The re-run leaves the previous run's `github-pages` artefact in place, and `actions/deploy-pages@v4` finds two artefacts of that name in the run and errors with "Multiple artifacts named 'github-pages' were unexpectedly found". Instead, trigger a fresh workflow with `gh workflow run deploy.yml --ref main` — a new run number, a single artefact, clean deploy.

### Historical V1/V2 pitfalls (kept for context)

- **heatmap.js sized its canvas from `container.offsetWidth` — zero on a detached element.** This was the V1 rendering bug caught in production. A vitest mock of `h337.create` will not catch it because the mock never observes real `offsetWidth` behaviour. The lesson: mocks should stay close to the library boundary and ideally be exercised against the real library once. heatmap.js was removed in V3; this is only relevant if you are reading a pre-V3 commit. See `LEARNINGS.md` entries dated 2026-04-06 and 2026-04-16.
- **UNISAL's raw output was log-probabilities, not 0–1 saliency.** The V2 postprocess applied `exp(y - max(y))` before upsample/blur/normalise. The V3 model (MSI-Net fine-tuned on UEyes) outputs [0,1] directly; the `logProbsToProbabilities` step was removed. If a future model swap brings back log-prob output, that conversion will need to be reinstated in `pipeline/postprocess.js`.

---

## Final note

If you are unsure whether something should be done, ask the user before doing it. The cost of asking is ~30 seconds. The cost of undoing a wrong decision can be much higher.
