# Contributing to Foveacast

Thank you for considering a change to Foveacast. This document covers the things a new contributor needs to know to land a PR that will actually get merged — the expectations on tests, docs, commit style, and the files that need updating alongside code changes.

Foveacast is a small, single-maintainer project at the moment. That means low ceremony but high standards for what ships: every change is expected to leave the codebase, the tests, and the documentation in a better state than it found them.

## Before you start

Read these in order:

1. [README.md](README.md) — what Foveacast is and how to run it.
2. [docs/PRD.md](docs/PRD.md) — scope, non-goals, model roadmap, and the architectural contracts each module must honour.
3. [LEARNINGS.md](LEARNINGS.md) — prior dead ends and decisions. Especially useful if your change touches the model layer, the render layer, or testing.

If your change is larger than a bug fix or a documentation tweak, please open an issue first so we can agree on the approach before code is written. The PRD is the source of truth for scope — "it'd be neat if Foveacast also did X" probably belongs as a follow-up issue or a PRD update, not as a scope creep inside another PR.

## Development setup

```sh
pnpm install
pnpm dev               # http://localhost:5173, serves docs/ directly
pnpm test              # vitest under jsdom
pnpm smoke             # dev-server liveness check
pnpm test:e2e          # playwright, chromium, against ?demo=1
```

Playwright needs its browser bundle once:

```sh
pnpm exec playwright install chromium
```

Foveacast is buildless on purpose — the `docs/` folder you edit is the folder GitHub Pages publishes, which is the folder a user unzips and opens. There is no bundler step between edit and publish. Vite is a dev-time convenience, not a dependency of the shipped artefact. If your change introduces a build step, please flag that in the PR description; the bar for reintroducing tooling is high.

## Architecture, briefly

Four layers. The boundary between them is load-bearing; changes that blur it will be sent back.

| Layer | Location | What lives there |
|---|---|---|
| `model/` | `docs/src/model/` | Loads the Graph Model, runs inference. **The only place `@tensorflow/tfjs` is imported.** |
| `pipeline/` | `docs/src/pipeline/` | Pure functions: preprocess, postprocess, fixation centroid. No framework imports. |
| `render/` | `docs/src/render/` | heatmap.js wrapper + Canvas compositor + PNG download. |
| `ui/` | `docs/src/ui/` | DOM: drop zone, controls, status banner, mobile guard. |

If you need TF.js in the `ui/` or `render/` layer, you almost certainly don't — reach through `model/inference.js` instead.

## What goes into a change

Every PR should arrive with four things in sync.

### 1. Tests

Add tests alongside the code. Pick the right tier:

- **Vitest (`tests/*.test.js`)** for pure logic — anything in `pipeline/`, anything you can exercise without a browser. These run on every push and must stay green.
- **Playwright E2E (`tests/e2e/*.spec.js`)** for anything where the real DOM or the real library matters. The detached-container bug would have been caught here; don't let a render-layer change land without a playwright assertion that reaches it.
- **Smoke script (`scripts/smoke-test.sh`)** only for "is the dev server alive" changes. It's a liveness check, not an end-to-end test.

If your change is a bug fix, include a test that fails without the fix. Regressions on fixed bugs are the most preventable kind of regression.

### 2. Documentation

Update every document affected by your change. At minimum, check:

- **README.md** — if you added a command, a flag, a run mode, a dependency, or a supported browser, it probably needs a line here.
- **docs/PRD.md** — if you're changing scope, non-goals, the error-message set, accessibility commitments, or the model roadmap, update the PRD in the same PR. The PRD is the spec; drift between PRD and code is a bug.
- **CHANGELOG.md** — every user-visible change gets an entry under the `[Unreleased]` heading (add one if missing). Follow [Keep a Changelog](https://keepachangelog.com/) conventions.
- **CONTRIBUTING.md** (this file) — if your change alters the expectations in this document, update it.
- **LEARNINGS.md** — add an entry for any non-obvious decision, any dead end, any "oh, that's how that actually works" moment. See the next section.

### 3. LEARNINGS.md — specifically

`LEARNINGS.md` is the project's running prose log of technical decisions, dead ends, and discoveries that don't belong in commit messages or the changelog. It is part of the workflow, not an afterthought.

When to add an entry:

- You discovered something that took more than an hour to figure out.
- You made a decision that a future reader (or future-you) would reasonably question without context.
- You hit a dead end that is cheaper to document than to rediscover.
- You landed a non-trivial refactor or replaced a dependency.

Entries are dated, prose, and informal. Lead with the problem, say what you tried, say what worked, say what's left open. One or two paragraphs is usually enough. Don't worry about polish — this file is for future-maintenance value, not publication.

### 4. Commit messages and PR description

Use [Conventional Commits](https://www.conventionalcommits.org/) — `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`, `ci:`, with scopes where useful (`feat(pipeline):`). The commit body should explain *why*, not *what* — the diff already shows the what.

Sign every commit with the co-author trailer:

```
Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

…if the commit was co-authored with Claude. Keep this honest — don't add the trailer to commits you wrote alone, and don't omit it on commits Claude substantially contributed to.

PRs should carry:

- A summary of what changes and why.
- A list of commits with one-line descriptions.
- A test plan the reviewer can run locally.
- Any known limitations or follow-ups.
- A screenshot or a short loom for anything user-visible.

## Coding guide

This is the project's stance on how we write code. It is opinionated on purpose — consistency across a small codebase is worth more than matching any particular external convention. If you disagree with something here, open an issue before adopting a different style in a PR.

### Ample comments, explaining why

Default to writing comments — this is the opposite of the common "comments are a smell" rule and it is deliberate. Foveacast is expected to be picked up by people who didn't build it, often months after the original context has decayed. A one-line comment that captures why is worth more than a diff that someone has to reverse-engineer.

Minimum bar:

- Every exported function has a JSDoc block: one-line purpose, `@param` types with short descriptions, `@returns`.
- Every non-obvious branch has an inline comment explaining the decision. "Non-obvious" means: a reader who understands JavaScript but not this codebase would ask why.
- Every module header explains what lives there and why — particularly the load-bearing invariants (e.g. "nothing outside `model/` imports `@tensorflow/tfjs`").
- Workarounds for external library quirks (heatmap.js private fields, TF.js backend selection, jsdom gaps) get a comment naming the library and the problem, so a future maintainer can tell whether the workaround is still needed.

What comments are NOT for:

- Restating what the code obviously does. `// increment counter` on `counter++` is noise.
- Changelog or PR-context chatter (`// added for issue #42`). Those belong in commit messages and `LEARNINGS.md`.
- Commented-out code. Delete it; `git log` remembers.

### Tests before or alongside the code

Tests are not optional. Write them with the code, not after. See the [What goes into a change → Tests](#1-tests) section above for the three tiers (vitest / smoke / playwright) and when each is appropriate.

Specifics:

- **Pure functions (pipeline, file validation, demo helpers) get vitest unit tests.** One test per behaviour, assertion-rich, no mocking beyond what is necessary. A test that mocks out the thing it should be testing — like the render layer's earlier heatmap.js mock that hid the detached-container bug — is worse than no test at all.
- **UI behaviour that depends on the DOM, the browser, or a library's real runtime behaviour gets a Playwright test.** This is how we catch the class of bug that unit-test mocks hide.
- **Bug fixes land with a regression test.** The test should fail without the fix and pass with it. This is the single cheapest thing you can do to make the codebase more resilient over time.
- **Never disable a failing test as part of unrelated work.** If a test is blocking you and you think it's wrong, open a separate PR to delete or fix it and explain why.

### Layer discipline

The `model / pipeline / render / ui` layer boundary is load-bearing. Specifically:

- **Nothing outside `model/` imports `@tensorflow/tfjs`.** If you need tensor operations elsewhere, the fix is almost always to add a contract-level function in `model/` and call that. The grep test is `grep -r "@tensorflow/tfjs" docs/src/ | grep -v 'docs/src/model/'` — this should return nothing.
- **Nothing outside `render/` imports `heatmap.js`.** Same rule.
- **`pipeline/` is pure.** No DOM, no browser APIs, no library dependencies. Functions take arrays and numbers, return arrays and numbers. This makes it trivially testable.
- **`ui/` is allowed to depend on the DOM and on `pipeline/` / `render/` / `model/` — but should not reach "through" those layers to their dependencies.** E.g. the UI layer should not call `tf.tensor` directly even if `model/` happens to re-export `tf`.

### Failure handling

- **Validate at the edge, trust inside.** User input (dropped files, URL params) gets validated once at the boundary. After that, internal code can assume shapes are correct.
- **Errors carry a `code` and a `message`.** Codes are for branching and tests; messages are for humans. `STATUS_ERROR_MESSAGES` is the single source of truth for user-facing strings — do not inline variants at call sites.
- **Every error state must offer the user a next action.** A dead end is worse than a crash. If the next action is "refresh the page", say that; if it is "drop a smaller file", say that.
- **Do not catch errors you cannot handle.** `try { ... } catch { /* swallowed */ }` is a code smell. Either handle, or let it propagate to the single top-level handler in `main.js`.

### Accessibility, non-negotiably

Every UI change has to clear WCAG 2.1 AA. The tiers that matter:

- **Keyboard**: every interactive control is reachable with Tab and operable with Enter / Space. Focus visible.
- **Screen reader**: `aria-label` or real text on every control, `aria-live` on status regions, `alt` on informative images.
- **Motion**: respect `prefers-reduced-motion` on every animation, not just the big ones.
- **Contrast**: AA (≥4.5:1 for body text, ≥3:1 for large). Use the browser devtools contrast picker if in doubt.

`?demo=1` is the fastest way to exercise the full UI in a browser; use it during manual testing.

### Dependencies

- **No new runtime dependencies without a reason.** Each one is a maintenance cost, a supply-chain exposure, and a reason future contributors need to learn something. The PR description should explain why existing tools can't do the job.
- **Dev dependencies get a lower bar** but still need justification. "Because it's popular" is not enough.
- **No native-build dependencies ever.** Anything that needs `node-gyp` or a C compiler breaks the "pnpm install" promise for contributors who don't happen to have a working build toolchain.

### Prose in the codebase

Anything humans read — README, CHANGELOG, LEARNINGS, CONTRIBUTING, PRD, in-UI copy, commit messages — should sound like a human wrote it. Plain, direct, honest about uncertainty, no marketing register.

Concretely, avoid these AI-writing tells:

- "Seamlessly", "delightfully", "robust solution", "best-in-class", "cutting-edge", "powered by".
- Inflated verbs: "leverage" (use), "utilise" (use), "facilitate" (help).
- The rule of three for no reason: "fast, simple, and reliable" when one or two adjectives would do.
- Starting sentences with "Simply" — the user does not need reassurance that your thing is simple; show them.
- Em-dash overuse — which is hypocritical of this guide, I know — but pick one or two per paragraph, not six.

The `humanizer` skill in the Claude Code CLI helps if you are writing with AI assistance. Run it over long-form prose before committing.

### Commit-by-commit hygiene

Every commit should build green, pass tests, and do one conceptual thing. A PR with nine tightly-scoped commits is much easier to review than a single commit with 400 lines of mixed-intent changes. Conventional Commits + good subject lines + `why`-focused bodies = a git log that reads like documentation instead of archaeology.

### Size discipline

- **Prefer small modules over large ones.** A file past 400 lines is a hint to look for a module boundary. Not a hard rule, but a useful one.
- **Prefer small PRs over large ones.** If your change is getting large, consider shipping the foundation first and the user-visible change as a follow-up.
- **Prefer explicit code over clever code.** `if (x) return a; return b;` is almost always better than a ternary chain.

## Destructive and shared-state actions

- Do not force-push to `main`. Do not rewrite published history on a branch someone else is reviewing.
- Do not commit model weights or large binaries. `.gitignore` has patterns for `*.pb`, `*.onnx`, and `*.bin`; if your artefact has a different extension, flag it in the PR.
- Do not skip git hooks (`--no-verify`). If a hook fails, fix the cause.

## Reviewing a PR

If you're reviewing, the things to check for, roughly in order of how often they trip contributors:

1. **Tests at the right tier.** A render-layer change with only a vitest update is incomplete. A pipeline change with a Playwright test is overkill.
2. **Doc drift.** README, PRD, CHANGELOG, LEARNINGS — did the relevant ones move?
3. **Layer boundaries.** Did TF.js leak out of `model/`? Did the UI layer grow a hidden dependency on a specific backend?
4. **Commit hygiene.** Conventional Commits, atomic, readable body, co-author trailer where appropriate.
5. **Accessibility regressions.** Tab order, focus management, `aria-label`, `prefers-reduced-motion`, contrast.
6. **Scope.** Is this change doing more than the PR title claims?

## Questions

Open an issue. Issues with the `question` label get a faster response than email.

Thank you for contributing. Small, well-tested changes with good documentation are what makes this project sustainable.
