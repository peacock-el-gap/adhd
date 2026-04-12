# ADHD Harness — Phase 1.5: Operational Hardening

## Product Overview

The ADHD harness is a GAN-inspired adversarial coding tool that uses four specialized agents (Planner, Generator, Evaluator, Documenter) to implement software features through sprint-based decomposition with adversarial validation. It is built for developers who want AI-assisted code generation with rigorous quality gates.

**Phase 1.5** focuses on operational hardening: fixing correctness bugs that cause phantom sprints, closing observability gaps that destroy forensic evidence, improving resume reliability, and adding developer experience improvements. These fixes were surfaced by dogfooding the harness against its own codebase.

**Core value proposition**: A trustworthy, debuggable harness where failures are visible, resume is reliable, and operational metadata is never silently lost.

## Tech Stack

- **Runtime**: Bun + TypeScript (ESNext, strict mode)
- **SDK**: Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`)
- **Tracing**: Langfuse via OpenTelemetry (`@langfuse/otel`, `@opentelemetry/sdk-node`)
- **Linting**: Biome
- **Testing**: Bun's built-in test runner (`bun test`)
- **Architecture**: `shared/` for SDK-independent orchestration, `harness-claude/` for Claude-specific implementations, connected via `AgentRunners` DI interface

### Project Structure

- Source code: `shared/` (orchestration, files, types, logger, etc.) and `harness-claude/` (Claude SDK implementations)
- Tests: `tests/`
- Entry point: `harness-claude/index.ts`
- Metadata directory: `.adhd/` (contracts, feedback, logs, progress, spec)

## Design Language

This is a CLI tool. "Design language" applies to terminal output, log formatting, and file naming conventions.

### Terminal Output
- **Colors**: Cyan (HARNESS), Magenta (PLANNER), Green (GENERATOR), Yellow (EVALUATOR), Blue (DOCUMENTER), Gray (TRACING), Red (errors)
- **Timestamps**: `HH:MM:SS` in configured timezone, prefix every log line
- **Dividers**: Visual separators between phases and sprints
- **Notifications**: Terminal bell (`\x07`) for attention-required moments; optional desktop notifications via `--notify`

### File Naming
- **Log files**: Timestamped prefix `YYYY.MM.DD-HH.MM.SS-` followed by descriptive name (e.g., `2026.04.12-14.30.00-sprint-3-attempt-0-generator.md`)
- **Contracts**: `sprint-N.json` in `.adhd/contracts/`
- **Feedback**: `sprint-N-round-M.json` in `.adhd/feedback/`
- **Diagnostic files**: `sprint-N-contract-parse-error.txt` in `.adhd/logs/`

### Commit Message Conventions
- `[adhd]` prefix for harness metadata commits
- `[auto-commit]` for fallback generator commits
- `[docs]` for documenter commits

## Feature List

### Feature: Sprint Counting Regex Fix
- **User story**: As a developer, I want the harness to correctly count sprints from my spec so that phantom sprints with no spec guidance are never executed.
- **Description**: The regex that counts `Sprint` headings matches inline prose references (e.g., sprint numbers mentioned in acceptance scenarios or quoted text). This inflates the sprint count, causing the harness to run phantom sprints where the Generator invents content. Fix by anchoring the regex to line start with `^` and multiline flag. Also update the spec-format skill to discourage heading-level sprint references in prose.
- **Sprint**: 1
- **Acceptance scenarios**:
  - **Scenario: Only line-start headings are counted**
    - Given a spec containing `Sprint 1`, `Sprint 2`, and prose text mentioning `Sprint 3` (even with markdown heading level 2 `##`) inside a blockquote or inline context
    - When the harness counts sprints from the spec
    - Then the total sprint count is 2
  - **Scenario: Standard multi-sprint spec**
    - Given a spec with four `Sprint N` headings (markdown level 2 `##`) each starting at column 1
    - When the harness counts sprints
    - Then the total sprint count is 4
  - **Scenario: Sprint references in acceptance criteria**
    - Given a spec where acceptance criteria text contains "builds on Sprint 1 features" or backtick-quoted sprint references
    - When the harness counts sprints
    - Then those inline references are not counted as sprint headings

### Feature: Timestamp Log Filenames
- **User story**: As a developer debugging a failed run, I want log files to have timestamp prefixes so that resume and retry cycles do not overwrite previous logs and I can reconstruct the chronological sequence of events.
- **Description**: Add `YYYY.MM.DD-HH.MM.SS` timestamp prefix to all conversation log filenames. Prevents overwrites on resume/retry, guarantees chronological ordering in `ls`, and enables forensic analysis. Align Langfuse trace span names to the same timestamped format for cross-referencing.
- **Sprint**: 1
- **Acceptance scenarios**:
  - **Scenario: Log files include timestamps**
    - Given the generator runs for sprint 2, attempt 0
    - When the conversation log is finalized
    - Then the filename matches the pattern `YYYY.MM.DD-HH.MM.SS-sprint-2-attempt-0-generator.md`
  - **Scenario: Resume does not overwrite prior logs**
    - Given a prior run created `2026.04.12-10.00.00-sprint-2-attempt-0-generator.md`
    - When the harness resumes and re-runs sprint 2
    - Then a new log file is created with a different timestamp prefix and the original file remains intact
  - **Scenario: Contract negotiation logs are timestamped**
    - Given contract negotiation runs for sprint 3
    - When the conversation log is finalized
    - Then the filename matches `YYYY.MM.DD-HH.MM.SS-sprint-3-contract-negotiation.md`

### Feature: Resume Contract Skip
- **User story**: As a developer resuming a run, I want the harness to reuse existing sprint contracts instead of re-negotiating them, saving time and LLM cost.
- **Description**: On `--resume`, before negotiating a contract for sprint N, check if `.adhd/contracts/sprint-N.json` already exists on disk. If it does, load and reuse it (same logic as `--sprint N` mode). Only negotiate if no contract file exists.
- **Sprint**: 2
- **Acceptance scenarios**:
  - **Scenario: Existing contract is reused on resume**
    - Given a prior run wrote `.adhd/contracts/sprint-3.json` before being interrupted
    - When the harness resumes with `--resume` and reaches sprint 3
    - Then the existing contract is loaded from disk without invoking contract negotiation agents
  - **Scenario: Missing contract triggers negotiation on resume**
    - Given a prior run was interrupted before writing `.adhd/contracts/sprint-3.json`
    - When the harness resumes with `--resume` and reaches sprint 3
    - Then contract negotiation runs normally
  - **Scenario: Loaded contract is logged**
    - Given an existing contract for sprint 2 exists on disk
    - When the harness loads it during resume
    - Then a log message indicates the contract was loaded from disk with its criteria count

### Feature: Contract Parse Error Logging
- **User story**: As a developer, I want to see diagnostic output when contract JSON parsing fails so that I can understand why a sprint ran against meaningless default criteria.
- **Description**: When `parseContract` fails to extract valid JSON from the evaluator's contract review response, log the raw unparseable text to the console (truncated to a reasonable length) and write the full text to `.adhd/logs/sprint-N-contract-parse-error.txt`. This provides forensic evidence instead of silent fallback to generic criteria.
- **Sprint**: 2
- **Acceptance scenarios**:
  - **Scenario: Parse failure writes diagnostic file**
    - Given the evaluator returns a contract review response that contains no valid JSON
    - When `parseContract` falls back to the default contract
    - Then a file `.adhd/logs/sprint-N-contract-parse-error.txt` is created containing the full raw text
  - **Scenario: Parse failure logs truncated text to console**
    - Given the evaluator returns unparseable text of 2000 characters
    - When `parseContract` falls back to the default contract
    - Then a warning is logged to the console containing a truncated preview of the raw text
  - **Scenario: Successful parse does not create diagnostic file**
    - Given the evaluator returns valid contract JSON
    - When `parseContract` successfully extracts the contract
    - Then no diagnostic file is created

### Feature: `.adhd/` Artifact Commits and Deterministic Revert
- **User story**: As a developer, I want the harness to commit `.adhd/` artifacts before invoking the Generator so that the working tree is clean and checkpoint rollback is deterministic.
- **Description**: Two connected improvements. First: commit `.adhd/` artifacts (contracts, progress, feedback) with a `[adhd]` commit message before each Generator invocation, ensuring the Generator starts with a clean working tree. Second: replace `git revert --no-commit` in `revertToCheckpoint` with `git reset --hard <sha>` plus stash/unstash of `.adhd/` files. This eliminates the dirty-tree revert failure mode.
- **Sprint**: 3
- **Acceptance scenarios**:
  - **Scenario: Artifacts committed before Generator**
    - Given the harness has written a contract to `.adhd/contracts/sprint-2.json`
    - When the Generator is about to be invoked for sprint 2
    - Then `.adhd/` files are committed with a `[adhd]` prefix commit message before the Generator runs
  - **Scenario: Checkpoint revert uses reset**
    - Given the harness needs to revert to a checkpoint SHA during resume
    - When `revertToCheckpoint` executes
    - Then `git reset --hard` is used instead of `git revert --no-commit`
  - **Scenario: `.adhd/` files survive revert**
    - Given the harness has written `.adhd/progress.json` and `.adhd/contracts/sprint-3.json` after the checkpoint
    - When `revertToCheckpoint` resets to the checkpoint SHA
    - Then `.adhd/progress.json` and `.adhd/contracts/sprint-3.json` are preserved (stashed and restored)
  - **Scenario: Clean working tree for Generator**
    - Given `.adhd/` artifacts have been committed
    - When the Generator starts its session
    - Then `git status --porcelain` shows no uncommitted `.adhd/` files

### Feature: Progress "documenting" Status
- **User story**: As a developer monitoring a run, I want `progress.json` to show `"documenting"` status while the Documenter agent runs so that the progress file accurately reflects what the harness is doing.
- **Description**: Add `"documenting"` to the `HarnessProgress.status` union type. Set status to `"documenting"` before the Documenter agent starts. Set to `"complete"` only after the Documenter finishes (or is skipped).
- **Sprint**: 3
- **Acceptance scenarios**:
  - **Scenario: Status is "documenting" during documentation**
    - Given all sprints have passed
    - When the Documenter agent is invoked
    - Then `progress.json` contains `"status": "documenting"` before the Documenter completes
  - **Scenario: Status transitions to "complete" after documentation**
    - Given the Documenter agent finishes successfully
    - When the final progress is written
    - Then `progress.json` contains `"status": "complete"`
  - **Scenario: Status type includes "documenting"**
    - Given the `HarnessProgress` type definition
    - When the type is inspected
    - Then `"documenting"` is a valid value in the status union

### Feature: HITL Notifications
- **User story**: As a developer who steps away during long harness runs, I want terminal bell and optional desktop notifications at interactive gates so that I don't miss time-sensitive decisions.
- **Description**: Add terminal bell character (`\x07`) output at all HITL gates and error conditions. Add a `--notify` CLI flag that sends desktop notifications via `notify-send` (Linux) or `osascript` (macOS) when the terminal may be backgrounded.
- **Sprint**: 4
- **Acceptance scenarios**:
  - **Scenario: Terminal bell on HITL gate**
    - Given the harness reaches the spec approval gate
    - When the gate prompt is displayed
    - Then a terminal bell character (`\x07`) is written to stdout
  - **Scenario: Desktop notification with --notify flag**
    - Given the harness is run with `--notify`
    - When a HITL gate activates
    - Then a desktop notification is sent using the platform-appropriate command
  - **Scenario: No desktop notification without --notify**
    - Given the harness is run without `--notify`
    - When a HITL gate activates
    - Then no desktop notification command is executed (only terminal bell)
  - **Scenario: Notification on error conditions**
    - Given the harness encounters a fatal error
    - When the error is displayed
    - Then a terminal bell is emitted

### Feature: `--commit-adhd` and `--commit-adhd-logs` Flags
- **User story**: As a developer, I want an opt-in way to version-control `.adhd/` artifacts in git so that I have a structured audit trail of contracts, progress, and feedback across sprints.
- **Description**: Add `--commit-adhd` flag that commits `.adhd/contracts/`, `.adhd/feedback/`, `.adhd/progress.json`, and `.adhd/spec.md` after each sprint with message `[adhd] Sprint N: contract + metadata`. Add `--commit-adhd-logs` flag that additionally commits `.adhd/logs/` (implies `--commit-adhd`). Both are opt-in; the default behavior (no commits) is unchanged.
- **Sprint**: 4
- **Acceptance scenarios**:
  - **Scenario: --commit-adhd commits metadata after sprint**
    - Given the harness is run with `--commit-adhd`
    - When sprint 2 passes evaluation
    - Then a git commit is created containing `.adhd/contracts/`, `.adhd/feedback/`, `.adhd/progress.json`, and `.adhd/spec.md` with message `[adhd] Sprint 2: contract + metadata`
  - **Scenario: --commit-adhd-logs includes logs**
    - Given the harness is run with `--commit-adhd-logs`
    - When sprint 2 passes evaluation
    - Then the commit also includes `.adhd/logs/` files
  - **Scenario: --commit-adhd-logs implies --commit-adhd**
    - Given the harness is run with `--commit-adhd-logs` but without `--commit-adhd`
    - When the config is resolved
    - Then `commitAdhd` is true
  - **Scenario: Default behavior unchanged**
    - Given the harness is run without `--commit-adhd`
    - When sprints complete
    - Then no `[adhd]` commits are created for metadata files

## Sprint Plan

## Sprint 1

**Theme: Fix Critical Correctness Bug and Log Preservation**

The highest-ROI fixes: eliminate phantom sprints caused by the regex false-positive bug, and prevent log file overwrites that destroy forensic evidence.

Features:
- Sprint Counting Regex Fix
- Timestamp Log Filenames

## Sprint 2

**Theme: Resume Reliability and Parse Error Observability**

Make resume workflows faster and cheaper by skipping redundant contract negotiation, and surface contract parse failures instead of silently falling back to meaningless defaults.

Features:
- Resume Contract Skip
- Contract Parse Error Logging

## Sprint 3

**Theme: Clean Working Tree and Deterministic Rollback**

The largest single change: commit `.adhd/` artifacts before Generator invocation and replace the fragile `git revert` mechanism with `git reset --hard` plus stash/unstash. Also add the `"documenting"` progress status.

Features:
- `.adhd/` Artifact Commits and Deterministic Revert
- Progress "documenting" Status

## Sprint 4

**Theme: Developer Experience**

Quality-of-life improvements: notifications for HITL gates and opt-in git commits for `.adhd/` artifacts.

Features:
- HITL Notifications
- `--commit-adhd` / `--commit-adhd-logs` Flags
