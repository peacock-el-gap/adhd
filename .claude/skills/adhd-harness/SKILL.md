---
name: adhd-harness
description: >-
  Drive the ADHD harness — the adversarial multi-agent coding CLI invoked as `adhd` — to build features
  or whole projects inside any repo. Use this whenever the user wants to run `adhd`, start or resume an
  ADHD build/sprint, preview a plan with `--dry-run`, choose or scope flags (models, `--max-sprints`,
  `--threshold`, `--scout`, `--review`, `--commit-adhd`, `--greenfield`, …), understand the
  Planner/Generator/Evaluator/Documenter sprint loop or sprint contracts, control run cost, or debug an
  ADHD run (the `.adhd/` directory, interactive gates, contract-parse fallbacks). Trigger even when the
  user just says "run adhd", "build this with the harness", or names the `.adhd/` directory, a sprint, or
  a contract — they mean this tool. Do NOT trigger for the medical/attention condition "ADHD", for
  developing the harness's own source code, or for other, unrelated coding-agent tools.
---

# Driving the ADHD harness (`adhd`)

ADHD is a command-line coding harness you point at a project. You give it a goal in plain language; it
plans the work, builds it in stages, judges its own output adversarially, and documents the result. This
skill helps you (and the user) invoke it correctly, pick the right flags, keep cost in check, and
understand what it leaves behind.

`adhd` is a globally linked command (run `adhd --help` anywhere). It works on an existing project
(modifies it in place) or scaffolds a new one (`--greenfield`).

## The mental model (why it produces good code)

The whole design rests on one idea: **don't let an agent grade its own homework.** ADHD splits the work
across agents that don't share a conversation, so the one that judges is never the one that built:

- **Planner** turns your prompt into a spec broken into **sprints** (a handful of sequential, independently
  scoped chunks). Runs once, on a strong model.
- For each sprint, **Generator** and **Evaluator** first negotiate a **contract** — machine-readable,
  testable criteria that define "done" *before* any code is written. The contract, not prose, is the
  source of truth.
- **Generator** builds the sprint and commits.
- **Evaluator** is read-only and adversarial: it tries to *break* what was built and scores each
  criterion. It is the **sole pass/fail gate**. If a criterion falls short, the sprint retries with
  feedback (a few attempts); if it passes, the harness checkpoints and moves on.
- **Documenter** runs once at the end (README/CHANGELOG), on a cheap model. Advisory — it never fails the run.
- Optional: **Scout** (a read-only pass before building, to learn the codebase's conventions) and
  **Reviewer** (a read-only code-craft report after each sprint, advisory only).

Everything the harness knows about a run lives in files under **`.adhd/`** in the project — the spec,
contracts, evaluator feedback, progress checkpoints, a cost ledger, and an accumulating behavioural test
suite. That is what makes a run inspectable and resumable.

## Running it

Run `adhd` from inside the target project. The three canonical forms:

```bash
adhd "Add token-bucket rate limiting to the public API"   # existing project (default)
adhd --file spec.md                                       # drive from a written spec
adhd --greenfield "Build a CLI todo app in Rust"          # scaffold a new project under app/
```

Preview before you spend on a build — this runs only the Planner and shows the spec, then exits:

```bash
adhd --dry-run "Add token-bucket rate limiting to the public API"
```

**Prerequisites:** `ANTHROPIC_API_KEY` set (or an `.adhd/.env` in the project), the `bun` runtime, a git
repo, and ideally a clean working tree (the harness warns on a dirty tree but does not stop).

When the user asks "what does `--X` do" or which flags to combine, read **`references/flags.md`** rather
than answering from memory — the CLI evolves and that file is the authoritative list.

## Four things that surprise people

These are the failure modes worth pre-empting whenever someone runs `adhd`:

1. **It makes its own branch.** By default the harness creates a topic branch (`adhd/<slug>-<timestamp>`)
   before building, so commits never land on your current branch or `main`. If you *wanted* the commits on
   the current branch, pass `--allow-main`. Either way, tell the user where their work ended up.

2. **Gitignore `.adhd/`.** The harness writes all its bookkeeping into `.adhd/` in the project. Add
   `.adhd/` to `.gitignore` so it never pollutes the user's commits — by default the harness commits
   nothing from `.adhd/`. (If they ever opt into committing harness metadata with `--commit-adhd`, only
   two files are worth keeping long-term: `.adhd/usage.json`, the cumulative cost ledger, and
   `.adhd/regression.json`, the behavioural suite.)

3. **It costs real money.** A full multi-sprint run can use hundreds of thousands of tokens and tens of
   dollars. Preview with `--dry-run`, scope with `--max-sprints`, set a guardrail with
   `--sprint-token-budget`, and check `.adhd/usage.json` for the per-stage, per-model breakdown. See
   **`references/cost-and-models.md`**.

4. **Interactive gates need a human — or `--no-interactive`.** The harness pauses at decision points
   (spec approval, contract preview, evaluator override, mid-run steering) with countdown timers. In CI or
   any headless run, pass `--no-interactive` (auto-accept defaults) or `--gate-timeout 0`, or it will stall
   waiting for input.

## Going deeper

Read these on demand — don't load them up front:

- **`references/flags.md`** — every flag and env var, grouped, plus a verbatim, always-current
  `adhd --help` block. The source of truth when a flag's exact behaviour matters.
- **`references/workflow.md`** — the full run lifecycle, and the distinctions people get wrong:
  `--resume` vs `--sprint N` vs `--dry-run`, progressive spec refinement, and BDD regression accumulation.
- **`references/cost-and-models.md`** — the per-agent model matrix, why it's tiered that way, the
  Evaluator-≥-Generator invariant, and how to keep spend down.
- **`references/troubleshooting.md`** — the *silent* failure modes (contract-parse fallback, Scout skipped
  in greenfield, a skill shadowing another, dirty-tree side effects) and where to look in `.adhd/logs/`.

If the flag list ever looks stale, regenerate it: **`scripts/sync-help.sh`** rewrites the auto-generated
block in `flags.md` from the live `adhd --help`. When in doubt, just run `adhd --help`.
