# Changelog

All notable changes to this project are documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [v0.5.0] - 2026-05-10

First release tagged under SemVer. Earlier `v0.01`–`v0.04` tags were re-tagged as `v0.1.0`–`v0.4.0` against the same commits.

### Added
- Per-model token usage tracking with per-stage model column and per-model rollup view in the terminal summary; `model` field persisted in `.adhd/usage.json` (Phase 1.6 — see detailed notes below)
- SDK result diagnostics logged for every agent invocation (`stop_reason`, `num_turns`, `is_error`)
- Evaluator JSON parsing hardened with retry on `max_tokens` truncation
- Enhancements / ideas backlog (`docs/enhancements-new-features-ideas.md`)

### Changed
- Agent-commit recovery unified via shared `ensureAgentCommit` primitive in `shared/orchestration/git-ops.ts`

### Fixed
- `--dry-run` followed by `--resume` no longer skips sprints and jumps straight into the documenter

## [v0.4.0] - 2026-04-12

Phase 1.5 — Operational Hardening. See "Phase 1.5" sections below for full detail.

## [v0.3.0] - 2026-04-11

SDK separation refactor — `shared/` proven free of LLM SDK imports; `harness-{provider}` directory convention established.

## [v0.2.0] - 2026-04-10

Phase 1 — Deepen complete. See "Phase 1" sections below for full detail.

## [v0.1.0] - 2026-04-09

Initial public milestone — four-agent harness (planner, generator, evaluator, documenter) with sprint loop, contract negotiation, checkpoint/resume, and interactive gates.

---

## Phase 1: Deepen (Smarter Within Existing Architecture)

Closes the highest-impact quality gaps in the harness -- cross-sprint regression detection, wasted evaluation turns, imprecise retry feedback, code quality blindness -- and adds DX improvements for faster iteration on multi-sprint projects.

### Sprint 1 -- Regression Detection & Static Analysis Foundation

**Features:** BDD Regression Accumulation Across Sprints, Static Analysis Soft Gate

- Added `type` field (`"behavioral" | "implementation"`) to `SprintCriterion` interface for classifying contract criteria
- Updated contract negotiation prompts to instruct Generator/Evaluator to classify each criterion by type
- Implemented regression accumulation logic in `shared/regression.ts`: after a sprint passes, behavioral criteria are appended to `.adhd/regression.json` with deduplication by name
- Regression criteria from previous sprints are injected into the Evaluator prompt under a `## Regression Criteria` section
- Added `--no-bdd` flag to disable regression accumulation entirely
- Implemented static analysis command detection from `package.json` scripts (`lint`, `typecheck`, `type-check`)
- Static analysis results are injected into the Evaluator prompt under `## Static Analysis Results` (soft gate)
- Added `--lint-gate` CLI flag for hard gate mode: lint failure skips Evaluator and counts as failed attempt
- Output truncation at 4K characters for static analysis results
- Unit tests for regression accumulation, static analysis detection, truncation, and lint-gate behavior

**Verified:** All 15 criteria passed (scores 7-10). 311 tests passing, 0 failures.

### Sprint 2 -- Sharper Feedback & Quality Awareness

**Features:** Diff-Aware Evaluation on Retries, Quality Criteria in Contracts

- Implemented `shared/diff.ts`: computes `git diff <beforeSha>..HEAD` between retry attempts
- Diff injected into Evaluator prompt under `## Changes Since Last Attempt` on retry attempts only (skipped on attempt 0)
- Diff output truncated at 8K characters with descriptive warning
- Graceful degradation when git is unavailable or SHA is invalid
- Extended `CONTRACT_NEGOTIATION_GENERATOR_PROMPT` to require quality criteria covering naming conventions, code duplication, error handling, and maintainability
- Extended `CONTRACT_NEGOTIATION_EVALUATOR_PROMPT` to reject contracts lacking quality criteria
- Quality criteria tagged as `"implementation"` type (do not accumulate in regression set)
- Added `## Quality Criteria` section to Evaluator prompt requiring same scoring rigor as behavioral criteria
- Unit tests for diff computation, truncation, graceful degradation, and quality criteria prompt content

**Verified:** All 15 criteria passed (scores 7-10). 336 tests passing, 0 failures.

### Sprint 3 -- Developer Experience: Targeted Sprint Execution

**Features:** Sprint Selection (`--sprint N`)

- Added `--sprint N` CLI flag to `parseCli()` and `resolveConfig()`
- Sprint selection path in `harness.ts`: loads existing spec, skips planning, runs targeted sprint only
- Contract reuse when `.adhd/contracts/sprint-N.json` exists; fresh negotiation otherwise
- Mutual exclusion with `--resume` (clear error message)
- Validation: requires existing `.adhd/spec.md`, rejects non-positive integers
- Warning logged when no checkpoint exists for sprint N-1
- Workspace not cleaned in sprint mode (preserves existing artifacts)
- Regression criteria loaded and injected in sprint mode
- No prompt required for sprint mode (reads spec from disk, like `--resume`)
- Unit tests for CLI parsing, mutual exclusion, spec requirement, contract reuse, and edge cases

**Verified:** All 15 criteria passed. Single attempt.

### Sprint 4 -- Adaptive Specifications

**Features:** Progressive Spec Refinement (Guarded)

- Added `--refine-spec` CLI flag to enable post-sprint spec refinement
- After each passing sprint (except the last), the Planner is re-invoked with current spec and codebase context
- Completed sprint sections are frozen via `freezeCompletedSprints()` -- programmatic replacement ensures byte-identical preservation
- Line-level spec diff computed and logged to terminal (`+`/`-` prefixed lines)
- Interactive gate for accept/reject of proposed changes using existing `promptGateWithText` infrastructure
- Auto-accept mode when combined with `--no-interactive` (diff still logged)
- Sprint count recalculated after accepted refinement, capped by `--max-sprints`
- Regression criteria in `.adhd/regression.json` preserved unchanged through refinement
- Graceful error handling: Planner failure preserves original spec and continues
- Implemented in `shared/refinement.ts`: `extractSprintSection`, `extractCompletedSprintSections`, `freezeCompletedSprints`, `countSprints`, `computeSpecDiff`, `buildRefinementPrompt`
- Unit tests for section extraction, freezing, sprint counting, diff computation, and flag parsing

**Verified:** All 15 criteria passed. Single attempt.

### Sprint 5 -- Cross-Feature Integration Hardening

**Features:** Integration testing, CLI documentation, edge case hardening

- Verified sprint selection + regression injection works correctly
- Verified sprint selection + lint-gate compose without crashes
- Verified refinement preserves regression criteria (byte-identical)
- Verified diff and static analysis sections coexist in Evaluator context without clobbering
- Established deterministic ordering of supplementary context: regression > static analysis > diff
- Added all Phase 1 flags (`--lint-gate`, `--sprint`, `--refine-spec`, `--no-bdd`) to `CLI_FLAG_HELP` with descriptions
- Combined flags (`--sprint 2 --lint-gate --refine-spec --no-bdd`) resolve without crashes
- `--no-bdd` disables regression injection even in sprint selection mode
- `regression.json` survives `initWorkspace` and `cleanHarnessArtifacts`
- Invalid `--sprint` values (0, -1, non-numeric) produce clear error messages
- Malformed `regression.json` handled gracefully (warning + empty fallback)
- 3+ new integration tests covering cross-feature interactions

**Verified:** All 15 criteria passed. Single attempt.

### Sprint 6 -- Polish: Type Safety, JSDoc, Test Coverage

**Features:** TypeScript error fixes, dead code removal, JSDoc, test coverage closure

- Fixed 8 pre-existing TypeScript errors in test files (missing `noDocs` and `documenter` properties on `HarnessConfig`)
- Removed unused imports across Phase 1 files
- Added JSDoc comments with `@description` and `@param` tags to all exported functions in `shared/regression.ts`, `shared/diff.ts`, `shared/static-analysis.ts`, `shared/refinement.ts`, and `shared/config.ts`
- Ensured every `.ts` module in `shared/` has a corresponding `.test.ts` file
- Verified `bunx tsc --noEmit` produces zero errors across the entire project
- Verified `bunx biome check shared/ harness-claude/` produces zero errors/warnings
- No `any` type casts in Phase 1 code
- All `JSON.parse` call sites in `shared/` wrapped in try-catch with descriptive error handling
- All sprint 5 criteria verified as non-regressed

**Verified:** All 10 criteria passed. 3 attempts (initial TypeScript errors and biome warnings fixed on retries).

## Phase 1.5: Operational Hardening

Fixes correctness bugs that cause phantom sprints, closes observability gaps that destroy forensic evidence, improves resume reliability, and adds developer experience improvements. Surfaced by dogfooding the harness against its own codebase.

### Sprint 1 -- Sprint Counting Fix & Timestamped Logs

**Features:** Sprint Counting Regex Fix, Timestamp Log Filenames

- Fixed sprint-counting regex in `shared/sprint-count.ts`: anchored to line start with `^` and multiline flag `m` so that only `## Sprint N` headings at column 1 are counted -- inline prose references, blockquoted headings, and indented lines are excluded
- Added `YYYY.MM.DD-HH.MM.SS` timestamp prefix to all conversation log filenames via `fileTimestamp()` in `shared/logger.ts`
- Resume/retry cycles create new log files with distinct timestamps instead of overwriting prior logs
- All agent log types (Generator, Evaluator, Planner, Documenter, contract-negotiation) use the timestamped filename format
- Langfuse trace span names aligned to the same timestamped identifier for cross-referencing between log files and traces
- Timestamp uses configured timezone (`TZ_DISPLAY`) consistent with terminal output
- DRY: single `fileTimestamp()` utility used by all log-writing code paths
- Graceful fallback to UTC-based timestamp if timezone configuration throws
- 9 unit tests covering sprint-counting regex edge cases (standard headings, inline prose, blockquotes, indented, backtick-quoted, case-insensitive, zero headings)

**Verified:** All 13 criteria passed (scores 7-10). 474 tests passing. 2 attempts.

### Sprint 2 -- Resume Contract Skip & Parse Error Diagnostics

**Features:** Resume Contract Skip, Contract Parse Error Logging

- On `--resume`, existing contracts in `.adhd/contracts/sprint-N.json` are loaded from disk and reused without re-negotiating -- saves time and LLM cost
- `loadExistingContract()` in `shared/files.ts` validates: file exists, non-empty, valid JSON, criteria is a non-empty array, features is an array; malformed files return null and trigger negotiation
- Same `loadExistingContract()` function shared between `--resume` and `--sprint N` modes (no duplication)
- Log message on loaded contract includes criteria count: "Loaded contract from disk for sprint N with M criteria"
- When `parseContract` fails to extract valid JSON, `writeParseErrorDiagnostic()` writes full raw text to `.adhd/logs/sprint-N-contract-parse-error.txt`
- Truncated preview (500 chars max) logged to console on parse failure with "... (truncated, N chars total)" indicator
- `.adhd/logs/` directory created on demand with `mkdir({ recursive: true })`
- No diagnostic file created on successful parse
- Error during diagnostic file writing caught and logged without masking the original parse failure

**Verified:** All 23 criteria passed (scores 7-10, including Sprint 1 regression). 492 tests passing. Single attempt.

### Sprint 3 -- Clean Working Tree & Deterministic Rollback

**Features:** `.adhd/` Artifact Commits and Deterministic Revert, Progress "documenting" Status

- `commitAdhdArtifacts()` in `shared/orchestration/git-ops.ts` commits pending `.adhd/` files with `[adhd] Sprint N: artifacts` message before each Generator invocation, ensuring a clean working tree
- No-op when there are no `.adhd/` changes (avoids empty commits)
- `revertToCheckpoint()` now uses `git reset --hard <sha>` instead of `git revert --no-commit`, eliminating dirty-tree revert failures
- `.adhd/` files survive revert via stash/unstash: `stashAdhdFiles()` stages and stashes `.adhd/` before reset, `unstashAdhdFiles()` restores them after
- Stash/unstash errors are logged with context but do not cause unhandled exceptions; reset still completes
- Added `"documenting"` to the `HarnessProgress.status` union type
- Status set to `"documenting"` before the Documenter agent starts, transitions to `"complete"` after it finishes
- All new orchestration logic lives in `shared/` with zero SDK imports; DI boundary maintained

**Verified:** All 13 criteria passed (scores 6-10). Single attempt.

### Sprint 4 -- HITL Notifications & Metadata Commit Flags

**Features:** HITL Notifications, `--commit-adhd` / `--commit-adhd-logs` Flags

- `notify()` in `shared/notifications.ts` emits terminal bell (`\x07`) at all HITL gates and fatal errors
- `--notify` flag enables desktop notifications via `notify-send` (Linux) or `osascript` (macOS)
- Platform detection with graceful no-op on unsupported platforms; subprocess failures logged as debug warnings
- `--commit-adhd` flag commits `.adhd/contracts/`, `.adhd/feedback/`, `.adhd/progress.json`, `.adhd/spec.md` after each passing sprint with message `[adhd] Sprint N: contract + metadata`
- `--commit-adhd-logs` additionally commits `.adhd/logs/` and implies `--commit-adhd`
- `commitAdhdMetadata()` in `shared/orchestration/git-ops.ts` stages specific metadata paths, skips missing paths, and no-ops when nothing is staged
- Default behavior unchanged: no `[adhd]` metadata commits without explicit flags
- All new flags documented in `CLI_FLAG_HELP` and `--help` output

**Verified:** All 14 criteria passed (scores 7-10). Single attempt.

### Sprint 5 -- End-to-End Integration Validation

**Features:** Cross-feature integration testing, regression verification, README documentation

- Verified phantom sprint prevention: inline sprint references in prose, blockquotes, and acceptance criteria do not inflate sprint count
- Verified full resume cycle: contract reuse from disk, timestamped log preservation, `git reset --hard` with `.adhd/` stash/unstash
- Verified `--commit-adhd` and `--commit-adhd-logs` produce correct `[adhd]` commits with expected paths
- Verified notification dispatch: terminal bell at all HITL gates, desktop notifications only with `--notify`
- Verified progress status lifecycle: `planning → generating → evaluating → documenting → complete`
- Verified contract parse error diagnostics: diagnostic file written on failure, truncated console preview, no file on success
- Verified timestamp consistency across all log types with chronological ordering
- Verified clean working tree before every Generator invocation
- Updated README with `--notify`, `--commit-adhd`, `--commit-adhd-logs` documentation and configuration table
- Biome lint clean across all modified files
- SDK separation maintained: zero provider SDK imports in `shared/`

**Verified:** All 14 criteria passed (scores 7-10). 2 attempts.

## Phase 1.6: Observability Sharpening

Extends the existing cost tracking subsystem with per-model attribution: every recorded stage carries the resolved model name, the terminal summary gains a per-stage model column and a per-model rollup view, and the persisted `.adhd/usage.json` stores the model alongside tokens and cost. Backward-compatible with legacy usage logs.

### Sprint 1 -- Per-Model Usage Tracking

**Features:** `model` field on `StageUsage`, call-site wiring, per-stage model column, per-model rollup, JSON persistence with legacy compatibility

- Added required `model: string` field to `StageUsage` in `shared/types.ts`; `UsageTracker.recordStage` abstract interface gains a required `model` parameter (no optional/defaulted fallback in production paths)
- Wired `config.resolvedModel*` values from all seven Claude call sites: planner and planner-revision → `resolvedModelPlanner`; generator → `resolvedModelGenerator`; evaluator → `resolvedModelEvaluator`; documenter → `resolvedModelDocumenter`; contract-proposal → generator's model; contract-review → evaluator's model
- `formatStageTable` pure helper returns `string[]` with a left-aligned model column placed immediately after the stage name and before all numeric columns; numeric columns remain right-aligned
- `aggregateByModel` pure aggregator sums input tokens, output tokens, and cost per distinct model and returns `ModelRollupRow[]` sorted by total USD descending
- `formatModelRollup` pure helper renders the rollup section as `string[]`; section is always printed (even for single-model runs) so output shape is predictable
- `serializeStage` writes keys in spec-defined order: `stage`, `model`, `inputTokens`, `outputTokens`, `cacheReadTokens`, `costUsd`, `durationMs`
- `deserializeStage` defaults missing `model` field to `"unknown"` (exactly one place); next `save()` rewrites all legacy entries in new shape
- Malformed `usage.json` produces a meaningful "usage.json could not be parsed" message rather than a raw thrown parse error
- Unit tests cover: model field storage, per-stage formatting helper, rollup aggregator, rollup sort order, legacy-load without throw, save/load round-trip across three models, JSON key order
- `shared/` retains zero LLM-SDK imports; `bun run typecheck` and `bun run lint` exit clean

**Verified:** All 15 criteria passed (scores 7-10). 2 attempts.
