# ADHD Harness — Roadmap

## How to Read This Document

This report has three parts. Each builds on the previous:

- **Part 1** catalogues every methodical functionality already implemented in the harness.
- **Part 2** identifies gaps and opportunities, each with options, pros/cons, and recommendations. Every opportunity is numbered (OPP-01 through OPP-13).
- **Part 3** organizes opportunities into a prioritized roadmap. Every roadmap item references its Part 2 analysis by OPP-ID. A separate **Content Stream** runs in parallel for work that requires no code changes.

The document is self-contained. No prior conversation context is required.

---

## Part 1: Inventory of Built-In Methodical Functionalities

The harness encodes a rich set of SDLC practices across its three-agent adversarial architecture. Each functionality below is fully implemented and operational.

### 1.1 GAN-Inspired Adversarial Architecture

The foundational design pattern: **separate generation from evaluation, then pit them against each other**. Three specialized agents (Planner, Generator, Evaluator) communicate through files, not shared conversation history. This prevents **self-evaluation bias** — the quiet killer of single-agent coding tools where the model praises its own mediocre output.

- **Planner**: Creates product specification with sprint decomposition
- **Generator**: Implements features with full tool access (Read, Write, Edit, Bash, Glob, Grep)
- **Evaluator**: Tests and scores with read-only tools (Read, Bash, Glob, Grep — no Write/Edit)

The asymmetry is intentional: the evaluator cannot fix problems, only report them. This forces the generator to produce genuinely working code.

### 1.2 Sprint-Based Decomposition

The Planner decomposes work into 3-6 sequential sprints with independent scope. Each sprint is a self-contained unit of work with its own contract, build-evaluate cycle, and checkpoint. This mirrors Scrum sprint planning but with adversarial validation through contract negotiation.

### 1.3 Contract Negotiation

Before any code is written, the Generator proposes a sprint contract (5-15 testable criteria), then the Evaluator reviews it for specificity, completeness, and measurability. Anti-vagueness rules reject "works well" or "looks good" — only measurable criteria survive.

This is **Definition of Done as a protocol**: machine-readable JSON, not a wiki page nobody reads.

### 1.4 BDD (Behavior-Driven Development)

When enabled (default), the Planner writes acceptance scenarios in **Given/When/Then** format. These flow into sprint contracts as testable criteria. The Evaluator verifies that tests exist for each scenario and that they pass.

Disableable via `--no-bdd`. Also filters community skills tagged `type: methodology-bdd`.

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

Safety net ensuring every generator run produces a git commit:

1. **Check** — Did the agent commit on its own? (Compare HEAD before/after)
2. **Resume** — If uncommitted changes exist, resume the session with a commit-only prompt (max 3 turns, Bash-only)
3. **Fallback** — Harness runs `git add -A && git commit` with a contextual message tagged `[auto-commit]`

`commitSource` field ("agent" | "resume" | "fallback") tracked in each SprintResult for compliance monitoring.

### 1.9 Checkpoint & Resume

After each passing sprint, a checkpoint is saved to `.adhd/progress.json` with the git commit SHA, all sprint results, and evaluation feedback. On `--resume`:
- Planning phase is skipped (spec exists)
- Incomplete sprint commits are reverted to last known good state
- Sprint loop continues from the next unfinished sprint

Transient errors (HTTP 429, 5xx, network) retried automatically with exponential backoff (30s, 60s, 120s).

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

1. **Conversation logs** — Detailed markdown per agent/sprint/attempt in `.adhd/logs/`. Always written regardless of log level. Tool calls with inputs, results (long outputs collapsed in `<details>`).
2. **Langfuse OTEL tracing** — Optional hierarchical span tree mirroring the harness structure. Fire-and-forget; zero impact on agent behavior.
3. **Per-stage cost tracking** — Tokens, USD, duration per SDK call. Printed at session end, accumulated across resume sessions in `.adhd/usage.json`.

### 1.12 Additional Operational Features

| Feature | Description |
|---------|-------------|
| **Dry-run mode** (`--dry-run`) | Run planner + spec approval only. Zero generation cost. |
| **Multi-model strategy** | Per-agent model overrides (`--model-planner`, `--model-generator`, `--model-evaluator`) |
| **Context injection** (`--context <file>`) | Feed API specs, schemas, design docs into planner prompt |
| **Branch creation** (`--branch <name>`) | Create feature branch before sprint loop |
| **Greenfield mode** (`--greenfield`) | Scaffold fresh `app/` with git init |
| **Directory conventions** (`--source-dir`, `--test-dir`) | Control where agents place source and test code |
| **Planner HITL** (`AskUserQuestion`) | Planner can ask clarifying questions mid-planning (60s timeout) |
| **Timezone display** (`TZ_DISPLAY`) | Configurable terminal timestamp timezone |

---

## Part 2: What's Missing — Opportunities

Each opportunity is numbered OPP-01 through OPP-13. These IDs are referenced in Part 3's roadmap.

### OPP-01: BDD Regression Accumulation Across Sprints

**Problem**: Each sprint is currently a sealed unit. The Evaluator only checks the *current* sprint's contract criteria. Previous contracts are not rechecked. This creates two related blind spots:

1. **No memory** — The Evaluator doesn't know what previous sprints established or what issues were found.
2. **No regression detection** — Sprint 3 can silently break behavior established in Sprint 1, because Sprint 1's criteria are never re-evaluated.

**Key insight**: BDD scenarios are **behavioral invariants**. "Given a user submits a valid form, When the server processes it, Then a 201 is returned" — this is a promise about what the system *does*. It must remain true after Sprint 1, after Sprint 3, after Sprint 6. Unlike TDD unit tests (which may legitimately change during refactoring), BDD acceptance criteria describe business behavior that should hold across all sprints.

**Opportunity**: Accumulate BDD-derived contract criteria across sprints. Have the Evaluator check ALL accumulated behavioral criteria, not just the current sprint's.

**Mechanism**:
- After Sprint N passes, its behavioral contract criteria are added to an accumulated regression set
- When evaluating Sprint N+1, the Evaluator receives both the current sprint's contract AND accumulated behavioral criteria from Sprints 1..N
- Pass rule: ALL current criteria >= threshold AND no regression failures on accumulated criteria
- Criteria already exist as structured JSON in `.adhd/contracts/sprint-N.json` — no new storage format needed

**Design consideration — criteria classification**: Not all contract criteria are behavioral. Some are code quality ("error handling covers X") or implementation ("uses the correct database schema"). Two approaches:

- **Option A — Tag during negotiation**: Add a `"type": "behavioral"` field to criteria during contract negotiation. Only behavioral criteria accumulate for regression. Requires a prompt change in the contract negotiation phase.
  - Pros: Precise; only genuinely behavioral criteria are re-evaluated; avoids false positives from implementation-specific criteria
  - Cons: Adds complexity to contract format; LLM may misclassify criteria
- **Option B — Accumulate all, let Evaluator judge**: Pass all previous criteria to the Evaluator. It can recognize which are still testable and which are obsolete (e.g., if a feature was deliberately replaced).
  - Pros: Simpler; no contract format change; leverages Evaluator's judgment
  - Cons: More criteria per evaluation = longer prompt, higher cost; Evaluator may be too lenient on regressions it can explain away
- **Recommended**: **Option A** — the contract format change is minimal (one field), and precision matters more than simplicity here. False regression alerts would erode trust in the harness.

**Cost consideration**: Evaluation becomes slightly more expensive each sprint (more criteria). But the Evaluator already runs the code and inspects the codebase — checking one more endpoint or scenario within the same session is marginal. For a 5-sprint run, Sprint 5's Evaluator might check ~50-60 accumulated criteria vs ~12 current ones. This is manageable within context limits.

- **Effort**: Medium

### OPP-03: Pre-Evaluation Static Analysis Gate

**Problem**: The Evaluator is a full LLM call. Wasting an evaluation turn on trivial issues (lint errors, type errors, import mistakes) is expensive — especially when the project already has a linter or type checker configured.

**Opportunity**: Run the project's existing lint/typecheck commands between Generator output and Evaluator invocation.

- **Option A — Hard gate**: If lint/typecheck fails, don't run Evaluator. Count as a failed attempt, inject lint output as feedback.
  - Pros: Saves the full cost of an Evaluator turn
  - Cons: Consumes a retry attempt on something the Generator could fix quickly; some projects have noisy linters with pre-existing warnings
- **Option B — Soft gate**: Run lint/typecheck, inject results into Evaluator's context as supplementary data. Evaluator decides severity.
  - Pros: No retry consumed; Evaluator has richer signal; tolerates pre-existing warnings
  - Cons: Still runs the Evaluator call
- **Option C — Auto-fix gate**: Run lint with auto-fix (e.g., `biome check --fix`), commit fixes, then proceed to Evaluator.
  - Pros: Fixes trivial issues silently; no retry or Evaluator cost
  - Cons: Auto-fix may introduce changes the Generator didn't intend; harder to audit
- **Recommended**: **Option B** for safety, with an opt-in flag (`--lint-gate`) for Option A when users know their linter is clean.
- **Effort**: Small to Medium (depends on detection of project's lint/typecheck commands)

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

### OPP-05: Diff-Aware Evaluation on Retries

**Problem**: On retries, the Evaluator re-evaluates the entire codebase state. It doesn't know what changed between attempts, making feedback less focused and the evaluation more expensive.

**Opportunity**: Inject `git diff` between the previous attempt's commit and the current one into the Evaluator's prompt. The Evaluator can then focus on what changed while still checking all criteria.

- **Pros**: Sharper feedback; the Evaluator can distinguish "this was already there" from "the generator just wrote this"; reduces evaluation time on large codebases
- **Cons**: Adds prompt length (diffs can be large); may bias the Evaluator toward only checking changed code
- **Mitigation**: Cap diff size (e.g., 8K tokens) with a truncation warning. The Evaluator still runs all criteria — the diff is supplementary context, not a replacement.
- **Effort**: Small (git diff is cheap; only the evaluator prompt template changes)

### OPP-06: Code Quality in Evaluation

**Problem**: The Evaluator checks *behavior* — does the code work, do tests pass, does it meet criteria? It does not systematically assess *craft* — naming, duplication, maintainability, architectural fit, security patterns. These concerns are distinct: code can pass all functional tests and still be unmaintainable.

**Opportunity**: Incorporate code quality assessment into the evaluation process.

- **Option A — Separate Reviewer agent (4th agent)**: A new agent with read-only tools, focused on code quality. Runs only on passing sprints.
  - Pros: Clean separation of concerns; Evaluator stays focused on behavior; Reviewer has its own specialized prompt
  - Cons: Extra LLM cost per passing sprint; adds latency; significant architectural change (new agent type, new orchestration path)
- **Option B — Quality criteria in contracts**: Extend contract negotiation prompts to include quality-focused criteria (naming, duplication, complexity) alongside behavioral ones.
  - Pros: No new agent; no architectural change; quality concerns checked alongside behavior within the existing evaluation
  - Cons: Evaluator prompt already long; mixing behavioral and quality concerns may dilute both; harder to make quality criteria optional
- **Option C — Post-run review skill**: A skill that adds code review instructions to the Evaluator for the final sprint only.
  - Pros: Uses existing architecture; only one extra evaluation; quality check at the end when all code is written
  - Cons: Feedback comes too late to improve code; doesn't catch quality drift mid-run
- **Recommended**: **Option B** initially — extend contract negotiation to include quality criteria. This tests whether the *signal* is missing (no quality awareness) or the *mechanism* is inadequate (needs a dedicated agent). Evolve to **Option A** only if quality concerns consistently need deeper, separate analysis.
- **Effort**: Option B is Small. Option A is Large.

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

### OPP-08: Sprint Selection (`--sprint N`)

**Problem**: To re-run a single sprint, users must either `--resume` (which continues from last checkpoint) or start a full fresh run. There's no way to target a specific sprint.

**Opportunity**: `--sprint N` jumps to sprint N, loading spec and existing contracts, skipping earlier sprints. If the contract for sprint N doesn't exist, runs contract negotiation for that sprint only.

- **Pros**: Major DX improvement for iterating on specific sprints; saves significant time and cost
- **Cons**: Skipped sprints may have introduced state that sprint N depends on; user must ensure codebase is in the right state
- **Mitigation**: Require existing spec (error if none). Warn if no checkpoint exists for sprint N-1.
- **Effort**: Medium

### OPP-09: Progressive Spec Refinement

**Problem**: The spec is static — written once, read many times. If the Generator discovers mid-run that the spec's assumptions are wrong (e.g., a library doesn't support a planned feature), the spec doesn't adapt.

**Opportunity**: After each sprint, the Planner re-reads the spec + actual code state and adjusts remaining sprints. Completed sprints are frozen — only not-yet-started sprints can be modified.

- **Pros**: Spec stays aligned with reality; recovers from incorrect assumptions; mirrors how real teams adjust scope mid-project
- **Cons**: Changes the fundamental static-spec contract; re-planning costs tokens; may cause scope drift; risk of Planner rewriting in surprising ways
- **Required guardrails** (if implemented):
  1. Only sprints **not yet started** may be modified — completed sprints are frozen
  2. Revised spec shown to the user via a gate (like existing spec approval) — not silently applied
  3. A diff is logged: "Planner adjusted Sprint 4: removed X, added Y"
  4. Accumulated BDD regression criteria (OPP-01-A) from completed sprints remain unchanged — they are the stable behavioral contract
- **Effort**: Large (but guardrails reduce risk significantly)

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

### OPP-13: Documentation Generation

**Problem**: The harness produces **zero documentation output**. The code is committed, but all knowledge *about* the code evaporates when the run ends. No README, no API docs, no changelog, no architecture notes.

Yet the harness generates rich structured knowledge during a run:

| Artifact | Contains | Persisted? |
|----------|----------|------------|
| `spec.md` | Product vision, features, BDD scenarios, sprint plan | Yes, but in `.adhd/` (gitignored) |
| `contracts/sprint-N.json` | Testable criteria, feature descriptions | Yes, in `.adhd/` |
| `feedback/sprint-N-round-M.json` | Quality assessments, what passed/failed | Yes, in `.adhd/` |
| Evaluator summaries | What works, edge cases found | Only in conversation logs |
| Generator commit messages | What was built per feature | In git history |

A real project needs at minimum: a README (what this is, how to run it), API documentation (if endpoints were built), and a CHANGELOG (what was built per sprint — this is literally the contract history).

**Opportunity**: Ensure the harness run produces project documentation, not just code.

- **Option A — Post-run synthesis agent**: After all sprints pass, run a dedicated "Documenter" agent that reads codebase + `.adhd/` artifacts and writes project documentation. Read-only on `.adhd/`, write access to the project.
  - Pros: Dedicated agent with focused prompt; can read actual code + spec + contracts; produces high-quality output
  - Cons: Extra LLM cost; adds latency at end of run; new agent type to maintain
- **Option B — Generator responsibility**: Extend the Generator prompt to include "write/update documentation after implementing features" as part of each sprint.
  - Pros: No new agent; documentation stays current per sprint; Generator already knows what it just built
  - Cons: Generator context already full; documentation quality may suffer as afterthought; adds criteria to every contract
- **Option C — Skill + contract criterion**: A documentation skill injected to the Generator providing templates and conventions. Combined with a contract criterion like "README.md is updated with new features." Documentation becomes a quality criterion (pairs with OPP-06, Option B).
  - Pros: Uses existing infrastructure; composable; developer controls the template; lightweight
  - Cons: Generator may treat it as checkbox compliance rather than genuine documentation; quality depends on skill content
- **Recommended**: **Option C** for Phase 1 (small, uses existing skills + contract criteria). Upgrade to **Option A** in a later phase if documentation quality from the Generator proves insufficient.
- **Effort**: Option C is Small (content only). Option A is Medium.

---

## Part 3: Proposed Roadmap with Priorities

### Prioritization Criteria

Each item is assessed on four dimensions:

1. **Impact on output quality** — Does it make the generated code better?
2. **Impact on reliability** — Does it reduce failures and wasted retries?
3. **Impact on developer experience** — Does it make the harness easier/faster to use?
4. **Implementation cost** — How much work and risk is involved?

### Traceability

Every roadmap item references its Part 2 opportunity analysis by OPP-ID, including which option was selected where applicable.

---

### Content Stream (Parallel — No Code Changes)

These items use the existing skills system and contract negotiation prompts. They require content authoring only and can proceed in parallel with any engineering phase.

| # | Feature | Source | Effort | Deliverable |
|---|---------|--------|--------|-------------|
| CS-1 | **Policy skills + code-style template** | OPP-07 | S | Harness-level: `security-owasp`, `accessibility-wcag`, `api-design` skill directories with `skill.yaml` + `.md` content. Project-level: a `code-style` skeleton template with guidance questions for developers to fill in per project (placed in `.adhd/skills/local/`). |
| CS-2 | **Documentation skill** | OPP-13-C | S | `documentation` skill with README/CHANGELOG templates, injected to Generator. Pairs with quality criteria (1.5 / OPP-06-B) to make documentation a contract requirement. |
| CS-3 | **Codebase context guidance** | OPP-04-B | S | Documentation/template for creating project-local `.adhd/skills/local/codebase-context.md` skills. Not a harness skill itself — a guide for users. |

**Rationale**: These are the highest-leverage items relative to effort — they fill the content gap in an architecturally mature skills system. No PRs to review, no tests to write, no risk of regression.

---

### Phase 1: Deepen — Smarter Within Existing Architecture

**Goal**: Address the highest-impact gaps. Most items work within the current three-agent model. One item (1.6) is a larger architectural investment included because it addresses a fundamental limitation of static specs.

| # | Feature | Source | Effort | Justification |
|---|---------|--------|--------|---------------|
| 1.1 | **BDD regression accumulation** | OPP-01-A | M | The #1 quality gap: cross-sprint behavioral regression. Accumulate BDD-derived contract criteria across sprints; Evaluator checks ALL accumulated behavioral criteria, not just the current sprint's. Criteria tagged `"type": "behavioral"` during contract negotiation. Uses existing contract JSON format — no new storage. |
| 1.2 | **Static analysis gate (soft)** | OPP-03-B | S | Inject lint/typecheck results into Evaluator context. Near-zero cost, richer signal for evaluation, no retries consumed. Requires detecting the project's lint command (package.json scripts or convention). |
| 1.3 | **Diff-aware evaluation on retries** | OPP-05 | S | Inject `git diff` between attempts into Evaluator prompt. Sharpens retry feedback, especially for large codebases. Small change to evaluator prompt template only. |
| 1.4 | **Sprint selection (`--sprint N`)** | OPP-08 | M | Major DX improvement. Targeted sprint re-run without full `--resume` from last checkpoint. |
| 1.5 | **Quality criteria in contracts** | OPP-06-B | S | Extend contract negotiation prompts to include quality-focused criteria (naming, duplication, complexity, documentation). Tests whether quality awareness is the missing signal before investing in a separate Reviewer agent. |
| 1.6 | **Progressive spec refinement (guarded)** | OPP-09 | L | Living spec that adapts after each sprint. **Guardrails**: only future sprints modified; user gate before applying changes; diff logged; accumulated BDD regression criteria (1.1 / OPP-01-A) remain unchanged. The largest item in Phase 1 but addresses a fundamental limitation. |
| 1.7 | **Post-run documentation agent** | OPP-13-A | M | Dedicated Documenter agent that runs once after all sprints pass, synthesizing codebase + `.adhd/` artifacts (spec, contracts, evaluator feedback, BDD scenarios) into project documentation (README, API docs, CHANGELOG). One additional `query()` call — architecturally simple (same pattern as Evaluator). Produces a tangible deliverable the user can immediately evaluate. Complements CS-2 (OPP-13-C): the skill ensures the Generator writes minimal docs per sprint; the Documenter produces polished final documentation. |

**Rationale for ordering**: Items 1.1-1.3 are the highest-leverage quick wins — they address quality gaps (cross-sprint regression, trivial failures, imprecise retry feedback) with minimal code. Item 1.4 is DX. Item 1.5 is a small prompt change with outsized impact on code quality. Item 1.6 is the most ambitious but directly addresses a real limitation: specs that can't adapt to reality. Item 1.7 ensures the harness produces production-ready output, not just working code.

**Dependencies**: Item 1.6 benefits from 1.1 being in place first — accumulated BDD criteria provide the stable behavioral contract that persists even as the spec evolves around them. Item 1.7 benefits from all other Phase 1 items — richer contracts, quality criteria, and refined specs all improve the Documenter's source material.

---

### Phase 2: Extend — New Capabilities

**Goal**: Capabilities that change how the harness operates, building on Phase 1 foundations.

| # | Feature | Source | Effort | Justification |
|---|---------|--------|--------|---------------|
| 2.1 | **Adaptive retry (model escalation)** | OPP-10 | M | Opt-in `--escalate` flag. Use cheaper model by default, escalate to stronger model on failed retry. Higher success rate on hard sprints without increasing baseline cost. Decomposition (attempt 3) deferred. |
| 2.2 | **`adhd skill` CLI** | OPP-07 (tooling) | M | `adhd skill add/list/remove` — UX sugar over manual git clone. Becomes valuable once Content Stream skills and future community skills create an ecosystem worth managing. |
| 2.3 | **Run comparison** | OPP-12 | M | `adhd compare` for evidence-based tuning. Data already exists in `.adhd/usage.json` and `progress.json`. Enables systematic prompt engineering and model selection. |
| 2.4 | **Code review agent (4th agent)** | OPP-06-A | L | Separate Reviewer agent for code quality. **Contingent**: only if Phase 1's quality criteria in contracts (1.5 / OPP-06-B) proves insufficient. If OPP-06-B works well, this item is dropped. |

**Rationale**: Item 2.1 addresses a fundamental retry limitation. Items 2.2-2.3 are ecosystem and tooling. Item 2.4 is contingent — it's the escalation path if OPP-06-B doesn't deliver enough quality signal.

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
| | CS-2 | Documentation skill + templates | OPP-13-C | Lightweight baseline for per-sprint docs |
| | CS-3 | Codebase context guidance | OPP-04-B | User guide, not a harness skill |
| --- | --- | --- | --- | --- |
| **Phase 1**<br/>*Deepen (HIGH)* | 1.1 | BDD regression accumulation | OPP-01-A | #1 quality gap: cross-sprint behavioral regression |
| | 1.2 | Static analysis gate (soft) | OPP-03-B | Inject lint/typecheck into Evaluator context |
| | 1.3 | Diff-aware evaluation on retries | OPP-05 | Inject `git diff` into Evaluator prompt |
| | 1.4 | Sprint selection (`--sprint N`) | OPP-08 | Targeted re-run without full `--resume` |
| | 1.5 | Quality criteria in contracts | OPP-06-B | Quality-focused criteria in contract negotiation |
| | 1.6 | Progressive spec refinement (guarded) | OPP-09 | Living spec; depends on 1.1 for stable BDD floor |
| | 1.7 | Post-run documentation agent | OPP-13-A | Synthesize `.adhd/` artifacts into project docs |
| --- | --- | --- | --- | --- |
| **Phase 2**<br/>*Extend (MEDIUM)* | 2.1 | Adaptive retry with model escalation | OPP-10 | Opt-in `--escalate` flag |
| | 2.2 | `adhd skill` CLI | OPP-07 (tooling) | UX sugar over manual install |
| | 2.3 | Run comparison | OPP-12 | Evidence-based prompt/model tuning |
| | 2.4 | Code review agent (4th agent) | OPP-06-A | **Contingent**: only if 1.5 (OPP-06-B) insufficient |
| --- | --- | --- | --- | --- |
| **Phase 3**<br/>*Transform (LOW)* | 3.1 | Parallel sprint execution | OPP-11 | Requires sprint dependency graph |
| | 3.2 | Web dashboard | OPP-12 | Requires stabilized CLI + data formats |

**Opportunities not on the roadmap**: OPP-04 (Generator context priming) is addressed via CS-3 (OPP-04-B) as documentation/guidance — no code needed.

---

### Key Architectural Insight

The harness's highest-leverage extension point is the **skills system**. It's a fully functional plugin architecture with per-agent routing, three scopes, and methodology-aware filtering — but only three built-in skills exist, all harness-internal. The Content Stream exploits this gap: policy skills, documentation templates, and codebase context guides can be authored independently of any engineering phase.

The second insight is that **BDD scenarios are the natural regression mechanism**. They already exist as structured JSON in sprint contracts. They represent behavioral invariants, not implementation details. Accumulating them across sprints (OPP-01-A) turns the contract system from a per-sprint checklist into a growing behavioral specification of the entire system — and pairs naturally with progressive spec refinement (OPP-09) because the accumulated BDD criteria provide the stable contract floor that persists even as the spec evolves above them.
