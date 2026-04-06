# Adversarial Development Harness for Delivery (ADHD)

Initial version from https://github.com/coleam00/adversarial-dev

A GAN-inspired three-agent harness that separates **planning**, **building**, and **evaluation** into distinct AI agents with distinct contexts. The evaluator's job is to **break** what the generator builds -- creating adversarial tension that drives quality far beyond what a single agent can achieve. Built with both the **Claude Agent SDK** and **Codex SDK** so you can run the same architecture on either platform.

Based on Anthropic's engineering article: [Harness Design for Long-Running Application Development](https://www.anthropic.com/engineering/harness-design-long-running-apps).

## What This Demonstrates

Most AI coding agents fail on complex tasks not because the model is bad, but because nobody separated the work into specialized roles. A single agent that plans, builds, and evaluates its own work will reliably praise its own mediocre output. This is called **self-evaluation bias**, and it's the quiet killer of ambitious AI coding projects.

This project implements the fix: three agents, each with a focused job and its own context window.

| Agent | Role | Analogy |
|-------|------|---------|
| **Planner** | Expands a short prompt into a full product spec with sprints | Product manager |
| **Generator** | Builds one feature at a time, commits to git | Software engineer |
| **Evaluator** | Actively tries to break what the generator built, scores ruthlessly | Adversarial QA |

The evaluator doesn't just review code -- it's an adversary. It runs the application, probes for failures, tests edge cases the generator didn't think of, and scores each criterion on a 1-10 scale with a hard pass threshold. If any criterion fails, the sprint goes back to the generator with detailed, unforgiving feedback. The generator has to fight its way past the evaluator to advance. This adversarial pressure is what turns AI-generated code from "looks right" into "actually works."

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) runtime installed
- Claude CLI authenticated (`claude auth login`) — only needed for the Claude harness
- Codex CLI authenticated (`codex auth login`) — only needed for the Codex harness

### Install

```bash
git clone https://github.com/peacock-el-gap/harness
cd harness
bun install
```

### Claude harness

> Claude harness supports:
> - running against an existing project
> - building a new project from scratch
> - loading prompt from a file
> - resuming after interruption

#### Run Against an Existing Project

The Claude harness defaults to **existing-project mode** — it works in your current directory (or a directory you specify with `--project`), reading your codebase and making changes in place. Harness metadata goes into `.harness/` so it stays out of your source tree.

```bash
# Assuming, that harness is located here:
#   /some-directory/harness/

# From inside your project directory run:
bun run /some-directory/harness/claude-harness/index.ts \
  "Add authentication with JWT tokens and role-based access control"

# Or point at a project from anywhere:
bun run /some-directory/harness/claude-harness/index.ts \
  --project ~/my-app \
  "Refactor the database layer to use connection pooling"
```

#### Build a New Project from Scratch

Use `--greenfield` to create a brand-new project in an `app/` subdirectory with a fresh git repo — the original harness behavior.

```bash
# Assuming, that harness is located here:
#   /some-directory/harness/

bun run /some-directory/harness/claude-harness/index.ts \
  --greenfield \
  "Build a personal task manager with a REST API, interactive dashboard with charts, task categories, priority levels, due dates, and search functionality"
```

#### Load a Prompt from a File

```bash
# Assuming, that harness is located here:
#   /some-directory/harness/

bun run /some-directory/harness/claude-harness/index.ts \
  --file prompt.md

bun run /some-directory/harness/claude-harness/index.ts \
  --greenfield \
  --file prompt.md
```

Check some example prompts in [example-prompts](./example-prompts/) directory.

#### Resume After Interruption

If the harness is interrupted (rate limit, crash, manual stop), it checkpoints after each passing sprint. Resume where you left off:

```bash
# Assuming, that harness is located here:
#   /some-directory/harness/

bun run /some-directory/harness/claude-harness/index.ts \
  --resume

bun run /some-directory/harness/claude-harness/index.ts \
  --resume \
  --project ~/my-app
```

### Codex Harness

The Codex harness uses the original greenfield-only workflow, building into `workspace/codex/app/`.

> **Note:** The Codex harness is frozen — it works as-is but no new features are planned. The Claude harness is the actively developed implementation.
>
> Codex harness DOES NOT support:
> - running against an existing project
> - resuming after interruption


```bash
# Assuming, that harness is located here:
#   /some-directory/harness/
bun run /some-directory/harness/codex-harness/index.ts \
  "Build a personal task manager with a REST API, interactive dashboard with charts, task categories, priority levels, due dates, and search functionality"
```

## Configuration

### Claude Harness Configuration

Settings can be set via CLI flags, environment variables, or a `.harness/.env` file inside the project directory. Precedence: **CLI flag > env var > `.harness/.env` > default**.

These settings can be applied for Claude harness only.

| Setting | CLI Flag | Env Var | Default |
|---------|----------|---------|---------|
| User prompt | positional arg | — | — (required, except with `--resume`) |
| Prompt file | `--file <path>` | — | — |
| Project directory | `--project <path>` | — | current directory |
| Greenfield mode | `--greenfield` | — | off (existing project) |
| Model | `--model <name>` | `CLAUDE_MODEL` | `claude-opus-4-6` |
| Max sprints | `--max-sprints <n>` | `MAX_SPRINTS` | `10` |
| Max retries/sprint | `--max-retries <n>` | `MAX_RETRIES` | `3` |
| Pass threshold | `--threshold <n>` | `PASS_THRESHOLD` | `7` |
| Log level | `--verbose` / `--quiet` | `LOG_LEVEL` | `normal` |
| Timezone display | — | `TZ_DISPLAY` | system local |
| Non-interactive | `--no-interactive` | — | interactive |
| Langfuse public key | — | `LANGFUSE_PUBLIC_KEY` | — (disabled) |
| Langfuse secret key | — | `LANGFUSE_SECRET_KEY` | — (disabled) |
| Langfuse base URL | — | `LANGFUSE_BASEURL` | `https://cloud.langfuse.com` |
| Resume mode | `--resume` | — | off |

The `.harness/.env` file must be placed inside the project directory.

```env
# Example .harness/.env file

CLAUDE_MODEL=claude-sonnet-4-6
MAX_SPRINTS=6
PASS_THRESHOLD=8
LOG_LEVEL=verbose
TZ_DISPLAY=Europe/Warsaw

# Optional: enable Langfuse tracing
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
```

### Codex Harness Configuration

The Codex harness uses hardcoded defaults from `shared/config.ts`:

| Setting | Default | Description |
|---------|---------|-------------|
| `CODEX_MODEL` | `gpt-5.4` | Model for Codex harness |
| `maxSprints` | 10 | Maximum number of sprints |
| `maxRetriesPerSprint` | 3 | Max evaluation retries before failing a sprint |
| `passThreshold` | 7 | Minimum score (out of 10) for each criterion |

## How It Works

### 1. Planning Phase
The planner takes your short prompt and generates a comprehensive product specification with features organized into sprints, a design language, and tech stack decisions. In existing-project mode, the planner reads the existing codebase to understand context before writing the spec. The spec is saved to `.harness/spec.md`.

In interactive mode (default), the planner can ask clarifying questions via `AskUserQuestion` — presented in the terminal with a `[PLANNER asks]` prefix and a 60-second input timeout. Use `--no-interactive` to disable this; the planner will make its best judgment and document assumptions instead.

### 2. Contract Negotiation (per sprint)
The generator proposes what it will build and how success should be measured. The evaluator reviews the criteria, making them more specific, adding edge cases, and raising the bar. They iterate until locked in. The contract is saved as JSON to `.harness/contracts/`.

### 3. Build Phase (per sprint)
The generator reads the spec and contract, then implements features one at a time with git commits after each. It has full access to create files, run commands, install dependencies, and test code. In existing-project mode, it works directly in the project root. In greenfield mode, it works in the `app/` subdirectory.

### 4. Evaluation Phase (per sprint)
The evaluator reads the contract criteria, examines the code, **runs the application**, and tries to break it. It scores each criterion on a 1-10 scale. If all criteria pass (score >= threshold), the sprint survives. If any fail, detailed feedback goes back to the generator -- with file paths, line numbers, and exact failure descriptions.

### 5. Retry Loop
The generator reads the adversarial feedback, decides whether to refine or pivot, and rebuilds. This cycles up to `maxRetries` times per sprint. If a sprint can't survive the evaluator after all retries, the harness stops.

### 6. Checkpoint & Resume
After each passing sprint, the harness saves a checkpoint to `.harness/progress.json` — including the git commit SHA and all sprint results. If the harness is interrupted by rate limits, quota exhaustion, or a crash, you can resume with `--resume`. The harness will:
- Skip the planning phase (spec already exists)
- Revert any incomplete sprint commits back to the last known good state
- Continue from the next unfinished sprint

Transient errors (HTTP 429, 5xx, network timeouts) are retried automatically with exponential backoff (30s, 60s, 120s). Non-transient errors (quota exhaustion, auth failures) trigger a clean checkpoint and exit.

### 7. Completion
Once all sprints pass, you have a working application built incrementally with quality gates at every step -- every feature tested by an agent whose job was to break it.

## Observability

### Conversation Logs

Every agent conversation is written as a markdown file to `.harness/logs/`, regardless of `LOG_LEVEL`. These are the detailed record of everything each agent said and did — assistant text, tool calls with inputs, and tool outputs (long outputs collapsed in `<details>` blocks). Files are named by role and context: `planner.md`, `sprint-1-contract-negotiation.md`, `sprint-1-attempt-0-generator.md`, `sprint-1-attempt-0-evaluator.md`, etc.

### Terminal Output (LOG_LEVEL)

| Level | What's shown |
|-------|-------------|
| `quiet` | Sprint pass/fail, errors only |
| `normal` | Tool names, scores, status messages (default) |
| `verbose` | Everything from `normal` + assistant text + tool input summaries |

Tool output is never shown in terminal — it's in the markdown logs.

### Langfuse Tracing

Set `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` to enable full tracing to [Langfuse](https://langfuse.com). Every agent call becomes a span with messages, tool calls, and metadata. The span hierarchy mirrors the harness structure:

```
Trace: "harness-run-<timestamp>"
  ├─ Span: "planner"
  ├─ Span: "sprint-1"
  │  ├─ Span: "contract-negotiation"
  │  ├─ Span: "attempt-0"
  │  │  ├─ Span: "generator"
  │  │  └─ Span: "evaluator"
  │  └─ Span: "attempt-1"
  │     └─ ...
  └─ ...
```

If Langfuse keys are not set, tracing is completely disabled with zero overhead. If Langfuse is unreachable at runtime, the harness logs a warning and continues — tracing never blocks agent work.

### Timezone Display

Terminal timestamps use the system's local timezone by default. Set `TZ_DISPLAY` (e.g. `Europe/Warsaw`) to override. Markdown log headers and persisted timestamps always use UTC.

## The Architecture

![diagram](/images/adversarial-development-harness.png)
(based on original diagram from https://github.com/coleam00/adversarial-dev)

```
User Prompt (1-4 sentences)
         |
         v
   +-----------+
   |  PLANNER  |  --> writes .harness/spec.md
   +-----------+
         |
         v  (for each sprint)
   +---------------------+
   | CONTRACT NEGOTIATION |  Generator proposes criteria,
   | Generator <-> Eval   |  Evaluator tightens the screws,
   +---------------------+  both lock in "done"
         |
         v
   +-----------+     fail + feedback     +------------+
   | GENERATOR | <---------------------- | EVALUATOR  |
   | (build)   | ----------------------> | (attack)   |
   +-----------+     implementation      +------------+
         |                                      |
         v              pass                    |
   Checkpoint + Next Sprint <-------------------+
```

### Sprint Contracts

Before any code is written, the generator and evaluator negotiate a **sprint contract**: a JSON document defining exactly what "done" means. Each criterion is specific and testable -- not "works well" but "PUT /frames/reorder returns 200 and reorders frames in the database."

The evaluator uses contract negotiation to set traps -- adding edge cases, tightening thresholds, and demanding specifics that force the generator to build robust code from the start. This is directly from Anthropic's approach. They found that JSON contracts work better than markdown because models are less likely to tamper with structured JSON.

### File-Based Communication

Agents communicate through files, not shared conversation history. This keeps each agent's context focused on its role:
- `.harness/spec.md` -- Product specification from the planner
- `.harness/contracts/sprint-{n}.json` -- Sprint contracts
- `.harness/feedback/sprint-{n}-round-{m}.json` -- Evaluator feedback per attempt
- `.harness/progress.json` -- Harness state tracking (includes checkpoint data for resume)

### Two Operating Modes

**Existing project mode** (default): The harness works directly in your project directory. Agents read the existing codebase to understand context and make changes in place. Only the `.harness/` directory is created for metadata. You should add `.harness/` to your `.gitignore`.

**Greenfield mode** (`--greenfield`): The harness creates a new project from scratch in an `app/` subdirectory with a fresh git repo. Metadata still goes to `.harness/`. This is useful for generating entire applications from a prompt.

## The GAN Connection

This architecture is inspired by **Generative Adversarial Networks** (GANs), where a generator creates outputs and a discriminator tries to reject them, iterating until quality emerges from the tension between the two.

| GANs | This Harness |
|------|-------------|
| Generator vs. discriminator | **Generator vs. evaluator** |
| Gradient descent | **Hard pass/fail thresholds** |
| Two networks | **Three agents** (adds planner) |
| Continuous training | **Sprint-based iteration** |
| Zero-sum game | **Asymmetric adversarial** -- evaluator tries to break, generator tries to survive |

The core insight is the same: **separate generation from evaluation, then pit them against each other**. A generator that evaluates its own work converges on mediocrity. A separate evaluator with the explicit mandate to find failures creates the adversarial pressure that forces quality upward. The generator doesn't just build -- it builds knowing an adversary is waiting.

## Why This Is the Future of AI Coding

We're at an inflection point. In 2025, the focus was on making individual agents smarter. In 2026, the focus has shifted to **harness design** -- the scaffolding around agents that makes them reliable.

Here's the key principle from Anthropic's article:

> "Every component in a harness encodes an assumption about what the model can't do on its own."

As models improve, harnesses simplify. When Opus 4.5 shipped, Anthropic removed context resets from their harness because the model could maintain coherence natively. When Opus 4.6 shipped with 1M tokens, they removed sprint decomposition entirely because the model could sustain coherent work across two-hour builds.

But the frontier doesn't shrink -- it moves. Better models make previous scaffolding unnecessary while opening new possibilities for harnesses that achieve more complex tasks. The **pattern** of separating planning, building, and evaluation is durable even as the implementation details evolve.

Two principles that matter most:
1. **Separate evaluation from generation.** Don't let the agent grade its own homework.
2. **Define "done" before you start.** Sprint contracts are how you turn vibing into engineering.

## Project Structure

```
harness/
├── shared/              # Shared types, config, prompts, utilities
│   ├── types.ts         # TypeScript interfaces
│   ├── config.ts        # Defaults, CLI parsing, config resolution
│   ├── prompts.ts       # Agent system prompts (static + dynamic builders)
│   ├── logger.ts        # Colored console output with timezone support
│   ├── files.ts         # File I/O for .harness/ metadata
│   ├── conversation-logger.ts  # Markdown conversation log writer
│   └── tracing.ts       # Langfuse tracing (no-op when disabled)
├── claude-harness/      # Claude Agent SDK implementation
│   ├── index.ts         # CLI entry point (parseArgs, config resolution)
│   ├── harness.ts       # Orchestration loop (checkpoint, resume, retry)
│   ├── planner.ts       # Planner agent
│   ├── generator.ts     # Generator agent
│   └── evaluator.ts     # Evaluator agent
├── codex-harness/       # Codex SDK implementation
│   ├── index.ts         # CLI entry point
│   ├── harness.ts       # Orchestration loop
│   ├── planner.ts       # Planner agent
│   ├── generator.ts     # Generator agent
│   └── evaluator.ts     # Evaluator agent
└── workspace/           # Runtime output for Codex harness (gitignored)
    └── codex/           # Codex harness working directory
```

The Claude harness works in the current directory (or `--project` target) by default. Its metadata goes into `.harness/` inside the project. The Codex harness uses the original `workspace/codex/` layout.

Both harnesses share the same prompts, types, and orchestration flow. The only differences are the SDK-specific agent implementations -- `query()` async generators for Claude, `Codex` threads for Codex.

## `.harness/` Directory

When the Claude harness runs, it creates a `.harness/` directory in the target project:

```
your-project/
├── src/                   # Your existing code (untouched in existing-project mode)
├── .git/
├── .harness/              # Created by the harness
│   ├── .env               # Optional: harness-specific config overrides
│   ├── progress.json      # Run state + checkpoint data
│   ├── spec.md            # Product specification from the planner
│   ├── contracts/         # Sprint contract JSON files
│   ├── feedback/          # Evaluator feedback JSON files
│   └── logs/              # Markdown conversation logs (always written)
└── ...
```

Add `.harness/` to your `.gitignore` to keep harness artifacts out of version control.
