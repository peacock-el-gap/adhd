# ADHD Harness — Roadmap

## How to Read This Document

This report has three parts. Each builds on the previous:

- **Part 1** catalogues every methodical functionality implemented in the harness.
- **Part 2** identifies open gaps and opportunities, each with options, pros/cons, and recommendations.
- **Part 3** organizes opportunities into a prioritized roadmap. A separate **Content Stream** runs in parallel for work that requires no code changes.

The document is self-contained. No prior conversation context is required.

---

## Part 1: Inventory of Built-In Methodical Functionalities

The harness encodes a rich set of SDLC practices across its four-agent architecture. Each functionality below is fully implemented and operational.

### 1.1 GAN-Inspired Adversarial Architecture

The foundational design pattern: **separate generation from evaluation, then pit them against each other**. Four specialized agents (Planner, Generator, Evaluator, Documenter) communicate through files, not shared conversation history. This prevents **self-evaluation bias** — the quiet killer of single-agent coding tools where the model praises its own mediocre output.

- **Planner**: Creates product specification with sprint decomposition
- **Generator**: Implements features with full tool access (Read, Write, Edit, Bash, Glob, Grep)
- **Evaluator**: Tests and scores with read-only tools (Read, Bash, Glob, Grep — no Write/Edit)
- **Documenter**: Synthesizes codebase + `.adhd/` artifacts into project documentation (README, API docs, CHANGELOG) after all sprints pass

The asymmetry is intentional: the evaluator cannot fix problems, only report them. This forces the generator to produce genuinely working code. The documenter runs post-sprint as a synthesis step, not an adversarial one.

### 1.2 Sprint-Based Decomposition

The Planner decomposes work into 3-6 sequential sprints with independent scope. Each sprint is a self-contained unit of work with its own contract, build-evaluate cycle, and checkpoint. This mirrors Scrum sprint planning but with adversarial validation through contract negotiation.

### 1.3 Contract Negotiation

Before any code is written, the Generator proposes a sprint contract (5-15 testable criteria), then the Evaluator reviews it for specificity, completeness, and measurability. Anti-vagueness rules reject "works well" or "looks good" — only measurable criteria survive.

This is **Definition of Done as a protocol**: machine-readable JSON, not a wiki page nobody reads.

When contract JSON parsing fails, the harness logs a truncated preview to the console and writes the full raw text to `.adhd/logs/sprint-N-contract-parse-error.txt` before falling back to a generic default contract — so parse failures are observable rather than silent.

### 1.4 BDD (Behavior-Driven Development)

When enabled (default), the Planner writes acceptance scenarios in **Given/When/Then** format. These flow into sprint contracts as testable criteria. The Evaluator verifies that tests exist for each scenario and that they pass.

BDD criteria tagged `"type": "behavioral"` during contract negotiation are **accumulated across sprints** as a regression set (see §1.14). This turns BDD scenarios into persistent behavioral invariants — Sprint 3 cannot silently break behavior established in Sprint 1.

Disableable via `--no-bdd`. Also filters community skills tagged `type: methodology-bdd`. Disabling BDD also disables regression accumulation.

### 1.5 TDD (Test-Driven Development)

When enabled (default), the Generator receives explicit Red-Green-Refactor instructions: write failing tests first, implement until tests pass, then refactor. The Evaluator checks that tests exist and are meaningful — but enforcement is pragmatic (spirit over ceremony; commit ordering is not mechanically enforced).

Disableable via `--no-tdd`. Also filters skills tagged `type: methodology-tdd`.

### 1.6 Build-Evaluate Retry Loop (max 3 attempts)

The core adversarial cycle:

```
For each sprint:
  For attempt 0..maxRetries:
    Generator implements (with previous feedback on retry)
    Commit enforcement (3-tier safety net)
    Evaluator scores against contract criteria
    If ALL criteria >= threshold → PASS, break
    If failed → inject detailed feedback, retry
```

On retry, the Generator must apply a **REFINE vs PIVOT** decision:
- **REFINE** if scores are trending upward (incremental improvement)
- **PIVOT** if scores are flat or declining (fundamental rethink needed)

Evaluator feedback is structured: file paths, line numbers, exact errors, specific criterion scores.

### 1.7 Five Interactive Control Gates

Human-in-the-loop at every critical decision point, implemented via timed single-keypress prompts with countdown bars:

| Gate | When | Default on Timeout | Purpose |
|------|------|--------------------|---------|
| **Dirty-tree check** | Before start | Continue | Warn about uncommitted changes |
| **Spec approval** | After planning | Abort (safe) | Approve / Edit / Revise / Abort |
| **Contract preview** | Before each sprint | Accept | Review sprint scope |
| **Evaluator override** | On failed evaluation | Retry | Force PASS on false negatives |
| **Mid-run steering** | Between sprints | Continue | Continue / Edit spec / Skip / Abort |

All gates support `[w]` to pause the timer. All are skippable via `--gate-timeout 0` or `--no-interactive`.

### 1.8 Three-Tier Commit Enforcement

Safety net ensuring every agent run that produces changes also produces a git commit. Applied uniformly to both the Generator and the Documenter via a shared `ensureAgentCommit` primitive in `shared/orchestration/git-ops.ts`:

1. **Check** — Did the agent commit on its own? (Compare HEAD before/after)
2. **Resume** — If uncommitted changes exist, resume the agent's SDK session with a commit-only prompt (max 3 turns, Bash-only) using the SDK's `resume` field to load the original conversation history
3. **Fallback** — Harness runs `git add -A && git commit` with a contextual message referencing the sprint and features (tagged `[auto-commit]` for the Generator, `[docs]` for the Documenter)

`commitSource` field ("agent" | "resume" | "fallback" | "none") tracked in each SprintResult for compliance monitoring.

### 1.9 Checkpoint & Resume

After each passing sprint, a checkpoint is saved to `.adhd/progress.json` with the git commit SHA, all sprint results, and evaluation feedback. On `--resume`:
- Planning phase is skipped (spec exists)
- Incomplete sprint commits are reverted to last known good state
- Sprint loop continues from the next unfinished sprint

Transient errors (HTTP 429, 5xx, network) retried automatically with exponential backoff (30s, 60s, 120s).

Resume is idempotent: if a sprint contract already exists at `.adhd/contracts/sprint-N.json`, contract negotiation is skipped and the existing contract is reused — the same pattern used by `--sprint N`. Checkpoint rollback stashes `.adhd/` files, runs `git reset --hard <checkpoint-sha>`, then unstashes, producing a clean code state with deterministic behavior even when the harness has written uncommitted metadata.

### 1.10 Skills System (Three-Scope, Self-Routing)

A full plugin mechanism for composable guidance:

**Three scopes** (precedence: project > user > harness):
- `<harness>/shared/skills/` — Built-in (spec-format, contract-structure, evaluation-criteria)
- `~/.adhd/skills/` — User-wide (reusable across projects)
- `<project>/.adhd/skills/` — Project-specific (installed or hand-written)

**Per-agent routing** via `skill.yaml` manifests:
- `inject` — Content embedded in system prompt (high impact, always loaded)
- `reference` — Listed as available files via `additionalDirectories` (agent reads on demand)
- `exclude` — Not provided to this agent

**Methodology-aware filtering**: `--no-bdd` removes `type: methodology-bdd` skills, `--no-tdd` removes `type: methodology-tdd`.

### 1.11 Observability Stack

Three layers, all operational:

1. **Conversation logs** — Detailed markdown per agent/sprint/attempt in `.adhd/logs/`. Always written regardless of log level. Tool calls with inputs, results (long outputs collapsed in `<details>`). Filenames are prefixed with a `YYYY.MM.DD-HH.MM.SS` timestamp (e.g., `2026.04.10-05.28.33-sprint-5-attempt-0-generator.md`) so resume/retry never overwrites prior evidence, `ls` sorts chronologically, and Langfuse trace names align.
2. **Langfuse OTEL tracing** — Optional hierarchical span tree mirroring the harness structure. Fire-and-forget; zero impact on agent behavior.
3. **Per-stage cost tracking with per-model attribution** — Tokens, USD, duration per SDK call, plus the resolved model that produced each stage. Two terminal summary views: a per-stage breakdown with model column and a per-model rollup sorted by total USD descending. Stage entries carry a `model` field in `.adhd/usage.json`; legacy entries without the field load as `"unknown"` for backward compatibility. Accumulated across resume sessions.

### 1.12 Post-Run Documentation Generation

After all sprints pass, a dedicated **Documenter** agent synthesizes the codebase and `.adhd/` artifacts (spec, contracts, evaluation feedback, BDD scenarios) into project documentation:

- **README.md** — Overview, setup, usage, architecture, features
- **CHANGELOG.md** — One section per sprint, derived from contract history
- **API.md** — Conditional, only if API endpoints exist

The Documenter reads the actual code (not just the spec) and uses an artifact digest (`shared/artifact-digest.ts`) with token-budget enforcement to stay within context limits. Advisory validation (`shared/doc-validation.ts`) warns if README or CHANGELOG are missing or too short.

Key properties:
- Runs once after all sprints pass (not per-sprint)
- Disableable via `--no-docs` (or `ADHD_NO_DOCS` env var)
- Per-agent model override via `--model-documenter`
- Non-fatal: documentation failure does not fail the run
- Resume-aware: re-attempts documentation if a previous run failed at this stage
- Commit enforcement: uses the same three-tier `ensureAgentCommit` primitive as the Generator (§1.8), with `[docs]`-prefixed fallback message referencing the sprints it documented

### 1.13 Additional Operational Features

| Feature | Description |
|---------|-------------|
| **Dry-run mode** (`--dry-run`) | Run planner + spec approval only. Zero generation cost. |
| **Multi-model strategy** | Per-agent model overrides (`--model-planner`, `--model-generator`, `--model-evaluator`, `--model-documenter`, `--model-contract`) layered over a reasoned per-agent default matrix (see §1.23–§1.24) |
| **Context injection** (`--context <file>`) | Feed API specs, schemas, design docs into planner prompt |
| **Branch creation** (`--branch <name>`) | Create feature branch before sprint loop |
| **Greenfield mode** (`--greenfield`) | Scaffold fresh `app/` with git init |
| **Directory conventions** (`--source-dir`, `--test-dir`) | Control where agents place source and test code |
| **Planner HITL** (`AskUserQuestion`) | Planner can ask clarifying questions mid-planning (60s timeout) |
| **Timezone display** (`TZ_DISPLAY`) | Configurable terminal timestamp timezone |
| **HITL notifications** | Terminal bell (`\x07`) on every HITL gate. `--notify` flag adds desktop notifications via `notify-send` (Linux) / `osascript` (macOS) for backgrounded terminals. |
| **Opt-in artifact commits** (`--commit-adhd`, `--commit-adhd-logs`) | Harness-level git commits for `.adhd/contracts/`, `.adhd/feedback/`, `.adhd/progress.json`, `.adhd/spec.md` (and optionally `.adhd/logs/`) after each sprint, tagged `[adhd]`. Provides structured audit trail without polluting project history by default. |
| **Pre-Generator artifact commit** | Before invoking the Generator, the harness commits `.adhd/` artifacts with an `[adhd]` message so the Generator starts with a clean working tree and rollbacks remain deterministic. |
| **Real-time `"documenting"` progress status** | `progress.json` sets `status: "documenting"` while the Documenter runs, distinct from `"complete"`, so external monitors reflect actual state. |

### 1.14 BDD Regression Accumulation Across Sprints

After each passing sprint, behavioral contract criteria (those tagged `"type": "behavioral"`) are accumulated into a persistent regression set stored at `.adhd/regression.json`. When evaluating subsequent sprints, the Evaluator receives both the current sprint's contract AND all accumulated behavioral criteria from prior sprints.

- **Criteria classification**: Contract negotiation prompts require every criterion to have a `"type"` field — either `"behavioral"` (observable behavior, API contracts, user-facing functionality) or `"implementation"` (code quality, naming, internal structure). Only behavioral criteria accumulate for regression.
- **Graceful degradation**: If regression criteria cannot be read, the sprint proceeds without them.
- **BDD-gated**: Regression accumulation is disabled when `--no-bdd` is set.

### 1.15 Pre-Evaluation Static Analysis Gate

Between Generator output and Evaluator invocation, the harness detects and runs the project's existing lint/typecheck commands (via `package.json` scripts or conventions). Results are injected into the Evaluator's context as supplementary data.

Two modes:
- **Soft gate** (default): Static analysis output is injected into the Evaluator prompt. No retry consumed; Evaluator decides severity.
- **Hard gate** (`--lint-gate`): If any lint/typecheck command exits non-zero, the Evaluator is skipped entirely and the attempt counts as failed. Static analysis output is included in the feedback.

Output is auto-truncated to prevent prompt bloat.

### 1.16 Diff-Aware Evaluation on Retries

On retry attempts (attempt > 0), the harness computes `git diff` between the previous attempt's commit and the current one. This diff is injected into the Evaluator's prompt as supplementary context, allowing the Evaluator to focus on what changed while still checking all criteria.

Ordering in the Evaluator prompt: regression criteria → diff → static analysis results.

### 1.17 Sprint Selection (`--sprint N`)

`--sprint N` jumps to sprint N, loading the existing spec and reusing any existing contract for that sprint. If no contract exists, contract negotiation runs for that sprint only. Only the targeted sprint executes — no other sprints run.

- Requires an existing spec (errors if none found)
- Warns if no checkpoint exists for sprint N-1
- Mutually exclusive with `--resume`
- Preserves existing `progress.json` sprint results when available

### 1.18 Quality Criteria in Contracts

Contract negotiation prompts (both Generator proposal and Evaluator review) now require quality-focused criteria alongside behavioral ones. The Generator must include at least one `"implementation"`-type criterion covering code quality aspects: naming conventions, code duplication (DRY), error handling patterns, and maintainability. The Evaluator rejects contracts missing quality criteria.

The Evaluator's system prompt includes a dedicated **Quality Criteria** section mandating that quality criteria are scored with the same rigor and threshold as functional criteria — they are not advisory.

### 1.19 Progressive Spec Refinement

When `--refine-spec` is set, after each passing sprint (except the last), the Planner re-reads the spec plus the actual code state and proposes adjustments to remaining sprints. Completed sprints are frozen — only not-yet-started sprints can be modified.

**Guardrails**:
1. Completed sprint sections are programmatically frozen and force-repaired if the Planner modifies them
2. Accumulated BDD regression criteria are preserved across refinement
3. A diff of proposed changes is displayed to the user
4. A HITL gate allows accepting or rejecting the revised spec (auto-accepted in non-interactive mode)
5. Sprint count is recalculated from the revised spec

### 1.20 Surface-Aware Sprint Contracts

Each sprint contract names the parts of the codebase it intends to change, drawn from a fixed six-value vocabulary defined once in `shared/surfaces.ts`: `backend`, `frontend`, `db`, `tests`, `docs`, `config`. Contract negotiation requires it — the Generator proposes a non-empty `surfaces` array reflecting the sprint's real footprint, and the Evaluator's contract review rejects any contract whose surfaces are missing, empty, or contain a token outside the vocabulary.

Surfaces are normalized on every read and write: unknown and duplicate tokens are dropped, first-seen order is preserved, and malformed stored values degrade to "absent" rather than crashing a run. Contract JSON persists with a stable key order (`sprintNumber`, `features`, `surfaces`, `criteria`); legacy contracts that predate the field round-trip untouched and never gain a spurious empty array.

Declaring surfaces is what makes scope checkable — it is the input both the coverage gate (§1.21) and the size ceiling (§1.22) measure against.

### 1.21 Pre-Evaluation Surface Coverage Gate

A cheap, AI-free check that runs after the Generator commits but before the Evaluator: did the sprint actually touch every surface its contract promised? The harness lists the files the attempt changed with `git diff --name-only` (excluding `.adhd/` metadata so harness bookkeeping never inflates the count) and classifies each path to at most one surface using an ordered pattern table covering common Bun/Node/TS, Python, Go, and Ruby layouts. Test paths take precedence, so a test file with a UI extension (e.g. `Button.test.tsx`) classifies as `tests`, not `frontend`.

If any declared surface was left untouched, the attempt fails immediately with a skipped-Evaluator result and feedback naming the missing surfaces — no Evaluator spend on work that visibly dropped part of its scope. This is the cheaper of the two pre-Evaluator gates and runs before the static-analysis gate (§1.15); whichever fails first short-circuits the attempt.

Like diff-aware evaluation (§1.16), the gate measures against the previous attempt's commit, so it engages on retry attempts. It degrades gracefully: a contract that declares no surfaces, or an attempt whose changed-file list cannot be computed, simply proceeds to the Evaluator as before.

### 1.22 Contract Size Ceiling

Contract negotiation enforces configurable per-sprint size limits to stop scope inflation before any code is generated: at most `maxFeatures` features, `maxCriteria` criteria, and `maxSurfaces` surfaces (defaults 3 / 10 / 2), set via `--max-features` / `--max-criteria` / `--max-surfaces` or the matching `MAX_FEATURES` / `MAX_CRITERIA` / `MAX_SURFACES` env vars, following the standard CLI > env > `.adhd/.env` > default precedence.

The reviewer is told the active caps and must narrow an over-budget proposal rather than approve it. If the negotiated contract still exceeds a limit, the harness runs exactly one additional reviewer narrowing round — never a loop — and, as a final guarantee, applies a pure deterministic trim that keeps the first items within every cap so the Generator is never handed over-budget work. Odd limit values (NaN, negatives, non-numbers) are treated as "no cap" for that dimension, so a misconfiguration disables trimming rather than crashing or emptying a contract. The ceiling logic lives in pure, never-throwing helpers in `shared/contract-limits.ts`; only the single narrowing round touches the SDK.

This is the negotiation-time complement to the coverage gate (§1.21): the ceiling stops a sprint from being defined too large; the gate catches a sprint that silently delivers less than it declared.

### 1.23 Per-Agent Model Defaults & the Evaluator ≥ Generator Invariant

Each of the four agents runs on a tier chosen for its role and blast radius, applied automatically when no model flag is set: **Planner** and **Evaluator** on Opus, **Generator** on Sonnet, **Documenter** on Haiku. The three tier IDs live in one place (`shared/models.ts`) and are referenced by name everywhere else — no model-ID string appears elsewhere in `shared/` or `harness-claude/`.

Per agent, selection follows a fixed precedence: an explicit per-agent flag (`--model-planner` / `--model-generator` / `--model-evaluator` / `--model-documenter`, or the matching `MODEL_*` env var) overrides a uniform `--model` / `CLAUDE_MODEL`, which in turn overrides the agent's tier default; blank values are ignored so they fall through cleanly. At startup the harness prints the resolved model for all four agents (the Documenter included) so the run's configuration is shown honestly.

A governing invariant holds across every profile: **the Evaluator's tier must be at least the Generator's.** The Evaluator is the sole pass/fail gate (§1.1), and a judge weaker than the producer would rubber-stamp code it cannot out-reason — and a false PASS is never re-litigated, whereas a weak Generator is always caught and retried. If a chosen configuration puts the Evaluator below the Generator, the harness logs a one-time advisory warning at startup and continues; it never hard-fails, and it stays silent when either model is an unrecognized ID it cannot rank.

### 1.24 Single-Model Contract Negotiation Override

Contract negotiation normally inherits a split — the Generator's model proposes the contract, and the Evaluator's model reviews it and runs any narrowing round (§1.22). The optional `--model-contract` flag (or `MODEL_CONTRACT` env var) collapses all three negotiation calls onto one model, letting a project decouple negotiation from the Generator/Evaluator picks without disturbing the rest of the matrix. When unset, the inherited propose/review split is used.

### 1.25 Harness-Owned Verification (Single Test Run, Shared Result)

During a sprint the harness runs the project's canonical verification — the test command, plus the lint/typecheck it already ran for the static-analysis gate (§1.15) — **once per attempt**, centrally, and shares the result with the agents instead of letting each agent re-run the full suite repeatedly. The test command is auto-detected from `package.json` scripts (`test`, `test:unit`, `test:run`, in priority order; a no-op when none is found), run through the same cached command-runner and output-truncation path as lint/typecheck, and captured as a compact structured result — pass/fail counts, failing test names, truncated output. That single result is injected into both the Generator (as the starting baseline) and the Evaluator (as the authoritative result), and both are instructed not to re-run the whole suite; a single scoped test file is still allowed when inspecting one failure.

Before the Generator runs, the harness also captures a **known-failing baseline** — which tests were already red before this sprint's changes began — so post-generation failures are classified as pre-existing or newly-introduced, and agents no longer spend turns re-deriving that distinction by stashing and comparing against a clean tree. An optional hard **test gate** (`--test-gate`) skips the Evaluator outright when the Generator introduces new failures, mirroring the lint hard-gate (§1.15) and saving an Evaluator call on a broken build. The detection and classification logic lives in pure, non-throwing helpers in `shared/`; a project with no test command, or a spawn failure, degrades gracefully to the prior behaviour.

### 1.26 Context-Frugal Prompting: Read Discipline, Per-Agent Turn Caps & Codebase Map

Cache-read traffic — the whole agent session re-read from cache on every turn — is the dominant cost in a run, so three mechanisms cut the per-turn context the agents carry:

- **Read-discipline rules** in the Generator and Evaluator system prompts: locate a region first (grep/search) then read a bounded range rather than whole files, never re-read a file already shown in the session, run only scoped tests during work, and end with a short summary rather than a long recap.
- **Per-agent turn caps** replacing the single global 50-turn ceiling: `--planner-max-turns`, `--generator-max-turns`, `--evaluator-max-turns`, `--documenter-max-turns` (and matching env vars) set each agent's ceiling independently. All default to 50 for backward compatibility, invalid values degrade to the default, and any cap that differs from the default is printed at startup alongside the per-agent models (§1.23). Precedence is the standard CLI > env > default.
- A **harness-generated codebase map** — a deterministic, body-free digest of the project's structure, key files, and exported signatures — built once per run and injected into both the Generator and the Planner/refinement sessions so they don't re-explore the project from scratch. It is bounded in size and never throws: a partial or empty map is simply omitted. This realises the "Generator Context Priming" idea and generalises it to the planning agents.

### 1.27 Patch-Based Progressive Spec Refinement

Progressive spec refinement (§1.19) emits a **patch rather than a full-document rewrite**. When `--refine-spec` is enabled, the Planner is given the current spec as read-only reference and returns only the revised remaining-sprint sections; the harness splices them around the programmatically frozen completed sections, reusing the existing section-extraction machinery. Refinement is the second-largest cost role in a run and runs on the top model tier, so re-emitting frozen content the harness would overwrite anyway was pure waste — this removes it, along with an earlier failed-write/stub-read/re-write round-trip.

### 1.28 Structured Reviewer Output Envelope

The contract reviewer returns a compact JSON envelope — `{ verdict, changes, contract? }` — instead of re-emitting the entire contract or a bare `APPROVED` string. A revision now carries a short list of what changed and why, with the full revised contract included only when the verdict is `revised`. This makes contract revisions visible and cheaper to produce without changing the single-pass negotiation architecture; the parser still accepts the legacy literal-`APPROVED` and bare-contract forms.

### 1.29 Regression-Suite Tiering & Criterion Retirement

The accumulated behavioural regression suite (§1.14) no longer grows without bound. Criteria carry a tier: **core** criteria are always checked, while **optional** criteria run only when their declared surfaces overlap the current sprint's surfaces (§1.20), so a large suite stops linearly inflating every evaluation; the injected regression section is bounded with a visible truncation marker. Criteria can also be **retired** intentionally — a contract names them in a `retire:` field — so behaviours that were deliberately changed or dropped leave the persisted suite and stop penalising correct new work. Retired names are durable against re-accumulation: a later same-named criterion will not silently resurrect a retired one.

### 1.30 Per-Agent Tool & MCP Governance

The harness sets each agent's tool and MCP exposure deliberately rather than letting agents inherit whatever servers exist in the ambient environment. Non-coding agents (Planner, spec refinement, contract negotiation) receive only the built-in tools they need and **no MCP servers**; coding agents (Generator, Evaluator, Documenter) keep their full working set. The project's settings sources are inherited by default, and operators can override the policy — `--disable-mcp` to turn MCP off entirely, or `--mcp-servers` to add specific servers back — at the existing agent-launch seam. This closes an unbounded tool-access surface (the agents run with permissions bypassed) and stops planning agents wandering into unrelated tools.

### 1.31 Cost Guardrails

Two lightweight controls guard against silent overspend. At startup the harness prints an **advisory warning when a uniform `--model` override lifts agents above the cost-optimised per-agent default matrix** (§1.23) — the override stays in effect, but it becomes a deliberate choice rather than an accident that can triple a run's cost. And an optional **per-sprint token budget** (`--sprint-token-budget`, or `SPRINT_TOKEN_BUDGET`) sets a spend ceiling per sprint: a soft warning is logged once at 80%, and at 100% an interactive run pauses to ask whether to extend or abort while a non-interactive run logs and continues. The budget is inert when unset, and budget accounting never fails a run.

### 1.32 Contract-Parse Separation

`parseContractText` is now a **pure, side-effect-free function** that returns a discriminated union: `{ ok: true, contract }` on success, or `{ ok: false, fallback, rawText, preview }` on failure — zero console output, zero disk writes from the decision itself. A thin boundary wrapper (`parseContract`, unchanged signature) handles the boundary concern: on failure it logs a **warning** (amber, not red) with a clear sprint-scoped message and writes the diagnostic file. Parsing unit tests use the pure function and emit nothing; a fully green suite now passes with zero red lines. All code-fenced JSON, balanced-brace, unclosed-fence, and raw-text fallback strategies are exercised by the pure function and work as before.

### 1.33 Per-Session Log Subdirectories

Each run's conversation logs are grouped under `.adhd/logs/<YYYY.MM.DD-HH.MM.SS>/` instead of flat files. A single session-start timestamp is captured at the top of the run and threaded through the conversation logger, the per-session directory name, and run history — one canonical identity per run. When a contract parse fails (§1.3), the diagnostic file lands in the same session folder as that run's logs, never detached. A resume is a separate process invocation and writes into a fresh sibling directory. Legacy flat logs under `.adhd/logs/` are left untouched; `git add .adhd/logs/` (used by `--commit-adhd-logs`) recurses into subdirectories unchanged.

### 1.34 Complete `--commit-adhd` Metadata Set

Two data-loss gaps closed: (1) `.adhd/usage.json` (the cost ledger) is now included in the per-sprint `commitAdhdMetadata()` staging alongside contracts, feedback, and progress; (2) a final end-of-run metadata commit is written after the Documenter, capturing the terminal `progress.json` (status `"complete"`) and final `usage.json`. Both commits degrade to no-ops when nothing has changed, avoiding spurious empty commits. Without `--commit-adhd`, behaviour is unchanged.

### 1.35 Default Topic-Branch Creation

In existing-project mode, the harness now creates and switches to a dedicated topic branch (`adhd/<slug>-<timestamp>`) before the sprint loop. All generator commits land on that branch — never on `main`. The branch name is built by a **pure, never-throwing helper** in `shared/branch-name.ts` from the prompt/spec plus a session timestamp (collision-free by construction), announced in the startup banner, and recorded in `progress.json`. `--allow-main` is redefined to mean "skip auto-branching — run on the current branch" (covering both the old on-`main` case and any other current branch). `--branch <name>` still works as an explicit name override; `--resume` switches back to the recorded branch. Greenfield mode is unaffected. **Breaking change** (`feat!`): `--allow-main`'s meaning changed; no-flag runs now create a branch.

### 1.36 Scout Agent (Semantic Codebase Priming)

A new read-only agent (`--scout`) that runs **once before the sprint loop** on existing projects. It surfaces codebase idioms: naming conventions, error-handling patterns, testing style, and architectural layout — producing a bounded semantic digest that complements the structural codebase map (§1.26) without duplicating its body-free inventory. The digest is injected into the Generator's supplementary context under its own labelled section. Scout is read-only (Read, Bash, Glob, Grep — no Write/Edit), non-fatal (failures log at warning severity and the run proceeds), and skipped for greenfield projects. Cost is recorded as its own stage (`"scout"`) in `.adhd/usage.json`.

### 1.37 Run History & Comparison

Each run's terminal state (cost and progress) is **snapshot under `.adhd/runs/<session-stamp>/`** at end-of-run, regardless of `--commit-adhd`. The live `.adhd/usage.json` and `.adhd/progress.json` semantics are unchanged; preservation adds keyed snapshot copies without touching the live files. `adhd compare <run-a> <run-b>` prints a structured report of sprint pass/fail delta, cost delta (per-stage and per-model), and criteria score trends. With no run arguments it lists available runs newest first. Comparison logic is pure and never throws; degradations — missing records, malformed JSON — surface as warnings.

### 1.38 Reviewer Agent (Code-Craft Review)

A new read-only agent (`--review`) that runs **once per passing sprint**, focused exclusively on code craft: naming, duplication, maintainability, architectural fit, and security patterns. **Advisory only** — it never affects the pass/fail verdict. Reports are persisted per sprint to `.adhd/reviews/sprint-{n}.json` with stable key order and bounded to a character ceiling. Cost is recorded as its own stage (`"reviewer"`) with the Reviewer's resolved model, appearing in both the per-stage breakdown and the per-model rollup. The Reviewer's model defaults to the Evaluator tier and is configurable via `--model-reviewer`. Policy skills (security, accessibility, code-style) route to the Reviewer through the existing per-agent skills system. The Reviewer appears in the Langfuse trace hierarchy as a child span in the sprint-success phase; tracing failure is non-fatal.

---

## Part 2: What's Missing — Opportunities

Each opportunity below is an open gap or enhancement. Opportunities are numbered with their original IDs for traceability in Part 3. Implemented opportunities have been removed from this section — they are documented as current capabilities in Part 1 (§1.12-1.38).

### OPP-07: Policy Skills (Security, Accessibility, Style)

**Problem**: The skills system is architecturally mature but content-sparse. Only three built-in skills exist, all harness-specific (spec format, contract structure, scoring guide). No methodology or policy skills ship with the harness.

**Opportunity**: Author policy skills that inject domain-specific awareness into agents:

**Harness-level skills** (universal, shipped with the harness):

| Skill | Agents | Tier | Purpose |
|-------|--------|------|---------|
| `security-owasp` | Generator (inject), Evaluator (inject) | Policy | OWASP Top 10 awareness, injection prevention, auth patterns |
| `accessibility-wcag` | Planner (inject), Evaluator (reference) | Policy | WCAG 2.1 AA criteria for web projects |
| `api-design` | Planner (inject), Generator (reference) | Convention | REST/GraphQL design standards |

These are genuinely universal — OWASP Top 10 applies regardless of stack, WCAG applies to all web projects, REST semantics are language-agnostic.

**Project-local skills** (project-specific, authored by the developer):

| Skill | Agents | Tier | Purpose |
|-------|--------|------|---------|
| `code-style` | Generator (inject) | Convention | Project-specific naming, patterns, file structure, anti-patterns |

Code style is inherently project-specific. Python FastAPI conventions are nothing like React component patterns or Go service architecture. A generic "code-style" skill shipped with the harness would be either so vague it's useless or so opinionated it conflicts with real projects. Instead, the harness should ship a **template with guidance** — a skeleton `.md` with frontmatter and prompting questions (naming convention? error handling patterns? file organization?) that the developer fills in for their project. This is exactly what the skills system's project scope (`.adhd/skills/local/`) was designed for.

- **Pros**: Zero code changes — uses existing skills system; composable and optional; universal skills can be community-contributed
- **Cons**: Injected skills consume prompt tokens; quality depends on authorship; risk of prompt bloat if many skills injected
- **Mitigation**: The existing 8K-token guardrail per agent limits injection size. Reference tier avoids bloat for larger documents.
- **Effort**: Small per skill (content authoring only, no code changes)

### OPP-10: Adaptive Retry Strategy

**Problem**: The current retry loop uses the same model and the same approach on every attempt. The only difference is the Evaluator's feedback. If the model fundamentally can't solve the problem at its capability level, three retries with feedback won't help.

**Opportunity**: Escalate strategy across retry attempts:

- **Attempt 1**: Same model, feedback injected (current behavior)
- **Attempt 2**: Escalate to stronger model (e.g., Sonnet → Opus)
- **Attempt 3**: Decompose the failing criteria into sub-tasks

- **Pros**: Higher success rate on hard sprints; uses cheaper models by default, expensive ones only when needed
- **Cons**: Model escalation adds complexity to orchestration; decomposition requires re-negotiating the contract mid-sprint; cost becomes less predictable
- **Alternative**: Keep the current fixed retry but add a `--escalate` flag that enables model escalation. Conservative default, power-user opt-in.
- **Interaction**: Model escalation must respect the Evaluator ≥ Generator invariant (§1.23). Escalating the Generator to Opus on a retry requires the Evaluator to be at least Opus, or the gate degrades exactly when the sprint is hardest.
- **Effort**: Medium (model escalation alone). Large (if including decomposition).

### OPP-11: Parallel Sprint Execution

**Problem**: Sprints are strictly sequential. For specs with independent sprints (no shared state), this is unnecessarily slow.

**Opportunity**: Run independent sprints in parallel using separate git worktrees, then merge results.

- **Pros**: Dramatically reduces wall-clock time for large specs; makes the harness viable for ambitious multi-feature projects
- **Cons**: Requires dependency analysis in the Planner (sprint dependency graph); worktree management is complex; merge conflicts are possible; parallel cost tracking is harder; debugging is more difficult
- **Prerequisite**: Sprint dependency graph — the Planner must declare which sprints depend on which. This is itself a significant feature.
- **Recommended**: **Defer** to a future phase. The sequential model is simple and correct. Parallel execution is a performance optimization that adds substantial complexity.
- **Effort**: Large

### OPP-26: Remote Notification Dispatch (Pluggable Channels)

**Problem**: Notifications today (§1.13) are local-only — a terminal bell on every HITL gate, plus `--notify` desktop popups via `notify-send`/`osascript`. These assume the developer is at the machine running the harness, making them useless for headless/`--no-interactive`/CI runs, `bypassPermissions` runs in remote environments, and long multi-sprint sessions where the developer has stepped away. There is no way to reach the developer on a channel they already monitor when a run finishes, stalls on a gate, blows a token budget, or dies.

**Opportunity**: Add a notification dispatch layer that emits a normalised event envelope (`{ event, run, sprint?, status, detail, url? }`) to one or more configured channels at key lifecycle moments — run start/complete, sprint PASS/FAIL, HITL gate waiting, token-budget threshold (80%/100%), and fatal error. Config in `.adhd/notify.json`; secrets/endpoints via env, never committed. The first concrete channel adapter is **Microsoft Teams** via a Power Automate Workflows webhook ("When a Teams webhook request is received"), wrapping the envelope as an Adaptive Card. Classic Office 365 Connector webhooks must not be used — those are being retired (rollout May 2026).

- **Option A — Claude Code native hooks** (`Notification`/`Stop`): user wires a `command`/`http` hook in `settings.json`. Pros: zero harness code; works today. Cons: only Claude Code lifecycle, not harness-level — cannot distinguish sprint PASS/FAIL, budget thresholds, or which gate is waiting; per-developer setup, not shippable behaviour.
- **Option B — Harness-native dispatcher + adapter interface**: a `NotificationChannel` interface plus normalised envelope; each channel is a thin adapter. Pros: full event vocabulary; one config drives all channels; new channels are small follow-on adapters. Cons: new module + per-channel payload mapping.
- **Option C — Single normalised webhook + external fan-out**: harness POSTs to one endpoint; routing/secrets/formatting live in an external relay (e.g. Power Automate flow). Pros: harness stays channel-unaware; centralises routing for team/fleet use. Cons: requires standing infra; over-engineered for a single developer.
- **Recommended**: **Option B** as the harness capability (rich events, shippable defaults), with **Option A** documented as the zero-code path for users who need only Claude-Code-level "done / needs input", and **Option C** as the scale-out pattern for multi-developer or fleet deployment. Adapter rollout: Teams first, Slack next.
- **Interaction**: remote extension of §1.13 — local bell/desktop and remote channels share the same event triggers and are independently composable. Per-event filtering keeps noisy per-attempt notifications opt-in.
- **Effort**: Medium (dispatcher + envelope + Teams adapter). Small per additional adapter.

### OPP-27: Error and Limit Condition Console Visibility

**Problem**: When the harness stops due to a structured condition — too many sprints planned, token budget exhausted, max retries consumed — the reason is written to `.adhd/logs/` but not surfaced in the console output. A developer watching the terminal sees the run stop without knowing why; finding the cause requires digging into log files. This was observed in practice: a "too many sprints" stop produced no actionable console output, yet the explanation was present in the session log.

**Opportunity**: Emit a concise, human-readable line to the console at the moment the limit or error condition is detected — not just in the end-of-run summary. The information already exists in the code at the detection point; this is surfacing it at the right level. Example: `[HARNESS] Sprint count (15) exceeds --max-sprints cap (10) — replan with smaller scope or raise --max-sprints`.

- **Option A — Inline WARN at detection point**: emit a log line at the exact location each limit is enforced, with a pointer to the relevant log file.
- **Option B — Structured "failure reason" field in session summary**: append a brief reason line to the end-of-run cost/status block already printed.
- **Recommended**: **Option A** for immediacy (developer knows the moment the limit fires), combined with **Option B** for completeness in the summary. Detection points are already in the code; this adds a targeted `log()` call at each.
- **Effort**: Small.

### OPP-28: Cost Persistence Without `--commit-adhd`

**Problem**: Without `--commit-adhd`, `.adhd/usage.json` is written only at end-of-run. A fatal error or unexpected process death during a long session loses all cost data for that run. §1.34 mitigates this for `--commit-adhd` users by staging the cost ledger after each sprint; the default (no flag) case is not covered. §1.37's run snapshot captures terminal state, but only if the process reaches teardown.

**Opportunity**: Write `.adhd/usage.json` after each sprint stage regardless of the `--commit-adhd` flag, so a crash mid-run preserves whatever cost was accumulated up to that point.

- **Note**: Validate first whether §1.34 + §1.37 together already close the meaningful gap. If most long runs use `--commit-adhd`, the residual risk is low and this can remain deferred. The gap is highest for users running long sessions without the flag.
- **Effort**: Small (add a `writeUsage()` call after each sprint stage rather than only at teardown).

> **OPP-29 – OPP-47 below** were surfaced by a deep architecture/craft review of the
> harness (2026-06-06): per-module review across ten lenses, system-wide specialist
> passes, and adversarial verification, folded with a 17-finding self-development
> run post-mortem. Each carries a **tag** — **[harness-implementable]** (safe for the
> harness to implement against itself: clear remit, green-keepable, test-first where
> noted) or **[human-led]** (contested architecture, core-loop surgery, or anything
> adjacent to the judge model or the 1.0 surface freeze). They are sequenced in
> **Phase 1** of Part 3.

### OPP-29: `--sprint N` Bypasses Branch Safety

**Problem**: The `--sprint N` entry path (`sprintSelectionHarness` in `shared/orchestration/harness.ts`) performs no branch setup at all — no topic-branch creation, no `--allow-main` check, no `progress.branch` read or write — yet it runs the full sprint loop, which commits on whatever branch is checked out. The fresh and resume paths both guard this. The result silently violates the documented hard default that commits never land on `main` (README, CHANGELOG, §1.35). The standalone guard `assertBranchAllowed` in `git-ops.ts` has no production caller.

**Opportunity**: Close the last unguarded entry path so every path that commits also enforces branch safety.

- **Option A** — Reuse the recorded `progress.branch` when present; when absent, error exactly like the resume path unless `--allow-main`.
- **Option B** — Require explicit branch context for `--sprint N`.

- **Recommended**: **Option A** — it mirrors the resume precedent and is least surprising. Fold the logic into the shared `ensureRunBranch` helper (OPP-37) so all three paths share one implementation. Write the sprint-selection branch-safety test first — it is RED until the fix lands.
- **Effort**: Medium.
- **Tag**: **[human-led]** — core-loop branch safety.

### OPP-30: Test-Gate Skip Drops Carried-Forward Evaluator Findings

**Problem**: When the optional test gate (§1.25, `--test-gate`) short-circuits the Evaluator, it builds the skipped result without the last real evaluation (`buildSkippedEvaluatorResult` in `shared/orchestration/sprint-attempts.ts` is called with three arguments, omitting `lastRealEval`; the surface and lint gates both pass it). The next Generator then receives boilerplate feedback instead of the real defect, re-triggering the exact ping-pong the carry-forward was built to prevent. The carry-forward landed for the surface and lint gates but the later-added test gate never inherited it.

**Opportunity**: Make all three pre-Evaluator gates carry real findings forward identically.

- **Option A** — Pass `lastRealEval` as the fourth argument at the call site.
- **Option B** — Extract a uniform `gateSkip(reason, detail)` helper that always threads it (also delivered by OPP-38).

- **Recommended**: **Option B** — it makes the divergence a compile-time impossibility rather than a convention. Until OPP-38 lands, Option A is the safe interim. Add a test that targets the test-gate branch specifically (the existing gate tests mirror the loop and cannot catch this).
- **Effort**: Small.
- **Tag**: **[harness-implementable]**.

### OPP-31: Empty / Partial Evaluator Feedback Is a Vacuous PASS

**Problem**: The evaluator parser (`harness-claude/evaluator.ts`) validates only that `feedback` is an array, then computes `passed = feedback.every(... >= threshold)`. Because `[].every(...)` is `true`, a well-formed `{"feedback": []}` — or a truncated 2-of-5 response — ships as PASS with criteria unchecked. The zeroed fallback fires only on a parse *failure*, never on a parse-success-but-empty. This is the judge's terminal false-negative reached by benign malformation.

**Opportunity**: Make the gate reject non-coverage.

- **Option A** — Reject an empty feedback array (fall through to the zeroed fallback, `passed: false`).
- **Option B** — Also reconcile parsed feedback against `contract.criteria` by name and treat any unscored criterion as a fail.

- **Recommended**: **Option A** now (narrow and safe; avoids new false negatives on legitimate criterion merges), with **Option B** as the partial-coverage follow-up. Add tests for both the empty and partial cases. Test-first.
- **Effort**: Small.
- **Tag**: **[human-led]** — touches the judge gate logic (not the model tier).

### OPP-32: Per-Criterion Thresholds Are Dead at the Gate

**Problem**: The gate compares every criterion against one flat `passThreshold`; each criterion's negotiated `threshold` is read only for display, and the model's own `passed` verdict is discarded. A sprint the judge itself marked FAIL once shipped as PASS. The `threshold` field is also persisted on disk (contracts, `regression.json`) where its stored meaning diverges from its runtime effect — a format field that lies, a hazard to freeze at 1.0.

**Opportunity**: Make the gate verdict honest and visible before the 1.0 format freeze.

- **Option A** — WARN and set a distinct flag when the model's emitted `passed` diverges from the flat-gate verdict (zero behaviour change; do not conflate with the human-override flag).
- **Option B** — Make per-criterion thresholds authoritative (calibration-sensitive; ties to the on-disk format decision).

- **Recommended**: **Option A** now; **Option B** only with calibration and the format-freeze decision made together. Add a test exercising a criterion whose negotiated threshold differs from the flat bar.
- **Effort**: Small (A) / Medium (B).
- **Tag**: **[human-led]** — judge gate + 1.0 format. *Confirms post-mortem #2.*

### OPP-33: Deterministic Gates Before the Opus Eval

**Problem**: The cheap deterministic gates (`--lint-gate`, `--test-gate`) default off, and no `lint:fix` runs before the expensive Evaluator. A large fraction of retry cost in measured runs was preventable by spending deterministic effort first.

**Opportunity**: Spend deterministic effort before model effort.

- **Option A** — Prepend `lint:fix → lint → typecheck → test` to the Generator self-check (purely additive).
- **Option B** — Default `--lint-gate` on for dogfooding.

- **Recommended**: **Option A** now (green, additive); document **Option B** as the recommended flag (flipping the default needs config-test updates).
- **Effort**: Small.
- **Tag**: **[harness-implementable]**. *Confirms post-mortem #6.*

### OPP-34: Refinement Fires Every Passing Sprint, on Opus, Unconditionally

**Problem**: When `--refine-spec` is set, the Planner (Opus) is invoked after every passing non-final sprint, *before* the no-change determination — the largest single recoverable role cost, and frequently a no-op. The flag defaults off, so it bites opt-in runs only. (This is the sanctioned cost lever — refinement is recoverable; the judge is **never** a cost lever.)

**Opportunity**: Cut the largest recoverable role cost without weakening the judge.

- **Option A** — A structured WARN/metric distinguishing a no-op refinement from a real mutation (today's `log()` is indistinguishable and never aggregated).
- **Option B** — Conditional skip (e.g. skip after a clean first pass that added no forward-referenced symbol; always run after a retry), gated behind a flag and validated against recorded runs first (skipping risks a stale forward reference).

- **Recommended**: **Option A** now; **Option B** only behind a flag with a backtest.
- **Effort**: Medium.
- **Tag**: **[human-led]** — core-loop cost lever. *Confirms post-mortem #5.*

### OPP-35: Characterization Tests for the Orchestration Core

**Problem**: No test drives `runHarness` / `resumeHarness` / `sprintSelectionHarness` / `runSprintLoop` / `runSprintAttempts`. The tests that import the orchestration modules read them as strings or mirror their logic in comments; the one test credited with covering the commit path exercises a statically dead branch. The mirror-style gate tests are precisely why defects like OPP-30 stay invisible.

**Opportunity**: Build the characterization net the safe-refactor work depends on. The `AgentRunners` DI seam already exists (SDK-free) for exactly this.

- **Approach** — A fake `AgentRunners` + fake `Tracer` + temp git repo driving the real functions. Pin: `--sprint N` without `--allow-main` does not commit on the starting branch (OPP-29); the abort path saves usage; gate ordering and the `lastRealEval` carry-forward across all three gates (OPP-30). Caveat: `runSprintAttempts` calls verification internally with no injected executor — either run against a real temp repo with a real test command, or add a verification-runner seam first (relates to OPP-47/K7).

- **Recommended**: Build it — it is the prerequisite for OPP-30, OPP-37, OPP-38, and OPP-40. Rewrite the dead-branch test to exercise the real guard.
- **Effort**: Large.
- **Tag**: **[human-led]** — core-loop test scaffolding. *Confirms post-mortem #7.*

### OPP-36: Offline Judge-Replay Backtest + Escalating Judge

**Problem**: There is no sanctioned way to evaluate a cheaper or escalating judge. The judge's false negative (passing bad work → ships, no retry) is terminal and invisible in cost/retry metrics, so the judge model must never be downgraded on intuition.

**Opportunity**: Turn "which judge?" into a measurement.

- **Approach** — An offline judge-replay over frozen `(contract, diff, results)` tuples with a seeded gold set, measuring false-negative rate. The same harness calibrates the trigger for an escalating judge (deterministic gate → Sonnet → Opus-on-demand).

- **Recommended**: Build the backtest **first** — it gates any judge-model change and calibrates the escalating trigger. This is the highest-value deeper bet and the only sanctioned route to touching the judge tier.
- **Effort**: Large.
- **Tag**: **[human-led]** — judge model. *Confirms post-mortem §3.*

### OPP-37: Extract Shared Run-Setup from `harness.ts`

**Problem**: `harness.ts` (≈698 LOC) duplicates the skill-resolution call and the branch-setup block across its three top-level paths (the branch block is also *absent* from sprint-selection — that gap is OPP-29). The run-history snapshot block is duplicated too. `import.meta.dir` ties `shared/` to its on-disk position — a boundary leak that would bite a second harness.

**Opportunity**: A single source for run setup.

- **Approach** — Extract `resolveSkillsForRun(config)`, `snapshotRunHistory(...)`, and `ensureRunBranch(config, progress, mode)`, each called once per path. A second harness should pass its base directory in rather than `shared/` computing it.

- **Recommended**: Do the skills and run-history extractions first (pure, behaviour-preserving); the `ensureRunBranch` part carries OPP-29's behaviour change and is test-gated. Do this only after OPP-35's tests exist.
- **Effort**: Medium.
- **Tag**: **[harness-implementable]** for the pure parts; **[human-led]** for the OPP-29 branch part.

### OPP-38: Uniform Gate + Context Assembly in `runSprintAttempts`

**Problem**: `runSprintAttempts` (≈473 LOC) is one function mixing baseline capture, three pre-Evaluator gates inlined with divergent arguments, interleaved evaluator-context assembly, and error handling. The divergent gate shape is exactly how the OPP-30 omission slipped in.

**Opportunity**: Make gate divergence impossible and the loop testable.

- **Approach** — Extract a uniform `gateSkip(reason, detail)` that always threads `lastRealEval` (folding in OPP-30), plus a `buildEvaluatorContext(...)` that takes already-computed inputs and preserves gate-relative ordering.

- **Recommended**: Behaviour-preserving only if OPP-35's tests exist first. Do after OPP-35.
- **Effort**: Large.
- **Tag**: **[human-led]** — core-loop surgery.

### OPP-39: Reject NaN from Malformed Flags / Env

**Problem**: `validateConfig` guards `passThreshold` / `maxSprints` / `maxRetriesPerSprint` with bare range checks (`NaN < 1` is false, so NaN escapes), while `maxFeatures` / `maxCriteria` / `maxSurfaces` correctly use `Number.isInteger`. `parseCli` uses bare `parseInt` with no NaN guard. A malformed value (`--threshold xyz`, `--max-sprints abc`) yields a forever-failing run or a corrupted loop bound.

**Opportunity**: Reject NaN at validation, and ideally at the parse boundary.

- **Approach** — Add `Number.isInteger` to the three range-only guards (preserving the legitimate `0` cases and the gate-timeout `0`/`undefined` sentinels); better still, NaN-check at the parse boundary so a bad flag throws a flag-named error.

- **Recommended**: Do it; write NaN-rejection tests first (RED until the fix, commit together).
- **Effort**: Small.
- **Tag**: **[harness-implementable]**.

### OPP-40: Accurate Cost Ledger & Turn Diagnostics

**Problem**: Several ledger/diagnostic gaps undercount or misattribute cost: the Reviewer cost stage uses a literal `"reviewer"` label so every sprint's row collides (the exact per-sprint attribution the post-mortem set out to fix); resume calls (the Opus-tier eval `max_tokens` retry, generator/documenter commit) spend tokens that are never recorded; contract-negotiation cost rows vanish silently if the optional `usage` is omitted; and the turn-limit warning is computed against the deprecated global cap rather than the agent's real `maxTurns` (so read-only agents at cap never warn).

**Opportunity**: Make the cost ledger and diagnostics accurate.

- **Approach** — Sprint-tag the reviewer identity; record resume `sdkResult`s as their own additive stages; make `usage` required on the contract options; thread the real cap into the turn-limit warning (clamping the margin so single-turn calls don't spuriously warn).

- **Recommended**: Do as a batch of small additive fixes, each with a test. Additive rows keep usage parsing green.
- **Effort**: Small–Medium.
- **Tag**: **[harness-implementable]** — observability. *Aligns with OPP-27.*

### OPP-41: Remove Dead / Duplicate Code + Add a Non-LLM Guard

**Problem**: Dead and duplicate code sits on `main`, invisible to the green gate (`noUnusedLocals`/`noUnusedParameters` are off; Biome does not lint `tests/`): a duplicate `buildTopicBranchName` (`topic-branch.ts` is unwired), two orphaned branch guards, dead stage-name constants kept alive only by tautological tests, a production-dead `freezeCompletedSprints`, and unread option fields on the cross-SDK `AgentRunners` contract.

**Opportunity**: Remove it and prevent recurrence.

- **Approach** — Delete the unwired module, orphaned guards, dead constants, dead helper, and dead option fields (each with the tests that exist only to exercise them). Add a non-LLM static check asserting exactly one export of a given symbol across `shared/` (feasible with the existing file-read test pattern; respects the SDK boundary).

- **Recommended**: Do it; the static check is the durable fix. All deletions keep green (no production importer).
- **Effort**: Small.
- **Tag**: **[harness-implementable]**. *Confirms post-mortem #3.*

### OPP-42: Empty-Spec Refinement Leaves a Blank Spec on Disk

**Problem**: In the empty-spec branch of refinement (`spec-refinement.ts`), `restoreRegressionData` runs but the `writeSpec(originalSpec)` that every other branch performs is omitted. The refinement Planner writes `spec.md` as canonical output, so a blank document stays on disk while the function returns the original spec in memory. A later resume, editor path, or `--commit-adhd` reads the divergent blank spec. The same hand-copied teardown across six return branches is the underlying fragility.

**Opportunity**: Disk and return value must never diverge.

- **Option A** — Add the missing `writeSpec` to the empty-spec branch.
- **Option B** — Centralise the teardown so the invariant is structural.

- **Recommended**: **Option B** preferred; write the empty-spec characterization test first (RED today), then the fix.
- **Effort**: Small.
- **Tag**: **[harness-implementable]** — test-first.

### OPP-43: Robust, Visible HITL Gate & Degradations

**Problem**: Three interactive/observability rough edges: the editor launch (`execSync` in `gates.ts`) is unguarded, so a missing or typo'd editor throws a fatal error instead of returning to the recoverable gate; an empty "revise" entry falls through all branches and silently re-prompts with no explanation; and documenter degradations log via plain stdout `log("… WARNING:")` instead of `logWarn`, so operators filtering by severity miss them.

**Opportunity**: Make the HITL gate and degradations robust and visible.

- **Approach** — Wrap the editor exec in try/catch and `continue` back to the gate with a clear message; add an explicit empty-revise log; switch the documenter degradations to `logWarn`.

- **Recommended**: Do as a small UX/observability batch; all green-safe.
- **Effort**: Small.
- **Tag**: **[harness-implementable]**.

### OPP-44: Document & Tighten the Security Model

**Problem**: There is no documented trust boundary. Every agent runs with permissions bypassed and executes the target project's scripts and `.claude/` assets, yet README/ARCHITECTURE/RELEASING have no security section. Project lint/test scripts run via `sh -c` with the full parent environment (provider, tracing, and `.adhd/.env` secrets included), and conversation logs persist raw Bash commands and tool output unredacted.

**Opportunity**: State the security model and tighten the high-value surfaces.

- **Option A** — Add a "Security model / trust boundary" section to README (the harness runs unsandboxed and executes the target repo's scripts and `.claude/` assets — aim it only at trusted repos). Zero risk.
- **Option B** — Scrub the environment handed to project-script execution down to a minimal allowlist at both spawn sites.
- **Option C** — A lightweight redaction pass over conversation logs (mask the values of secret-shaped env keys).

- **Recommended**: **Option A** now; **Options B/C** are report-first and test-first (the spawn-env work needs a test exercising the real executor, and a complete remediation also scrubs the dominant `run-agent` channel — larger, separate).
- **Effort**: Small (docs) / Medium (code).
- **Tag**: **[harness-implementable]** for (A); **[human-led]** for (B)/(C).

### OPP-45: Fix the Phantom Flag; Bound Ambient Settings Inheritance

**Problem**: Two public-surface/governance gaps. (1) `--reviewer-max-turns` was advertised in the v0.8.0 CHANGELOG but never implemented — and because the CLI parser is strict, passing it hard-crashes; the Reviewer silently uses the read-only default cap. (2) Coding agents inherit the operator's and the target project's `user`/`project`/`local` `.claude/` (CLAUDE.md, skills, slash commands, subagents) via hardcoded `settingSources`, with no flag to bound it — an unbounded skill/command surface, the analogue of the MCP exposure that §1.30 deliberately bounded. The genuinely novel exposure is an untrusted target project's `project`/`local` `.claude/` auto-running hooks/commands.

**Opportunity**: Make the docs match the code, and bound ambient inheritance.

- **Option A (the flag)** — Implement `--reviewer-max-turns` mirroring the other four turn caps (better 1.0 story) **or** strike the CHANGELOG advertisement.
- **Option B (governance)** — Add a settings-source flag symmetric to the MCP controls (`--no-inherit-settings` / `--settings-sources`), resolved through the existing tool-policy seam, defaulting to current behaviour; correct §1.30's wording (it under-describes the inherited scope).

- **Recommended**: Implement the flag (with a parse test) and add the governance flag (with a tool-policy test, default preserved). Pairs with OPP-47.
- **Effort**: Small–Medium.
- **Tag**: **[human-led]** — public surface / governance. *Confirms seed findings #4 and #1.*

### OPP-46: Complete the `--help` / README Reference

**Problem**: Documentation gaps across the surface: ~17 env vars are accepted but absent from `--help` (and asymmetric — some model flags advertise their env var, others don't); README omits several real flags, has no env-var section, carries a stale "10–60 minutes" duration, and `printHelp` omits both the Reviewer and the `adhd compare` subcommand; an invalid `LOG_LEVEL` is silently ignored without a warning.

**Opportunity**: Make `--help` and README a complete, consistent reference.

- **Approach** — Append `(env: VAR)` to the remaining help descriptions; add env-var and Security (OPP-44) sections to README; reframe the duration to scale with sprint count; add the Reviewer to `printHelp` and the `adhd compare` line; warn on an invalid `LOG_LEVEL`.

- **Recommended**: Do as a docs-only / additive batch; existing tests use substring checks, so green holds.
- **Effort**: Small.
- **Tag**: **[harness-implementable]**. *Confirms seed findings #2 and #3.*

### OPP-47: Lift Claude-Specific Vocabulary Behind Harness Seams

**Problem**: Several Claude-specific assumptions live in `shared/` as *vocabulary* coupling (no SDK import — the sacred boundary is intact — but latent friction for a `harness-gemini`): hardcoded Claude model IDs with substring tier-matching (a second harness gets all-"unknown" tiers, silently no-op-ing the cost/invariant warnings); cost/token observability that zeroes for any provider not emitting `total_cost_usd`; `settingSources` literals (relates to OPP-45); Claude-named constants and a hardcoded "Claude Agent SDK" banner; contract cost recorded inside the wrapper rather than the orchestrator; and a direct `Bun.spawnSync` in `static-analysis-runner` with no executor seam.

**Opportunity**: Lift the provider vocabulary behind harness-owned seams while keeping the portable logic in `shared/`.

- **Approach** — Let each harness supply a model→tier catalog and (eventually) a cost adapter injected alongside `AgentRunners`; express the governance intent abstractly; parameterize the banner/env names; pull contract-cost recording up to the orchestrator; extend the `CommandExecutor` seam to `static-analysis-runner`.

- **Recommended**: Do the cheap, live-value items now — the cost WARN when tokens are positive but cost is zero, the `static-analysis-runner` executor seam (also unblocks OPP-35's unit test), and the provider-named banner. Defer the rest until a second harness is real; the refactors move test fixtures, so test-first.
- **Effort**: Small–Medium.
- **Tag**: **[human-led]** — evolvability.

> **OPP-48 – OPP-53 below** were folded in from the project's enhancement-ideas
> backlog (2026-06-06). They cluster into live observability / liveness (answering
> "is it stuck?") and after-the-fact forensics. None was already implemented; where
> adjacent infrastructure exists it is cited inline. They are sequenced in **Phase 2**
> of Part 3.

### OPP-48: Incremental Conversation Log Writes

**Problem**: The conversation logger (`shared/conversation-logger.ts`) accumulates all events in memory and writes the markdown file only at the end, inside `finalize()` (a single `writeFile` of the joined lines). During a long agent turn nothing appears on disk until the agent finishes, so a developer cannot follow progress with `tail -f`, and a crash mid-turn loses the in-progress log.

**Opportunity**: Write the header when the log is created and append each entry as it arrives (or batch-flush every few seconds).

- **Option A** — Append per entry (`appendFile`) as events arrive. Simplest; immediately `tail -f`-able.
- **Option B** — Batch-flush every few seconds. Fewer syscalls on very chatty turns, at a small latency cost.

- **Recommended**: **Option A** for simplicity and immediacy; revisit batching only if syscall volume proves to matter. Keep the per-file leading timestamp and per-session subdirectory (§1.33) unchanged.
- **Effort**: Small.
- **Tag**: **[harness-implementable]**.

### OPP-49: Surface Model Thinking Activity

**Problem**: The Agent SDK emits events for thinking blocks (extended-thinking models), but `harness-claude/agent-stream.ts` does not display them. During a long reasoning pass the terminal is silent, so a developer cannot tell a model that is thinking from a process that has hung.

**Opportunity**: Show a rate-limited terminal line (e.g. every 30 seconds) while a thinking block is streaming — for example: `GENERATOR thinking — ~4 minutes elapsed, ~11 000 thinking tokens`.

- **Approach** — Consume the thinking-block stream events in `processAgentStream`, throttle to one line per interval, and label with the agent role plus elapsed time and an approximate thinking-token count.

- **Recommended**: Do it; it pairs with OPP-50/OPP-51 to make a run legible in real time. Rate-limit to avoid log spam.
- **Effort**: Small.
- **Tag**: **[harness-implementable]**.

### OPP-50: `adhd status` — Live Run Introspection

**Problem**: There is no way to ask "is anything happening right now?" for an in-flight run. A developer watching a quiet terminal has to guess whether the harness is working, waiting on the model, or stuck.

**Opportunity**: A read-only `adhd status` command that reports the current state of a running harness: it reads `progress.json`, locates the running harness process and its SDK subprocess, samples I/O counters on the SDK's network socket, and prints the current phase, sprint and attempt, model in use, time elapsed in the current LLM call, the last tool call observed, and inbound bytes per second.

- **Interaction** — Shares process-tree discovery and I/O-counter sampling with the stream-liveness watchdog (OPP-51); build that sampling helper once and use it for both. Sits alongside the existing `adhd compare` subcommand.
- **Note** — The `/proc`-based I/O sampling is Linux-specific; degrade gracefully (or document the limitation) on other platforms, mirroring the notification platform handling (§1.13).

- **Recommended**: Implement as a read-only subcommand; reuse the OPP-51 sampler.
- **Effort**: Medium.
- **Tag**: **[harness-implementable]**.

### OPP-51: Stream-Liveness Watchdog & Auto-Recovery

**Problem**: A run can hang with no bound. The transient-error retry (§1.9) handles errors that are *raised*, but a silently stalled LLM response (no inbound bytes on the SDK's API socket) or a hung tool subprocess (e.g. a test runner that keeps the SDK's stdout open after the model already returned `end_turn`) just waits forever. Today "is it stuck?" is an unbounded wait.

**Opportunity**: A background loop in the harness that polls `/proc/PID/io` counters (`rchar`, `wchar`, `syscr`, `syscw`) every ~30 seconds for the SDK subprocess and every descendant in its process tree — these aggregate all I/O (network, file, pipe, output) in one set of numbers. After ~5 minutes of stalled counters across the whole tree, log a warning; after ~15 minutes, kill the entire descendant tree (SIGTERM, then SIGKILL after a short escalation) and surface the kill as a **transient retryable error** so the stage retries while preserving conversation state. This covers both a hung LLM call and a hung tool subprocess in one mechanism, converting "is it stuck?" into a bounded, self-correcting condition.

- **Interaction** — Reuses the process-tree I/O sampler that powers `adhd status` (OPP-50), and feeds the existing transient-retry path (§1.9) so a recovered stall resumes rather than fails. Thresholds should be configurable, with the kill behaviour conservatively defaulted or opt-in given it terminates processes.
- **Note** — `/proc`-based; Linux-first. Killing a process tree is irreversible mid-call, so the escalation and the retry hand-off must be covered by tests before this ships.

- **Recommended**: Build the sampler + warn path first (observe-only), then the kill-and-retry escalation behind a clearly-defaulted threshold. Test the escalation and the retry hand-off.
- **Effort**: Large.
- **Tag**: **[human-led]** — touches the retry loop and terminates live processes.

### OPP-52: `adhd contract-diff <sprint>` — Contract-Version Diffing

**Problem**: When a sprint is re-contracted across multiple runs, separate negotiation logs are written but there is no easy way to compare them. Debugging why the same sprint keeps being re-contracted means reading raw logs side by side.

**Opportunity**: A command — `adhd contract-diff <sprint-number>` — that shows the structural differences between successive contract versions for that sprint: criteria added, removed, renamed, or rephrased.

- **Interaction** — Complements `adhd compare` (§1.37, cross-run) with a within-sprint, cross-version view. The comparison logic should be pure and never-throwing, like the run-comparison module.

- **Recommended**: Implement as a subcommand over the persisted per-sprint contract versions; reuse the structured-diff style of the run-comparison report.
- **Effort**: Small–Medium.
- **Tag**: **[harness-implementable]**.

### OPP-53: Self-Contained Per-Session Artifact + Log Bundle

**Problem**: A run's forensic trail is split. Conversation logs are already grouped under a timestamped per-session directory (§1.33) with timestamped filenames (§1.11), and terminal cost/progress are snapshotted under `.adhd/runs/` (§1.37) — but the *artifacts* (contracts, feedback, `progress.json`, `spec.md`) live in their own `.adhd/` subdirectories and are versioned over time only if the user opts into `--commit-adhd` git commits (§1.34). Without git there is no chronological record of how the artifacts changed within a run.

**Opportunity**: Snapshot the artifact set into the per-session log directory as each version is produced, with a timestamped, self-describing filename — so a single timestamped folder holds the complete chronological trail of one run (logs + artifacts) without depending on git or `--commit-adhd`.

- **Approach** — On each artifact write (contract negotiated, feedback produced, progress checkpointed, spec refined), also write a timestamped copy into the session directory. Reuse the session-stamp threading already in place (§1.33) and the never-throwing snapshot discipline of §1.37; degrade gracefully on a copy failure.
- **Note** — This overlaps with `--commit-adhd` (§1.34) and run snapshots (§1.37); scope it to the gap (per-change artifact copies into the log directory) rather than duplicating either, and confirm the disk footprint is acceptable for long runs (consider opt-in or pruning).

- **Recommended**: Implement as a never-throwing copy into the session directory, scoped to the artifacts not already snapshotted; validate the disk-footprint impact first.
- **Effort**: Medium.
- **Tag**: **[harness-implementable]**.

---

## Part 3: Proposed Roadmap with Priorities

### Prioritization Criteria

Each item is assessed on five dimensions:

1. **Impact on output quality** — Does it make the generated code better?
2. **Impact on reliability** — Does it reduce failures and wasted retries?
3. **Impact on developer experience** — Does it make the harness easier/faster to use?
4. **Implementation cost** — How much work and risk is involved?
5. **Impact on run cost** — Does it reduce tokens/$ per run? (Now measurable: `.adhd/usage.json` is tracked as a durable cost ledger.)

---

### Content Stream (Parallel — No Code Changes)

These items use the existing skills system and contract negotiation prompts. They require content authoring only and can proceed in parallel with any engineering phase.

| # | Feature | Source | Effort | Deliverable |
|---|---------|--------|--------|-------------|
| CS-1 | **Policy skills + code-style template** | OPP-07 | S | Harness-level: `security-owasp`, `accessibility-wcag`, `api-design` skill directories with `skill.yaml` + `.md` content. Project-level: a `code-style` skeleton template with guidance questions for developers to fill in per project (placed in `.adhd/skills/local/`). |
| CS-2 | **Codebase context guidance** | OPP-04 (Option B) | S | Documentation/template for creating project-local `.adhd/skills/local/codebase-context.md` skills. Not a harness skill itself — a guide for users. Lead content item; proceeds in parallel with engineering. |

**Rationale**: These are the highest-leverage items relative to effort — they fill the content gap in an architecturally mature skills system. No PRs to review, no tests to write, no risk of regression.

---

### Phase 1: Harden — Correctness, Safety & Foundations

**Goal**: Resolve the correctness, safety, test-debt, and hygiene findings from the deep architecture/craft review (OPP-29–OPP-47). This is the **highest-priority engineering band** and **leads** the Extend work in Phase 2 — several Phase 2 features sit on a core loop these items make safe to change. The phases are priority bands, not a strict timeline; the Content Stream still runs in parallel.

Each item is tagged **[harness-implementable]** (safe for the harness to build against itself — clear remit, green-keepable, test-first where noted) or **[human-led]** (contested architecture, core-loop surgery, or anything adjacent to the judge model or the 1.0 surface freeze). Several fixes are RED until written — they need a characterization test that fails first, so OPP-35 underpins the refactors and OPP-30/OPP-39/OPP-42 commit their test with the fix.

#### 1.A — Correctness & Safety (critical — do first)

| OPP | Feature | Effort | Tag | Justification |
|-----|---------|--------|-----|---------------|
| OPP-29 | `--sprint N` branch safety | M | **[human-led]** | Commits can land on `main`, against the documented default. The last unguarded entry path. Test-first (RED until fixed). |
| OPP-31 | Reject empty/partial evaluator feedback | S | **[human-led]** | A well-formed empty feedback array ships as a vacuous PASS — the judge's terminal false-negative. Narrow empty-rejection now. |
| OPP-30 | Carry `lastRealEval` through the test-gate skip | S | **[harness-implementable]** | The test-gate short-circuit degrades next-attempt feedback to boilerplate, re-triggering ping-pong. One missing argument. |
| OPP-39 | Reject NaN from malformed flags/env | S | **[harness-implementable]** | `--threshold xyz` / `--max-sprints abc` survive validation → forever-failing or corrupted runs. Tests first. |
| OPP-42 | Fix empty-spec refinement disk/memory divergence | S | **[harness-implementable]** | A blank `spec.md` is left on disk while the original is returned in memory; a later resume reads the blank. Test-first. |

#### 1.B — Judge Integrity & Test Foundations (high — mostly human-led)

| OPP | Feature | Effort | Tag | Justification |
|-----|---------|--------|-----|---------------|
| OPP-32 | Honest per-criterion gate verdict | S / M | **[human-led]** | Negotiated thresholds are dead at the gate; a self-declared FAIL shipped as PASS. Zero-risk WARN + distinct flag first; ties to the 1.0 format freeze. Confirms post-mortem #2. |
| OPP-35 | Characterization tests for the orchestration core | L | **[human-led]** | No test drives the sprint loop; the one "covering" test exercises a dead branch. Prerequisite for OPP-30/37/38/40. Confirms post-mortem #7. |
| OPP-36 | Offline judge-replay backtest + escalating judge | L | **[human-led]** | The only sanctioned route to a cheaper/escalating judge. Build the backtest first. Highest-value deeper bet. Confirms post-mortem §3. |
| OPP-37 | Extract shared run-setup from `harness.ts` | M | **[harness-implementable]** / **[human-led]** | Skill-resolution + branch-setup duplicated 3×. Pure extractions first; the `ensureRunBranch` part carries OPP-29. After OPP-35. |
| OPP-38 | Uniform gate + context assembly in `runSprintAttempts` | L | **[human-led]** | A 473-LOC function inlines three divergent gates (the source of OPP-30). A uniform `gateSkip` makes divergence a compile-time impossibility. After OPP-35. |

#### 1.C — Cost, Hygiene & Observability (medium — mostly harness-implementable)

| OPP | Feature | Effort | Tag | Justification |
|-----|---------|--------|-----|---------------|
| OPP-33 | Deterministic gates before the Opus eval | S | **[harness-implementable]** | Prepend `lint:fix → lint → typecheck → test` to the Generator self-check (additive); recommend `--lint-gate` for dogfooding. Confirms post-mortem #6. |
| OPP-34 | Stop refinement firing every sprint on Opus | M | **[human-led]** | The largest recoverable role cost runs unconditionally on Opus before the no-op check. WARN/metric first; conditional skip behind a flag + backtest. Confirms post-mortem #5. |
| OPP-40 | Accurate cost ledger & turn diagnostics | S–M | **[harness-implementable]** | Sprint-tag the reviewer stage; record resume `sdkResult`s; require `usage` on contract opts; thread the real turn cap into the warning. |
| OPP-41 | Remove dead/duplicate code + non-LLM guard | S | **[harness-implementable]** | Duplicate `buildTopicBranchName`, orphaned branch guards, dead stage-name constants, `freezeCompletedSprints`, dead option fields — invisible to the green gate. Static "one export per symbol" check. Confirms post-mortem #3. |
| OPP-43 | Robust, visible HITL gate & degradations | S | **[harness-implementable]** | A bad editor command crashes the gate; empty "revise" re-loops silently; documenter degradations log to stdout instead of `logWarn`. |

#### 1.D — Docs, Security & 1.0 Surface (pre-1.0)

| OPP | Feature | Effort | Tag | Justification |
|-----|---------|--------|-----|---------------|
| OPP-44 | Document & tighten the security model | S / M | **[harness-implementable]** / **[human-led]** | No documented trust boundary; target scripts run with the full env incl. secrets. README Security section now; env-allowlist + log redaction reported. |
| OPP-45 | Phantom flag; bound ambient settings inheritance | S–M | **[human-led]** | `--reviewer-max-turns` advertised but unimplemented (crashes on use); coding agents inherit user/project/local `.claude/` with no flag to bound it. Confirms seed #4/#1. |
| OPP-46 | Complete the `--help`/README reference | S | **[harness-implementable]** | ~17 undocumented env vars, missing flags, stale "10–60 min", `printHelp` omits the Reviewer and `adhd compare`. Docs/additive only. Confirms seed #2/#3. |
| OPP-47 | Lift Claude-specific vocabulary behind harness seams | S–M | **[human-led]** | Hardcoded Claude model IDs, cost zeroing for non-USD providers, `settingSources` literals — all latent friction for a `harness-gemini`. Cheap live-value items now; defer the rest. |

**Rationale**: A deep review found that the harness's recent growth (the Phase 2 wave) outpaced its test net and surfaced a cluster of silent correctness and safety gaps. 1.A is the floor — defects that can produce a wrong PASS, an unsafe commit, or a corrupted run, each small and test-first. 1.B builds the characterization net the larger refactors require and opens the only sanctioned path to the judge tier without ever downgrading it. 1.C banks the recoverable cost levers and the cheap hygiene wins. 1.D states the trust boundary and settles the surface questions that would hurt to freeze at 1.0. The harness can implement most of 1.A/1.C/1.D against itself; the judge-adjacent, core-loop, and 1.0-surface items are human-led.

---

### Phase 2: Extend — New Capabilities

The first Phase 2 wave shipped as §1.32–§1.38 (contract-parse separation, per-session log subdirectories, the complete `--commit-adhd` metadata set, default topic-branch creation, the Scout agent, run history & comparison, the Reviewer). The remaining and newly-surfaced items are grouped by theme and reprioritized below; the tags carry the same meaning as in Phase 1.

#### 2.A — Live Observability & Liveness ("is it stuck?")

| OPP | Feature | Effort | Tag | Justification |
|-----|---------|--------|-----|---------------|
| OPP-27 | Error/limit condition console visibility | S | **[harness-implementable]** | Surface "too many sprints", budget-exhausted, and similar conditions at the moment of detection, not just in log files. High usability return; found via dogfooding. |
| OPP-48 | Incremental conversation log writes | S | **[harness-implementable]** | Write the header on creation and append entries as they arrive, so a long agent turn is followable with `tail -f` instead of appearing only at `finalize()`. |
| OPP-49 | Surface model thinking activity | S | **[harness-implementable]** | A rate-limited line ("GENERATOR thinking — ~4 min, ~11k thinking tokens") distinguishes "model is reasoning" from "process is stuck". |
| OPP-50 | `adhd status` — live run introspection | M | **[harness-implementable]** | A read-only command answering "is anything happening right now?": phase/sprint/attempt, model, time in the current call, last tool, inbound bytes/sec. |
| OPP-51 | Stream-liveness watchdog & auto-recovery | L | **[human-led]** | Poll process-tree I/O counters; warn on a 5-min stall, kill the tree at 15 min and surface it as a transient retryable error. Covers a hung LLM call and a hung tool subprocess in one mechanism; touches the retry loop. |

#### 2.B — Forensics & Debugging

| OPP | Feature | Effort | Tag | Justification |
|-----|---------|--------|-----|---------------|
| OPP-53 | Self-contained per-session artifact + log bundle | M | **[harness-implementable]** | Snapshot contracts/feedback/progress/spec into the per-session log directory, timestamped per change, so a run's full trail is self-contained without git/`--commit-adhd`. Extends §1.33/§1.37. |
| OPP-52 | `adhd contract-diff <sprint>` | S–M | **[harness-implementable]** | Show structural diffs between successive contract versions for a sprint (criteria added/removed/renamed/rephrased) — for debugging why a sprint keeps being re-contracted. |
| OPP-28 | Cost persistence without `--commit-adhd` | S | **[harness-implementable]** | Write `usage.json` after each sprint regardless of flag. Validate first whether §1.34 + §1.37 already close the gap. |

#### 2.C — Reach & Ecosystem

| OPP | Feature | Effort | Tag | Justification |
|-----|---------|--------|-----|---------------|
| OPP-26 | Remote notification dispatch (Teams first) | M | **[human-led]** | Pluggable channel adapter + normalised event envelope; Teams Adaptive Cards via Power Automate. Unblocks headless/CI/remote use where desktop notifications don't reach the developer. |
| OPP-10 | Adaptive retry (model escalation) | M | **[human-led]** | Opt-in `--escalate`; must keep Evaluator ≥ Generator (§1.23). Lower priority now that scope control (§1.20–§1.22) and the Reviewer (§1.38) address most retry-quality causes. |
| OPP-07 | `adhd skill` CLI (tooling) | M | **[harness-implementable]** | `adhd skill add/list/remove` — UX sugar over manual install. Valuable once the Content Stream + community skills create an ecosystem worth managing. |

**Rationale**: The trust/observability/safety wave (§1.32–§1.38) is complete, and the deep-review hardening (Phase 1) now leads engineering. Within Extend, the **"is it stuck?" cluster (2.A)** rises to the top: long unattended runs surfaced a real operability gap — no way to tell a reasoning model from a hung process, or to follow a run live. These are mostly small, low-risk wins (incremental logs, error/limit visibility, thinking activity), with the read-only `adhd status` next and the process-killing watchdog last (largest, riskiest, human-led). **2.B** adds after-the-fact forensics — a self-contained session bundle and contract-version diffing — plus the cost-durability gap. **2.C** holds the previously-planned reach and ecosystem items, now ranked below live observability.

---

### Phase 3: Transform — Architectural Changes

**Goal**: Fundamentally new capabilities. Each requires validation from real-world usage.

| # | Feature | Source | Effort | Justification & Prerequisite |
|---|---------|--------|--------|------------------------------|
| 3.1 | **Parallel sprint execution** | OPP-11 | L | Independent sprints in separate git worktrees, merged at completion. **Prerequisite**: Sprint dependency graph (Planner must declare dependencies) and evidence that sequential execution is too slow for target use cases. |
| 3.2 | **Web dashboard** | — | L | Visual UI over `.adhd/` data — run history (§1.37), cost trends, sprint timelines. **Prerequisite**: CLI workflow stabilized; data formats frozen. |

---

### Summary View

| Stream / Phase | # | Feature | Source | Notes |
|---|---|---|---|---|
| **Content Stream**<br/>*(parallel, HIGH)* | CS-1 | Policy skills + code-style template | OPP-07 | Universal skills + project-local template |
| | CS-2 | Codebase context guidance | — | User guide for project-local skill authoring |
| --- | --- | --- | --- | --- |
| **Phase 1**<br/>*Harden (HIGH — leads)*<br/>from the deep review | 1.A | Correctness & safety | OPP-29,31,30,39,42 | Branch safety, vacuous PASS, test-gate carry-forward, NaN config, empty-spec divergence |
| | 1.B | Judge integrity & test foundations | OPP-32,35,36,37,38 | Honest gate, orchestration test net, judge-replay, core refactors |
| | 1.C | Cost, hygiene & observability | OPP-33,34,40,41,43 | Deterministic gates, refinement cost, cost ledger, dead-code removal, HITL robustness |
| | 1.D | Docs, security & 1.0 surface | OPP-44,45,46,47 | Security model, phantom flag + settings governance, docs completeness, second-harness vocabulary |
| --- | --- | --- | --- | --- |
| **Phase 2**<br/>*Extend (MEDIUM)*<br/>§1.32–§1.38 shipped | 2.A | Live observability & liveness | OPP-27,48,49,50,51 | "Is it stuck?": error/limit visibility, incremental logs, thinking activity, `adhd status`, stream watchdog |
| | 2.B | Forensics & debugging | OPP-53,52,28 | Self-contained session bundle, `contract-diff`, cost persistence |
| | 2.C | Reach & ecosystem | OPP-26,10,07 | Remote notifications, adaptive retry, `adhd skill` CLI |
| --- | --- | --- | --- | --- |
| **Phase 3**<br/>*Transform (LOW)* | 3.1 | Parallel sprint execution | OPP-11 | Requires sprint dependency graph |
| | 3.2 | Web dashboard | — | Requires stabilised CLI + data formats |

---

### Key Architectural Insight

The harness's highest-leverage extension point is the **skills system**. It's a fully functional plugin architecture with per-agent routing, three scopes, and methodology-aware filtering — but only three built-in skills exist, all harness-internal. The Content Stream exploits this gap: policy skills and codebase context guides can be authored independently of any engineering phase.

The second insight is that **BDD scenarios are the natural regression mechanism**. They already exist as structured JSON in sprint contracts. They represent behavioral invariants, not implementation details. Accumulating them across sprints (§1.14) turns the contract system from a per-sprint checklist into a growing behavioral specification of the entire system — and pairs naturally with progressive spec refinement (§1.19) because the accumulated BDD criteria provide the stable contract floor that persists even as the spec evolves above them.

The third insight: **dogfooding exposes operational issues that unit tests and design reviews miss**. Running the harness against its own codebase surfaced phantom sprints from regex false positives, log file overwrites destroying forensic evidence, and silent fallbacks masking contract parse failures — now hardened in §1.3, §1.9, §1.11, and §1.13. Running it against a separate 19-sprint project (CRIST) surfaced the systemic scope-inflation failure mode that the surface and contract-ceiling suite (§1.20–§1.22) now addresses. A full-run cost analysis showed that run cost is dominated by cache-read traffic rather than code generation, driving the cost-and-efficiency capabilities in §1.25–§1.31. Fifteen Phase 2 sprints of self-development then added trust and observability improvements (§1.32–§1.38): contract-parse separation, per-session log subdirectories, the complete `--commit-adhd` metadata set, default topic-branch creation, the Scout agent, run history and comparison, and the Reviewer agent. Neither set of gaps was visible from unit tests or design reviews alone.

The fourth insight: **the discriminator must never rank below the producer**. §1.1's adversarial asymmetry — the Evaluator can only report, not fix — has a model-tier corollary, now built into the harness as a startup invariant (§1.23): if the Evaluator's *capability* falls below the Generator's, it approves code it cannot out-reason and the gate silently fails open. This makes Evaluator tier ≥ Generator tier a design invariant rather than a tuning preference, and it identifies the judge as the cheapest place to spend capability — a Generator's mistakes are caught and retried, an Evaluator's are not.

The fifth insight: **a structured deep review is a discovery mode distinct from dogfooding.** Where running the harness surfaced operational failures (insight three), a multi-lens architecture/craft review of the code at rest surfaced a different class: silent correctness gaps (an empty evaluator feedback array passing as a vacuous PASS; the `--sprint N` path committing without branch safety; per-criterion thresholds dead at the gate), test debt masquerading as coverage (a statically dead branch credited as a passing test, mirror tests that re-implement the loop instead of driving it), and provider-vocabulary coupling latent until a second harness exists. These became Phase 1 (OPP-29–OPP-47). The lesson pairs with the fourth: correctness, test integrity, and evolvability need deliberate review of the static structure — they do not reliably fall out of either unit tests or a green run, and the recent growth in capability (§1.32–§1.38) outpaced the test net that should guard it.
