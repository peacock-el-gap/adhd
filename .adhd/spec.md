# Post-Run Documentation Agent (OPP-13-A / Roadmap Item 1.7)

## Product Overview

**What it does**: After all sprints pass in an ADHD harness run, a new "Documenter" agent automatically synthesizes the codebase and `.adhd/` artifacts (spec, contracts, evaluator feedback, BDD scenarios, git history) into polished project documentation: README, API docs, and CHANGELOG.

**Who it's for**: Developers using the ADHD harness who want their generated projects to ship with production-quality documentation, not just working code.

**Core value proposition**: The harness already generates rich structured knowledge during a run (spec, contracts, evaluation feedback, commit messages). Today, that knowledge evaporates. The Documenter agent turns it into lasting, human-readable project documentation with zero additional effort from the developer.

## Tech Stack

- **Language**: TypeScript (Bun runtime) -- matching the existing harness codebase
- **Agent SDK**: `@anthropic-ai/claude-agent-sdk` via the existing `query()` wrapper in `shared/tracing.ts`
- **Existing infrastructure reused**: conversation logger, usage tracker, tracing/spans, skills system, file I/O helpers
- **Source code directory**: `claude-harness/` and `shared/` (existing convention)
- **Test directory**: `tests/` (existing convention, using `bun test`)

## Design Language

Not applicable -- this is a CLI tool extension with no UI. The "design" is the structure and tone of the generated documentation:

- **README**: Clean, scannable, with sections for overview, setup, usage, architecture, and features
- **API docs**: Endpoint-per-section format (if applicable), with request/response examples
- **CHANGELOG**: Sprint-per-section, linking features to what was built and verified
- **Tone**: Professional, concise, developer-friendly -- not marketing copy, not LLM-verbose

## Feature List

### Feature 1: Documenter Agent Module

**User story**: As a harness operator, I want a Documenter agent that runs after all sprints pass so that my project gets professional documentation without manual effort.

**Description**: A new `documenter.ts` module in `claude-harness/` that follows the same architectural pattern as `evaluator.ts`. It receives the work directory and model config, constructs a system prompt and user prompt from `.adhd/` artifacts, calls `query()` with write access to the project (but read-only on `.adhd/`), and produces documentation files. The agent has access to Read, Write, Bash, Glob, and Grep tools -- the same toolset as the Generator, since it needs to write files.

**Sprint**: 1

**Acceptance Scenarios**:

- **Given** a Documenter agent module exists, **When** it is called with a valid workDir and model, **Then** it invokes `query()` with a well-formed system prompt and user prompt and returns a result object.
- **Given** the Documenter agent is invoked, **When** `query()` completes, **Then** the agent's conversation is logged to `.adhd/logs/` using the existing conversation logger (agent role: "documenter").
- **Given** the Documenter agent is invoked, **When** `query()` returns usage data, **Then** usage is recorded via the existing UsageTracker under a stage name like `"documenter"`.

### Feature 2: Documenter System Prompt

**User story**: As a harness operator, I want the Documenter to produce high-quality, accurate documentation that reflects what was actually built and verified.

**Description**: A `buildDocumenterPrompt()` function in `shared/prompts.ts` that constructs the system prompt for the Documenter agent. The prompt instructs the agent to: read the codebase, read `.adhd/` artifacts (spec, contracts, feedback), and produce a README.md at the project root (or `app/` for greenfield), an API documentation file if the project has API endpoints, and a CHANGELOG.md summarizing what was built per sprint. The prompt emphasizes accuracy (document what exists, not what was planned), proper setup instructions (derived from actually running the project), and conciseness.

**Sprint**: 1

**Acceptance Scenarios**:

- **Given** `buildDocumenterPrompt()` is called with a prompt context, **When** greenfield is true, **Then** the prompt references `app/` as the documentation target directory.
- **Given** `buildDocumenterPrompt()` is called, **When** greenfield is false, **Then** the prompt references the project root as the documentation target directory.
- **Given** `buildDocumenterPrompt()` is called with skills, **When** a documentation skill is provided, **Then** the skill content is appended to the prompt via the existing `appendSkills()` helper.

### Feature 3: Artifact Digest Construction

**User story**: As a harness operator, I want the Documenter to have full context about what was built and how it was evaluated, so the documentation is grounded in reality.

**Description**: Before invoking the Documenter agent, the harness assembles a structured digest of `.adhd/` artifacts to include in the user prompt. This digest includes: the full spec, all sprint contracts (from `.adhd/contracts/`), final evaluation feedback per sprint (from `.adhd/feedback/`), and the sprint results summary (pass/fail, attempts). The digest is size-bounded to avoid exceeding context limits -- contracts and feedback are summarized if the total exceeds a configurable token budget.

**Sprint**: 1

**Acceptance Scenarios**:

- **Given** a completed harness run with 3 sprints, **When** the artifact digest is constructed, **Then** it includes the spec content, all 3 sprint contracts, and the final passing feedback for each sprint.
- **Given** feedback files exist for multiple retry attempts per sprint, **When** the digest is constructed, **Then** only the final (passing) feedback per sprint is included, not intermediate failure feedback.
- **Given** the combined artifact content exceeds the token budget, **When** the digest is constructed, **Then** contracts and feedback are truncated with a note indicating truncation.

### Feature 4: Harness Orchestration Integration

**User story**: As a harness operator, I want the Documenter to run automatically after all sprints pass, with proper tracing, usage tracking, and error handling.

**Description**: The `runSprintLoop()` function in `harness.ts` is extended to call the Documenter agent after the sprint loop completes successfully (all sprints passed). The Documenter runs within its own tracing span (child of the harness span), records usage, and its success/failure does not affect the overall harness exit code -- documentation generation is best-effort. If the Documenter fails, a warning is logged but the run still reports success. The Documenter commit is handled the same way as Generator commits (three-tier enforcement).

**Sprint**: 2

**Acceptance Scenarios**:

- **Given** all sprints pass in a harness run, **When** the sprint loop completes, **Then** the Documenter agent is invoked automatically before the harness exits.
- **Given** the Documenter agent fails (throws an error), **When** the harness handles the error, **Then** a warning is logged, the harness still exits with success (exit code 0), and progress.json still shows status "complete".
- **Given** the Documenter agent runs, **When** tracing is enabled, **Then** a "documenter" span appears as a child of the harness span.
- **Given** the Documenter agent runs, **When** it completes, **Then** its cost is recorded in usage.json under a "documenter" stage.
- **Given** the harness is run with `--dry-run`, **When** planning completes, **Then** the Documenter is NOT invoked.
- **Given** some sprints fail, **When** the harness exits, **Then** the Documenter is NOT invoked.

### Feature 5: `--no-docs` CLI Flag

**User story**: As a harness operator, I want to skip documentation generation when I don't need it, to save time and cost.

**Description**: A new `--no-docs` CLI flag that disables the post-run Documenter agent. When set, the harness skips the documentation phase entirely. The flag is parsed in `config.ts`, stored in `HarnessConfig`, and checked before invoking the Documenter. Environment variable `ADHD_NO_DOCS=1` is also supported, following the existing precedence pattern (CLI > env > default).

**Sprint**: 2

**Acceptance Scenarios**:

- **Given** the `--no-docs` flag is passed, **When** all sprints pass, **Then** the Documenter agent is NOT invoked and no documentation-related log lines appear.
- **Given** `ADHD_NO_DOCS=1` is set in the environment, **When** all sprints pass, **Then** the Documenter agent is NOT invoked.
- **Given** neither `--no-docs` nor `ADHD_NO_DOCS` is set, **When** all sprints pass, **Then** the Documenter agent IS invoked (default behavior).

### Feature 6: Per-Agent Model Override for Documenter

**User story**: As a harness operator, I want to use a different (potentially cheaper) model for documentation generation than for code generation.

**Description**: A new `--model-documenter` CLI flag and corresponding `modelDocumenter` field in `HarnessConfig`. Follows the same pattern as existing `--model-planner`, `--model-generator`, `--model-evaluator` overrides. Falls back to the base `--model` if not specified. Environment variable `ADHD_MODEL_DOCUMENTER` is also supported.

**Sprint**: 2

**Acceptance Scenarios**:

- **Given** `--model-documenter claude-sonnet-4-20250514` is passed, **When** the Documenter runs, **Then** it uses `claude-sonnet-4-20250514` as the model, not the base model.
- **Given** no `--model-documenter` is specified, **When** the Documenter runs, **Then** it uses the base `--model` value.
- **Given** `ADHD_MODEL_DOCUMENTER` is set in the environment, **When** no CLI flag overrides it, **Then** the Documenter uses the environment variable's model.

### Feature 7: Documenter Git Commit

**User story**: As a harness operator, I want the documentation the Documenter writes to be committed to git, so it's part of the project history.

**Description**: After the Documenter agent completes, the harness ensures its changes are committed using the same three-tier commit enforcement as the Generator (check if agent committed, resume session if not, fallback auto-commit). The commit message is tagged distinctively (e.g., `[docs]` prefix) so it's distinguishable from feature commits in git history.

**Sprint**: 2

**Acceptance Scenarios**:

- **Given** the Documenter writes documentation files, **When** commit enforcement runs, **Then** all documentation changes are committed to git.
- **Given** the Documenter agent commits on its own, **When** the harness checks, **Then** `commitSource` is `"agent"` and no fallback commit is made.
- **Given** the Documenter agent does NOT commit, **When** fallback runs, **Then** an auto-commit is made with a message containing `[docs]`.

### Feature 8: Skills Integration for Documenter

**User story**: As a harness operator, I want to customize documentation output via the skills system, so I can inject project-specific templates or conventions.

**Description**: The Documenter agent participates in the existing skills system. Skills can target the "documenter" agent via their `skill.yaml` routing configuration (inject/reference/exclude). This enables project-local skills like a documentation template or style guide to influence the Documenter's output. The skill routing in `shared/skills.ts` is extended to recognize "documenter" as a valid agent target.

**Sprint**: 3

**Acceptance Scenarios**:

- **Given** a skill with `documenter: inject` in its routing, **When** the Documenter runs, **Then** the skill content is embedded in the Documenter's system prompt.
- **Given** a skill with `documenter: reference` in its routing, **When** the Documenter runs, **Then** the skill is listed as an available reference file.
- **Given** a skill with `documenter: exclude` in its routing, **When** the Documenter runs, **Then** the skill is not provided to the Documenter.
- **Given** no skills target the documenter, **When** the Documenter runs, **Then** it operates with its base system prompt only.

### Feature 9: Resume Compatibility

**User story**: As a harness operator, I want `--resume` to work correctly with the Documenter, so that if a run completed all sprints but the Documenter failed, I can re-run just the documentation phase.

**Description**: The progress tracking system is extended with a `docsGenerated` boolean field. On resume, if all sprints are complete but `docsGenerated` is false, the harness re-runs only the Documenter phase. If `docsGenerated` is true, the resume reports "nothing to do." This prevents re-running the entire sprint loop just to retry documentation.

**Sprint**: 3

**Acceptance Scenarios**:

- **Given** a completed run where the Documenter failed, **When** `--resume` is used, **Then** only the Documenter phase runs (no sprint loop).
- **Given** a completed run where the Documenter succeeded, **When** `--resume` is used, **Then** the harness reports "All sprints and documentation already completed."
- **Given** a partially completed run (some sprints remaining), **When** `--resume` is used, **Then** the normal sprint resume behavior occurs and the Documenter runs after all sprints pass.
- **Given** `progress.json` has `docsGenerated: true`, **When** `--resume` is used, **Then** the Documenter is NOT re-invoked.

### Feature 10: Documentation Quality Validation

**User story**: As a harness operator, I want basic validation that the Documenter actually produced useful documentation, not empty or placeholder files.

**Description**: After the Documenter completes, the harness performs lightweight validation: check that README.md exists and has meaningful content (more than a configurable minimum, e.g., 200 characters), check that CHANGELOG.md exists. If validation fails, log a warning but do not fail the run. This is a safety net, not a full evaluation -- the Documenter is trusted to produce quality output given good inputs.

**Sprint**: 3

**Acceptance Scenarios**:

- **Given** the Documenter creates a README.md with 500+ characters, **When** validation runs, **Then** it passes silently.
- **Given** the Documenter creates a README.md with fewer than 200 characters, **When** validation runs, **Then** a warning is logged: "Documentation may be incomplete: README.md is very short."
- **Given** the Documenter does NOT create a README.md, **When** validation runs, **Then** a warning is logged: "Documenter did not create README.md."
- **Given** validation fails, **When** the harness continues, **Then** the run still reports success (validation is advisory only).

## Sprint Plan

## Sprint 1

**Theme: Core Documenter Agent**

Build the foundational Documenter agent module, its system prompt, and the artifact digest mechanism. After this sprint, the Documenter can be called programmatically (but is not yet wired into the harness orchestration).

**Features**:
- Feature 1: Documenter Agent Module
- Feature 2: Documenter System Prompt
- Feature 3: Artifact Digest Construction

## Sprint 2

**Theme: Harness Integration**

Wire the Documenter into the harness orchestration loop, add the CLI flag to control it, support per-agent model override, and handle git commits for documentation.

**Features**:
- Feature 4: Harness Orchestration Integration
- Feature 5: `--no-docs` CLI Flag
- Feature 6: Per-Agent Model Override for Documenter
- Feature 7: Documenter Git Commit

## Sprint 3

**Theme: Polish and Resilience**

Add skills integration, resume compatibility, and output validation to make the Documenter a robust, customizable part of the harness.

**Features**:
- Feature 8: Skills Integration for Documenter
- Feature 9: Resume Compatibility
- Feature 10: Documentation Quality Validation
