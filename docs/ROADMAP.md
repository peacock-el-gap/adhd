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

---

## Part 2: What's Missing — Opportunities

Each opportunity below is an open gap or enhancement. Opportunities are numbered with their original IDs for traceability in Part 3. Implemented opportunities have been removed from this section — they are documented as current capabilities in Part 1 (§1.12-1.24).

### OPP-04: Generator Context Priming

**Problem**: The Generator discovers the codebase through tool use during implementation, spending early turns on `Read`, `Glob`, and `Grep` to understand existing patterns. This burns tool-use turns and tokens on exploration rather than building.

**Opportunity**: Before the Generator starts coding, provide a focused digest of key interfaces, existing patterns, and architectural conventions.

- **Option A — Harness-generated digest**: The harness runs `tree`, reads key files (package.json, tsconfig, main entry point), and injects a summary into the Generator's prompt.
  - Pros: Deterministic, cheap, no LLM cost
  - Cons: May miss relevant patterns; hard to know which files matter without domain knowledge
- **Option B — Skill-based priming**: A project-local skill (`.adhd/skills/local/codebase-context.md`) where the developer documents key patterns. Injected via the existing skills system.
  - Pros: Uses existing architecture; developer controls what's included; zero new code needed
  - Cons: Requires manual authoring; may become stale as codebase evolves
- **Option C — Agent-generated digest**: Run a brief 4th agent ("Scout") that reads the codebase and produces a summary for the Generator.
  - Pros: Adaptive, finds relevant patterns automatically
  - Cons: Extra LLM cost; may be redundant for greenfield projects
- **Recommended**: **Option B** first (zero code changes, uses existing skills). Consider **Option A** as a later enhancement for projects without manually-authored context.
- **Effort**: Option B is zero (documentation/guidance only). Option A is Small. Option C is Medium.

### OPP-06: Separate Code Review Agent

Quality criteria in contracts (§1.18) test whether quality *awareness* is the missing signal. If it proves insufficient — if quality concerns consistently need deeper, separate analysis — a dedicated **Reviewer agent** (5th agent) with read-only tools could run on passing sprints, focused exclusively on code craft: naming, duplication, maintainability, architectural fit, security patterns.

- **Pros**: Clean separation of concerns; Evaluator stays focused on behavior; Reviewer has its own specialized prompt
- **Cons**: Extra LLM cost per passing sprint; adds latency; significant architectural change (new agent type, new orchestration path)
- **Contingent**: Only pursued if §1.18's quality criteria prove insufficient in practice.
- **Effort**: Large

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

### OPP-12: Run Analytics & Comparison

**Problem**: After multiple harness runs, there's no easy way to compare outcomes, identify which sprints fail most, or tune configuration based on historical data.

**Opportunity**: `adhd compare <run-a> <run-b>` reads `.adhd/` artifacts from two runs and reports spec diff, pass/fail delta, cost delta, criteria score trends.

- **Pros**: Enables evidence-based prompt engineering and model selection; data already exists in `.adhd/usage.json` and `progress.json`
- **Cons**: Requires run-ID or timestamp-based run identification; needs a storage convention for historical runs (currently each run overwrites the previous)
- **Effort**: Medium

### OPP-15: Complete the `--commit-adhd` Metadata Set

**Problem**: The opt-in `--commit-adhd` flag (§1.13) commits `.adhd/contracts/`, `.adhd/feedback/`, `.adhd/progress.json`, and `.adhd/spec.md` after each sprint — but it never commits `.adhd/usage.json`, and the final terminal state (the post-Documenter `status: "complete"` write and `docsGenerated`) is written *after* the last sprint's metadata commit. So even with `--commit-adhd` on, a run's full cost record and its completed checkpoint are left uncommitted and easily lost.

**Opportunity**:
1. Add `.adhd/usage.json` to the staged paths in `commitAdhdMetadata()`.
2. Add a final end-of-run metadata commit (after the Documenter) capturing the terminal `progress.json` state plus the final `usage.json`.

**Why it matters**: It is a prerequisite for run analytics & comparison (OPP-12), which reads `.adhd/usage.json` and `progress.json` per run — those have to be preserved before runs can be compared. Default behaviour is unchanged: nothing is committed without `--commit-adhd`.

- **Pros**: Closes a real data-loss gap; tiny, contained change; unblocks OPP-12; keeps the audit-trail philosophy (still opt-in)
- **Cons**: `usage.json` changes on every API call, so committing it adds some churn to the `[adhd]` commit stream (acceptable, and opt-in)
- **Effort**: Small

---

## Part 3: Proposed Roadmap with Priorities

### Prioritization Criteria

Each item is assessed on four dimensions:

1. **Impact on output quality** — Does it make the generated code better?
2. **Impact on reliability** — Does it reduce failures and wasted retries?
3. **Impact on developer experience** — Does it make the harness easier/faster to use?
4. **Implementation cost** — How much work and risk is involved?

---

### Content Stream (Parallel — No Code Changes)

These items use the existing skills system and contract negotiation prompts. They require content authoring only and can proceed in parallel with any engineering phase.

| # | Feature | Source | Effort | Deliverable |
|---|---------|--------|--------|-------------|
| CS-1 | **Policy skills + code-style template** | OPP-07 | S | Harness-level: `security-owasp`, `accessibility-wcag`, `api-design` skill directories with `skill.yaml` + `.md` content. Project-level: a `code-style` skeleton template with guidance questions for developers to fill in per project (placed in `.adhd/skills/local/`). |
| CS-2 | **Codebase context guidance** | OPP-04 | S | Documentation/template for creating project-local `.adhd/skills/local/codebase-context.md` skills. Not a harness skill itself — a guide for users. |

**Rationale**: These are the highest-leverage items relative to effort — they fill the content gap in an architecturally mature skills system. No PRs to review, no tests to write, no risk of regression.

---

### Phase 2: Extend — New Capabilities

**Goal**: Capabilities that change how the harness operates, building on Phase 1 foundations.

| # | Feature | Source | Effort | Justification |
|---|---------|--------|--------|---------------|
| 2.1 | **Complete the `--commit-adhd` metadata set** | OPP-15 | S | Add `.adhd/usage.json` + a final end-of-run metadata commit so the full cost record and completed checkpoint are preserved. Closes a data-loss gap; prerequisite for run comparison (2.4). |
| 2.2 | **Adaptive retry (model escalation)** | OPP-10 | M | Opt-in `--escalate` flag. Builds on the per-agent model baseline (§1.23) and must keep the Evaluator ≥ Generator. Lower priority now that sprint scope control (§1.20–§1.22) has shipped — most CRIST-run retries were caused by oversized scope, not model capability. Decomposition (attempt 3) deferred. |
| 2.3 | **`adhd skill` CLI** | OPP-07 (tooling) | M | `adhd skill add/list/remove` — UX sugar over manual git clone. Becomes valuable once Content Stream skills and future community skills create an ecosystem worth managing. |
| 2.4 | **Run comparison** | OPP-12 | M | `adhd compare` for evidence-based tuning. Data already exists in `.adhd/usage.json` and `progress.json`. Enables systematic prompt engineering and model selection. |
| 2.5 | **Code review agent (5th agent)** | OPP-06 | L | Separate Reviewer agent for code quality. **Contingent**: only if quality criteria in contracts (§1.18) proves insufficient. |

**Rationale**: Item 2.1 is a small, low-effort fix that closes a data-loss gap and unblocks run comparison (2.4). Item 2.2 addresses a retry limitation in the cases where sprint scope control (§1.20–§1.22) isn't enough, and builds directly on the per-agent model baseline (§1.23). Items 2.3-2.4 are ecosystem and tooling. Item 2.5 is contingent — it's the escalation path if the quality criteria in contracts (§1.18) don't deliver enough signal.

---

### Phase 3: Transform — Architectural Changes

**Goal**: Fundamentally new capabilities. Each requires validation from real-world usage.

| # | Feature | Source | Effort | Justification & Prerequisite |
|---|---------|--------|--------|------------------------------|
| 3.1 | **Parallel sprint execution** | OPP-11 | L | Independent sprints in separate git worktrees, merged at completion. **Prerequisite**: Sprint dependency graph (Planner must declare dependencies) and evidence that sequential execution is too slow for target use cases. |
| 3.2 | **Web dashboard** | OPP-12 | L | Visual UI over `.adhd/` data — run history, cost trends, sprint timelines. **Prerequisite**: CLI workflow stabilized; data formats frozen. |

---

### Summary View

| Stream / Phase | # | Feature | Source | Notes |
|---|---|---|---|---|
| **Content Stream**<br/>*(parallel, HIGH)* | CS-1 | Policy skills + code-style template | OPP-07 | Universal skills (security, a11y, API) + project-local template |
| | CS-2 | Codebase context guidance | OPP-04 | User guide, not a harness skill |
| --- | --- | --- | --- | --- |
| **Phase 2**<br/>*Extend (MEDIUM)* | 2.1 | Complete the `--commit-adhd` metadata set | OPP-15 | Preserve usage.json + final checkpoint; unblocks run comparison |
| | 2.2 | Adaptive retry with model escalation | OPP-10 | Opt-in `--escalate` flag; builds on the §1.23 model baseline |
| | 2.3 | `adhd skill` CLI | OPP-07 (tooling) | UX sugar over manual install |
| | 2.4 | Run comparison | OPP-12 | Evidence-based prompt/model tuning |
| | 2.5 | Code review agent (5th agent) | OPP-06 | **Contingent**: only if §1.18 quality criteria insufficient |
| --- | --- | --- | --- | --- |
| **Phase 3**<br/>*Transform (LOW)* | 3.1 | Parallel sprint execution | OPP-11 | Requires sprint dependency graph |
| | 3.2 | Web dashboard | OPP-12 | Requires stabilized CLI + data formats |

---

### Key Architectural Insight

The harness's highest-leverage extension point is the **skills system**. It's a fully functional plugin architecture with per-agent routing, three scopes, and methodology-aware filtering — but only three built-in skills exist, all harness-internal. The Content Stream exploits this gap: policy skills and codebase context guides can be authored independently of any engineering phase.

The second insight is that **BDD scenarios are the natural regression mechanism**. They already exist as structured JSON in sprint contracts. They represent behavioral invariants, not implementation details. Accumulating them across sprints (§1.14) turns the contract system from a per-sprint checklist into a growing behavioral specification of the entire system — and pairs naturally with progressive spec refinement (§1.19) because the accumulated BDD criteria provide the stable contract floor that persists even as the spec evolves above them.

The third insight: **dogfooding exposes operational issues that unit tests and design reviews miss**. Running the harness against its own codebase surfaced phantom sprints from regex false positives, log file overwrites destroying forensic evidence, and silent fallbacks masking contract parse failures — now hardened in §1.3, §1.9, §1.11, and §1.13. Running it against a separate 19-sprint project (CRIST) surfaced the systemic scope-inflation failure mode that the surface and contract-ceiling suite (§1.20–§1.22) now addresses. Neither set of gaps was visible from unit tests or design reviews alone.

The fourth insight: **the discriminator must never rank below the producer**. §1.1's adversarial asymmetry — the Evaluator can only report, not fix — has a model-tier corollary, now built into the harness as a startup invariant (§1.23): if the Evaluator's *capability* falls below the Generator's, it approves code it cannot out-reason and the gate silently fails open. This makes Evaluator tier ≥ Generator tier a design invariant rather than a tuning preference, and it identifies the judge as the cheapest place to spend capability — a Generator's mistakes are caught and retried, an Evaluator's are not.
