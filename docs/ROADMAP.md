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
| **Multi-model strategy** | Per-agent model overrides (`--model-planner`, `--model-generator`, `--model-evaluator`, `--model-documenter`) |
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

---

## Part 2: What's Missing — Opportunities

Each opportunity below is an open gap or enhancement. Opportunities are numbered with their original IDs for traceability in Part 3. Implemented opportunities have been removed from this section — they are documented as current capabilities in Part 1 (§1.12-1.19).

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

### OPP-13: Sprint Scope Control (Surfaces + Coverage + Ceiling)

**Problem**: Dogfooding ADHD against CRIST initiative-tracker (19 sprints across 7 runs) surfaced a systemic failure mode: planned sprints are too big, contract negotiation inflates them further, and the generator silently drops whole features. 63% of sprints needed retries (33 attempts across 19 sprints); 2 of 7 runs were abandoned mid-sprint; one sprint cost $20.48 across 4 failed attempts and never finished. A typical evaluator verdict on a failure: "Backend implementation is solid. However, two critical frontend features are completely missing." The contract negotiator approved a feature list growing 1 → 5 → 11 across renegotiations of a single sprint, with no pushback.

**Opportunity**: Three coordinated changes that reinforce each other.

1. **Surface declaration in contracts.** Each sprint contract names the parts of the code it will touch (backend / frontend / db / tests / docs / config) as a field in the contract JSON. Makes scope explicit and checkable.

2. **Surface coverage check after the generator.** Between the generator's commit and the evaluator's run, compare the declared surfaces against the files actually changed in the diff. If the contract declared backend + frontend but only backend files changed, the attempt fails before the evaluator runs. No evaluator spend on a sprint where the generator dropped half the work. Exact result, no AI cost. Fits into the same step as the existing pre-evaluation static-analysis gate (§1.15). Default file-path patterns target the common Bun/Node/TS + Python/Go stacks; a per-project override can be added later if real projects need it.

3. **Contract size ceiling in the negotiator.** The reviewer rejects contracts above measurable limits (defaults: features > 3, criteria > 10, surfaces > 2; configurable per project via `--max-features`, `--max-criteria`, `--max-surfaces`). One extra revision round narrows the contract before approval — no infinite loop. Stops the 1 → 5 → 11 inflation pattern at negotiation time, before any code runs.

Why all three together: declaring surfaces makes coverage checkable; the coverage check forces honest declarations; the ceiling stops scope inflation at negotiation time so the generator is never asked to do too much in the first place.

**Validation**: Re-run the CRIST initiative-tracker scenario with the changes on. Pass criteria: retry rate below the current 33% baseline; no abandoned runs; cost per sprint trending down. The harness already records everything needed in `.adhd/usage.json` and `.adhd/logs/` to make that comparison directly.

**Interactions with other items**:
- Extends §1.3 (contract negotiation) and §1.6 (build-evaluate retry loop) — same shape, more checks.
- Same kind of check as §1.15 (pre-evaluation static-analysis gate). Both run in the same step, both can fail the attempt before the evaluator.
- OPP-10 (adaptive retry — model escalation) becomes less urgent. Most CRIST retries were caused by oversized scope, not model capability ceilings.
- OPP-06 (5th reviewer agent) unaffected — that's about code quality, this is about scope.
- "Structured reviewer output envelope" in [enhancements-new-features-ideas.md](enhancements-new-features-ideas.md) would make narrowing decisions more visible, but isn't required for this to work.

**Effort**: M overall. Surface declaration: S. Coverage check: M. Size ceiling: M.

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
| 2.1 | **Sprint scope control (surfaces + coverage + ceiling)** | OPP-13 | M | Reduces retry burn at the root: surface declaration + post-generator coverage check + contract size ceiling. Highest-leverage reliability fix surfaced by dogfooding. |
| 2.2 | **Adaptive retry (model escalation)** | OPP-10 | M | Opt-in `--escalate` flag. Lower priority once 2.1 lands — most CRIST-run retries were caused by oversized scope, not model capability. Decomposition (attempt 3) deferred. |
| 2.3 | **`adhd skill` CLI** | OPP-07 (tooling) | M | `adhd skill add/list/remove` — UX sugar over manual git clone. Becomes valuable once Content Stream skills and future community skills create an ecosystem worth managing. |
| 2.4 | **Run comparison** | OPP-12 | M | `adhd compare` for evidence-based tuning. Data already exists in `.adhd/usage.json` and `progress.json`. Enables systematic prompt engineering and model selection. |
| 2.5 | **Code review agent (5th agent)** | OPP-06 | L | Separate Reviewer agent for code quality. **Contingent**: only if quality criteria in contracts (§1.18) proves insufficient. |

**Rationale**: Item 2.1 is the highest-leverage reliability fix from dogfooding evidence. Item 2.2 addresses a retry limitation in cases where scope control isn't enough. Items 2.3-2.4 are ecosystem and tooling. Item 2.5 is contingent — it's the escalation path if quality criteria in contracts don't deliver enough signal.

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
| **Phase 2**<br/>*Extend (MEDIUM)* | 2.1 | Sprint scope control (surfaces + coverage + ceiling) | OPP-13 | Highest-leverage reliability fix from dogfooding |
| | 2.2 | Adaptive retry with model escalation | OPP-10 | Opt-in `--escalate` flag; lower priority once 2.1 lands |
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

The third insight: **dogfooding exposes operational issues that unit tests and design reviews miss** — phantom sprints from regex false positives, log file overwrites destroying forensic evidence, silent fallbacks masking contract parse failures. The operational-hardening capabilities now described in §1.3, §1.9, §1.11, and §1.13 exist because running the harness against its own codebase revealed these gaps.
