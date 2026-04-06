# ADHD Internals

Architecture details, design rationale, and project structure for harness developers.

For usage instructions, see the [README](../README.md).

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

Most AI coding agents fail on complex tasks not because the model is bad, but because nobody separated the work into specialized roles. A single agent that plans, builds, and evaluates its own work will reliably praise its own mediocre output. This is called **self-evaluation bias**, and it's the quiet killer of ambitious AI coding projects.

## Why Harness Design Matters

We're at an inflection point. In 2025, the focus was on making individual agents smarter. In 2026, the focus has shifted to **harness design** -- the scaffolding around agents that makes them reliable.

Here's the key principle from Anthropic's article:

> "Every component in a harness encodes an assumption about what the model can't do on its own."

As models improve, harnesses simplify. When Opus 4.5 shipped, Anthropic removed context resets from their harness because the model could maintain coherence natively. When Opus 4.6 shipped with 1M tokens, they removed sprint decomposition entirely because the model could sustain coherent work across two-hour builds.

But the frontier doesn't shrink -- it moves. Better models make previous scaffolding unnecessary while opening new possibilities for harnesses that achieve more complex tasks. The **pattern** of separating planning, building, and evaluation is durable even as the implementation details evolve.

Two principles that matter most:
1. **Separate evaluation from generation.** Don't let the agent grade its own homework.
2. **Define "done" before you start.** Sprint contracts are how you turn vibing into engineering.

## Architecture Details

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

**Existing project mode** (default): The harness works directly in your project directory. Agents read the existing codebase to understand context and make changes in place. Only the `.harness/` directory is created for metadata.

**Greenfield mode** (`--greenfield`): The harness creates a new project from scratch in an `app/` subdirectory with a fresh git repo. Metadata still goes to `.harness/`. This is useful for generating entire applications from a prompt.

### Checkpoint & Resume

After each passing sprint, the harness saves a checkpoint to `.harness/progress.json` -- including the git commit SHA, all sprint results, and the last evaluation feedback. If the harness is interrupted, `--resume` will:
- Skip the planning phase (spec already exists)
- Revert any incomplete sprint commits back to the last known good state
- Continue from the next unfinished sprint with full evaluation context

Transient errors (HTTP 429, 5xx, network timeouts) are retried automatically with exponential backoff (30s, 60s, 120s). Non-transient errors (quota exhaustion, auth failures) trigger a clean checkpoint and exit.

### Observability

**Conversation logs** are detailed markdown files written to `.harness/logs/` on every run, regardless of terminal log level. Files are named by role and context: `planner.md`, `sprint-1-contract-negotiation.md`, `sprint-1-attempt-0-generator.md`, etc. They include assistant text, tool calls with inputs, and tool outputs (long outputs collapsed in `<details>` blocks).

**Langfuse tracing** (optional) creates a span hierarchy mirroring the harness structure:

```
Trace: "harness-run-<timestamp>"
  +-- Span: "planner"
  +-- Span: "sprint-1"
  |   +-- Span: "contract-negotiation"
  |   +-- Span: "attempt-0"
  |   |   +-- Span: "generator"
  |   |   +-- Span: "evaluator"
  |   +-- Span: "attempt-1"
  |       +-- ...
  +-- ...
```

Tracing is fire-and-forget: if Langfuse is unreachable, the harness logs a warning and continues.

## Project Structure

```
harness/
├── shared/                        # Shared types, config, prompts, utilities
│   ├── types.ts                   # TypeScript interfaces (HarnessConfig, contracts, eval)
│   ├── config.ts                  # CLI parsing, env loading, config resolution
│   ├── prompts.ts                 # Agent system prompts (dynamic builders + static constants)
│   ├── logger.ts                  # Leveled logging (quiet/normal/verbose/debug) with timezone support
│   ├── files.ts                   # File I/O for .harness/ metadata
│   ├── conversation-logger.ts     # Markdown conversation log writer
│   └── tracing.ts                 # Langfuse tracing (no-op when disabled)
├── claude-harness/                # Claude Agent SDK implementation (actively developed)
│   ├── index.ts                   # CLI entry point
│   ├── harness.ts                 # Orchestration loop (checkpoint, resume, retry)
│   ├── planner.ts                 # Planner agent (async generator + interactive mode)
│   ├── generator.ts               # Generator agent (full tool access)
│   └── evaluator.ts               # Evaluator agent (read-only tools)
├── codex-harness/                 # Codex SDK implementation (frozen)
│   ├── index.ts                   # CLI entry point
│   ├── harness.ts                 # Orchestration loop
│   ├── planner.ts                 # Planner agent
│   ├── generator.ts               # Generator agent
│   └── evaluator.ts               # Evaluator agent
├── tests/                         # Unit tests (bun test)
├── biome.json                     # Linter/formatter config
├── CLAUDE.md                      # Project instructions for Claude Code
└── workspace/                     # Runtime output for Codex harness (gitignored)
```

The Claude harness uses dynamic prompt builders from `shared/prompts.ts` that interpolate the working directory and mode. The Codex harness uses static prompt constants from the same file -- these are frozen and should not be modified without checking codex-harness compatibility.

Both harnesses share the same types, config defaults, file I/O, and logging. The differences are SDK-specific: `query()` async generators for Claude, `Codex` threads for Codex.

## Development

```bash
bun run typecheck    # Type checking (tsc --noEmit)
bun run lint         # Biome lint + format check
bun run lint:fix     # Auto-fix lint/format issues
bun run test         # Unit tests
```
