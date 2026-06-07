# Adversarial Development Harness for Delivery (ADHD)

A four-agent harness that separates **planning**, **building**, **evaluation**, and **documentation** into distinct AI agents. The evaluator's job is to **break** what the generator builds — creating adversarial tension that drives quality beyond what a single agent achieves.

| Agent | Role | Analogy |
|-------|------|---------|
| **Planner** | Expands a short prompt into a full product spec with sprints | Product manager |
| **Generator** | Builds one feature at a time, commits to git | Software engineer |
| **Evaluator** | Actively tries to break what the generator built, scores ruthlessly | Adversarial QA |
| **Documenter** | Generates project documentation after all sprints pass | Technical writer |
| **Scout** (optional) | Reads codebase idioms before the sprint loop; guides the Generator | Code analyst |
| **Reviewer** (optional) | Reviews code craft after each passing sprint; advisory only | Code reviewer |

Based on Anthropic's [Harness Design for Long-Running Application Development](https://www.anthropic.com/engineering/harness-design-long-running-apps). Originally forked from [coleam00/adversarial-dev](https://github.com/coleam00/adversarial-dev) by Cole Medin — the initial architecture, three-agent design, and adversarial evaluation loop originate from that project.

## Install

### Prerequisites

- [Bun](https://bun.sh) runtime
- Claude CLI authenticated (`claude auth login`)

### Setup

```bash
git clone https://github.com/peacock-el-gap/adhd
cd adhd
bun install
bun link        # Makes 'adhd' available as a global command
```

After `bun link`, you can run `adhd` from any directory — it operates on the current directory by default.

> **Alternative:** If you prefer not to use `bun link`, you can create a shell alias:
> ```bash
> alias adhd='bun run /path/to/adhd/harness-claude/index.ts'
> ```
> Or run directly from the ADHD harness directory with `bun run start -- [flags]`.

## Core Usage

| I want to... | Command |
|---|---|
| Enhance my project with a prompt | `adhd "Add auth with JWT"` |
| Enhance my project with a spec file | `adhd --file changes.md` |
| Build a new project from a prompt | `adhd --greenfield "Build a task manager"` |
| Build a new project from a spec file | `adhd --greenfield --file spec.md` |
| Resume after interruption | `adhd --resume` |
| Re-run a specific sprint | `adhd --sprint 3` |
| Preview the plan without building | `adhd --dry-run "Add auth with JWT"` |
| Provide reference docs to the planner | `adhd --context api-spec.yaml "Implement the API"` |

All commands below assume you're in the project directory. Use `--project <path>` to target a different directory without cd-ing.

### Enhance an Existing Project

Go to your project directory and run the harness. It reads your codebase, makes changes in place, and stores metadata in `.adhd/`.

```bash
cd ~/my-app

# With an inline prompt:
adhd "Add authentication with JWT tokens and role-based access control"

# With a spec file (for complex changes):
adhd --file changes.md
```

The planner may ask clarifying questions in the terminal (60-second timeout). Use `--no-interactive` to skip this — the planner will make its best judgment and document assumptions.

**Branch safety (new in Phase 2):** By default, the harness creates a dedicated topic branch (`adhd/<slug>-<timestamp>`) before the sprint loop, so all commits land there — never on `main`. Use `--allow-main` if you genuinely want the harness to run on your current branch.

### Build a New Project

Create a project directory, then run with `--greenfield`. The harness creates an `app/` subdirectory (with its own git repo) for the generated code, and `.adhd/` for metadata.

```bash
mkdir ~/projects/my-new-app
cd ~/projects/my-new-app

# With an inline prompt:
adhd --greenfield "Build a personal task manager with REST API, dashboard, and search"

# With a spec file:
adhd --greenfield --file spec.md
```

### Resume After Interruption

The harness checkpoints after each passing sprint. If interrupted (rate limit, crash, manual stop), resume where you left off:

```bash
cd ~/my-app
adhd --resume
```

If a topic branch was created, `--resume` automatically switches back to it.

### Sprint Selection

Re-run a specific sprint without running all previous sprints. Requires an existing spec in `.adhd/spec.md`:

```bash
# Re-run sprint 3 only
adhd --sprint 3
```

If a contract for the target sprint already exists in `.adhd/contracts/`, it is reused. Otherwise, contract negotiation runs fresh.

### Dry Run

Preview the planner's spec without building anything:

```bash
adhd --dry-run "Add authentication with JWT tokens"
```

The planner generates a spec, the spec approval gate runs (if interactive), and then the harness exits. The spec is saved to `.adhd/spec.md`.

### Context Injection

Provide reference documents (API specs, design docs, existing schemas) to the planner:

```bash
adhd --context api-spec.yaml --context design.md "Implement the REST API"
```

The `--context` flag is repeatable. Each file's contents are injected into the planner's prompt as reference material.

## Advanced Configuration

### Model Selection

By default, the harness uses a cost-optimized per-agent model matrix: Planner and Evaluator use Opus (stronger judgment), Generator uses Sonnet (lower cost), Documenter uses Haiku (advisory). Choose different models:

```bash
# Use a single model for all agents
adhd --model claude-opus-4-8 "Add auth"

# Override individual agents
adhd --model-generator claude-opus-4-8 --model-evaluator claude-opus-4-8 "Add auth"

# Override contract negotiation separately
adhd --model-contract claude-opus-4-8 "Add auth"

# Override the optional Reviewer agent
adhd --review --model-reviewer claude-opus-4-8 "Add auth"
```

Precedence: per-agent flag > uniform `--model` > per-agent default tier.

If a uniform model override puts all agents above the default tier, an advisory warning is printed at startup.

### Turn Caps per Agent

Control how many turns (back-and-forth interactions) each agent may take:

```bash
# Limit the Generator to 25 turns (default: 50 for all agents)
adhd --generator-max-turns 25 "Add auth"

# Limit each agent independently
adhd --planner-max-turns 40 --generator-max-turns 25 --evaluator-max-turns 40 "Add auth"
```

Available flags: `--planner-max-turns`, `--generator-max-turns`, `--evaluator-max-turns`, `--documenter-max-turns`. All default to 50. Invalid values degrade to defaults with a warning.

### Static Analysis / Lint Gate

The harness automatically detects `lint`, `typecheck`, and `type-check` scripts in your project's `package.json` and runs them after the generator completes. Results are injected into the evaluator's context as soft feedback.

Enable hard gate mode to make lint/typecheck failures skip the evaluator and count as failed attempts:

```bash
adhd --lint-gate "Add auth"
```

### Test Gate

By default, test results are injected into the evaluator's context as soft feedback. Enable a hard test gate to skip evaluation when new test failures are introduced:

```bash
adhd --test-gate "Add auth"
```

The harness captures which tests were failing before the generator ran (the "known-failing baseline"), then compares post-generation results against it. Only newly-introduced failures trigger the gate.

### Progressive Spec Refinement

After each passing sprint, have the planner re-evaluate and adjust the spec for remaining sprints based on what was actually built:

```bash
adhd --refine-spec "Build a dashboard with analytics"
```

In interactive mode, you review a diff of proposed changes and can accept or reject them. Completed sprint sections are frozen and cannot be modified. The harness injects a codebase map into the refinement planner's context so it doesn't need to re-explore the code.

### Tool & MCP Governance

By default, coding agents (Generator, Evaluator, Documenter) receive full MCP and tool access. Non-coding agents (Planner, contract negotiation) receive only essential tools and no MCP.

Disable MCP entirely (useful for testing or sandboxing):

```bash
adhd --disable-mcp "Add auth"
```

Or inject specific MCP servers into coding agents:

```bash
adhd --mcp-servers '{"filesystem":{"command":"node","args":["fs-server.js"]}}' "Add auth"
```

### Cost Tracking & Guardrails

The harness prints a per-stage cost summary after each run and saves cumulative usage to `.adhd/usage.json`. This tracks input/output tokens and USD cost per model and per agent.

Optionally set a per-sprint token ceiling:

```bash
# Warn at 80% of budget; pause (interactive) or log (non-interactive) at 100%
adhd --sprint-token-budget 100000 "Add auth"
```

When a budget is set:
- **At 80%**: A soft warning is logged; the run continues.
- **At 100% (interactive)**: The harness pauses and asks you to extend the budget or abort the sprint.
- **At 100% (non-interactive)**: A warning is logged and the run auto-continues.

### Scout: Codebase Conventions (Phase 2)

Optionally run a read-only Scout pass before the sprint loop to surface codebase conventions, idioms, and patterns. The Scout digest is injected into the Generator's context so it writes more idiomatic code from the start:

```bash
adhd --scout "Add auth with JWT"
```

The Scout is skipped for greenfield projects (empty codebase) and requires an existing project. Cost is recorded as its own stage in `.adhd/usage.json`.

### Reviewer: Code-Craft Review (Phase 2)

Optionally run a read-only Reviewer agent after each passing sprint to produce a code-craft report covering naming, duplication, maintainability, and architectural fit. The review is advisory only and does not affect pass/fail:

```bash
adhd --review "Add auth with JWT"
```

The Reviewer's report is persisted per sprint to `.adhd/reviews/sprint-{n}.json`. Cost is recorded as its own stage with its own resolved model.

### Commit Harness Metadata (Phase 2)

By default, the harness does not commit any `.adhd/` files to the target repository's git history — all metadata stays as uncommitted working files on disk. To opt in to a structured audit trail in git:

```bash
# Commit the structured audit record after each sprint (Tier A)
adhd --commit-adhd "Add auth"

# Also commit conversation logs (Tier B = Tier A + logs; implies --commit-adhd)
adhd --commit-adhd-logs "Add auth"
```

**Tier A** (`--commit-adhd`) commits the structured audit record: `.adhd/contracts/`, `.adhd/feedback/`, `.adhd/progress.json`, `.adhd/spec.md`, `.adhd/usage.json`, `.adhd/regression.json`, `.adhd/reviews/`, `.adhd/scout-digest.json`, and `.adhd/baseline-verification-*.json`. A final end-of-run commit captures the completed checkpoint and final cost ledger.

**Tier B** (`--commit-adhd-logs`) commits everything in Tier A **plus** `.adhd/logs/`.

**Never committed** under any flag: `.adhd/runs/` (local-only run snapshots), `.adhd/skills/`, and `.adhd/.env`. The harness never force-stages a path your `.gitignore` excludes — your ignore rules are absolute.

### Run History & Comparison (Phase 2)

The harness preserves each run's terminal state (cost and progress) under `.adhd/runs/<session-stamp>/` for later comparison. These snapshots are local-only — never committed to git by the harness under any flag:

```bash
# List all preserved runs (newest first)
adhd compare

# Compare two runs
adhd compare 2026.06.06-15.42.30 2026.06.06-16.10.45
```

The comparison report shows sprint pass/fail delta, cost delta (per-stage and per-model), and criteria score trends between the two runs.

### Interactive Gates

In interactive mode (the default), the harness pauses at key decision points:
- **Dirty-tree warning** before starting
- **Spec approval** after planning (customize with `--editor`)
- **Contract preview** before each sprint
- **Evaluator override** on failures
- **Steering** between sprints (continue, skip, edit spec, or abort)

Gates have countdown timers with sensible defaults — press any key to choose, or wait for the timeout. Use `--no-interactive` to skip all gates or `--gate-timeout 0` to skip without counting.

### Non-Interactive Execution

```bash
# Skip all interactive gates; auto-accept defaults
adhd --no-interactive --file spec.md
```

Or disable specific gate categories with `--gate-timeout 0`.

### Other Configuration

```bash
# Use a specific editor for spec approval
adhd --editor "code --wait" "Add auth"

# Set max sprints (default: 10)
adhd --max-sprints 5 "Add auth"

# Set max retries per sprint (default: 3)
adhd --max-retries 5 "Add auth"

# Set pass threshold (default: 7 out of 10)
adhd --threshold 8 "Add auth"

# Limit contract size
adhd --max-features 2 --max-criteria 8 --max-surfaces 2 "Add auth"

# Disable BDD (behavioral accumulation across sprints)
adhd --no-bdd "Add auth"

# Disable TDD (test-driven development instructions)
adhd --no-tdd "Add auth"

# Skip documentation generation
adhd --no-docs "Add auth"

# Enable desktop notifications
adhd --notify "Add auth"

# Set project directory without cd-ing
adhd --project ~/my-app "Add auth"

# Set source/test directory conventions
adhd --source-dir lib --test-dir test "Add auth"

# Enable verbose or debug logging
adhd --verbose "Add auth"
adhd --debug "Add auth"

# Run quietly (minimal output)
adhd --quiet "Add auth"

# Set source/test directory conventions (default: src / tests)
adhd --source-dir lib --test-dir spec "Add auth"

# Cap total token spend per sprint (soft warn at 80%, pause at 100%)
adhd --sprint-token-budget 500000 "Add auth"
```

## Environment Variables

Every flag that accepts a backing environment variable is documented in `adhd --help`. The table below lists the complete set of accepted variables, including those with no corresponding flag:

| Variable | Flag equivalent | Purpose |
|---|---|---|
| `CLAUDE_MODEL` | `--model` | Uniform model for all agents |
| `MAX_SPRINTS` | `--max-sprints` | Maximum number of sprints |
| `MAX_RETRIES` | `--max-retries` | Maximum retries per sprint |
| `PASS_THRESHOLD` | `--threshold` | Pass threshold score 1–10 |
| `MAX_FEATURES` | `--max-features` | Maximum features per contract |
| `MAX_CRITERIA` | `--max-criteria` | Maximum criteria per contract |
| `MAX_SURFACES` | `--max-surfaces` | Maximum surfaces per contract |
| `ADHD_EDITOR` | `--editor` | Editor command for spec approval |
| `EDITOR` | `--editor` (fallback) | System default editor |
| `ADHD_GATE_TIMEOUT` | `--gate-timeout` | Gate timeout in seconds |
| `SOURCE_DIR` | `--source-dir` | Source directory convention |
| `TEST_DIR` | `--test-dir` | Test directory convention |
| `ADHD_NO_DOCS` | `--no-docs` | Skip documentation generation (1/true/yes) |
| `TEST_GATE` | `--test-gate` | Enable hard test gate (1/true/yes) |
| `MODEL_PLANNER` | `--model-planner` | Planner model override |
| `MODEL_GENERATOR` | `--model-generator` | Generator model override |
| `MODEL_EVALUATOR` | `--model-evaluator` | Evaluator model override |
| `MODEL_DOCUMENTER` | `--model-documenter` | Documenter model override |
| `MODEL_REVIEWER` | `--model-reviewer` | Reviewer model override |
| `MODEL_CONTRACT` | `--model-contract` | Contract-negotiation model override |
| `PLANNER_MAX_TURNS` | `--planner-max-turns` | Planner turn cap |
| `GENERATOR_MAX_TURNS` | `--generator-max-turns` | Generator turn cap |
| `EVALUATOR_MAX_TURNS` | `--evaluator-max-turns` | Evaluator turn cap |
| `DOCUMENTER_MAX_TURNS` | `--documenter-max-turns` | Documenter turn cap |
| `DISABLE_MCP` | `--disable-mcp` | Disable all MCP servers (1/true/yes) |
| `MCP_SERVERS` | `--mcp-servers` | MCP server config JSON |
| `SPRINT_TOKEN_BUDGET` | `--sprint-token-budget` | Per-sprint token ceiling |
| `ADHD_SCOUT` | `--scout` | Enable Scout pass (1/true/yes) |
| `ADHD_REVIEW` | `--review` | Enable Reviewer pass (1/true/yes) |
| `LOG_LEVEL` | `--verbose`/`--quiet`/`--debug` | Log level: quiet, normal, verbose, debug |
| `TZ_DISPLAY` | *(none)* | IANA timezone for terminal timestamps |
| `LANGFUSE_PUBLIC_KEY` | *(none)* | Langfuse tracing public key |
| `LANGFUSE_SECRET_KEY` | *(none)* | Langfuse tracing secret key |
| `LANGFUSE_BASE_URL` | *(none)* | Langfuse tracing base URL |

Variables can be set in your shell environment or in a `.adhd/.env` file in the project directory. Shell environment takes precedence over `.adhd/.env`.

## What to Expect

**Duration:** A single sprint typically takes 5–15 minutes; a full run with the default 10 sprints can take 1–2 hours. Scope with `--max-sprints` to control total time.

**Cost:** Planner and Evaluator default to Opus tier; Generator defaults to Sonnet. A full run with multiple sprints can consume significant API credits. Use `--model claude-sonnet-4-6` to override all agents to Sonnet, or `--max-sprints` to limit scope.

**What happens to your files:** In existing-project mode, the generator makes changes directly and creates git commits. In greenfield mode, all code goes into `app/`. The `.adhd/` directory stores metadata and logs. By default, no `.adhd/` files are committed to git — use `--commit-adhd` to opt in to a structured audit trail, or add `.adhd/` to your `.gitignore` for an extra layer of protection.

**Interactive gates:** Pauses at key decision points with countdown timers. Skip with `--no-interactive` or `--gate-timeout 0`.

**Cost tracking:** After each run, the harness prints a per-stage cost summary and saves cumulative usage data to `.adhd/usage.json`. Each stage entry carries the resolved model that produced it, enabling per-model attribution. The summary includes both a per-stage breakdown and a per-model rollup.

**Terminal output:** Timestamped status messages, tool calls, and sprint pass/fail results. Use `--verbose` for full agent output, `--quiet` for just results, or `--debug` for SDK-level tracing.

**Automatic retries:** Transient errors (rate limits, server errors) are retried with backoff (30s, 60s, 120s). Non-transient errors (auth failures, quota) trigger a checkpoint and exit.

**Exit codes:**

| Code | Meaning |
|------|---------|
| 0 | All sprints passed |
| 1 | Sprint evaluation failed (generator couldn't pass the evaluator) |
| 2 | Infrastructure error (API failure, crash — progress saved, use `--resume`) |

## How It Works

1. **Planning** — The planner expands your prompt into a full product spec with features organized into sprints. Saved to `.adhd/spec.md`.

2. **Spec Approval** — You review the spec with options to approve, edit in your editor (`--editor`), revise with feedback, or abort. Skipped in non-interactive mode.

3. **Scout (optional, Phase 2)** — If `--scout` is set, a read-only pass surfaces codebase conventions and idioms. The digest is injected into the Generator's context to guide idiomatic code generation.

4. **Contract Negotiation** — For each sprint, the generator and evaluator negotiate a JSON contract defining exactly what "done" means. Each criterion is classified as `"behavioral"` (functional) or `"implementation"` (code quality). The evaluator adds edge cases and tightens criteria.

5. **Build** — The generator implements features one at a time, making git commits after each. After the generator finishes, the harness verifies that all changes were committed. If not, it resumes the generator to request a meaningful commit message or auto-commits with a descriptive message.

6. **Static Analysis** — If the project has `lint`/`typecheck` scripts, they run automatically and results are injected into the evaluator's context. With `--lint-gate`, failures skip evaluation and count as a retry.

7. **Evaluation** — The evaluator reads the code, runs the application, and tries to break it. Each criterion is scored 1-10. All must meet the threshold (default: 7). On retries, a git diff of what changed is included for sharper feedback.

8. **Regression Check** — Behavioral criteria from passing sprints accumulate in `.adhd/regression.json`. On subsequent sprints, the evaluator checks both new and accumulated criteria, catching cross-sprint regressions. Disable with `--no-bdd`.

9. **Reviewer (optional, Phase 2)** — If `--review` is set, a read-only code-craft review runs after each passing sprint. The review is advisory only and does not affect pass/fail.

10. **Retry** — If any criterion fails, detailed feedback goes back to the generator. This cycles up to `maxRetries` times per sprint.

11. **Spec Refinement** — With `--refine-spec`, the planner re-evaluates remaining sprints after each pass, adjusting scope based on what was actually built. Completed sprints are frozen.

12. **Checkpoint & Steering** — After each passing sprint, progress is saved. Between sprints you can continue, skip a sprint, edit the spec, or abort. Safe to interrupt and resume.

13. **Documentation** — After all sprints pass, the documenter agent generates project documentation. Disable with `--no-docs`.

## Built-In Methodologies: BDD & TDD

By default, the harness bakes **BDD** and **TDD** into the agent prompts:

- **BDD (Behavior-Driven Development)** — The planner writes acceptance scenarios in Given/When/Then format. These flow into sprint contracts as testable criteria. The evaluator verifies that tests exist for each scenario and that they pass. Behavioral criteria accumulate across sprints for regression detection.

- **TDD (Test-Driven Development)** — The generator receives Red-Green-Refactor instructions: write failing tests first, implement until tests pass, then refactor. Enforcement is pragmatic — the evaluator checks that tests exist and are meaningful, not that they were written in a specific order.

Both are enabled by default. Disable with `--no-bdd` and/or `--no-tdd` if your project doesn't need them.

## Skills System

Skills are composable guidance documents that augment the agent prompts. Each skill declares which agents receive it and how.

### Three Scopes

| Scope | Location | Purpose |
|-------|----------|---------|
| **Harness** | `<harness>/shared/skills/` | Built-in: spec format, contract structure, scoring guide |
| **User** | `~/.adhd/skills/` | Your reusable practices across all projects |
| **Project** | `<project>/.adhd/skills/local/` | Project-specific domain knowledge and conventions |

Precedence: project > user > harness (same skill name in a higher scope overrides lower).

## Architecture

The harness consists of two main parts:

### `shared/` — SDK-Independent Core

Pure business logic, data structures, and orchestration that never imports from any LLM SDK:

- **orchestration/** — Sprint loop coordination, gates, error handling, static analysis
- **Types & Config** — HarnessConfig, ResolvedConfig, types.ts, models.ts
- **Contracts** — Contract parsing, limits, refinement
- **Usage & History** — Cost tracking, run preservation, run comparison
- **Codebase Analysis** — Codebase map, Scout digest, Review report, Branch naming
- **Prompts & Skills** — Prompt templates, skill resolution
- **Utilities** — Logger, file I/O, agent identity, interactions

### `harness-claude/` — Claude SDK Specific

Agent wrappers, SDK integration, and tool policies:

- **Agents** — Planner, Generator, Evaluator, Documenter, Scout, Reviewer
- **Contract** — Contract negotiation via Claude
- **Tools** — Tool execution, MCP handling
- **Tracing** — Langfuse + OpenTelemetry integration

## Development

```bash
# Install dependencies
bun install

# Type checking
bun run typecheck

# Linting
bun run lint

# Auto-fix lint issues
bun run lint:fix

# Run tests
bun test

# Run the harness in development
bun run start -- "Your prompt here"
```

## Testing

The test suite covers:
- Contract parsing and limits
- Configuration resolution
- Model and tier selection
- Codebase mapping and Scout digest
- Run history and comparison
- Branch naming
- Cost tracking and usage
- Integration tests with mock SDK calls

Run `bun test` to execute all tests. The suite passes with zero red error lines when all tests pass.

## Contributing

- All changes in `shared/` must have zero imports from any LLM SDK to maintain provider independence
- `harness-claude/` contains all Claude SDK-specific code
- New harness implementations (e.g., `harness-gemini/`) follow the same SDK-independent architecture
- Follow the existing naming conventions: camelCase functions, PascalCase types, SCREAMING_SNAKE_CASE constants
- Write tests for new functionality; the suite must remain green and silent (no red output)

## Security

**The harness runs unsandboxed and executes the target repository's scripts and configured assets.**

When you point the harness at a project directory, it:
- Runs the project's `lint`, `typecheck`, and `test` scripts from `package.json` as part of static analysis and the test gate.
- Executes any MCP server commands you supply via `--mcp-servers` / `MCP_SERVERS`.
- Reads and writes files in the project directory, and makes git commits on the current branch.

**Only run the harness against repositories you trust.** Pointing it at an untrusted repository is equivalent to running that repository's scripts as your user — malicious scripts could read environment variables, exfiltrate data, or modify your system.

This applies in both existing-project mode (where the harness modifies the repository in place) and greenfield mode (where the harness writes into an `app/` subdirectory).

Treat `.adhd/.env` as a secret store: it is loaded into `process.env` at startup. Do not commit it, and do not include credentials there that you would not want the target project's scripts to see.

## License

MIT License — see [LICENSE](LICENSE) file for details.

## Acknowledgments

Based on Anthropic's [Harness Design for Long-Running Application Development](https://www.anthropic.com/engineering/harness-design-long-running-apps).

Original architecture and three-agent design by [Cole Medin](https://github.com/coleam00) in [coleam00/adversarial-dev](https://github.com/coleam00/adversarial-dev).

Phase 2 enhancements: trust, observability, workflow safety, and quality improvements in collaboration with [Peg El-Gap](https://github.com/peacock-el-gap).
