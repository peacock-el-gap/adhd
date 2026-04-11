# Changelog

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
