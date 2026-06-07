# Governance for committing the harness's own `.adhd/` artifacts

**Status:** Planning / decision doc (tracked, under `docs/planning/`).
**Lifecycle:** Captures the decision journey + design + executable plan for **OPP-54**
(the durable forward pointer in `docs/ROADMAP.md`). Archive once OPP-54 ships, per the
Planning → archives lifecycle.
**Base commit:** `7794fee3439a8f96cfc5c346e984985837f8dcc5`.
**Decided with:** Peg, 2026-06-07. Three forks settled: **tier-model flags**,
**decouple hygiene from persistence (true default-off)**, **new OPP + this planning doc**.

---

## 1. The question

The ADHD harness can be pointed at *any* repo. It writes a family of its own
artifacts under `<workDir>/.adhd/` and, today, commits some of them to git. We
needed to decide **which of its own `.adhd/` artifacts should land in git, under
whose control** — and whether to change the current behaviour.

The human's proposed two-layer model, which we pressure-tested and adopted:

1. **The project's `.gitignore` always wins.** A project decision the harness
   must never override.
2. **A flag means "the harness *may* commit this artifact"; default off.** Whether
   it actually lands still depends on `.gitignore` (layer 1 on top).

Because the harness runs against arbitrary repos, **any guarantee that must hold
everywhere lives in the harness code, not in ADHD's own `.gitignore`.**

---

## 2. The decision in one paragraph

Layer 1 is **already true in code** and becomes an enforced invariant. Layer 2 is
realised by **separating two concerns that currently wear one hat**: *persistence*
(what survives in git — governed by flags, default off) and *hygiene* (the clean
working tree the Generator's diff isolation needs — governed by **path exclusion**,
not by committing). Today the harness buys hygiene by committing `.adhd/` churn on
every Generator attempt, which is *why* "default off" is not actually the current
behaviour. We remove that hygiene commit, make the working-tree checks ignore
`.adhd/`, and let the existing flag-gated commits be the *only* path that writes
`.adhd/` to git. Result: **default off genuinely means "the harness never touches
git with `.adhd/`,"** exactly the human's model.

---

## 3. What the code does today (grounded findings)

Verified against the base commit (parallel code audit + direct reads of
`git-ops.ts` and `diff.ts`).

### 3.1 Layer 1 already holds

- **No `git add -f` / `--force` anywhere** in `shared/` or `harness-claude/`. The
  four harness-executed `git add` sites
  ([git-ops.ts:96, 113, 158, 249](../../shared/orchestration/git-ops.ts)) all respect
  `.gitignore`. (Agent prompts also instruct the LLM to run `git add`, but those are
  not harness-guaranteed paths.) So a project that
  gitignores `.adhd/` already wins on every commit path — including the allow-list
  staging, whose per-path `git add` is wrapped in try/catch and degrades silently
  to "not staged" when git refuses an ignored path
  ([git-ops.ts:156-162](../../shared/orchestration/git-ops.ts#L156-L162)).
- `checkGitignore` ([files.ts](../../shared/files.ts) `checkGitignore`) only **logs an
  advisory** ("Consider adding `.adhd/` to your `.gitignore`"); it never writes a
  `.gitignore`. (Minor: it substring-matches `.adhd`, and the message is identical
  whether the file is missing or merely lacks the entry.)

### 3.2 Three commit paths, only one flag-gated

| Path | Where | Stages | Flag? | When |
|---|---|---|---|---|
| `commitAdhdArtifacts` | [git-ops.ts:106-128](../../shared/orchestration/git-ops.ts#L106-L128), called [sprint-attempts.ts:137](../../shared/orchestration/sprint-attempts.ts#L137) | **bare `git add .adhd/`** (everything non-ignored) | **none** | before **every** Generator attempt |
| `commitAdhdMetadata` | [git-ops.ts:180-192](../../shared/orchestration/git-ops.ts#L180-L192) | allow-list (`ADHD_METADATA_PATHS` [+logs]) | `commitAdhd` | after each passing sprint |
| `commitFinalMetadata` | [git-ops.ts:210-225](../../shared/orchestration/git-ops.ts#L210-L225) | allow-list (`ADHD_METADATA_PATHS` [+logs]) | `commitAdhd` **&& allPassed** (normal path); a 2nd call in the docs-only resume path is gated on `commitAdhd` alone | end of run |
| *(plus)* `ensureAgentCommit` fallback | [git-ops.ts:96](../../shared/orchestration/git-ops.ts#L96) | **whole tree `git add -A`** | none | when an agent leaves a dirty tree and resume fails/absent |

The allow-list is exactly
`[".adhd/contracts/", ".adhd/feedback/", ".adhd/progress.json", ".adhd/spec.md", ".adhd/usage.json"]`,
plus `".adhd/logs/"` when `--commit-adhd-logs`
([git-ops.ts:135-141, 150-154](../../shared/orchestration/git-ops.ts#L135-L154)).

**Consequence (the reframe):** with no flags, `.adhd/` is still committed on every
attempt — often multiple `[adhd] Sprint N: artifacts` commits per sprint on retries
— via the *ungated* `commitAdhdArtifacts`, whenever `.adhd/` is not gitignored. The
flag governs the curated *metadata* commit; it is **not** the master switch for
whether `.adhd/` lands in git. "Default off" is currently false.

### 3.3 The clean-tree coupling — and where it actually lives

- The **committed-diff** side is already `.adhd`-safe: the changed-file feeds
  `computeChangedFiles` and `computeChangedFilesSince` filter through
  `isAdhdMetadataPath`, which matches **all** of `.adhd/`, not just the metadata
  subset ([diff.ts:60-63](../../shared/diff.ts#L60-L63)), so the surface-coverage gate
  (§1.21) never sees `.adhd/`. `computeDiffSection` (the diff *text* injected into the
  Evaluator, §1.16) does **not** itself filter — but once the pre-Generator commit is
  removed, `.adhd/` is never in the `beforeSha..HEAD` range, so its diff text is clean
  by timing regardless.
- The **working-tree dirty checks** are *not* `.adhd`-safe. Three sites run
  `git status --porcelain` with **no pathspec** and test only non-emptiness:
  `ensureAgentCommit` ([:60](../../shared/orchestration/git-ops.ts#L60) and
  [:88](../../shared/orchestration/git-ops.ts#L88)) and `checkDirtyTree`
  ([:428](../../shared/orchestration/git-ops.ts#L428)). A fourth, `stashAdhdFiles`
  ([:237](../../shared/orchestration/git-ops.ts#L237)), is correctly scoped with
  `-- .adhd/`.
- The **fallback** stages the whole tree: `git add -A && git commit`
  ([:96](../../shared/orchestration/git-ops.ts#L96)).

So the pre-Generator hygiene commit buys exactly one thing: it clears uncommitted
`.adhd/` churn so `ensureAgentCommit`'s L60 `dirty` check reflects only the
Generator's product output. **The diff isolation does not depend on it.**

The latent bug this creates: against a target that does **not** gitignore `.adhd/`
(the README advises gitignoring it, but nothing enforces it), an artifact written
*during* the Generator stage — e.g. the Generator's own conversation log, which is
flushed once in a `finally` block when the agent finishes
([conversation-logger.ts](../../shared/conversation-logger.ts) `finalize`) — lands as
an untracked file *after* the hygiene commit ran. It then makes L60 read "dirty,"
triggers the resume/fallback tier, and the fallback `git add -A` folds that
`.adhd/` file into the **product** commit. In this very repo the bug is masked only
because the bare `logs` glob in `.gitignore` incidentally ignores `.adhd/logs/`;
no `.adhd`-specific rule exists.

### 3.4 The full artifact set and two inconsistencies

Families written under `.adhd/` and whether the harness commits them today:

| Family | Writer | In allow-list? | Swept by bare `git add .adhd/`? |
|---|---|---|---|
| `contracts/` | `writeContract` | yes | yes |
| `feedback/` | `writeFeedback` | yes | yes |
| `progress.json` | `writeProgress` | yes | yes |
| `spec.md` | `writeSpec` | yes | yes |
| `usage.json` | `usage.save` | yes | yes |
| `logs/` | `conversation-logger` | only under `--commit-adhd-logs` | yes (if not ignored) |
| `regression.json` | `regression.ts` | **no** | yes |
| `reviews/` | `reviewer.ts` | **no** | yes |
| `scout-digest.json` | `scout.ts` | **no** | yes |
| `baseline-verification-*.json` | `writeBaselineVerification` | **no** | yes |
| `runs/<stamp>/` | `writeRunRecord` | **no** | yes (by timing usually absent during loop) |
| `skills/`, `.env` | `initWorkspace` / config | no | `.env` gitignored; `skills/` swept |

Two inconsistencies fall out:

1. **`regression.json` mismatch.** `CLAUDE.md` and `RELEASING.md` name
   `usage.json` **and** `regression.json` as the two durable assets kept on `main`,
   yet only `usage.json` is in the allow-list. The harness never stages
   `regression.json` via the flag path — its survival on `main` depends entirely on
   the manual release step.
2. **`runs/` and `baseline-*` docstrings vs. behaviour.** `run-history.ts` says runs
   are snapshotted "regardless of `--commit-adhd` — no git operation," and
   `baseline-verification` is documented "not committed by default" — yet the bare
   `git add .adhd/` sweeps both into the unconditional artifacts commit (baseline
   files are tracked in this repo right now).

### 3.5 Greenfield is exempt (no change needed)

For `--greenfield`, `gitDir(workDir, true)` is `<workDir>/app` while `.adhd/` lives
at `<workDir>` — outside the app repo — so `git add .adhd/` from `app/` matches
nothing and no git op touches `.adhd/` ([files.ts](../../shared/files.ts) `gitDir`,
`harnessDir`). The whole topic applies only to non-greenfield runs where
`gitDir == workDir`. Path exclusion is harmless in greenfield.

---

## 4. The chosen model

### Layer 1 — `.gitignore` is absolute (enforced invariant)

- Keep the no-`-f` rule. **Never** use `git add -f` / `--force` to override a
  project's `.gitignore`. The allow-list/try-catch behaviour that swallows the
  ignored-path error stays.
- Add a **guard test** asserting no `git add -f` / `--force` appears in `shared/`
  (and `harness-claude/`), so a future edit cannot silently break layer 1.

### Layer 2 — tier-model flags, default off

Two flags, grouped by **purpose**, not one switch per family:

| Tier | Flag (default off) | Families committed |
|---|---|---|
| **A — structured audit record** | `--commit-adhd` | `contracts/`, `feedback/`, `progress.json`, `spec.md`, `usage.json`, **`regression.json`**, **`reviews/`**, **`scout-digest.json`**, **`baseline-verification-*.json`** |
| **B — full forensic trail** | `--commit-adhd-logs` *(implies A)* | Tier A **+ `logs/`** (raw per-agent conversation logs) |
| **Always local-only** | — *(never committed by the harness, any flag)* | `runs/`, `skills/`, `.env` (`.env` is gitignored regardless) |

Rationale:

- **No per-family flag explosion.** Operators want "the audit record" or "+ the
  verbose logs," not ten independent switches. The split mirrors today's
  `--commit-adhd` / `--commit-adhd-logs` shape — the only family the logs flag
  gates is `logs/`, exactly as now.
- **Tier A expands to the complete structured record.** Today `reviews/`,
  `scout-digest.json`, `baseline-*` and `regression.json` are committed *only* by
  the ungated bare add; once that is removed they would become uncommitted-by-default
  unless folded into a flag. Folding them into Tier A keeps `--commit-adhd` a
  *complete* audit trail and **fixes the `regression.json` mismatch** (it now rides
  the same flag as `usage.json`, matching the documented durable pair).
- **`runs/` becomes truly local-only**, matching its §1.37 design intent ("no git
  operation"); `adhd compare` reads it from disk. It only landed in git before via
  the bare-add accident.
- **Allow-list, not deny-list.** New `.adhd/` families default to *not committed*
  until explicitly added to the list. This is the code-level expression of "keep
  `.adhd/` out by default" and matches the `RELEASING.md` philosophy. Cost: adding a
  new committable family is a deliberate one-line edit (acceptable, and safer than
  the reverse).

---

## 5. Clean-tree handling (the hard part)

**Decouple hygiene from persistence.** Stop committing for hygiene; exclude the
uncommitted `.adhd/` subset from the working-tree checks and the fallback.

Because the Generator (and Documenter) never write `.adhd/` — it is harness
bookkeeping — **excluding all of `.adhd/` from generator-output detection is
correct**, not just the not-flagged subset.

Precise changes:

1. **Working-tree dirty checks ignore `.adhd/`.** Replace the three pathspec-free
   `git status --porcelain` calls with a `.adhd`-excluding pathspec:
   `git status --porcelain -- . ':(exclude).adhd'`
   - `ensureAgentCommit` L60 (`dirty`) and L88 (`postResumeDirty`).
   - `checkDirtyTree` L428 (lowest-risk, most debatable — it warns the operator
     about *pre-existing* uncommitted changes; excluding leftover `.adhd/` from a
     prior run is desirable but is a UX gate, not detection-critical).
2. **Fallback stages product only** — the bug fix. The fallback must (a) never fold
   `.adhd/` into the product commit and (b) still commit when real product changes
   exist, in **both** the `.adhd`-gitignored and not-gitignored cases. The naive
   `git add -A -- . ':(exclude).adhd' && git commit …` is **unsafe**: when `.adhd/`
   *is* gitignored, the explicit `.` pathspec names an ignored directory, so `git add`
   prints an ignored-path diagnostic and **exits 1** — the `&&` short-circuits and no
   commit is made even though product changes were correctly staged (verified
   empirically in throwaway repos). `-f` is **not** the fix — it would force-stage the
   ignored `.adhd/`, violating layer 1. Instead **decouple add from commit**: stage
   product-only tolerating a non-zero exit, then commit only if something is staged —
   `git add -A -- . ':(exclude).adhd'` (wrapped so an ignored-path error does not
   abort), followed by `git diff --cached --quiet || git commit -m …`. (`':(exclude).adhd'`
   is a git magic pathspec, git ≥ 1.9; it is path filtering, orthogonal to `.gitignore`.)
3. **Remove the pre-Generator hygiene commit — *only together with (1) and (2)*.**
   Delete the `commitAdhdArtifacts(config.workDir, gDir, sprint)` call at
   [sprint-attempts.ts:137](../../shared/orchestration/sprint-attempts.ts#L137) and its
   comment. **The removal is safe only because (1) makes uncommitted `.adhd/` invisible
   to generator-output detection** — removing it *without* (1), in a brownfield repo
   that has not gitignored `.adhd/`, would leave the tree dirty after the Generator
   commits, needlessly firing the resume tier and then the fallback `git add -A`, which
   would sweep `.adhd/` into the product commit. Land (1)+(2)+(3) as one atomic change.
   `commitAdhdArtifacts` has no other caller, so delete the function too (see §6 for the
   exact tests to update). (Greenfield is already safe regardless: `.adhd/` lives
   outside the `app/` repo — §3.5.)

Why this is self-consistent:

- Reaching the fallback now requires the `.adhd`-excluded dirty check to be
  non-empty → real product changes exist; the commit fires only when
  `git diff --cached` is non-empty, so it is never an empty commit (and never blocked
  by `git add`'s exit code in the gitignored case).
- `.adhd`-only churn (no product change) makes the excluded dirty check empty →
  `ensureAgentCommit` returns `"agent"` (if HEAD moved) or `"none"` — never a
  fallback. Leftover `.adhd/` stays uncommitted, as intended.
- With no pre-Generator commit, earlier-phase `.adhd/` churn (contract, scout,
  baseline, prior retry) is never committed, so it is never in `beforeSha..HEAD`
  and never appears in the diff — *better* isolation than today.
- Persistence happens only at the flag-gated points: `commitAdhdMetadata` after a
  passing sprint and `commitFinalMetadata` at end-of-run.

Checkpoint/revert interaction (verify, likely unaffected): with `.adhd/`
uncommitted/untracked, `git reset --hard <checkpoint>` does not remove untracked
files, so `.adhd/` survives a revert naturally; `stashAdhdFiles` (scoped to
`.adhd/`) continues to stash the untracked set before reset and restore after. No
redesign needed; add a revert test to pin it.

---

## 6. Implementation plan (executable)

Ordered; each step keeps the suite green and is test-first where it changes
behaviour.

1. **Layer-1 guard test.** Add a test asserting no `git add -f` / `--force` token
   in `shared/` and `harness-claude/` source (string-scan, mirrors existing
   file-read test pattern). Green today; durable.
2. **Detection exclusion (test-first).**
   - Tests for `ensureAgentCommit` with a stray uncommitted `.adhd/` file present:
     (a) HEAD moved + only `.adhd/` dirty → `"agent"`; (b) HEAD unchanged + only
     `.adhd/` dirty → `"none"`; (c) product change + resume absent → `"fallback"`
     **and the committed tree contains no `.adhd/` path**. RED until the edits land.
   - Edit L60, L88 to `git status --porcelain -- . ':(exclude).adhd'`.
   - Edit L96 fallback to the **decoupled** form (§5.2): `git add -A -- . ':(exclude).adhd'`
     (tolerate a non-zero exit), then `git diff --cached --quiet || git commit -m …`.
   - Add a git-semantics test that runs the fallback with `.adhd/` **gitignored** and
     asserts a product commit is still made and contains no `.adhd/` path (locks the
     exit-1 short-circuit fix).
3. **Remove the hygiene commit (atomic with step 2).** Delete the call at
   sprint-attempts.ts:137 + its comment and the `commitAdhdArtifacts` function (only
   caller). Update the tests that reference it or the suite/typecheck go red:
   - `tests/git-ops.test.ts`: remove the import, the `describe("commitAdhdArtifacts")`
     block (5 tests, ~L91-161), and the shared comment ~L33.
   - `tests/phase-1-5-integration.test.ts`: remove the import (~L29) and the
     `describe("clean_working_tree_before_generator")` block (3 tests, ~L633-680, which
     encode the *old* hygiene behaviour); delete the `typeof commitAdhdArtifacts`
     assertion in `consistent_naming_conventions` (~L836); and rewrite the
     `no_code_duplication_across_features` test (~L872) so it no longer names the
     deleted symbol.
4. **`checkDirtyTree` exclusion.** Edit L428 to the `.adhd`-excluding pathspec;
   adjust/add the dirty-tree test.
5. **Tier-model flags / allow-list.**
   - Extend `ADHD_METADATA_PATHS` (Tier A) to add `.adhd/regression.json`,
     `.adhd/reviews/`, `.adhd/scout-digest.json`, and the baseline glob
     `.adhd/baseline-verification-*.json` (the per-path try/catch already tolerates
     a no-match glob and missing paths).
   - Leave the `includeLogs` branch as `.adhd/logs/` only (Tier B = Tier A + logs).
   - No new config flags or fields are required — `commitAdhd` / `commitAdhdLogs`
     and their implication chain are unchanged; only the **path set** each commits
     grows. (Optional, separate: add env-var fallbacks for symmetry with the rest of
     the config surface — out of scope here.)
   - Update `stageAdhdMetadataPaths` / `commitAdhdMetadata` / `commitFinalMetadata`
     docstrings to the new path set.
   - Tests: assert Tier A stages `regression.json`/`reviews/`/`scout`/`baseline`
     and **not** `runs/`/`skills/`; assert Tier B adds `logs/`.
6. **Revert pin.** Add a `revertToCheckpoint` test with uncommitted `.adhd/`
   present to confirm survival across `git reset --hard`.
7. **Docs.**
   - `docs/ROADMAP.md`: OPP-54 (already added) moves to `docs/CAPABILITIES.md` once
     shipped; remove it from Part 1/2.
   - Update `README.md:397` and the §1.13 / §1.33 / §1.34 / §1.37 wording so the
     described commit behaviour matches (default off; Tier A/B; `runs/` local-only).
   - Reconcile `baseline-verification` / `run-history` docstrings with the new
     reality (Tier A / local-only respectively).
8. **CHANGELOG.** See §7.

---

## 7. Migration & compatibility

User-visible behaviour changes (acceptable on `0.x`; treat as a **breaking
behavioural change**, `feat!` / `BREAKING CHANGE:`, precedent: §1.35's
`--allow-main` default change):

- **Default no longer commits `.adhd/`.** No more `[adhd] Sprint N: artifacts`
  commits without a flag. For self-development (where `.adhd/` is not gitignored)
  the working tree ends a run with uncommitted `.adhd/`; the release strip already
  handles this. For targets, the README advises gitignoring `.adhd/`.
- **`--commit-adhd` now commits a fuller record** (adds `regression.json`,
  `reviews/`, `scout-digest.json`, `baseline-*`). `--commit-adhd-logs` is unchanged
  in meaning (Tier A + `logs/`).
- **`runs/` is never committed by the harness** (was incidental before).

CHANGELOG entry: state the new default, the Tier A/B contents, the `runs/`
local-only rule, and the `regression.json` fix. The release-time strip rule in
`RELEASING.md`/`CLAUDE.md` is simplified (branches accumulate far less `.adhd/`
churn) but not removed — agents can still create commits, and `usage.json` /
`regression.json` remain the durable keeps.

**Coordinate with OPP-55 (standing cross-cutting requirements).** That work may add a
third durable asset, `.adhd/policy.json`, editing the *same* `RELEASING.md` / `CLAUDE.md`
durable-asset prose this change touches. If both land, the durable set becomes
`{usage.json, regression.json, policy.json}`; sequence the two edits so neither clobbers
the other, and let OPP-55's proposed strip-guard cover all three.

---

## 8. Risks & open questions

- **Load-bearing detection change (primary risk).** `ensureAgentCommit` is the
  generator/documenter output detector. The targeted tests in §6.2 are the
  mitigation; this is why OPP-54 is tagged **[human-led]**. (OPP-35's broader
  orchestration test net would help but is not a prerequisite for these unit-level
  pins.)
- **Pathspec portability.** `':(exclude)…'` needs git ≥ 1.9 (universal in
  practice) and correct shell quoting through `execSync` (`/bin/sh`, single quotes).
- **`checkDirtyTree` scope (debatable).** Excluding `.adhd/` from the pre-flight
  warning is a small UX change; if undesired, leave L428 unchanged — it does not
  affect detection correctness.
- **Allow-list maintenance.** A future `.adhd/` family is not committed until added
  to the list (intended; document in the artifact-writer checklist).
- **Open:** env-var fallbacks for the commit flags (asymmetry with the rest of the
  config) — noted, deferred.

---

## 9. Decision log (rejected alternatives)

- **Commit-side `:(exclude)` only** (mirror how one might exclude `runs/` from the
  bare add): rejected — insufficient for anything present *during* the loop (logs),
  because it leaves the artifact untracked-and-visible to the whole-tree dirty
  checks, which is the actual coupling.
- **Append `.adhd/logs/` to `.git/info/exclude`**: rejected as the primary fix —
  collapses the artifact into the gitignore tier, which then disables the flag's
  ability to opt it *in* (the explicit `git add` would hit the ignored-path error)
  unless forced with `-f`, violating layer 1.
- **Document the status quo / require operators to gitignore `.adhd/`**: rejected —
  pushes correctness onto the operator and leaves the dirty-check pollution
  unaddressed.
- **Per-family flags**: rejected — flag explosion for no real operator benefit;
  the purpose-based tier split covers the realistic choices.
- **Move logs out of `.adhd/`**: rejected — a larger logging-layout refactor that
  still needs the dirty-check exclusion, so no cheaper where it matters.
- **Keep the hygiene commit, make it flag/gitignore-respecting**: rejected — once
  the dirty checks exclude the uncommitted subset, the hygiene commit is redundant;
  keeping it reintroduces the "commits by default" behaviour we set out to remove.
