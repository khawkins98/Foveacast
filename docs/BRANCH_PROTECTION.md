# Branch protection rules

This file documents the branch protection rules applied to the `main` branch of this repository. Rules are configured via the GitHub API and cannot be seen without admin access; this document lets a future maintainer understand and recreate them without opening Settings.

Rules were enabled 2026-04-20.

---

## `main` branch

| Setting | Value | Reason |
|---|---|---|
| Require status checks to pass | Yes | No broken code reaches main |
| Required checks | `vitest (node 20)`, `vitest (node 22)`, `playwright (chromium)` | These are the CI job names in `.github/workflows/ci.yml` |
| Require branches to be up to date | No | Squash merging makes this redundant |
| Require linear history | Yes | Squash-only merges; keeps `git log --oneline` readable |
| Allow force pushes | No | Prevents rewriting published history |
| Allow deletions | No | Prevents accidental `main` deletion |
| Require pull request before merging | No | Solo project; requiring self-review adds friction with no benefit |
| Enforce for administrators | No | Maintainer can bypass for emergency fixes |

---

## How to recreate these rules

```sh
gh api --method PUT /repos/khawkins98/Foveacast/branches/main/protection \
  -f 'required_status_checks[strict]=false' \
  -f 'required_status_checks[contexts][]=vitest (node 20)' \
  -f 'required_status_checks[contexts][]=vitest (node 22)' \
  -f 'required_status_checks[contexts][]=playwright (chromium)' \
  -F 'enforce_admins=false' \
  -F 'required_linear_history=true' \
  -F 'allow_force_pushes=false' \
  -F 'allow_deletions=false' \
  -F 'required_pull_request_reviews=null' \
  -F 'restrictions=null'
```

---

## Changing the rules

Update this file and the API call together in the same PR. The PR itself cannot merge unless CI is green, so protection is self-reinforcing once a PR is in-flight.
