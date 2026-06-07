# Cost and models

ADHD calls the Anthropic API many times per run, so cost is a first-class concern. This is how the
harness keeps it down by default, and how to steer it.

## The per-agent model matrix (and why it's tiered)

When you set neither `--model` nor a per-agent flag, each agent runs on a deliberately chosen tier:

| Agent | Default | Why this tier |
|-------|---------|---------------|
| Planner | `claude-opus-4-8` (Opus) | Runs once; its spec drives the whole run, so judgment matters most here. |
| Generator | `claude-sonnet-4-6` (Sonnet) | The cost-dominant agent (it runs every attempt of every sprint); its mistakes are recoverable via retries, so a mid-tier model is the right trade. |
| Evaluator | `claude-opus-4-8` (Opus) | The sole pass/fail gate — it has to out-reason the Generator. |
| Documenter | `claude-haiku-4-5-20251001` (Haiku) | Lowest stakes, advisory output, runs once. |
| Reviewer | `claude-opus-4-8` (Opus) | Advisory code-craft review; only runs with `--review`. |

**The invariant that matters: keep the Evaluator tier ≥ the Generator tier.** A judge weaker than the
producer rubber-stamps code it cannot actually out-reason. The harness only *warns* if you violate this —
it will not stop you — so it is on you to choose deliberately.

## How overrides resolve

Precedence, highest first: a **per-agent flag** (`--model-generator`, …) > the uniform **`--model`** >
the built-in tiered default. So `--model claude-opus-4-8 --model-generator claude-sonnet-4-6` runs
everything on Opus except the Generator.

The most common cost mistake is `--model claude-opus-4-8` alone: it lifts the Generator (the
cost-dominant agent) from Sonnet to Opus and can roughly triple spend. The harness warns when a uniform
override raises agents above their defaults, then proceeds. Override the Generator back down if you only
wanted stronger planning/judging.

`--model-contract` sets a single model for all contract-negotiation calls; left unset, negotiation uses
the Generator to propose and the Evaluator to review.

## Keeping spend in check

- **Preview free:** `--dry-run` runs only the Planner and exits — see the plan before paying for a build.
- **Scope the run:** `--max-sprints N` caps total sprints; smaller spec ⇒ fewer, tighter sprints.
- **Set a guardrail:** `--sprint-token-budget <tokens>` warns at 80% of the per-sprint ceiling and, at
  100%, pauses (interactive) or logs (non-interactive). It is a *soft* limit — it does not hard-stop a run.
- **Watch the ledger:** `.adhd/usage.json` accumulates cost across sessions (including resumes), with a
  per-stage and per-model breakdown in tokens and USD. Check it after the first sprint or two to project
  the full run. The terminal also prints a per-stage cost summary as it goes.

A full multi-sprint run on the defaults commonly lands in the hundreds-of-thousands-of-tokens range and
tens of dollars; the exact figure depends on codebase size, sprint count, and how many retries the
Evaluator forces.
