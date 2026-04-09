# ADHD Harness — Phase 1: Deepen (Smarter Within Existing Architecture)

## Product Overview

The ADHD harness is a GAN-inspired adversarial coding tool that decomposes software projects into sprints, generates code via an LLM Generator agent, and validates it via a separate LLM Evaluator agent. This phase deepens the harness's quality, reliability, and developer experience without changing its fundamental four-agent architecture (Planner, Generator, Evaluator, Documenter).

**Who it's for**: Developers using the ADHD harness to generate production-quality software projects via AI agents.

**Scope**: This spec targets the Claude harness (`claude-harness/`) and shared infrastructure (`shared/`). The Codex harness (`codex-harness/`) is frozen and out of scope.

**Core value proposition**: Phase 1 closes the highest-impact quality gaps — cross-sprint behavioral regression, wasted evaluation turns on trivial failures, imprecise retry feedback, code quality blindness — and adds key DX improvements (sprint selection, adaptive specs) that make the harness dramatically more effective on multi-sprint projects.

## Tech Stack

- **Runtime**: Bun (TypeScript)
- **LLM SDK**: @anthropic-ai/claude-agent-sdk
- **Testing**: Bun's built-in test runner (`bun test`)
- **Linting**: Biome
- **Observability**: Langfuse OTEL tracing (optional)
- **Data format**: JSON for contracts, feedback, progress; Markdown for specs and docs

## Design Language

This is a CLI tool with no visual UI. Design language applies to terminal output and data formats:

- **Color palette**: Green for PASS/success, Red for FAIL/errors, Yellow for warnings/gates, Cyan for info headers, White for body text. ANSI escape codes only.
- **Typography**: Monospace terminal output. Section dividers via `===` lines. Log prefix tags in brackets: `[HARNESS]`, `[GENERATOR]`, `[EVALUATOR]`.
- **Spacing**: One blank line between log sections. Divider lines between phases. Indented sub-items with 2 spaces.
- **Data contracts**: All inter-agent communication via JSON files in `.adhd/`. Human-readable with `null, 2` formatting. Contracts, feedback, and progress files are the canonical data exchange format.
- **Overall identity**: Professional, terse, information-dense. No emoji in logs. Timestamps optional (controlled by TZ_DISPLAY).

## Existing Project Structure

- **Source code**: `claude-harness/` (main harness), `shared/` (shared utilities, prompts, types), `codex-harness/` (alternative harness)
- **Tests**: `shared/*.test.ts` and `claude-harness/*.test.ts` (Bun test files colocated with source)
- **Config**: `package.json`, `tsconfig.json`, `biome.json`
- **Key files**:
  - `shared/types.ts` — Core type definitions (HarnessConfig, SprintContract, SprintCriterion, EvalResult, etc.)
  - `shared/prompts.ts` — System prompts for all agents, contract negotiation prompts
  - `shared/config.ts` — CLI parsing, config resolution
  - `shared/files.ts` — All .adhd/ file I/O (contracts, feedback, progress, spec)
  - `claude-harness/harness.ts` — Main orchestration loop (sprint loop, contract negotiation, retry logic)
  - `claude-harness/evaluator.ts` — Evaluator agent invocation
  - `claude-harness/generator.ts` — Generator agent invocation
  - `claude-harness/planner.ts` — Planner agent invocation
  - `claude-harness/documenter.ts` — Documenter agent invocation
  - `shared/skills.ts` — Skills resolution, routing, and injection

## Feature List

### Feature 1.1: BDD Regression Accumulation Across Sprints

**User Story**: As a developer, I want the Evaluator to check all behavioral criteria from previous sprints — not just the current sprint's — so that regressions in previously-passing behavior are caught immediately.

**Description**: After each sprint passes, its behavioral contract criteria are added to a cumulative regression set. When evaluating subsequent sprints, the Evaluator receives both the current sprint's contract AND all accumulated behavioral criteria from previous sprints. A new `type` field on criteria (`"behavioral"` vs `"implementation"`) controls which criteria accumulate. The contract negotiation prompts instruct the Generator/Evaluator to classify each criterion. The Evaluator must pass ALL current criteria AND all accumulated behavioral regression criteria for the sprint to pass.

**Sprint**: 1

**Acceptance Scenarios**:

- **Given** a contract criterion has `"type": "behavioral"`, **When** its sprint passes, **Then** the criterion is added to the accumulated regression set stored in `.adhd/regression.json`.
- **Given** accumulated regression criteria exist from sprints 1 and 2, **When** sprint 3 is evaluated, **Then** the Evaluator's prompt includes all accumulated behavioral criteria alongside sprint 3's own contract criteria.
- **Given** a criterion has `"type": "implementation"` (or no type field), **When** its sprint passes, **Then** it is NOT added to the regression set.
- **Given** the `--no-bdd` flag is set, **When** a sprint is evaluated, **Then** regression accumulation is skipped entirely (no regression criteria injected).
- **Given** the contract negotiation prompt, **When** the Generator proposes criteria, **Then** each criterion includes a `"type"` field set to either `"behavioral"` or `"implementation"`.

---

### Feature 1.2: Static Analysis Soft Gate

**User Story**: As a developer, I want lint and type-check results automatically injected into the Evaluator's context so that trivial code quality issues are surfaced without wasting a full evaluation turn.

**Description**: Between the Generator's output and the Evaluator's invocation, the harness detects and runs the project's lint/typecheck commands (from package.json scripts, common conventions, or a configurable override). The results are injected as supplementary context into the Evaluator's prompt. This is a "soft gate" — lint failures don't consume a retry attempt; they enrich the Evaluator's signal. An opt-in `--lint-gate` flag enables "hard gate" mode where lint failure skips the Evaluator and counts as a failed attempt directly.

**Sprint**: 1

**Acceptance Scenarios**:

- **Given** a project with a `lint` script in package.json, **When** the Generator completes and before the Evaluator runs, **Then** the harness executes the lint command and injects its stdout/stderr into the Evaluator's prompt under a "## Static Analysis Results" section.
- **Given** a project with a `typecheck` script in package.json, **When** the Generator completes, **Then** the harness executes the typecheck command and includes the results alongside lint output in the Evaluator context.
- **Given** no lint or typecheck commands are detected, **When** the Generator completes, **Then** the Evaluator runs normally with no static analysis section (no error, graceful skip).
- **Given** the `--lint-gate` flag is set and lint fails, **When** the harness would normally invoke the Evaluator, **Then** the Evaluator is skipped, the attempt is marked as failed, and lint output is injected as feedback for the Generator's retry.
- **Given** static analysis output exceeds 4K characters, **When** injecting into the Evaluator prompt, **Then** the output is truncated with a warning message indicating truncation.

---

### Feature 1.3: Diff-Aware Evaluation on Retries

**User Story**: As a developer, I want the Evaluator to see what changed between retry attempts so that feedback is sharper and focused on the Generator's recent modifications.

**Description**: On retry attempts (attempt > 0), the harness computes `git diff` between the previous attempt's commit and the current HEAD. This diff is injected into the Evaluator's prompt as supplementary context. The Evaluator still checks all criteria but can use the diff to focus feedback. Diff output is capped at a configurable token budget (default 8K characters) with truncation warning.

**Sprint**: 2

**Acceptance Scenarios**:

- **Given** a sprint is on retry attempt 1 and the Generator has committed new changes, **When** the Evaluator is invoked, **Then** a `git diff <previous-sha>..<current-sha>` is included in the Evaluator's prompt under a "## Changes Since Last Attempt" section.
- **Given** a sprint is on attempt 0 (first attempt), **When** the Evaluator is invoked, **Then** no diff section is included in the prompt.
- **Given** the diff output exceeds 8K characters, **When** injecting into the Evaluator prompt, **Then** the output is truncated and a warning like "[diff truncated — showing first 8000 chars of N total]" is appended.
- **Given** `git diff` fails (no git repo, no previous SHA), **When** the harness tries to compute the diff, **Then** evaluation proceeds normally without the diff section (graceful degradation).

---

### Feature 1.4: Quality Criteria in Contracts

**User Story**: As a developer, I want sprint contracts to include code quality criteria (naming, duplication, complexity) alongside behavioral criteria so that the Evaluator assesses craft, not just functionality.

**Description**: The contract negotiation prompts are extended to instruct the Generator to include quality-focused criteria covering naming conventions, code duplication, error handling patterns, and maintainability. These are tagged with `"type": "implementation"` so they don't accumulate across sprints (only behavioral criteria accumulate per Feature 1.1). The Evaluator prompt is updated to assess these quality criteria with the same rigor as functional ones.

**Sprint**: 2

**Acceptance Scenarios**:

- **Given** the contract negotiation Generator prompt, **When** it instructs criteria generation, **Then** it explicitly requests criteria covering naming, duplication, error handling, and maintainability in addition to functional criteria.
- **Given** a proposed contract, **When** the Evaluator reviews it during negotiation, **Then** it checks that at least one quality-focused criterion is present and rejects contracts that are purely functional.
- **Given** a quality criterion like "Consistent naming conventions", **When** it is classified, **Then** its `"type"` field is `"implementation"` (not `"behavioral"`).
- **Given** a contract with quality criteria, **When** the Evaluator scores the sprint, **Then** quality criteria are scored with the same threshold and rigor as behavioral criteria.

---

### Feature 1.5: Sprint Selection (`--sprint N`)

**User Story**: As a developer, I want to re-run a specific sprint without running all previous sprints so that I can iterate quickly on a single sprint that needs attention.

**Description**: A new `--sprint N` CLI flag allows targeting a specific sprint. The harness loads the existing spec from `.adhd/spec.md`, skips all sprints before N, and runs the build-evaluate loop for sprint N only. If a contract for sprint N already exists, it is reused; otherwise, contract negotiation runs for sprint N. The flag requires an existing spec (errors if none found). A warning is emitted if no checkpoint exists for sprint N-1.

**Sprint**: 3

**Acceptance Scenarios**:

- **Given** a spec exists in `.adhd/spec.md` and `--sprint 3` is passed, **When** the harness starts, **Then** sprints 1 and 2 are skipped entirely and the build-evaluate loop runs for sprint 3 only.
- **Given** `--sprint 3` is passed and `.adhd/contracts/sprint-3.json` exists, **When** the sprint begins, **Then** the existing contract is loaded and contract negotiation is skipped.
- **Given** `--sprint 3` is passed and no contract exists for sprint 3, **When** the sprint begins, **Then** contract negotiation runs for sprint 3.
- **Given** `--sprint 3` is passed but no `.adhd/spec.md` exists, **When** the harness starts, **Then** it exits with a clear error message: "No spec found. Run the planner first or provide a spec."
- **Given** `--sprint 3` is passed but no checkpoint exists for sprint 2, **When** the harness starts, **Then** a warning is logged: "No checkpoint for sprint 2. Ensure the codebase is in the expected state." but execution proceeds.
- **Given** `--sprint N` and `--resume` are both passed, **When** parsing CLI flags, **Then** the harness errors with "Cannot use --sprint and --resume together."

---

### Feature 1.6: Progressive Spec Refinement (Guarded)

**User Story**: As a developer, I want the spec to adapt after each sprint based on what was actually built, so that remaining sprints stay aligned with reality instead of following assumptions that proved wrong.

**Description**: After each passing sprint (before the next sprint begins), the Planner re-reads the current spec and the actual codebase state, then proposes adjustments to not-yet-started sprints. Completed sprints are frozen and cannot be modified. Changes are shown to the user via a gate (similar to spec approval) before being applied. A diff of the spec changes is logged. Accumulated BDD regression criteria from completed sprints remain unchanged regardless of spec edits. This feature is opt-in via `--refine-spec` flag.

**Sprint**: 4

**Acceptance Scenarios**:

- **Given** `--refine-spec` is set and sprint 2 of 5 just passed, **When** the harness transitions to sprint 3, **Then** the Planner is invoked with the current spec and codebase to propose spec adjustments for sprints 3-5.
- **Given** the Planner proposes spec changes, **When** the refinement gate is shown, **Then** the user sees a diff of changes and can Accept, Reject, or Edit the revised spec.
- **Given** the Planner proposes changes, **When** the changes modify content under "## Sprint 1" or "## Sprint 2" (already completed), **Then** those changes are rejected/stripped and only changes to sprints 3+ are applied.
- **Given** `--refine-spec` is NOT set, **When** any sprint passes, **Then** no Planner re-invocation occurs (existing behavior preserved).
- **Given** spec refinement occurs after sprint 2, **When** the accumulated BDD regression criteria from sprints 1-2 are checked, **Then** they remain unchanged regardless of what the spec refinement modified.
- **Given** `--refine-spec` and `--no-interactive` are both set, **When** the Planner proposes changes, **Then** changes are auto-accepted (no gate shown) but the diff is still logged.
- **Given** spec refinement adds a new sprint (e.g., sprint 6), **When** the sprint count is recalculated, **Then** the new total is capped by `--max-sprints` and the loop continues with the updated count.

---

## Sprint Plan

## Sprint 1

**Theme: Regression Detection & Static Analysis Foundation**

Build the two features that improve evaluation quality from day one: BDD regression accumulation prevents cross-sprint behavioral breakage, and static analysis injection gives the Evaluator richer signal for free.

**Features**:
- Feature 1.1: BDD Regression Accumulation Across Sprints
- Feature 1.2: Static Analysis Soft Gate

**Key deliverables**:
- New `type` field on `SprintCriterion` interface (`"behavioral" | "implementation"`)
- Updated contract negotiation prompts to classify criteria by type
- Regression accumulation logic: read previous contracts, filter behavioral criteria, write `.adhd/regression.json`
- Regression criteria injection into Evaluator prompt
- Static analysis command detection (package.json scripts, conventions)
- Static analysis execution and result injection into Evaluator prompt
- `--lint-gate` CLI flag and hard-gate mode
- Tests for regression accumulation, static analysis detection, and prompt injection

## Sprint 2

**Theme: Sharper Feedback & Quality Awareness**

Improve evaluation precision on retries via diff-aware context, and extend contracts to cover code quality — not just functionality.

**Features**:
- Feature 1.3: Diff-Aware Evaluation on Retries
- Feature 1.4: Quality Criteria in Contracts

**Key deliverables**:
- Git diff computation between retry attempts (SHA tracking per attempt)
- Diff injection into Evaluator prompt with truncation
- Extended contract negotiation prompts for quality criteria
- Updated Evaluator negotiation prompt to enforce quality criteria presence
- Tests for diff computation, truncation, and quality criteria negotiation

## Sprint 3

**Theme: Developer Experience — Targeted Sprint Execution**

Add the ability to target a specific sprint for re-execution, dramatically reducing iteration time during development.

**Features**:
- Feature 1.5: Sprint Selection (`--sprint N`)

**Key deliverables**:
- New `--sprint` CLI flag with validation
- Sprint-specific entry path in harness orchestration (skip planning, load existing spec/contracts)
- Contract reuse vs fresh negotiation logic
- Mutual exclusion with `--resume`
- Warning for missing prior checkpoints
- Tests for CLI parsing, sprint selection logic, and edge cases

## Sprint 4

**Theme: Adaptive Specifications**

Enable the spec to evolve after each sprint while maintaining behavioral guarantees through accumulated regression criteria.

**Features**:
- Feature 1.6: Progressive Spec Refinement (Guarded)

**Key deliverables**:
- `--refine-spec` CLI flag
- Post-sprint Planner re-invocation with codebase context
- Completed sprint freezing logic (prevent edits to past sprints)
- Spec diff computation and display
- User gate for refinement approval
- Integration with regression accumulation (frozen behavioral criteria)
- Auto-accept mode for non-interactive runs
- Sprint count recalculation after refinement
- Tests for spec freezing, diff computation, gate behavior, and regression criteria preservation
