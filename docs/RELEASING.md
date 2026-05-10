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

- Develop on topic branches: `feat/*`, `fix/*`, `chore/*`, `docs/*`, `refactor/*`
- **Squash-merge** to `main`. Never merge-commit, never fast-forward a noisy branch.
- The squash commit message uses [Conventional Commits](https://www.conventionalcommits.org/):
  - `feat: short summary` — new feature (minor bump)
  - `fix: short summary` — bug fix (patch bump)
  - `docs: ...`, `chore: ...`, `refactor: ...`, `test: ...` — no version bump on its own
  - Breaking change: add `!` (`feat!: ...`) or a `BREAKING CHANGE:` footer

### Why squash-merge

ADHD is a self-developing harness. Topic branches accumulate commits like `[auto-commit] Sprint 3: uncommitted work on: …` from the harness's own generator. Squash-merging keeps `main`'s history clean (one commit per feature) while the branch retains the per-sprint trail.

### Preserving sprint history before deleting branches

Before deleting a merged topic branch, tag the branch tip:

```bash
git tag dev/<branch-name> <branch-name>
git push origin dev/<branch-name>
git branch -d <branch-name>
git push origin --delete <branch-name>
```

The `dev/*` tag keeps the per-sprint commits reachable forever. Without it, the harness's sprint-by-sprint provenance is lost to garbage collection (~30 days).

## Per-Release Checklist

Run these on `main` after the feature work is merged.

```bash
# 1. Sanity checks
git checkout main
git pull --ff-only
bun run typecheck && bun run lint && bun run test

# 2. Pick the new version (see Versioning Policy)
NEW=0.x.y

# 3. Bump package.json
#    Edit "version" field manually, or:
#    (bun has no built-in `pm version` — edit the file directly)

# 4. Update CHANGELOG.md
#    - Move the [Unreleased] section's entries under a new [v$NEW] - YYYY-MM-DD heading
#    - Leave [Unreleased] empty at the top for the next cycle

# 5. Commit
git add package.json CHANGELOG.md
git commit -m "chore(release): v$NEW"

# 6. Tag (annotated)
git tag -a v$NEW -m "Release v$NEW"

# 7. Push commit + tag
git push origin main
git push origin v$NEW

# 8. GitHub Release
gh release create v$NEW \
  --title "v$NEW" \
  --notes-file <(awk '/^## \[v'$NEW'\]/{flag=1;next} /^## \[/{flag=0} flag' CHANGELOG.md)
```

## CHANGELOG Format

We use a [Keep-a-Changelog](https://keepachangelog.com/)-style structure:

```markdown
# Changelog

## [Unreleased]

### Added
- ...

### Fixed
- ...

## [v0.5.0] - 2026-05-10

### Added
- Per-model token usage tracking with rollup view
- ...
```

Categories: `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`.

## What NOT to Do

- ❌ **Never force-push `main`.** History is shared and partially user-facing now.
- ❌ **Never rewrite or squash already-pushed commits on `main`.** Cosmetic gain isn't worth the coordination risk.
- ❌ **Don't tag without bumping `package.json`.** They must agree.
- ❌ **Don't commit `.adhd/` files from harness self-development runs into the release commit.** Use `--commit-adhd` only on intentional dogfood branches; the release commit should only touch `package.json` and `CHANGELOG.md`.

## When a Collaborator Joins

The first task is to add a `CONTRIBUTING.md` that links here, plus enable branch protection on `main` (require PR, require squash-merge, disallow force-push). Nothing in this runbook needs to change.
