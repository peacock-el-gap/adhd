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
| [Use a cheaper model](#configuration) | `adhd --model claude-sonnet-4-6 "Add auth"` |
| [Run non-interactively](#configuration) | `adhd --no-interactive --file spec.md` |

All commands below assume you're in the project directory. Use `--project <path>` to target a different directory without cd-ing.

### Enhance an Existing Project

Go to your project directory and run the harness. It reads your codebase, makes changes in place, and stores metadata in `.harness/`.

```bash
cd ~/my-app

# With an inline prompt:
adhd "Add authentication with JWT tokens and role-based access control"

# With a spec file (for complex changes):
adhd --file changes.md
```

The planner may ask clarifying questions in the terminal (60-second timeout). Use `--no-interactive` to skip this -- the planner will make its best judgment and document assumptions.

### Build a New Project

Create a project directory, then run with `--greenfield`. The harness creates an `app/` subdirectory (with its own git repo) for the generated code, and `.harness/` for metadata.

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

## What to Expect

**Duration:** A typical run takes 10-60 minutes depending on project complexity and number of sprints.

**Cost:** Uses Claude Opus by default. A full run with multiple sprints can consume significant API credits. Use `--model claude-sonnet-4-6` for lower cost, or `--max-sprints` to limit scope.

**What happens to your files:** In existing-project mode, the generator makes changes directly and creates git commits. In greenfield mode, all code goes into `app/`. The `.harness/` directory stores metadata and logs -- add it to your `.gitignore`.

**Terminal output:** Timestamped status messages, tool calls, and sprint pass/fail results. Use `--verbose` for full agent output or `--quiet` for just results.

**Automatic retries:** Transient errors (rate limits, server errors) are retried with backoff (30s, 60s, 120s). Non-transient errors (auth failures, quota) trigger a checkpoint and exit.

**Exit codes:**

| Code | Meaning |
|------|---------|
| 0 | All sprints passed |
| 1 | Sprint evaluation failed (generator couldn't pass the evaluator) |
| 2 | Infrastructure error (API failure, crash -- progress saved, use `--resume`) |

## How It Works

1. **Planning** -- The planner expands your prompt into a full product spec with features organized into sprints. Saved to `.harness/spec.md`.

2. **Contract Negotiation** -- For each sprint, the generator and evaluator negotiate a JSON contract defining exactly what "done" means. The evaluator adds edge cases and tightens criteria.

3. **Build** -- The generator implements features one at a time, making git commits after each.

4. **Evaluation** -- The evaluator reads the code, runs the application, and tries to break it. Each criterion is scored 1-10. All must meet the threshold (default: 7).

5. **Retry** -- If any criterion fails, detailed feedback goes back to the generator. This cycles up to `maxRetries` times per sprint.

6. **Checkpoint** -- After each passing sprint, progress is saved. Safe to interrupt and resume.

## The `.harness/` Directory

```
your-project/
├── src/                       # Your existing code
├── app/                       # Generated code (greenfield mode only)
├── .harness/                  # Harness metadata (add to .gitignore)
│   ├── .env                   # Optional: config overrides
│   ├── progress.json          # Run state + checkpoint data
│   ├── spec.md                # Product spec from the planner
│   ├── contracts/             # Sprint contract JSON files
│   ├── feedback/              # Evaluator feedback per attempt
│   └── logs/                  # Conversation logs (always written)
└── ...
```

**Conversation logs** are detailed markdown records of everything each agent said and did. Always written regardless of terminal log level. Useful for debugging or understanding agent decisions.

## Configuration

Settings via CLI flags, environment variables, or `.harness/.env` in the project directory.
Precedence: **CLI flag > env var > `.harness/.env` > default**.

| Setting | CLI Flag | Env Var | Default |
|---------|----------|---------|---------|
| User prompt | positional arg | -- | -- (required, except `--resume`) |
| Prompt file | `--file <path>` | -- | -- |
| Project directory | `--project <path>` | -- | current directory |
| Greenfield mode | `--greenfield` | -- | off (existing project) |
| Model | `--model <name>` | `CLAUDE_MODEL` | `claude-opus-4-6` |
| Max sprints | `--max-sprints <n>` | `MAX_SPRINTS` | `10` |
| Max retries/sprint | `--max-retries <n>` | `MAX_RETRIES` | `3` |
| Pass threshold | `--threshold <n>` | `PASS_THRESHOLD` | `7` |
| Log level | `--verbose` / `--quiet` | `LOG_LEVEL` | `normal` |
| Timezone display | -- | `TZ_DISPLAY` | system local |
| Non-interactive | `--no-interactive` | -- | interactive |
| Resume mode | `--resume` | -- | off |
| Langfuse tracing | -- | `LANGFUSE_PUBLIC_KEY` + `LANGFUSE_SECRET_KEY` | disabled |
| Langfuse base URL | -- | `LANGFUSE_BASEURL` | `https://cloud.langfuse.com` |

```env
# Example .harness/.env file
CLAUDE_MODEL=claude-sonnet-4-6
MAX_SPRINTS=6
PASS_THRESHOLD=8
LOG_LEVEL=verbose
TZ_DISPLAY=Europe/Warsaw
```

### Terminal Output Levels

| Level | What's shown |
|-------|-------------|
| `quiet` | Sprint pass/fail, errors only |
| `normal` | Tool names, scores, status messages (default) |
| `verbose` | Everything above + assistant text + tool input summaries |

### Langfuse Tracing

Set `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` to enable tracing to [Langfuse](https://langfuse.com). Zero overhead when disabled.

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
|  PLANNER  |  --> .harness/spec.md
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
