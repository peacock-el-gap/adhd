# Adversarial Development Harness for Delivery (ADHD)

A four-agent harness that separates **planning**, **building**, **evaluation**, and **documentation** into distinct AI agents. The evaluator's job is to **break** what the generator builds -- creating adversarial tension that drives quality beyond what a single agent achieves.

| Agent | Role | Analogy |
|-------|------|---------|
| **Planner** | Expands a short prompt into a full product spec with sprints | Product manager |
| **Generator** | Builds one feature at a time, commits to git | Software engineer |
| **Evaluator** | Actively tries to break what the generator built, scores ruthlessly | Adversarial QA |
| **Documenter** | Generates project documentation after all sprints pass | Technical writer |

Based on Anthropic's [Harness Design for Long-Running Application Development](https://www.anthropic.com/engineering/harness-design-long-running-apps). Originally forked from [coleam00/adversarial-dev](https://github.com/coleam00/adversarial-dev) by Cole Medin -- the initial architecture, three-agent design, and adversarial evaluation loop originate from that project.

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

After `bun link`, you can run `adhd` from any directory -- it operates on the current directory by default.

> **Alternative:** If you prefer not to use `bun link`, you can create a shell alias:
> ```bash
> alias adhd='bun run /path/to/adhd/harness-claude/index.ts'
> ```
> Or run directly from the ADHD harness directory with `bun run start -- [flags]`.

## Usage

| I want to... | Command |
|---|---|
| [Enhance my project with a prompt](#enhance-an-existing-project) | `adhd "Add auth with JWT"` |
| [Enhance my project with a spec file](#enhance-an-existing-project) | `adhd --file changes.md` |
| [Build a new project from a prompt](#build-a-new-project) | `adhd --greenfield "Build a task manager"` |
| [Build a new project from a spec file](#build-a-new-project) | `adhd --greenfield --file spec.md` |
| [Resume after interruption](#resume-after-interruption) | `adhd --resume` |
| [Re-run a specific sprint](#sprint-selection) | `adhd --sprint 3` |
| [Preview the plan without building](#dry-run) | `adhd --dry-run "Add auth with JWT"` |
| [Provide reference docs to the planner](#context-injection) | `adhd --context api-spec.yaml "Implement the API"` |
| [Use a cheaper model](#configuration) | `adhd --model claude-sonnet-4-6 "Add auth"` |
| [Use different models per agent](#configuration) | `adhd --model-planner claude-opus-4-8 "Add auth"` |
| [Work on a dedicated branch](#configuration) | `adhd --branch feature/auth "Add auth"` |
| [Run non-interactively](#configuration) | `adhd --no-interactive --file spec.md` |
| [Skip all interactive gates](#configuration) | `adhd --gate-timeout 0 --file spec.md` |
| [Enable lint hard gate](#static-analysis--lint-gate) | `adhd --lint-gate "Add auth"` |
| [Enable test hard gate](#test-gate) | `adhd --test-gate "Add auth"` |
| [Enable spec refinement](#progressive-spec-refinement) | `adhd --refine-spec "Build a dashboard"` |
| [Limit an agent's turns](#per-agent-turn-caps) | `adhd --generator-max-turns 30 "Add auth"` |
| [Set a cost ceiling per sprint](#cost-tracking--guardrails) | `adhd --sprint-token-budget 100000 "Add auth"` |
| [Disable MCP servers](#tool--mcp-governance) | `adhd --disable-mcp "Add auth"` |

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

The planner may ask clarifying questions in the terminal (60-second timeout). Use `--no-interactive` to skip this -- the planner will make its best judgment and document assumptions.

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

> **Tip:** You can prepare your project before running greenfield -- for example, `git init`, add a `.gitignore`, or write a detailed spec file. The harness reads existing files as context.

> **From a different directory:** Use `--project` instead of cd-ing:
> ```bash
> adhd --greenfield --project ~/projects/my-new-app --file spec.md
> ```

### Resume After Interruption

The harness checkpoints after each passing sprint. If interrupted (rate limit, crash, manual stop), resume where you left off:

```bash
cd ~/my-app
adhd --resume
```

### Sprint Selection

Re-run a specific sprint without running all previous sprints. Requires an existing spec in `.adhd/spec.md` (from a previous run or `--dry-run`):

```bash
# Re-run sprint 3 only
adhd --sprint 3
```

If a contract for the target sprint already exists in `.adhd/contracts/`, it is reused. Otherwise, contract negotiation runs fresh. The harness warns if no checkpoint exists for the previous sprint but proceeds anyway.

Cannot be combined with `--resume`.

### Dry Run

Preview the planner's spec without building anything. Useful for refining your prompt before committing to a full run:

```bash
adhd --dry-run "Add authentication with JWT tokens"
```

The planner generates a spec, the spec approval gate runs (if interactive), and then the harness exits. The spec is saved to `.adhd/spec.md` -- you can review it, adjust your prompt, and run again, or proceed with `adhd --resume`.

### Context Injection

Provide reference documents (API specs, design docs, existing schemas) to give the planner additional context:

```bash
adhd --context api-spec.yaml --context design.md "Implement the REST API"
```

The `--context` flag is repeatable. Each file's contents are injected into the planner's prompt as reference material. This is useful when the planner needs domain knowledge that isn't in your codebase.

### Static Analysis / Lint Gate

By default, the harness automatically detects `lint`, `typecheck`, and `type-check` scripts in your project's `package.json` and runs them after the generator completes. Results are injected into the evaluator's context as supplementary signal (soft gate -- does not consume retry attempts).

Enable hard gate mode to make lint/typecheck failures skip the evaluator and count as failed attempts:

```bash
adhd --lint-gate "Add auth with JWT"
```

### Progressive Spec Refinement

After each passing sprint, have the planner re-evaluate and adjust the spec for remaining sprints based on what was actually built:

```bash
adhd --refine-spec "Build a dashboard with analytics"
```

In interactive mode, you review a diff of proposed changes and can accept or reject them. Completed sprint sections are frozen and cannot be modified. Combined with `--no-interactive`, refinements are auto-accepted (but the diff is still logged).

The harness generates a codebase map of the project structure and injects it into the refinement planner's context so it doesn't need to re-explore the codebase. The planner emits only the revised remaining-sprint sections (not the entire spec), and the harness splices them around the frozen completed sections.

### Test Hard Gate

By default, test results are injected into the evaluator's context as soft feedback (failures don't prevent evaluation). Enable a hard test gate to skip evaluation when the generator introduces new test failures:

```bash
adhd --test-gate "Add auth with JWT"
```

The harness captures which tests were failing before the generator ran (the "known-failing baseline"), then compares post-generation results against it. Only newly-introduced failures trigger the gate. This saves evaluator cost when the generator makes obvious mistakes with tests.

### Per-Agent Turn Caps

Control how many turns (back-and-forth interactions) each agent is allowed:

```bash
# Limit the Generator to 25 turns (default: 50)
adhd --generator-max-turns 25 "Add auth"

# Limit each agent independently
adhd --planner-max-turns 40 --generator-max-turns 25 --evaluator-max-turns 40 "Add auth"
```

Available flags: `--planner-max-turns`, `--generator-max-turns`, `--evaluator-max-turns`, `--documenter-max-turns`. All default to 50 (preserving prior behavior). Invalid values degrade to defaults with a warning.

Precedence: CLI flag > `{AGENT}_MAX_TURNS` env var > default.

### Tool & MCP Governance

By default, coding agents (Generator, Evaluator, Documenter) receive full MCP and tool access. Non-coding agents (Planner, contract negotiation) receive only essential tools and no MCP.

Disable MCP entirely (useful for testing or sandboxing):

```bash
adhd --disable-mcp "Add auth"
```

Or inject specific MCP servers into coding agents (as a JSON object):

```bash
adhd --mcp-servers '{"filesystem":{"command":"node","args":["fs-server.js"]}}' "Add auth"
```

Precedence: `--disable-mcp` flag > `--mcp-servers` flag > `DISABLE_MCP` env var / `MCP_SERVERS` env var > default.

### Cost Tracking & Guardrails

The harness prints a per-stage cost summary after each run, and saves cumulative usage to `.adhd/usage.json`. This tracks input/output tokens and USD cost per model and per agent, enabling per-model attribution. The summary includes both a per-stage breakdown and a per-model rollup sorted by total USD.

Optionally set a per-sprint token ceiling to prevent runaway cost:

```bash
# Warn at 80% of budget; pause (interactive) or log warning (non-interactive) at 100%
adhd --sprint-token-budget 100000 "Add auth"
```

When a budget is set:
- **At 80%**: A soft warning is logged, but the run continues.
- **At 100% (interactive)**: The harness pauses and asks you to extend the budget or abort the sprint.
- **At 100% (non-interactive)**: A warning is logged and the run auto-continues.

If a uniform model override puts agents above the cost-optimised per-agent matrix tiers, an advisory warning is printed at startup alongside the model information.

Precedence: `--sprint-token-budget` flag > `SPRINT_TOKEN_BUDGET` env var > no budget (inert).

## What to Expect

**Duration:** A typical run takes 10-60 minutes depending on project complexity and number of sprints.

**Cost:** Planner and Evaluator default to Opus tier; Generator defaults to Sonnet. A full run with multiple sprints can consume significant API credits. Use `--model claude-sonnet-4-6` to override all agents to Sonnet, or `--max-sprints` to limit scope.

**What happens to your files:** In existing-project mode, the generator makes changes directly and creates git commits. In greenfield mode, all code goes into `app/`. The `.adhd/` directory stores metadata and logs -- add it to your `.gitignore`.

**Interactive gates:** In interactive mode (the default), the harness pauses at key decision points for your input. Gates have countdown timers with sensible defaults -- press any key to choose, or wait for the timeout. Gates include: dirty-tree warning before starting, spec approval after planning, contract preview before each sprint, evaluator override on failures, and mid-run steering between sprints. Use `--no-interactive` or `--gate-timeout 0` to skip all gates.

**Cost tracking:** After each run, the harness prints a per-stage cost summary and saves cumulative usage data to `.adhd/usage.json`. This tracks input/output tokens and USD cost for each planner, generator, and evaluator invocation across sessions. Each stage entry carries the resolved model that produced it, enabling per-model attribution. The terminal summary includes both a per-stage breakdown (with model column) and a per-model rollup sorted by total USD — useful for comparing cost-effectiveness when running mixed-model sprints.

**Terminal output:** Timestamped status messages, tool calls, and sprint pass/fail results. Use `--verbose` for full agent output, `--quiet` for just results, or `--debug` for SDK-level tracing.

**Automatic retries:** Transient errors (rate limits, server errors) are retried with backoff (30s, 60s, 120s). Non-transient errors (auth failures, quota) trigger a checkpoint and exit.

**Exit codes:**

| Code | Meaning |
|------|---------|
| 0 | All sprints passed |
| 1 | Sprint evaluation failed (generator couldn't pass the evaluator) |
| 2 | Infrastructure error (API failure, crash -- progress saved, use `--resume`) |

## How It Works

1. **Planning** -- The planner expands your prompt into a full product spec with features organized into sprints. Saved to `.adhd/spec.md`.

2. **Spec Approval** -- You review the spec with options to approve, edit in your editor (`--editor`), revise with feedback (re-runs the planner), or abort. Timeout defaults to abort (safe). Skipped in non-interactive mode.

3. **Contract Negotiation** -- For each sprint, the generator and evaluator negotiate a JSON contract defining exactly what "done" means. Each criterion is classified as `"behavioral"` (functional behavior) or `"implementation"` (code quality). The evaluator adds edge cases and tightens criteria. You get a preview before building starts.

4. **Build** -- The generator implements features one at a time, making git commits after each. After the generator finishes, the harness verifies that all changes were committed. If not, it resumes the generator session to request a meaningful commit message. As a last resort, the harness auto-commits with a descriptive fallback message referencing the sprint and features.

5. **Static Analysis** -- If the project has `lint`/`typecheck` scripts, they run automatically and results are injected into the evaluator's context. With `--lint-gate`, failures skip evaluation and count as a retry.

6. **Evaluation** -- The evaluator reads the code, runs the application, and tries to break it. Each criterion is scored 1-10. All must meet the threshold (default: 7). On retries, a git diff of what changed is included for sharper feedback. If the evaluator fails a sprint, you can override the score and force a PASS (useful for false negatives).

7. **Regression Check** -- Behavioral criteria from passing sprints accumulate in `.adhd/regression.json`. On subsequent sprints, the evaluator checks both new and accumulated criteria, catching cross-sprint regressions. Disable with `--no-bdd`.

8. **Retry** -- If any criterion fails, detailed feedback goes back to the generator. This cycles up to `maxRetries` times per sprint.

9. **Spec Refinement** -- With `--refine-spec`, the planner re-evaluates remaining sprints after each pass, adjusting scope based on what was actually built. Completed sprints are frozen.

10. **Checkpoint & Steering** -- After each passing sprint, progress is saved. Between sprints you can continue, skip a sprint, edit the spec, or abort. Safe to interrupt and resume.

11. **Documentation** -- After all sprints pass, the documenter agent generates project documentation. Disable with `--no-docs`.

## Built-In Methodologies: BDD & TDD

By default, the harness bakes **BDD** and **TDD** into the agent prompts:

- **BDD (Behavior-Driven Development)** -- The planner writes acceptance scenarios in Given/When/Then format. These flow into sprint contracts as testable criteria. The evaluator verifies that tests exist for each scenario and that they pass. Behavioral criteria accumulate across sprints for regression detection.

- **TDD (Test-Driven Development)** -- The generator receives Red-Green-Refactor instructions: write failing tests first, implement until tests pass, then refactor. Enforcement is pragmatic -- the evaluator checks that tests exist and are meaningful, not that they were written in a specific order.

Both are enabled by default. Disable with `--no-bdd` and/or `--no-tdd` if your project doesn't need them. These flags also filter community skills tagged with the corresponding methodology type.

## Skills System

Skills are composable guidance documents that augment the agent prompts. Each skill declares which agents receive it and how.

### Three Scopes

| Scope | Location | Purpose |
|-------|----------|---------|
| **Harness** | `<harness>/shared/skills/` | Built-in: spec format, contract structure, scoring guide |
| **User** | `~/.adhd/skills/` | Your reusable practices across all projects |
| **Project** | `<project>/.adhd/skills/local/` | Project-specific domain knowledge and conventions |

Precedence: project > user > harness (same skill name in a higher scope overrides lower).

### Routing

Each skill declares per-agent routing in its `skill.yaml` manifest:

- **inject** -- Content embedded directly in the agent's system prompt. For small, essential guidance.
- **reference** -- File path listed in the prompt; agent reads via `Read` tool when relevant. For larger documents.
- **exclude** -- Not provided to this agent.

### Creating a Project Skill

For project-specific conventions, create a markdown file with YAML frontmatter in `.adhd/skills/local/`:

```markdown
---
name: API Conventions
agents: [planner, generator, evaluator]
tier: inject
---

All REST endpoints follow /api/v2/{resource} pattern.
Authentication uses Bearer tokens via X-Auth-Token header.
Error responses use RFC 7807 Problem Details format.
```

Defaults: if `agents:` is omitted, all agents receive it. If `tier:` is omitted, it defaults to `inject`.

### Installing External Skills

Clone or copy skill directories into the appropriate scope:

```bash
# User scope (available to all your projects)
git clone https://github.com/example/adhd-skill-bdd ~/.adhd/skills/bdd-gherkin

# Project scope (for this project only)
git clone https://github.com/example/adhd-skill-fastapi .adhd/skills/installed/python-fastapi
```

## The `.adhd/` Directory

```
your-project/
├── src/                       # Your existing code
├── app/                       # Generated code (greenfield mode only)
├── .adhd/                     # Harness metadata (add to .gitignore)
│   ├── .env                   # Optional: config overrides
│   ├── progress.json          # Run state + checkpoint data
│   ├── spec.md                # Product spec from the planner
│   ├── regression.json        # Accumulated behavioral criteria (cross-sprint)
│   ├── usage.json             # Cumulative cost/token tracking across sessions
│   ├── contracts/             # Sprint contract JSON files
│   ├── feedback/              # Evaluator feedback per attempt
│   └── logs/                  # Conversation logs (always written)
└── ...
```

**Conversation logs** are detailed markdown records of everything each agent said and did. Always written regardless of terminal log level. Useful for debugging or understanding agent decisions.

**regression.json** persists across runs -- it is not cleaned by fresh runs or `--resume`. It tracks accumulated behavioral criteria from all passing sprints, enabling cross-sprint regression detection.

## Configuration

Settings via CLI flags, environment variables, or `.adhd/.env` in the project directory.
Precedence: **CLI flag > env var > `.adhd/.env` > default**.

| Setting | CLI Flag | Env Var | Default |
|---------|----------|---------|---------|
| User prompt | positional arg | -- | -- (required, except `--resume`/`--sprint`) |
| Prompt file | `--file`, `-f` `<path>` | -- | -- |
| Project directory | `--project <path>` | -- | current directory |
| Greenfield mode | `--greenfield` | -- | off (existing project) |
| Model (all agents) | `--model <name>` | `CLAUDE_MODEL` | per-agent matrix below |
| Planner model | `--model-planner <name>` | `MODEL_PLANNER` | Opus (`claude-opus-4-8`) |
| Generator model | `--model-generator <name>` | `MODEL_GENERATOR` | Sonnet (`claude-sonnet-4-6`) |
| Evaluator model | `--model-evaluator <name>` | `MODEL_EVALUATOR` | Opus (`claude-opus-4-8`) |
| Documenter model | `--model-documenter <name>` | `MODEL_DOCUMENTER` | Haiku (`claude-haiku-4-5-20251001`) |
| Contract negotiation model | `--model-contract <name>` | `MODEL_CONTRACT` | generator model (proposal) / evaluator model (review) |
| Max features/sprint | `--max-features <n>` | `MAX_FEATURES` | `3` |
| Max criteria/sprint | `--max-criteria <n>` | `MAX_CRITERIA` | `10` |
| Max surfaces/sprint | `--max-surfaces <n>` | `MAX_SURFACES` | `2` |
| Max sprints | `--max-sprints <n>` | `MAX_SPRINTS` | `10` |
| Max retries/sprint | `--max-retries <n>` | `MAX_RETRIES` | `3` |
| Pass threshold | `--threshold <n>` | `PASS_THRESHOLD` | `7` |
| Log level | `--verbose` / `--quiet` / `--debug` | `LOG_LEVEL` | `normal` |
| Timezone display | -- | `TZ_DISPLAY` | system local |
| Non-interactive | `--no-interactive` | -- | interactive |
| Resume mode | `--resume` | -- | off |
| Sprint selection | `--sprint <n>` | -- | off (run all sprints) |
| Dry-run mode | `--dry-run` | -- | off |
| Context files | `--context <file>` (repeatable) | -- | none |
| Branch creation | `--branch <name>` | -- | off (stay on current branch) |
| Editor for spec | `--editor <cmd>` | `ADHD_EDITOR` or `EDITOR` | none |
| Gate timeout | `--gate-timeout <sec>` | `ADHD_GATE_TIMEOUT` | varies by gate (0 = skip all) |
| Disable BDD | `--no-bdd` | -- | BDD enabled |
| Disable TDD | `--no-tdd` | -- | TDD enabled |
| Skip docs | `--no-docs` | `ADHD_NO_DOCS` | docs enabled |
| Lint hard gate | `--lint-gate` | -- | off (soft gate) |
| Test hard gate | `--test-gate` | `TEST_GATE` | off (soft gate) |
| Spec refinement | `--refine-spec` | -- | off |
| Planner max turns | `--planner-max-turns <n>` | `PLANNER_MAX_TURNS` | `50` |
| Generator max turns | `--generator-max-turns <n>` | `GENERATOR_MAX_TURNS` | `50` |
| Evaluator max turns | `--evaluator-max-turns <n>` | `EVALUATOR_MAX_TURNS` | `50` |
| Documenter max turns | `--documenter-max-turns <n>` | `DOCUMENTER_MAX_TURNS` | `50` |
| Disable MCP | `--disable-mcp` | `DISABLE_MCP` | MCP enabled (coding agents) |
| MCP servers | `--mcp-servers <json>` | `MCP_SERVERS` | project/user/machine defaults |
| Sprint token budget | `--sprint-token-budget <n>` | `SPRINT_TOKEN_BUDGET` | no budget (inert) |
| Notifications | `--notify` | -- | off (terminal bell only) |
| Commit .adhd/ metadata | `--commit-adhd` | -- | off (no metadata commits) |
| Commit .adhd/ + logs | `--commit-adhd-logs` | -- | off (implies `--commit-adhd`) |
| Allow main branch | `--allow-main` | -- | off (refuse main/master) |
| Source directory | `--source-dir <dir>` | `SOURCE_DIR` | `src` |
| Test directory | `--test-dir <dir>` | `TEST_DIR` | `tests` |
| Langfuse tracing | -- | `LANGFUSE_PUBLIC_KEY` + `LANGFUSE_SECRET_KEY` | disabled |
| Langfuse base URL | -- | `LANGFUSE_BASE_URL` | `https://cloud.langfuse.com` |

```env
# Example .adhd/.env file
# Omit CLAUDE_MODEL to use the per-agent default matrix (recommended).
# Set it to force a single model for all four agents.
# CLAUDE_MODEL=claude-sonnet-4-6
MAX_SPRINTS=6
PASS_THRESHOLD=8
LOG_LEVEL=verbose
TZ_DISPLAY=Europe/Warsaw
ADHD_EDITOR=code --wait
MODEL_PLANNER=claude-opus-4-8

# Langfuse tracing (optional)
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
# LANGFUSE_BASE_URL=https://your-instance.example.com  # only for self-hosted
```

### Per-Agent Model Matrix

When no `--model` flag is set, each agent uses a tier-appropriate default:

| Agent | Default model | Rationale |
|-------|--------------|-----------|
| Planner | `claude-opus-4-8` (Opus) | Runs once; its spec drives all downstream agents |
| Generator | `claude-sonnet-4-6` (Sonnet) | Cost-dominant; mistakes are recoverable via feedback |
| Evaluator | `claude-opus-4-8` (Opus) | The sole pass/fail gate; must out-judge the Generator |
| Documenter | `claude-haiku-4-5-20251001` (Haiku) | Lowest stakes; advisory output only |

**Resolution precedence** (per agent): `--model-<agent>` > `--model` > tier default above.

**Invariant warning:** If the Evaluator tier is weaker than the Generator tier, the harness prints an advisory warning at startup and continues — it does not hard-fail. The judge should never be weaker than the producer.

**`--model-contract`:** Overrides the model for all three contract-negotiation calls (proposal, review, and the bounded narrowing round). When unset, proposal uses the generator's model and review uses the evaluator's model.

### Notifications (`--notify`)

The harness emits a terminal bell character (`\x07`) at all interactive gates (spec approval, contract preview, evaluator override, mid-run steering) and on fatal errors so you hear a beep even if the terminal is in the background.

Add `--notify` to also send desktop notifications via the platform-appropriate command (`notify-send` on Linux, `osascript` on macOS):

```bash
# Terminal bell only (default)
adhd "Add auth with JWT"

# Terminal bell + desktop notifications
adhd --notify "Add auth with JWT"
```

### Versioning `.adhd/` Artifacts (`--commit-adhd`, `--commit-adhd-logs`)

By default, `.adhd/` files are never committed by the harness. Use `--commit-adhd` to create a git commit after each passing sprint containing contracts, feedback, progress, and the spec:

```bash
# Commit metadata after each sprint
adhd --commit-adhd "Add auth with JWT"
# Creates: [adhd] Sprint 2: contract + metadata
```

Use `--commit-adhd-logs` to additionally include conversation logs from `.adhd/logs/`. This flag implies `--commit-adhd`, so you don't need to pass both:

```bash
# Commit metadata + conversation logs
adhd --commit-adhd-logs "Add auth with JWT"
# Creates: [adhd] Sprint 2: contract + metadata (including logs)
```

The committed paths per flag:

| Flag | Committed paths |
|------|----------------|
| `--commit-adhd` | `.adhd/contracts/`, `.adhd/feedback/`, `.adhd/progress.json`, `.adhd/spec.md` |
| `--commit-adhd-logs` | All of the above + `.adhd/logs/` |

### Terminal Output Levels

| Level | What's shown |
|-------|-------------|
| `quiet` | Sprint pass/fail, errors only |
| `normal` | Tool names, scores, status messages (default) |
| `verbose` | Everything above + assistant text + tool input summaries |
| `debug` | Everything above + config details, SDK call tracing, message types |

### Langfuse Tracing

[Langfuse](https://langfuse.com) integration traces every harness run -- planner calls, generator sprints, evaluator scores, and tool usage. Zero overhead when disabled.

**Setup:**

1. Create a Langfuse account (cloud or self-hosted) and generate API keys from **Settings > API Keys**.
2. Add the keys to your project's `.adhd/.env`:
   ```env
   LANGFUSE_PUBLIC_KEY=pk-lf-...
   LANGFUSE_SECRET_KEY=sk-lf-...
   ```
   For self-hosted instances, also set `LANGFUSE_BASE_URL` (defaults to `https://cloud.langfuse.com`).
3. Run with `--debug` to confirm: you should see `Langfuse tracing: enabled` in the startup output.

## Architecture

```
adhd/
├── shared/                    # SDK-independent utilities, domain types, pure logic
│   ├── orchestration/         # Sprint loop coordination (SDK-independent)
│   │   ├── harness.ts         # Main orchestrator — accepts AgentRunners interface
│   │   ├── sprint-attempts.ts # Generator→evaluator retry loop
│   │   ├── sprint-success.ts  # Checkpoint, refinement, documenter phase
│   │   ├── gates.ts           # Spec approval with editor/revise loop
│   │   ├── git-ops.ts         # Git revert, dirty tree check
│   │   ├── error-handling.ts  # Transient retry, fatal error, custom errors
│   │   ├── static-analysis-runner.ts  # Run lint/test commands
│   │   ├── spec-refinement.ts # Mid-run spec evolution
│   │   └── types.ts           # AgentRunners interface + context types
│   ├── types.ts               # Core type definitions (HarnessConfig, SprintContract, etc.)
│   ├── config.ts              # CLI parsing, config resolution, validation
│   ├── prompts.ts             # System prompts for all agents + negotiation prompts
│   ├── files.ts               # .adhd/ file I/O (contracts, feedback, progress, spec)
│   ├── skills.ts              # Skills resolution, routing, and injection
│   ├── regression.ts          # BDD regression accumulation and injection
│   ├── diff.ts                # Git diff computation for retry-aware evaluation
│   ├── static-analysis.ts     # Lint/typecheck detection and execution
│   ├── refinement.ts          # Progressive spec refinement logic
│   ├── logger.ts              # Terminal output with log levels and ANSI colors
│   ├── interaction.ts         # Interactive gate prompts (approve/reject/edit)
│   ├── usage.ts               # Per-stage cost and token tracking
│   ├── tracing.ts             # Abstract Tracer/Span interfaces (SDK-independent)
│   ├── conversation-logger.ts # Markdown conversation log writer
│   ├── doc-validation.ts      # Documentation validation utilities
│   ├── artifact-digest.ts     # Build artifact digest generation
│   └── skills/                # Built-in harness skills (YAML + markdown)
├── harness-claude/            # Claude Agent SDK specific ONLY
│   ├── index.ts               # CLI entry point
│   ├── planner.ts             # Planner agent invocation
│   ├── generator.ts           # Generator agent invocation
│   ├── evaluator.ts           # Evaluator agent invocation
│   ├── documenter.ts          # Documenter agent invocation
│   ├── contract.ts            # Sprint contract negotiation via Claude SDK
│   ├── agent-stream.ts        # Claude SDK message stream processing
│   └── tracing-claude.ts      # Langfuse/OTEL instrumentation for Claude SDK
├── tests/                     # Test files (Bun test runner)
├── example-prompts/           # Sample spec files for reference
├── package.json               # Dependencies and scripts
├── tsconfig.json              # TypeScript config (strict mode)
└── biome.json                 # Linter/formatter config
```

The harness follows a GAN-inspired architecture where the generator and evaluator operate in adversarial tension. The generator builds; the evaluator tries to break it. Failed evaluations feed detailed feedback back to the generator, creating an iterative improvement loop.

Key data flow:
- **Spec** (`.adhd/spec.md`) flows from planner to all agents
- **Contracts** (`.adhd/contracts/sprint-N.json`) are negotiated between generator and evaluator
- **Feedback** (`.adhd/feedback/`) flows from evaluator back to generator on retries
- **Regression criteria** (`.adhd/regression.json`) accumulate from passing sprints and feed into future evaluations
- **Progress** (`.adhd/progress.json`) tracks run state for checkpoint/resume

## Features

### Core Loop
- Sprint-based project decomposition with contract negotiation
- Adversarial evaluation with per-criterion scoring
- Retry loop with detailed feedback
- Checkpoint/resume across interruptions
- Interactive gates at key decision points

### Phase 1: Evaluation Quality (Deepen)
- **BDD Regression Accumulation** -- Behavioral criteria from passing sprints accumulate and are re-checked on subsequent sprints, catching cross-sprint regressions
- **Static Analysis Soft Gate** -- Auto-detects and runs lint/typecheck, injecting results into evaluator context
- **Lint Hard Gate** (`--lint-gate`) -- Lint/typecheck failures skip evaluation and count as failed attempts
- **Diff-Aware Retries** -- On retry attempts, the evaluator sees a git diff of what changed, enabling sharper feedback
- **Quality Criteria in Contracts** -- Contracts include code quality criteria (naming, duplication, error handling) alongside functional criteria

### Phase 2: Cost & Efficiency
- **Harness-owned verification** -- Project tests run once per attempt, centrally, with results injected into both Generator (as baseline) and Evaluator (as authority); both agents are instructed not to re-run the full suite, and an optional hard test gate (`--test-gate`) skips evaluation on newly-introduced failures
- **Known-failing baseline** -- The harness captures which tests were failing before work started, so agents don't waste turns distinguishing pre-existing failures from regressions
- **Read discipline** -- Agent system prompts include durable rules to locate before reading, never re-read files already in-session, and run only scoped tests, reducing per-turn context and the cache-read multiplier
- **Per-agent turn caps** (`--planner-max-turns`, `--generator-max-turns`, `--evaluator-max-turns`, `--documenter-max-turns`) -- Set different turn ceilings for each agent (all default to 50 for backward compatibility)
- **Harness-generated codebase map** -- The harness builds a deterministic, body-free map of the project structure and exports once per run, injected into both the Generator and Planner/refinement so they don't re-explore from scratch
- **Patch-based spec refinement** (`--refine-spec`) -- After each passing sprint, the Planner emits only the revised remaining-sprint sections rather than re-writing the entire spec, with the harness splicing them around the frozen completed sections
- **Structured contract reviewer envelope** -- Contract reviewers emit a compact `{ verdict, changes, contract? }` envelope instead of re-stating the full contract, reducing contract-review cost while making revisions visible
- **Regression criterion retirement** -- Intentionally-changed or dropped behaviors can be marked `retire:` in contracts; retired criteria leave the persisted suite and won't penalize correct new work or be resurrected by later same-named criteria
- **Regression suite tiering & relevance filter** -- Criteria tagged as `core` always run; `optional` criteria run only when their declared surfaces overlap with the current sprint's surfaces, keeping large suites bounded
- **Tool & MCP governance** -- Non-coding agents (Planner, refinement, contract negotiation) receive only their necessary built-in tools and no MCP servers; coding agents (Generator, Evaluator, Documenter) retain their full working set; overridable via `--disable-mcp` or `--mcp-servers`
- **Cost guardrails** -- At startup, a warning appears if a uniform model override defeats the cost-optimized per-agent matrix; optional per-sprint token budget (`--sprint-token-budget`) with soft warn at 80% and interactive/non-interactive pause at 100%

### Developer Experience
- **Sprint Selection** (`--sprint N`) -- Re-run a specific sprint without running all previous sprints
- **Progressive Spec Refinement** (`--refine-spec`) -- Spec adapts after each sprint based on what was actually built
- **Dry Run** (`--dry-run`) -- Preview the plan without building
- **Context Injection** (`--context`) -- Provide reference docs to the planner
- **Per-Agent Models** -- Independent model selection per agent with a reasoned tier matrix (Opus/Sonnet/Opus/Haiku); uniform `--model` overrides all; `--model-contract` overrides all contract-negotiation calls
- **Branch Creation** (`--branch`) -- Auto-create a git branch before the sprint loop

### Contract Quality
- **Surface Taxonomy** -- Six canonical surfaces (`backend`, `frontend`, `db`, `tests`, `docs`, `config`); contracts declare which surfaces a sprint intends to touch
- **Surface Coverage Gate** -- After each generator attempt, changed file paths are classified against declared surfaces; a mismatch fails the attempt early (before evaluator) to save LLM cost
- **Contract Size Limits** -- `--max-features`, `--max-criteria`, `--max-surfaces` cap contract inflation; oversized contracts are trimmed deterministically and then re-reviewed in a bounded narrowing round

### Observability
- Per-stage cost and token tracking with per-model attribution (`.adhd/usage.json`)
- Per-model cost rollup in the terminal summary — sorted by total USD, always shown
- Langfuse OTEL tracing integration
- Conversation logs for every agent interaction
- Configurable terminal log levels

## Example Prompts

The `example-prompts/` directory contains sample spec files for reference -- a RAG chat application and an initiative tracker. These show the level of detail that produces good results with the planner.

## Development

```bash
# Run tests
bun run test

# Type check
bun run typecheck

# Lint
bun run lint

# Lint + fix
bun run lint:fix
```

## License & Attribution

MIT License. See [LICENSE](LICENSE).

This project was originally forked from [coleam00/adversarial-dev](https://github.com/coleam00/adversarial-dev) by Cole Medin. The initial three-agent adversarial architecture -- planner, generator, and evaluator -- comes from that work. This fork has since been substantially rewritten (shared config layer, contract negotiation, checkpoint/resume, interactive gates, Langfuse tracing, cost tracking, regression detection, spec refinement, and more), but the core concept and original codebase are Cole's.
