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
bun run start -- "Your prompt here"         # Claude harness
bun run start:codex -- "Your prompt here"   # Codex harness (frozen)
```

## Architecture

This section serves as the project's architecture reference. See README.md "The Architecture" section for full details.

- `shared/` — Types, config, prompts, file I/O, logging, tracing (used by both harnesses)
- `claude-harness/` — Claude Agent SDK implementation (actively developed)
- `codex-harness/` — Codex SDK implementation (frozen — no new features planned)

## Development

```bash
bun run typecheck    # Type checking
bun run lint         # Biome lint + format check
bun run lint:fix     # Auto-fix lint/format issues
bun run test         # Unit tests
```

## Agent SDK Reference

The `.claude/skills/claude-api/` skill provides Claude API and Agent SDK documentation.
For Agent SDK types and patterns, refer to the skill's `typescript/agent-sdk/` directory.
