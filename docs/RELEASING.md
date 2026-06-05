# Releasing ADHD

This is the runbook for cutting a release. The short rules are mirrored in `CLAUDE.md`; this file is the source of truth for the procedure.

## Versioning Policy

We follow [SemVer](https://semver.org) with a `v` prefix on tags (e.g. `v0.5.0`).

While on `0.x`:

- `0.x.0` — new features **or** breaking changes (the API/CLI is not yet stable)
- `0.x.y` — bug fixes only
- `1.0.0` — first release where we commit to backwards compatibility for the CLI flags, `.adhd/` file formats, and `AgentRunners` interface

Tags are always `vMAJOR.MINOR.PATCH`. Never `v0.01`-style — those don't sort, parse, or compare correctly with standard tooling.

## Branch Model

- **Always develop on a topic branch** — `dev/*`, `feat/*`, `fix/*`, `chore/*`, `docs/*`, `refactor/*`.
- **No direct commits to `main`.** Every change lands on `main` via a squash-merge from a topic branch. A direct commit is allowed only when the maintainer explicitly requests it and confirms it's an intentional exception — never a default, and never merely because `main` is the current branch.
- **Squash-merge** to `main`. Never merge-commit, never fast-forward a noisy branch. `main` holds one clean, squashed commit per change.
- **Keep `.adhd/` out of `main`.** A harness-developed branch carries `.adhd/` self-development metadata; a plain squash would drag it onto `main`. Drop it before committing the squash (see the checklist). The branch's `.adhd/` trail lives only in its `archive/*` tag.
- Squash messages use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`; `feat!:` / `BREAKING CHANGE:` for breaks) — see **Commit messages**.

### Releases ride the branch — no separate release commit on `main`

The version bump (`package.json`) and changelog finalisation (`[Unreleased]` → `## [vX]`) are done **on the topic branch**, as the last step before merging. The squash-merge lands the code *and* its version on `main` in one commit; tag that commit. `main` stays exception-free: every commit on it, releases included, arrives through a squashed branch.

**Pick the new version against `main`, not the branch.** Just before preparing the squash commit, check the version currently on `main` (`git show origin/main:package.json`) and set the new version above it. This keeps things correct when more than one topic branch is in flight: whoever merges second sees the version the first just shipped and bumps from there, so two branches never claim the same number.

### Why squash-merge

ADHD is a self-developing harness. Topic branches accumulate commits like `[auto-commit] Sprint 3: …` from the harness's own generator. Squash-merging keeps `main` clean while the branch keeps the per-sprint trail.

### After merging: delete the branch, preserve history locally

```bash
# Preserve per-sprint history with a LOCAL tag, only if the branch carries history worth
# keeping (the harness's [auto-commit]/[adhd] commits). The tag mirrors the full branch name:
git tag archive/<branch> <branch-tip-sha>     # e.g. archive/dev/feature-x — LOCAL ONLY
git branch -D <branch>
git push origin --delete <branch>             # only if it had ever been pushed
```

- **Never push an `archive/*` tag or a topic branch to `origin`.** They keep the per-sprint commits reachable on your machine only (git garbage-collects unreachable commits after ~30 days). `origin` carries only `main` and release (`v*`) tags.

## Per-Release Checklist

```bash
# On the topic branch, when the work is ready:
bun run typecheck && bun run lint && bun run test    # 1. gate must be green
git fetch origin                                     # 2. read the version on main…
git show origin/main:package.json | grep version     #    …and pick NEW above it (SemVer)
NEW=0.x.y
#    3. set "version" in package.json to $NEW
#    4. move CHANGELOG [Unreleased] entries under "## [v$NEW] - YYYY-MM-DD"; leave [Unreleased] empty
git commit -am "chore(release): v$NEW"               # 5. on the branch (will be squashed)

# Land it on main:
git checkout main && git pull --ff-only
git merge --squash <branch>
git restore --staged --worktree .adhd && git clean -fdq .adhd   # 6. drop .adhd self-dev metadata
git commit                                                       #    squash; REPLACE the prefilled message
git tag -a v$NEW -m "v$NEW — <one-line theme>"       # 7. annotated; see Tag messages
git push origin main && git push origin v$NEW        # 8. push commit + release tag

gh release create v$NEW --title "v$NEW" \             # 9. GitHub release from the changelog
  --notes-file <(awk '/^## \[v'$NEW'\]/{flag=1;next} /^## \[/{flag=0} flag' CHANGELOG.md)
#  10. delete branch + local archive/ tag (see "After merging")
```

### Commit messages

The squash-merge commit is the only record of a change that survives on `main`; the per-sprint `[auto-commit]`/`[adhd]` trail is collapsed away. `git merge --squash` pre-fills the message with every squashed commit — **replace it entirely**, don't keep the pile.

- **Subject** — one Conventional Commit line describing the whole change (not a sprint), imperative, ≤ ~72 chars: `feat: sprint scope control and per-agent model tiers`.
- **Body** — a short paragraph or a few bullets on *what* changed and *why*, at the level a future reader scanning `git log` on `main` needs. This is `main`'s only narrative.
- **Breaking changes** — `!` after the type (`feat!:`) and/or a `BREAKING CHANGE:` footer describing the migration.
- **Trailer** — end with `Co-Authored-By: Claude <noreply@anthropic.com>` when Claude authored the work.

### Tag messages

- **Release tags (`v*`)** are annotated (`git tag -a`). The message is more than "Release vX": use `vX — <one-line theme>`, optionally followed by the version's changelog highlights, so `git show vX` is self-describing. Keep it consistent with the `CHANGELOG.md` `[vX]` section (the GitHub release body).
- **Preservation tags (`archive/*`)** are lightweight — pure pointers, no message.

## CHANGELOG Format

We use a [Keep-a-Changelog](https://keepachangelog.com/)-style structure, written for the **user** — what changed for someone using the harness, not how it was built. No per-sprint detail, no internal symbol names.

```markdown
# Changelog

## [Unreleased]

## [v0.6.0] - 2026-06-04

### Added
- A model per agent — `--model-planner` / `--model-generator` / …

### Fixed
- …
```

Categories: `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`. A release with no user-visible change says so in one line (e.g. "No user-facing changes — internal refactor").

## What NOT to Do

- ❌ **Never force-push `main`.** History is shared and partially user-facing now.
- ❌ **Never rewrite or squash already-pushed commits on `main`.** Cosmetic gain isn't worth the coordination risk.
- ❌ **Don't tag without the matching `package.json` version.** They must agree.
- ❌ **Never push a topic branch or an `archive/*` preservation tag to `origin`.** `origin` carries only `main` and release (`v*`) tags.
- ❌ **Don't let `.adhd/` self-development files land on `main`.** They belong on the topic branch (and its local `archive/*` tag), never in `main`'s history.

## When a Collaborator Joins

The first task is to add a `CONTRIBUTING.md` that links here, plus enable branch protection on `main` (require PR, require squash-merge, disallow force-push). Nothing in this runbook needs to change.
