# Phase 1 Follow-up — Remaining Work

**Status:** active plan, written to be picked up in a **fresh conversation**. It contains
**only the work that is not yet done.** Self-contained: it restates what's left, how to build
it, and the release ritual.
**Updated:** 2026-06-07. **Archive this file once OPP-55, OPP-56, OPP-58, and OPP-60 are
resolved.**

**Read for detail behind each item:**
- `docs/ROADMAP.md` — the live opportunity list (OPP-55, 56, 58, 60 entries).
- `docs/planning/standing-requirements-design.md` — full design + sprint plan for OPP-55
  (its §11 sprint plan and §14 refinement are the build spec).
- `docs/RELEASING.md` — the release ritual.

---

## Already done (context — do **not** redo)

- **v0.9.0** — Phase 1 hardening; ROADMAP Part 1 extracted to `docs/CAPABILITIES.md`.
- **OPP-57** (roadmap drift-detector) — built, then **abandoned** as unworkable (the
  user-facing CHANGELOG carries no `OPP-NN` ids, so a CHANGELOG∩ROADMAP text-check can never
  fire). Its intent folds into OPP-55 — see `standing-requirements-design.md` §14. Do not
  rebuild it.
- **v0.10.0 / OPP-54** — `.adhd/` commit governance (default-off, tiered; `feat!` breaking).

---

## Remaining work

### S4 — OPP-56 + OPP-58 + OPP-60 (small fixes, one harness run)

All three are **small** and **[harness-implementable]**. Build them together in one `adhd`
run (see *How to run* below). Full detail is in `docs/ROADMAP.md`; in brief:

- **OPP-56 — Mid-run steering gate editor guard.** The mid-run steering gate launches the
  editor via an unwrapped `execSync` (`shared/orchestration/sprint-success.ts`); wrap it in
  the existing `tryExecEditor` (the same fix the spec-approval gate already has).
- **OPP-58 — Centralise refinement teardown.** The `writeSpec + restoreRegressionData +
  return` teardown is hand-copied across six exit branches of `performSpecRefinement`
  (`shared/orchestration/spec-refinement.ts`); centralise it into one path.
- **OPP-60 — `--project=<dir>` ignored by subcommands.** `extractProjectDir`
  (`harness-claude/index.ts`) matches only the space-separated `--project <dir>` form and
  silently ignores `--project=<dir>`, falling back to cwd; affects `compare` (and any
  read-only subcommand). Recognise the `=` form (or route through the shared arg parser).

Tuning: `--max-sprints 8 --max-features 3 --refine-spec`; `--context docs/ROADMAP.md`.

### S6 (later) — OPP-55 standing-requirements engine

The "declare a cross-cutting rule once, enforce it every applicable sprint" engine;
**roadmap-upkeep is its flagship first slice** (the working replacement for the abandoned
OPP-57). It is **[human-led] — close review**: it touches the Generator/Evaluator/Documenter
injection seams and introduces a pre-1.0 on-disk format.

Build spec: `docs/planning/standing-requirements-design.md` — especially **§11** (sprint
decomposition) and **§14** (the refinement from the OPP-57 attempt: roadmap-upkeep is
documenter-executed at run-completion, the Evaluator judges item completion, the harness
accumulates the evidence; rules carry an **owner + trigger** and a **delivery guarantee**).

Tuning: `--model-generator opus --refine-spec`, a higher `--max-sprints`; `--context
docs/ROADMAP.md --context docs/INTERNALS.md --context CLAUDE.md --context
docs/planning/standing-requirements-design.md`. Review the diff closely before release.

---

## How Claude runs `adhd` to self-develop

The `adhd` command runs from a **separate clone** (`/home/psz/dev/PSZ/harness`), so editing
*this* repo never alters the running tool — core-loop edits are safe to automate. **Heads-up:**
that clone is behind `main`; `git -C /home/psz/dev/PSZ/harness pull` first if you want to
dogfood the latest harness.

**Base flags (every run):**

| Flag | Why |
|---|---|
| `--no-interactive` | Required — Claude drives `adhd` in a non-TTY shell; the `--dry-run` preview replaces the spec gate. |
| `--lint-gate --test-gate` | Hard gates: a lint/type/new-test failure fails the attempt before the Opus judge — protects the suite. |
| `--review` | Advisory Reviewer code-craft pass after each passing sprint. |
| `--scout` | Read-only pass surfacing repo conventions for the Generator (important for the `shared/` SDK-independence rule). |
| `--branch feat/opp-NN-…` | Name the topic branch. |
| `--commit-adhd` | Keep the `.adhd/` audit trail on the branch (stripped at release except `usage.json`/`regression.json`). |
| `--notify` | Desktop pings on gates/errors. |
| `--context …` | Inject specs: `docs/ROADMAP.md`, `docs/INTERNALS.md`, `CLAUDE.md`, **and the item's design doc**. |

**Workflow per item:**
1. **Preview** — same command **+ `--dry-run`** (planner only, side-effect-free: omit
   `--branch`/gates). Review the spec against the requirement; fix the prompt/context and
   re-preview if off.
2. **Build** — rerun without `--dry-run`, **in the background** (long), and monitor.
3. **Ship** — review the diff (close + adversarial for `[human-led]` items), then release (§
   below). The harness does not release itself.

---

## Release ritual (after each piece)

Per `docs/RELEASING.md`: green gate → pick the next version above `main` → **user-facing**
CHANGELOG (no sprint/internal-symbol terms; rewrite the documenter draft) → squash-merge to
`main` → **strip `.adhd/`** keeping only `usage.json` + `regression.json`
(`git restore --staged --worktree .adhd ':(exclude).adhd/usage.json' ':(exclude).adhd/regression.json' && git clean -fdq .adhd`)
→ bump `package.json` + finalise CHANGELOG `[Unreleased]`→`[vX]` → annotated `vX` tag →
push `main` + tag → `gh release create` → archive (`archive/<branch>`, local-only) then
delete the branch. `feat!` / `BREAKING CHANGE:` for breaking changes.

---

## Lessons to carry forward

- **`--max-features` drops overflow.** The harness runs **one sprint per `## Sprint N`
  heading** and trims each sprint's contract to `--max-features`, *dropping* the rest — set
  `--max-features` to cover the planner's **largest** sprint, not 1.
- **Green ≠ correct.** Close-review (adversarial) and **behaviorally verify** load-bearing
  changes before releasing: OPP-57 was green-but-vacuous; OPP-54 shipped a mandated git test
  only as a mock until review caught it. Don't trust the green gate alone for `[human-led]`.
- **Parallel worktree.** `feat/adhd-harness-skill` (`/home/psz/dev/PSZ/adhd-harness-skill`)
  is Peg's plugin/skill packaging work — **do not touch it**; it needs a rebase onto the
  current `main`.
