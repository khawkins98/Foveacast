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

## Style

- **Comments**: write them. Foveacast's default is ample JSDoc on exported functions and inline comments that explain *why* for anything non-obvious. This is the opposite of the common "comments are a smell" rule and it is deliberate — the project is expected to be picked up by people who didn't build it.
- **Humanizer pass**: long-form prose (README, CHANGELOG, LEARNINGS, in-UI copy) should read like a human wrote it. The `humanizer` skill helps if you're using an AI-assisted workflow.
- **Accessibility**: every UI change needs to clear WCAG 2.1 AA. Keyboard operable, screen-reader labels, `prefers-reduced-motion` respected, AA contrast. Non-negotiable.
- **No new dependencies without a reason.** Every dependency is a long-term support cost. The PR description should say why the existing tools can't do the job.

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
