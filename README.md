# Adversarial Development Harness for Delivery (ADHD)

A three-agent harness that separates **planning**, **building**, and **evaluation** into distinct AI agents. The evaluator's job is to **break** what the generator builds -- creating adversarial tension that drives quality beyond what a single agent achieves.

| Agent | Role | Analogy |
|-------|------|---------|
| **Planner** | Expands a short prompt into a full product spec with sprints | Product manager |
| **Generator** | Builds one feature at a time, commits to git | Software engineer |
| **Evaluator** | Actively tries to break what the generator built, scores ruthlessly | Adversarial QA |

Based on Anthropic's [Harness Design for Long-Running Application Development](https://www.anthropic.com/engineering/harness-design-long-running-apps). Initial version from [coleam00/adversarial-dev](https://github.com/coleam00/adversarial-dev).

## Install

### Prerequisites

- [Bun](https://bun.sh) runtime
- Claude CLI authenticated (`claude auth login`)

### Setup

```bash
git clone https://github.com/peacock-el-gap/harness
cd harness
bun install
bun link        # Makes 'adhd' available as a global command
```

After `bun link`, you can run `adhd` from any directory -- it operates on the current directory by default.

> **Alternative:** If you prefer not to use `bun link`, you can create a shell alias:
> ```bash
> alias adhd='bun run /path/to/harness/claude-harness/index.ts'
> ```
> Or run directly from the harness directory with `bun run start -- [flags]`.

## Usage

| I want to... | Command |
|---|---|
| [Enhance my project with a prompt](#enhance-an-existing-project) | `adhd "Add auth with JWT"` |
| [Enhance my project with a spec file](#enhance-an-existing-project) | `adhd --file changes.md` |
| [Build a new project from a prompt](#build-a-new-project) | `adhd --greenfield "Build a task manager"` |
| [Build a new project from a spec file](#build-a-new-project) | `adhd --greenfield --file spec.md` |
| [Resume after interruption](#resume-after-interruption) | `adhd --resume` |
| [Preview the plan without building](#dry-run) | `adhd --dry-run "Add auth with JWT"` |
| [Provide reference docs to the planner](#context-injection) | `adhd --context api-spec.yaml "Implement the API"` |
| [Use a cheaper model](#configuration) | `adhd --model claude-sonnet-4-6 "Add auth"` |
| [Use different models per agent](#configuration) | `adhd --model-planner claude-sonnet-4-6 "Add auth"` |
| [Work on a dedicated branch](#configuration) | `adhd --branch feature/auth "Add auth"` |
| [Run non-interactively](#configuration) | `adhd --no-interactive --file spec.md` |
| [Skip all interactive gates](#configuration) | `adhd --gate-timeout 0 --file spec.md` |

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

## What to Expect

**Duration:** A typical run takes 10-60 minutes depending on project complexity and number of sprints.

**Cost:** Uses Claude Opus by default. A full run with multiple sprints can consume significant API credits. Use `--model claude-sonnet-4-6` for lower cost, or `--max-sprints` to limit scope.

**What happens to your files:** In existing-project mode, the generator makes changes directly and creates git commits. In greenfield mode, all code goes into `app/`. The `.adhd/` directory stores metadata and logs -- add it to your `.gitignore`.

**Interactive gates:** In interactive mode (the default), the harness pauses at key decision points for your input. Gates have countdown timers with sensible defaults -- press any key to choose, or wait for the timeout. Gates include: dirty-tree warning before starting, spec approval after planning, contract preview before each sprint, evaluator override on failures, and mid-run steering between sprints. Use `--no-interactive` or `--gate-timeout 0` to skip all gates.

**Cost tracking:** After each run, the harness prints a per-stage cost summary and saves cumulative usage data to `.adhd/usage.json`. This tracks input/output tokens and USD cost for each planner, generator, and evaluator invocation across sessions.

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

3. **Contract Negotiation** -- For each sprint, the generator and evaluator negotiate a JSON contract defining exactly what "done" means. The evaluator adds edge cases and tightens criteria. You get a preview before building starts.

4. **Build** -- The generator implements features one at a time, making git commits after each. After the generator finishes, the harness verifies that all changes were committed. If not, it resumes the generator session to request a meaningful commit message. As a last resort, the harness auto-commits with a descriptive fallback message referencing the sprint and features.

5. **Evaluation** -- The evaluator reads the code, runs the application, and tries to break it. Each criterion is scored 1-10. All must meet the threshold (default: 7). If the evaluator fails a sprint, you can override the score and force a PASS (useful for false negatives).

6. **Retry** -- If any criterion fails, detailed feedback goes back to the generator. This cycles up to `maxRetries` times per sprint.

7. **Checkpoint & Steering** -- After each passing sprint, progress is saved. Between sprints you can continue, skip a sprint, edit the spec, or abort. Safe to interrupt and resume.

## The `.adhd/` Directory

```
your-project/
├── src/                       # Your existing code
├── app/                       # Generated code (greenfield mode only)
├── .adhd/                     # Harness metadata (add to .gitignore)
│   ├── .env                   # Optional: config overrides
│   ├── progress.json          # Run state + checkpoint data
│   ├── spec.md                # Product spec from the planner
│   ├── usage.json             # Cumulative cost/token tracking across sessions
│   ├── contracts/             # Sprint contract JSON files
│   ├── feedback/              # Evaluator feedback per attempt
│   └── logs/                  # Conversation logs (always written)
└── ...
```

**Conversation logs** are detailed markdown records of everything each agent said and did. Always written regardless of terminal log level. Useful for debugging or understanding agent decisions.

## Configuration

Settings via CLI flags, environment variables, or `.adhd/.env` in the project directory.
Precedence: **CLI flag > env var > `.adhd/.env` > default**.

| Setting | CLI Flag | Env Var | Default |
|---------|----------|---------|---------|
| User prompt | positional arg | -- | -- (required, except `--resume`) |
| Prompt file | `--file`, `-f` `<path>` | -- | -- |
| Project directory | `--project <path>` | -- | current directory |
| Greenfield mode | `--greenfield` | -- | off (existing project) |
| Model (all agents) | `--model <name>` | `CLAUDE_MODEL` | `claude-opus-4-6` |
| Planner model | `--model-planner <name>` | `MODEL_PLANNER` | same as `--model` |
| Generator model | `--model-generator <name>` | `MODEL_GENERATOR` | same as `--model` |
| Evaluator model | `--model-evaluator <name>` | `MODEL_EVALUATOR` | same as `--model` |
| Max sprints | `--max-sprints <n>` | `MAX_SPRINTS` | `10` |
| Max retries/sprint | `--max-retries <n>` | `MAX_RETRIES` | `3` |
| Pass threshold | `--threshold <n>` | `PASS_THRESHOLD` | `7` |
| Log level | `--verbose` / `--quiet` / `--debug` | `LOG_LEVEL` | `normal` |
| Timezone display | -- | `TZ_DISPLAY` | system local |
| Non-interactive | `--no-interactive` | -- | interactive |
| Resume mode | `--resume` | -- | off |
| Dry-run mode | `--dry-run` | -- | off |
| Context files | `--context <file>` (repeatable) | -- | none |
| Branch creation | `--branch <name>` | -- | off (stay on current branch) |
| Editor for spec | `--editor <cmd>` | `ADHD_EDITOR` or `EDITOR` | none |
| Gate timeout | `--gate-timeout <sec>` | `ADHD_GATE_TIMEOUT` | varies by gate (0 = skip all) |
| Langfuse tracing | -- | `LANGFUSE_PUBLIC_KEY` + `LANGFUSE_SECRET_KEY` | disabled |
| Langfuse base URL | -- | `LANGFUSE_BASE_URL` | `https://cloud.langfuse.com` |

```env
# Example .adhd/.env file
CLAUDE_MODEL=claude-sonnet-4-6
MAX_SPRINTS=6
PASS_THRESHOLD=8
LOG_LEVEL=verbose
TZ_DISPLAY=Europe/Warsaw
ADHD_EDITOR=code --wait
MODEL_PLANNER=claude-sonnet-4-6

# Langfuse tracing (optional)
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
# LANGFUSE_BASE_URL=https://your-instance.example.com  # only for self-hosted
```

### Terminal Output Levels

| Level | What's shown |
|-------|-------------|
| `quiet` | Sprint pass/fail, errors only |
| `normal` | Tool names, scores, status messages (default) |
| `verbose` | Everything above + assistant text + tool input summaries |
| `debug` | Everything above + config details, SDK call tracing, message types |

### Langfuse Tracing

[Langfuse](https://langfuse.com) integration traces every harness run — planner calls, generator sprints, evaluator scores, and tool usage. Zero overhead when disabled.

**Setup:**

1. Create a Langfuse account (cloud or self-hosted) and generate API keys from **Settings → API Keys**.
2. Add the keys to your project's `.adhd/.env`:
   ```env
   LANGFUSE_PUBLIC_KEY=pk-lf-...
   LANGFUSE_SECRET_KEY=sk-lf-...
   ```
   For self-hosted instances, also set `LANGFUSE_BASE_URL` (defaults to `https://cloud.langfuse.com`).
3. Run with `--debug` to confirm: you should see `Langfuse tracing: enabled` in the startup output.

## Example Prompts

The `example-prompts/` directory contains sample spec files for reference -- a RAG chat application and an initiative tracker. These show the level of detail that produces good results with the planner.

## Codex Harness

> **Note:** The Codex harness is frozen -- it works as-is but no new features are planned.

The Codex harness uses greenfield-only mode, building into `workspace/codex/app/`. It does not support `--project`, `--resume`, or configuration flags.

```bash
# From the harness directory:
bun run start:codex -- "Build a task manager with REST API and dashboard"
```

## Architecture

For design rationale, the GAN connection, and project structure, see [docs/INTERNALS.md](docs/INTERNALS.md).

![diagram](/images/adversarial-development-harness.png)

```
User Prompt
     |
     v
+-----------+
|  PLANNER  |  --> .adhd/spec.md
+-----------+
     |
     v  (for each sprint)
+---------------------+
| CONTRACT NEGOTIATION |  Generator proposes,
| Generator <-> Eval   |  Evaluator tightens
+---------------------+
     |
     v
+-----------+    fail + feedback    +------------+
| GENERATOR | <-------------------- | EVALUATOR  |
| (build)   | -------------------> | (attack)   |
+-----------+    implementation     +------------+
     |                                    |
     v             pass                   |
  Checkpoint + Next Sprint <--------------+
```
