# Phase 1 Hardening — Follow-up Plan

> **Status:** plan / approach. This document is the agreed output of a review
> discussion. It is **not** the implementation — it is precise enough to execute
> later (by a human, by me, or by the harness against itself). Implementation
> lands as a separate change set driven by the roadmap this plan produces.
>
> **This stream is doc-only.** It restructures and syncs documentation. Every
> code/test change it identifies is recorded as a roadmap item and implemented
> later *from the roadmap* — never inline here. This keeps doc work and code work
> cleanly separate.
>
> **Base commit:** `7794fee` ("[adhd] Run complete: final metadata"), clean tree.
> **Gates at base:** `typecheck` clean · `lint` clean (60 files) · `bun test` 1472 pass / 0 fail.
> **Audience:** harness maintainers. Internal IDs (OPP-NN, F1–F9, symbol names)
> are appropriate here; the user-facing-language rule applies only to
> `CHANGELOG.md` / `README.md` / release notes.

---

## 1. Why this exists

A six-sprint "Phase 1 Hardening" self-development run delivered nine features
(F1–F9), each mapped one-to-one onto a roadmap opportunity. An independent
multi-agent verification re-checked every feature against the code at `7794fee`.
The code shipped and the gates are green, but the run left loose ends needing
deliberate, human-led decisions:

1. `docs/ROADMAP.md` was never synced — all nine completed opportunities are
   still listed as open, and two genuinely new capabilities are missing from the
   inventory.
2. Two symbols flagged as "dead code to remove" were left in place; whether to
   remove each needed a determination (§3.1).
3. Several test-integrity gaps surfaced (a test that looks like it guards a fix
   but does not; coverage that asserts on source text rather than behaviour).
4. **Structural:** `docs/ROADMAP.md` Part 1 is an *implemented-capability
   inventory* — a current-system reference that grows with every feature — living
   inside a document that is supposed to hold only forward-looking work. That
   mismatch is why the maintenance rule reads as self-contradictory and why the
   doc keeps growing. This plan extracts Part 1 (§3.4).

---

## 2. Verified state at `7794fee`

All ten verification targets were **confirmed**, including every contested
base-commit caveat. Summary:

| Feature | Verdict | Note (evidence) |
|---|---|---|
| F1 / OPP-39 — reject NaN/malformed numeric flags & env | DONE | parse-boundary throw + `Number.isInteger` backstop (`shared/config.ts:682/685/688`); zeros & gate-timeout 0 preserved |
| F2 / OPP-42 — empty-spec refinement keeps spec on disk | DONE (Option A) | one `writeSpec` added (`shared/orchestration/spec-refinement.ts:108`); teardown still hand-copied across **6** exit branches (Option B not taken) |
| F3 / OPP-30 — carry findings through test-gate skip | **prod DONE, test tautological** | all three gates thread `lastRealEval` (`sprint-attempts.ts:282/334/362`); the dedicated test mirrors a local copy and does **not** pin the production call site — proven by experiment: reverting the fix kept the suite green |
| F4 / OPP-41 — remove dead/dup code + static guard | **PARTIAL** | static one-export-per-symbol guard + dedup done; two symbols remain (see §3.1) |
| F5 / OPP-43 — robust interactive gates & degradations | DONE | `tryExecEditor` + `classifyReviseInput` + `logWarn` routing present (`shared/orchestration/gates.ts`) |
| F6 / OPP-33 — deterministic self-check before eval | **PARTIAL** | self-check sequence shipped (`shared/prompts.ts:151-162`); scenario 3 (README recommends `--lint-gate` for dogfooding) **unmet** |
| F7 / OPP-40 — accurate cost ledger & turn diagnostics | DONE | all five fixes present; evaluator max-tokens resume recording is **source-string-tested only**, no behavioural test (no injection seam on `runEvaluator`) |
| F8 / OPP-44 — document the security model | DONE (Option A) | README `## Security` present; no env-scrub/redaction code (Options B/C deferred) |
| F9 / OPP-46 — complete & truthful `--help` / README | DONE | full reference; phantom `--reviewer-max-turns` absent everywhere; **no test guards its re-introduction** |
| ROADMAP sync | **OUT OF SYNC** | all nine OPPs still open in Part 2 + Part 3 tables + Summary View; Part 1 missing entries for the F4 export guard and the F6 self-check |

---

## 3. Determinations (decisions, with rationale)

### 3.1 The two F4 "dead" symbols are not the same case

**`freezeCompletedSprints` (`shared/refinement.ts:53`) → REMOVE. Genuinely redundant (superseded).**

- The live refinement orchestrator never calls it: `performSpecRefinement`
  (`shared/orchestration/spec-refinement.ts`) uses `extractCompletedSprintSections`
  (line 62) + `spliceRefinementSections` (line 126).
- Its guarantee is now provided structurally and more strongly. It was the old
  "repair completed sections if the Planner edited them" tool from the full-rewrite
  era. Since the patch-based change (§1.27), the Planner emits only remaining
  sections, and `spliceRefinementSections` prepends the **verbatim original**
  completed sections and slices the Planner's output from the first remaining
  heading onward (`shared/refinement.ts:136`). Completed sprints cannot be modified
  because the Planner never supplies them.
- Clean blast radius: its only private helper `extractSprintSection` stays in use
  live (`shared/refinement.ts:38`). Removal touches only `freezeCompletedSprints`
  and three test files.
- **Why removable, not "unwired safety":** the safety it provided still holds — by
  a better mechanism. (Side note: §1.19's wording "force-repaired if the Planner
  modifies them" is now stale and should be reworded to describe the splice path.)

**`assertBranchAllowed` (`shared/orchestration/git-ops.ts:353`) → KEEP. Dead today, but necessary (the gap it guards is still open).**

- It refuses to run on `main`/`master` without `--allow-main`. In the fresh and
  resume paths, branch safety is now achieved a different way — `ensureTopicBranch`
  *creates* a topic branch (§1.35) — so the refuse-guard is unused there.
- But the `--sprint N` path does no branch setup at all and can commit straight to
  `main`. That is the live bug **OPP-29** exists to fix, and OPP-29's planned fix
  (reuse `progress.branch`, else error unless `--allow-main`) is exactly what this
  function does. It is tested safety logic for an *open* hole.
- **Why keep, not remove:** deleting it would discard a ready fix while leaving the
  bug. It is not redundant — no current path covers the `--sprint N` case. Its
  private helpers `currentGitBranch` / `shouldRefuseOnDefaultBranch` /
  `DEFAULT_BRANCHES` stay with it. Re-home it under OPP-29 (the item that should
  *wire it up*), not under OPP-41.
- **Contingency to record:** if OPP-29's eventual design closes the `--sprint N`
  gap purely by auto-branching (not refuse-on-main), this symbol becomes removable
  then. That decision belongs to OPP-29 (human-led, out of scope here).

**Separating principle:** *redundant — guarantee provided elsewhere* → remove;
*orphaned while the gap it covers is still open* → keep and wire.

### 3.2 Test-integrity gaps — routing decision (recorded as roadmap items)

Production code is correct for all four; only future-regression protection is
missing. None of these are done in this doc-only stream — each is recorded as a
roadmap item and implemented later:

- **F6 dogfooding note → OPP-33 (trimmed).** Document the hard `--lint-gate` as the
  recommended dogfooding setting (a README sentence; document, do not default-on).
- **F9 phantom-flag guard → OPP-46 (trimmed).** A small test asserting
  `--reviewer-max-turns` stays absent from `CLI_FLAG_HELP` and is rejected by the
  parser.
- **F3 tautological test → OPP-35.** The proper fix drives `runSprintAttempts` via
  a fake `AgentRunners` (the orchestration characterization net OPP-35 builds;
  Large, human-led; partly blocked on a verification-runner seam, OPP-47). A cheap
  structural/mirror guard would reproduce the very anti-pattern Phase-1B exists to
  remove, so it is **not** worth doing.
- **F7 source-string sub-gap → OPP-47.** The proper fix adds an injection seam to
  `runEvaluator`, then a behavioural test. No cheap improvement exists without it.

### 3.3 Roadmap upkeep — keep human-led, add a cheap drift-detector

The Documenter writes README/CHANGELOG but never touches `docs/ROADMAP.md`, which
is why it drifted. Teaching the Documenter to maintain the roadmap is **not**
recommended now: the roadmap is forward-looking judgment, not derivable from code,
and a wrong roadmap edit (erasing planned work, mislabeling status) is worse than a
stale one. The manual chore is cheap and the drift is easy to catch.

**Decision:** keep roadmap upkeep human-led; backlog full automation as an
opportunity; add a **cheap drift-detector** — a check flagging any OPP id present
in *both* the CHANGELOG `[Unreleased]` block *and* ROADMAP Part 2. The Part 1
extraction (§3.4) makes this even simpler: after the split, ROADMAP contains *only*
opportunities, so "shipped id still in ROADMAP" is the entire signal.

### 3.4 Extract Part 1 into its own document

`docs/ROADMAP.md` Part 1 (§1.1–§1.40, the implemented-capability inventory) is a
current-system reference, not planned work. It grows with every shipped feature
while Parts 2–3 should shrink, and its presence makes the "roadmap holds only
planned work" rule self-contradictory.

**Decision:** extract Part 1 to a dedicated `docs/CAPABILITIES.md`; `docs/ROADMAP.md`
keeps only Part 2 (opportunities) + Part 3 (priorities). Keep the §-numbering so
existing cross-references stay valid. Do it **together** with the sync (one
doc-only restructure) so the two new capability entries land in the new doc and
Part 1 is not edited twice. (`INTERNALS.md` is design rationale, not a capability
catalogue — do not fold Part 1 into it.)

---

## 4. Implementation plan (doc-only; execute later)

### 4.1 Extract Part 1 → `docs/CAPABILITIES.md`

- Move ROADMAP Part 1 (the "## Part 1: Inventory of Built-In Methodical
  Functionalities" section, §1.1–§1.40) verbatim into a new `docs/CAPABILITIES.md`,
  preserving the §-numbering and a short header explaining its purpose ("what the
  harness does today; opportunities live in ROADMAP, design rationale in
  INTERNALS").
- In `docs/ROADMAP.md`, replace Part 1 with a one-line pointer to
  `docs/CAPABILITIES.md`, and update "How to Read This Document" so the roadmap is
  described as two parts (opportunities + priorities) plus a link to capabilities.

### 4.2 `docs/ROADMAP.md` sync (Part 2 + Part 3)

Apply the project rule exactly: a completed item is **removed** from Part 2 and
Part 3; nothing is marked "done", struck through, or annotated with implementation
detail. New capabilities are described in `CAPABILITIES.md` (§4.3).

**A. Remove (fully shipped) — delete the `### OPP-NN` body, the Part 3 table row,
and the Summary View entry:**

- OPP-30 (F3) — carry-forward shipped; the test-net gap moves to OPP-35 (step C).
- OPP-39 (F1) — NaN rejection shipped.
- OPP-40 (F7) — ledger accuracy shipped; behavioural-test gap moves to OPP-47 (step C).
- OPP-42 (F2) — defect fixed (Option A); the teardown-centralization residual becomes OPP-58 (step D).
- OPP-43 (F5) — shipped; the mid-run-gate twin bug becomes OPP-56 (step D).

**B. Keep but trim (partial — reduce to the true remainder):**

- OPP-33 (F6) → "Document `--lint-gate` as the recommended dogfooding setting."
- OPP-41 (F4) → "Remove the redundant `freezeCompletedSprints` helper (its
  guarantee is provided by the patch-based splice)." `assertBranchAllowed` moves to
  OPP-29 (step C). The static guard shipped → CAPABILITIES (§4.3).
- OPP-44 (F8) → Options B/C only (environment-allowlist for project-script
  execution; conversation-log redaction). Option A shipped → already a capability.
- OPP-46 (F9) → "Add a regression guard against re-adding the phantom
  `--reviewer-max-turns` flag." The reference work shipped → already a capability.

**C. Re-home residuals into existing opportunities:**

- OPP-29 — note `assertBranchAllowed` is retained as the building block for the
  `--sprint N` branch-safety fix (refuse-on-main half).
- OPP-35 — add: rewrite the test-gate carry-forward test (mirror-only/tautological
  — F3) to drive the real `runSprintAttempts` call site.
- OPP-47 — add: extend the executor/seam work to `runEvaluator` so the evaluator
  max-tokens resume recording (F7) can be tested behaviourally.

**D. Add new opportunities (next free ids; place in the noted band):**

- OPP-56 — **Mid-run steering gate editor guard** (Phase 1.C). The mid-run gate
  launches the editor via an unwrapped `execSync`
  (`shared/orchestration/sprint-success.ts:124`) — the same crash class F5 fixed in
  the spec-approval gate. Wrap it with `tryExecEditor`.
- OPP-57 — **Roadmap drift-detector** (Phase 1.D / tooling). Flag any OPP id present
  in both CHANGELOG `[Unreleased]` and ROADMAP. This is the cheap near-term check;
  the general enforcement engine it points toward is **OPP-55 — Standing
  (cross-cutting) requirements** (see `docs/planning/standing-requirements-design.md`),
  which subsumes harness-maintained roadmap upkeep (deferred — §3.3).
- OPP-58 — **Centralise refinement teardown** (Phase 1.C, small). The
  `writeSpec + restoreRegressionData + return` teardown is hand-copied across six
  exit branches of `performSpecRefinement` (the F2 Option B not taken).
- OPP-59 (optional, minor) — **Strict numeric env-var parsing.** `MAX_SPRINTS="2.9"`
  truncates to `2` via `parseInt`, while a CLI float is rejected; make env parsing
  reject non-integers symmetrically.

**E. Summary View row edits (around `docs/ROADMAP.md:881/883/884`):**

- 1.A: `OPP-29,31,30,39,42` → `OPP-29, 31`
- 1.C: `OPP-33,34,40,41,43` → `OPP-33, 34, 41` (+ OPP-56/58 if placed here)
- 1.D: `OPP-44,45,46,47` → `OPP-44, 45, 46, 47` (44/46 trimmed but remain; + OPP-57 if here)

### 4.3 `docs/CAPABILITIES.md` additions

- New § (e.g. §1.41) — **Static One-Export-Per-Symbol Guard.** A model-free test
  (`tests/static-export-check.test.ts`) asserts no symbol is exported from more than
  one module across the SDK-independent core, respecting the SDK boundary.
- New § (e.g. §1.42) — **Deterministic Generator Self-Check (Pre-Evaluation).** The
  Generator's self-check guidance prepends an auto-fix → lint → type-check → test
  sequence so mechanically-detectable problems are resolved before the Evaluator.
  Additive guidance; no default flag or gate-verdict change.
- Fold-ins (no new §):
  - §1.13 operational-features table — add a row: strict numeric configuration
    validation (rejects NaN/non-integer flags & env vars with a flag-named error).
  - §1.11 observability / cost tracking — add a sentence: resume calls are recorded
    as their own additive ledger stages, the Reviewer stage is sprint-tagged, and
    the turn-limit warning is computed against each agent's real cap.

### 4.4 Reference updates (so nothing dangles after the split)

- Update prose that names the "three-part structure": at least `CLAUDE.md` (project)
  and `.adhd/spec.md`'s "Documentation Maintenance Note", plus any README/INTERNALS
  links into ROADMAP Part 1. The maintenance rule becomes: completed → remove from
  ROADMAP, add to CAPABILITIES; new opportunity → ROADMAP Part 2.

### 4.5 Definition of done (for the implementation)

- `docs/CAPABILITIES.md` exists with the former Part 1 (numbering intact) plus the
  two new §§ and the fold-ins; `docs/ROADMAP.md` Part 1 is replaced by a pointer.
- ROADMAP Part 2/3/Summary contain none of the five fully-shipped OPPs; OPP-33/41/44/46
  are trimmed to their remainders; F3/F7/`assertBranchAllowed` appear under
  OPP-35/47/29; OPP-56–59 added.
- Reference prose updated (§4.4). No code/test change in this stream — those are
  the roadmap items, implemented separately.
- This is a documentation change only; the code gates are unaffected.

---

## 5. Scope guardrails

This stream is **documentation only**. The code work it identifies (the F4
removal, the test/doc finishers, the new OPP-56–59, the re-homed test work) is
recorded in the roadmap and implemented later, each on its own topic branch with
green gates. When that implementation happens, do **not** touch: the Evaluator/judge
gate verdict or threshold logic; the sprint-loop control flow; branch-safety
*wiring* (OPP-29 — this plan only *retains* `assertBranchAllowed`); the
spec-refinement *decision* flow (removing the superseded `freezeCompletedSprints`
helper does not touch `performSpecRefinement`'s decisions); or anything tied to the
1.0 on-disk format freeze.

---

## 6. Deferred / not engaged this session

- **Parallel multi-worktree workflow (Topic 2)** — not engaged. The repo has
  `dev/phase1-roadmap-sync` and `dev/phase1-harness-hardening` (both at `7794fee`)
  plus three `explore/*` worktrees. A separate effort is developing a run-history
  snapshot exclusion (`RUNS_EXCLUDE_PATHSPEC`) not present at this commit; expect a
  CHANGELOG reconciliation when it lands. Formalising a worktree-session helper is
  available as a follow-up if wanted.
- **Branch reconciliation** — `dev/phase1-roadmap-sync` exists for this work but is
  empty; the implementation can adopt it or be merged into it.
