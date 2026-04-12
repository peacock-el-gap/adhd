# ADHD — Project Instructions

## Getting Started

```bash
bun install
bun link                                     # Makes 'adhd' available globally

# Run from any project directory:
cd ~/my-project
adhd "Your prompt here"
adhd --greenfield --file spec.md

# Or from the harness directory:
bun run start -- "Your prompt here"
```

## Architecture

### Directory Structure

```
shared/                    # SDK-independent utilities, domain types, pure logic
  orchestration/           # Sprint loop coordination (SDK-independent)
    harness.ts             # Main orchestrator — accepts AgentRunners interface
    sprint-attempts.ts     # Generator→evaluator retry loop
    sprint-success.ts      # Checkpoint, refinement, documenter phase
    gates.ts               # Spec approval with editor/revise loop
    git-ops.ts             # Git revert, dirty tree check, ensureAgentCommit primitive
    error-handling.ts      # Transient retry, fatal error, custom errors
    static-analysis-runner.ts  # Run lint/test commands
    spec-refinement.ts     # Mid-run spec evolution
    types.ts               # AgentRunners interface + context types
  (flat files)             # Types, config, prompts, files, logging, etc.

harness-claude/            # Claude Agent SDK specific ONLY
  index.ts                 # CLI entry — constructs AgentRunners, calls orchestration
  planner.ts               # Claude SDK agent wrapper
  generator.ts             # Claude SDK agent wrapper
  evaluator.ts             # Claude SDK agent wrapper
  documenter.ts            # Claude SDK agent wrapper
  contract.ts              # Sprint contract negotiation via Claude SDK
  agent-stream.ts          # Claude SDK message stream processing
  tracing-claude.ts        # Langfuse/OTEL instrumentation for Claude SDK
```

### SDK Independence Rule

**`shared/` must have zero imports from any LLM SDK.** This is enforced by design:
- `shared/tracing.ts` defines abstract `Tracer`/`Span` interfaces only
- `shared/orchestration/types.ts` defines the `AgentRunners` interface
- `harness-claude/` provides the Claude-specific implementations

### Adding a New Harness (e.g. harness-gemini)

1. Create `harness-gemini/` with SDK-specific agent wrappers
2. Each wrapper implements the signatures defined in `AgentRunners`
3. Create `harness-gemini/index.ts` that constructs the `AgentRunners` record and calls `runHarness(config, agents)` from `shared/orchestration/harness.ts`
4. No changes to `shared/` needed

### Naming Convention

Harness directories use `harness-{provider}` format (e.g., `harness-claude`, `harness-gemini`).

## Documentation Maintenance

### docs/ROADMAP.md

The roadmap is a living forward-looking document. When a roadmap item is completed:
- **Remove it** from Part 2 (opportunities) and Part 3 (roadmap tables)
- If the completed work introduces a new capability, **describe it in Part 1** (inventory)
- Do **not** mark items as "done", use strikethrough, or add implementation details — the roadmap should only contain planned work

## Development

```bash
bun run typecheck    # Type checking
bun run lint         # Biome lint + format check
bun run lint:fix     # Auto-fix lint/format issues
bun run test         # Unit + integration + smoke tests
```

## Agent SDK Reference

The `.claude/skills/claude-api/` skill provides Claude API and Agent SDK documentation.
For Agent SDK types and patterns, refer to the skill's `typescript/agent-sdk/` directory.
