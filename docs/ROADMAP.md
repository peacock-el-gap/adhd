# ADHD Harness — Roadmap

## How to Read This Document

This roadmap has two parts:

- **Part 1** identifies open gaps and opportunities, each with options, pros/cons, and a recommendation.
- **Part 2** organizes those opportunities into a prioritized roadmap. A separate **Content Stream** runs in parallel for work that requires no code changes.

What the harness already does — the catalogue of built-in capabilities — lives in its own document, [docs/CAPABILITIES.md](CAPABILITIES.md). The design reasoning behind those capabilities lives in [docs/INTERNALS.md](INTERNALS.md).

The document is self-contained. No prior conversation context is required.

---

## Part 1: What's Missing — Opportunities

Each opportunity below is an open gap or enhancement. Opportunities are numbered with their original IDs for traceability in Part 2. Implemented opportunities have been removed from this section — they are documented as current capabilities in [docs/CAPABILITIES.md](CAPABILITIES.md) (§1.12–§1.42).

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
> **Phase 1** of Part 2.

### OPP-29: `--sprint N` Bypasses Branch Safety

**Problem**: The `--sprint N` entry path (`sprintSelectionHarness` in `shared/orchestration/harness.ts`) performs no branch setup at all — no topic-branch creation, no `--allow-main` check, no `progress.branch` read or write — yet it runs the full sprint loop, which commits on whatever branch is checked out. The fresh and resume paths both guard this. The result silently violates the documented hard default that commits never land on `main` (README, CHANGELOG, §1.35). The standalone guard `assertBranchAllowed` in `git-ops.ts` has no production caller.

**Opportunity**: Close the last unguarded entry path so every path that commits also enforces branch safety.

- **Option A** — Reuse the recorded `progress.branch` when present; when absent, error exactly like the resume path unless `--allow-main`.
- **Option B** — Require explicit branch context for `--sprint N`.

- **Recommended**: **Option A** — it mirrors the resume precedent and is least surprising. Fold the logic into the shared `ensureRunBranch` helper (OPP-37) so all three paths share one implementation. The dead-today `assertBranchAllowed` guard (`shared/orchestration/git-ops.ts`) is retained precisely as the building block for the refuse-on-`main` half of this fix — wire it up here rather than deleting it (its removal under OPP-41 is explicitly declined). Write the sprint-selection branch-safety test first — it is RED until the fix lands.
- **Effort**: Medium.
- **Tag**: **[human-led]** — core-loop branch safety.

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

### OPP-33: Document `--lint-gate` as the Recommended Dogfooding Setting

**Problem**: The deterministic self-check sequence now runs before the Evaluator (a shipped capability — `docs/CAPABILITIES.md` §1.42), but the README does not yet tell maintainers to run the hard `--lint-gate` when dogfooding the harness against its own large test suite. The cheap deterministic effort is in place; the recommendation to use the hard gate is not yet written down.

**Opportunity**: Add a short README sentence recommending `--lint-gate` for dogfooding runs. Document only — do not flip the default (that needs config-test updates and is a separate call).

- **Effort**: Small.
- **Tag**: **[harness-implementable]**.

### OPP-34: Refinement Fires Every Passing Sprint, on Opus, Unconditionally

**Problem**: When `--refine-spec` is set, the Planner (Opus) is invoked after every passing non-final sprint, *before* the no-change determination — the largest single recoverable role cost, and frequently a no-op. The flag defaults off, so it bites opt-in runs only. (This is the sanctioned cost lever — refinement is recoverable; the judge is **never** a cost lever.)

**Opportunity**: Cut the largest recoverable role cost without weakening the judge.

- **Option A** — A structured WARN/metric distinguishing a no-op refinement from a real mutation (today's `log()` is indistinguishable and never aggregated).
- **Option B** — Conditional skip (e.g. skip after a clean first pass that added no forward-referenced symbol; always run after a retry), gated behind a flag and validated against recorded runs first (skipping risks a stale forward reference).

- **Recommended**: **Option A** now; **Option B** only behind a flag with a backtest.
- **Effort**: Medium.
- **Tag**: **[human-led]** — core-loop cost lever. *Confirms post-mortem #5.*

### OPP-35: Characterization Tests for the Orchestration Core

**Problem**: No test drives `runHarness` / `resumeHarness` / `sprintSelectionHarness` / `runSprintLoop` / `runSprintAttempts`. The tests that import the orchestration modules read them as strings or mirror their logic in comments; the one test credited with covering the commit path exercises a statically dead branch. The mirror-style gate tests are precisely why defects like the test-gate carry-forward gap (the shipped F3 fix) stay invisible.

**Opportunity**: Build the characterization net the safe-refactor work depends on. The `AgentRunners` DI seam already exists (SDK-free) for exactly this.

- **Approach** — A fake `AgentRunners` + fake `Tracer` + temp git repo driving the real functions. Pin: `--sprint N` without `--allow-main` does not commit on the starting branch (OPP-29); the abort path saves usage; gate ordering and the `lastRealEval` carry-forward across all three gates. In particular, rewrite the test-gate carry-forward test — today a mirror that does not drive the production call site, so reverting the fix leaves the suite green — to drive the real `runSprintAttempts`, so it fails when the carry-forward is removed. Caveat: `runSprintAttempts` calls verification internally with no injected executor — either run against a real temp repo with a real test command, or add a verification-runner seam first (relates to OPP-47/K7).

- **Recommended**: Build it — it is the prerequisite for OPP-37 and OPP-38. Rewrite the dead-branch test to exercise the real guard.
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

**Problem**: `runSprintAttempts` (≈473 LOC) is one function mixing baseline capture, three pre-Evaluator gates inlined with divergent arguments, interleaved evaluator-context assembly, and error handling. The divergent gate shape is exactly how the test-gate carry-forward omission slipped in.

**Opportunity**: Make gate divergence impossible and the loop testable.

- **Approach** — Extract a uniform `gateSkip(reason, detail)` that always threads `lastRealEval` across all three gates (so the test-gate carry-forward can never diverge again), plus a `buildEvaluatorContext(...)` that takes already-computed inputs and preserves gate-relative ordering.

- **Recommended**: Behaviour-preserving only if OPP-35's tests exist first. Do after OPP-35.
- **Effort**: Large.
- **Tag**: **[human-led]** — core-loop surgery.

### OPP-41: Remove the Redundant `freezeCompletedSprints` Helper

**Problem**: `freezeCompletedSprints` (`shared/refinement.ts`) is production-dead. The live refinement orchestrator (`performSpecRefinement`) protects completed sprints structurally instead — it splices the verbatim original sections around the Planner's remaining-only output (the patch-based path, `docs/CAPABILITIES.md` §1.27) — so the helper's old guarantee ("repair completed sections if the Planner edited them") can no longer be reached: the Planner is never handed a completed section to edit.

**Opportunity**: Delete the redundant helper and the tests that exist only to exercise it; its private helper `extractSprintSection` stays, as it is still used live.

- **Note**: The rest of the original OPP-41 work already shipped — the static one-export-per-symbol guard is now a capability (`docs/CAPABILITIES.md` §1.41) — and the orphaned `assertBranchAllowed` guard is deliberately **retained** under OPP-29 as the building block for the `--sprint N` branch-safety fix. Neither is removed here.
- **Recommended**: Remove the dead helper; with no production importer, the deletion keeps the suite green.
- **Effort**: Small.
- **Tag**: **[harness-implementable]**.

### OPP-44: Tighten the Security Model (Environment Allowlist + Log Redaction)

**Problem**: The trust boundary is now documented — the README has a Security section (a shipped capability, `docs/CAPABILITIES.md` §1.39) — but two high-value surfaces are still untightened. Project lint/test scripts run via `sh -c` with the full parent environment (provider, tracing, and `.adhd/.env` secrets included), and conversation logs persist raw Bash commands and tool output unredacted.

**Opportunity**: Tighten the two surfaces the documentation now names.

- **Option B** — Scrub the environment handed to project-script execution down to a minimal allowlist at both spawn sites.
- **Option C** — A lightweight redaction pass over conversation logs (mask the values of secret-shaped env keys).

- **Recommended**: Both are report-first and test-first — the spawn-env work needs a test exercising the real executor, and a complete redaction pass also covers the dominant `run-agent` channel (larger, separate). The spawn-env scrub pairs with the `static-analysis-runner` executor seam in OPP-47.
- **Effort**: Medium.
- **Tag**: **[human-led]**.

### OPP-45: Fix the Phantom Flag; Bound Ambient Settings Inheritance

**Problem**: Two public-surface/governance gaps. (1) `--reviewer-max-turns` was advertised in the v0.8.0 CHANGELOG but never implemented — and because the CLI parser is strict, passing it hard-crashes; the Reviewer silently uses the read-only default cap. (2) Coding agents inherit the operator's and the target project's `user`/`project`/`local` `.claude/` (CLAUDE.md, skills, slash commands, subagents) via hardcoded `settingSources`, with no flag to bound it — an unbounded skill/command surface, the analogue of the MCP exposure that §1.30 deliberately bounded. The genuinely novel exposure is an untrusted target project's `project`/`local` `.claude/` auto-running hooks/commands.

**Opportunity**: Make the docs match the code, and bound ambient inheritance.

- **Option A (the flag)** — Implement `--reviewer-max-turns` mirroring the other four turn caps (better 1.0 story) **or** strike the CHANGELOG advertisement.
- **Option B (governance)** — Add a settings-source flag symmetric to the MCP controls (`--no-inherit-settings` / `--settings-sources`), resolved through the existing tool-policy seam, defaulting to current behaviour; correct §1.30's wording (it under-describes the inherited scope).

- **Recommended**: Implement the flag (with a parse test) and add the governance flag (with a tool-policy test, default preserved). Pairs with OPP-47.
- **Effort**: Small–Medium.
- **Tag**: **[human-led]** — public surface / governance. *Confirms seed findings #4 and #1.*

### OPP-46: Guard Against Re-Adding the Phantom `--reviewer-max-turns` Flag

**Problem**: The `--help`/README reference is now complete and consistent (a shipped capability, `docs/CAPABILITIES.md` §1.40), including the removal of the phantom `--reviewer-max-turns` claim. But nothing stops it being reintroduced — there is no test asserting the flag stays absent and rejected.

**Opportunity**: Add a small regression test asserting `--reviewer-max-turns` is absent from `CLI_FLAG_HELP` and is rejected by the parser.

- **Effort**: Small.
- **Tag**: **[harness-implementable]**.

### OPP-47: Lift Claude-Specific Vocabulary Behind Harness Seams

**Problem**: Several Claude-specific assumptions live in `shared/` as *vocabulary* coupling (no SDK import — the sacred boundary is intact — but latent friction for a `harness-gemini`): hardcoded Claude model IDs with substring tier-matching (a second harness gets all-"unknown" tiers, silently no-op-ing the cost/invariant warnings); cost/token observability that zeroes for any provider not emitting `total_cost_usd`; `settingSources` literals (relates to OPP-45); Claude-named constants and a hardcoded "Claude Agent SDK" banner; contract cost recorded inside the wrapper rather than the orchestrator; and a direct `Bun.spawnSync` in `static-analysis-runner` with no executor seam.

**Opportunity**: Lift the provider vocabulary behind harness-owned seams while keeping the portable logic in `shared/`.

- **Approach** — Let each harness supply a model→tier catalog and (eventually) a cost adapter injected alongside `AgentRunners`; express the governance intent abstractly; parameterize the banner/env names; pull contract-cost recording up to the orchestrator; extend the `CommandExecutor` seam to `static-analysis-runner`.

- **Recommended**: Do the cheap, live-value items now — the cost WARN when tokens are positive but cost is zero, the `static-analysis-runner` executor seam (also unblocks OPP-35's unit test), and the provider-named banner. Extend the same executor/injection seam to `runEvaluator` so the evaluator `max_tokens` resume recording can be covered by a behavioural test rather than the current source-string check. Defer the rest until a second harness is real; the refactors move test fixtures, so test-first.
- **Effort**: Small–Medium.
- **Tag**: **[human-led]** — evolvability.

> **OPP-48 – OPP-53 below** were folded in from the project's enhancement-ideas
> backlog (2026-06-06). They cluster into live observability / liveness (answering
> "is it stuck?") and after-the-fact forensics. None was already implemented; where
> adjacent infrastructure exists it is cited inline. They are sequenced in **Phase 2**
> of Part 2.

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

> **OPP-54 below** was surfaced by a governance investigation (2026-06-07) into
> which of the harness's own `.adhd/` artifacts should be committed to git. It is a
> pre-1.0 surface decision (commit flags + default behaviour) that also closes a
> latent clean-tree coupling defect, so it is sequenced in **Phase 1 (1.D)**.

### OPP-54: `.adhd/` Commit Governance — Default-Off, Tiered, `.gitignore`-Supreme

**Problem**: The harness runs against arbitrary repos, so any rule about what it
commits must live in code, not in ADHD's own `.gitignore`. Today the behaviour does
not match a clean "default off" model. `.adhd/` is committed on **every** Generator
attempt by an *ungated* hygiene commit (`commitAdhdArtifacts`, a bare `git add .adhd/`),
whenever `.adhd/` is not gitignored — the `--commit-adhd` flag only governs a
separate curated *metadata* commit. The hygiene commit exists solely to keep the
working tree clean for generator-output detection, yet three whole-tree
`git status --porcelain` checks (`ensureAgentCommit` ×2, `checkDirtyTree`) and the
fallback `git add -A` do not exclude `.adhd/`. The result is a latent defect: an
artifact written *during* the Generator stage (e.g. the Generator's own conversation
log, flushed when the agent finishes) can be folded into the **product** commit by
the fallback. Two documentation/behaviour mismatches compound it: `regression.json`
is named a durable asset kept on `main` but is absent from the commit allow-list, and
`runs/` / `baseline-*` are documented "not committed" yet are swept by the bare add.

**Opportunity**: Make the project's `.gitignore` an enforced invariant, and separate
*persistence* (governed by flags, default off) from *hygiene* (governed by path
exclusion, not by committing). Removing the hygiene commit and excluding `.adhd/` from
the working-tree checks makes "default off" genuinely mean "the harness never touches
git with `.adhd/`," while flags opt specific tiers in.

- **Option A — Decouple hygiene from persistence (tiered flags).** Drop the ungated
  pre-Generator commit; make the three working-tree checks and the fallback exclude
  `.adhd/` (the committed-diff side already filters it). Persistence stays flag-gated
  in two purpose-based tiers: `--commit-adhd` commits the structured audit record
  (contracts, feedback, progress, spec, usage, **regression**, reviews, scout-digest,
  baseline), `--commit-adhd-logs` adds raw conversation logs; `runs/`/`skills/` are
  always local-only. Allow-list, so new families default to not-committed. Fixes both
  mismatches.
- **Option B — Additive only.** Keep the hygiene commit (commits by default); layer
  governance on top. No behaviour change, but "default off" is never achieved and the
  coupling defect and mismatches remain.
- **Option C — Minimal coupling fix.** Only exclude the uncommitted subset from the
  dirty checks so the fallback-pollution bug cannot bite; defer the flag redesign.

- **Recommended**: **Option A.** It realises the intended two-layer model
  (`.gitignore` supreme; flags opt in; default off) and closes the defect in one
  coherent change. The detection edits are the load-bearing risk — land them
  test-first (stray-`.adhd/` cases for `ensureAgentCommit`; product-only fallback;
  a no-`-f`/`--force` guard test). User-visible default change → `feat!` /
  `BREAKING CHANGE:` (precedent: §1.35). Greenfield is unaffected.
- **Interaction**: refines the `--commit-adhd` / `--commit-adhd-logs` surface
  (§1.13, §1.34) and the run-history/local-only intent (§1.37); pairs with the
  release-time strip rule (`RELEASING.md`), which it simplifies.
- **Effort**: Medium.
- **Tag**: **[human-led]** — core-loop generator-output detection + 1.0 commit surface.

> **OPP-55 below** was surfaced by the Phase-1 self-development post-mortem
> (2026-06-07): the harness completed nine roadmap items but updated
> `docs/ROADMAP.md` on none of them, despite the rule being present in the project
> CLAUDE.md and the spec. It is a governance/correctness capability with a pre-1.0
> on-disk-format footprint; it is sequenced in **Phase 2** under a new **Governance
> & Policy** band.

### OPP-55: Standing (Cross-Cutting) Requirements Enforced Every Sprint

**Problem**: The harness has no reliable way to honour a *standing* requirement — a cross-cutting rule that must hold on every sprint regardless of that sprint's features, e.g. "after completing a roadmap item, remove it from `docs/ROADMAP.md` Part 1 and Part 2." Such a rule can be written in the project CLAUDE.md and restated in the spec and it is still skipped: a self-development run completed nine items and updated the roadmap on none of them (the single manual fix even claimed in its commit message to have removed two opportunities it left untouched). The rule reaches the agents as ambient context — CLAUDE.md is loaded via settings sources, and the full spec is injected into the Generator — but it never becomes an *operative, owned, enforced* per-sprint obligation: it is not a contract criterion, so contract negotiation never carries it; the Generator is directed to "implement the features," not to satisfy criteria, so it does not act on it up front; and no gate checks it, so the sprint goes green without it — the same "invisible to the green gate" family as OPP-41. This is distinct from OPP-07 (policy *skills* route only to the advisory Reviewer and never affect pass/fail) and complements OPP-45 (bounding ambient settings inheritance).

**Opportunity**: Let an operator declare a standing requirement once and have the harness apply and verify it on every applicable sprint, across many target projects (some of which the rule does not apply to). A standing requirement compiles to one normalised form carrying: an *instruction* (a directive shown to the Generator up front, so the work is built rather than only judged), an optional *applicability guard* (so a roadmap rule is inert in a project that has no roadmap), a *verification mechanism*, and a *provenance/precedence* tag. The verification mechanism is configurable per rule — either an exact command whose result is authoritative, or natural-language logic the Evaluator applies — so mechanically-checkable rules are checked precisely while softer rules fall back to judgement. Enforcement runs through the existing Evaluator gate; the requirement is injected into both the Generator (so it is built) and the Evaluator (so it is scored).

**Options**:

- **Option A — Structured policy file (ADHD-native), deterministic core**: a committed `.adhd/policy.json` (a candidate third durable `.adhd` asset alongside `usage.json`/`regression.json`) and/or a repeatable `--policy` flag, resolved through the standard CLI > env > `.adhd/.env` > default precedence. The enforcement core lives in `shared/`, so any future `harness-{provider}` inherits it unchanged. Pros: deterministic, reproducible, reviewable in git. Cons: a new on-disk format to settle before the 1.0 freeze.
- **Option B — Natural-language only**: extract standing rules from the run prompt and the CLAUDE.md / `.claude` layers. Pros: zero new format; honours rules already written as prose; lowest authoring friction. Cons: enforcement reliability rests on a fuzzy extraction step that drifts with the model — and once results are persisted for stability the structured layer is rebuilt anyway.
- **Option C — Both, one enforcement path**: structured authoring is authoritative; natural language is a convenience that *populates candidate* rules (with provenance and a per-run audit of the resolved set) but never decides applicability. Every source compiles to the one normalised form; nothing is enforced "as prose."

**Recommended**: **Option C**. Make the requirement operative (a Generator directive) and enforced (an Evaluator criterion and/or an authoritative command), never merely present as context. Keep the deterministic core pure in `shared/` and any CLAUDE.md/`.claude` extraction behind a `harness-claude/` adapter, matching the SDK-independence boundary. Do **not** overload `contract.criteria` (that would expose standing rules to the size-ceiling trim, would not reach the Generator, and would touch the frozen contract format) — keep standing requirements in their own resolved set injected at sprint time.
- **Precedence**: a committed/shared rule is a floor; a personal/git-ignored layer may *add* rules but cannot *silently* cancel a committed one — cancelling requires an explicit, visible waiver. (The governing principle is "no silent override," not "personal beats shared.")
- **Verification**: AI judgement by default, plus an optional per-rule command whose exit status is the authoritative verdict (its output is shown as evidence but does not get reinterpreted).

**Interaction**: Reuses the *patterns* of the regression suite (§1.14, §1.29) — a durable `.adhd/*.json` store and a "build a section → inject into the prompt" step — but not its type or accumulation plumbing (regression criteria are auto-harvested from passed sprints, Evaluator-only, and carry no applicability guard or check command). It is the *enforced* counterpart to OPP-07's *advisory* policy skills, and relates to OPP-45 (settings governance). The applicability guard is what makes one rule safe to ship to many projects. The *roadmap-upkeep* rule is this engine's flagship first slice: a cheap deterministic text-check for it was attempted (formerly OPP-57) and proved unworkable — the user-facing CHANGELOG never carries opportunity ids by convention, so there is nothing to match against the roadmap. That confirms the case needs agent judgement, not string matching (see the post-mortem in the design doc).

**Effort**: Medium–Large.

**Tag**: **[human-led]** — touches the Generator/Evaluator injection seams and introduces a pre-1.0 on-disk format; the pure policy-compile/resolve core in `shared/` is **[harness-implementable]**.

**Design**: a detailed design and sprint plan is recorded in [`docs/planning/standing-requirements-design.md`](planning/standing-requirements-design.md).

> **OPP-56 and OPP-58 below** were split out from the Phase 1 hardening follow-up
> (2026-06-07): residual fixes carved off the shipped items F5 (interactive gates)
> and F2 (empty-spec refinement). They are sequenced in **Phase 1** (1.C). (A third
> split-out — the cheap roadmap-tidy check, formerly OPP-57 — was built, reviewed,
> and abandoned: its premise was unworkable. Its intent folds into OPP-55.)

### OPP-56: Mid-Run Steering Gate Editor Guard

**Problem**: The mid-run steering gate launches the external editor via an unwrapped `execSync` (`shared/orchestration/sprint-success.ts`) — the same crash class already fixed in the spec-approval gate (whose editor launch is wrapped in `tryExecEditor`). A missing or mistyped editor command throws a fatal error and kills the run instead of returning to the recoverable gate.

**Opportunity**: Wrap the mid-run editor launch in the same `tryExecEditor` guard, so a bad editor command surfaces a clear message and returns to the gate.

- **Effort**: Small.
- **Tag**: **[harness-implementable]**.

### OPP-58: Centralise Refinement Teardown

**Problem**: In `performSpecRefinement` (`shared/orchestration/spec-refinement.ts`), the `writeSpec + restoreRegressionData + return` teardown is hand-copied across six exit branches. The empty-spec divergence defect (the shipped F2 fix) was exactly one branch missing its `writeSpec`; the underlying fragility — six copies of the same teardown — was left in place (the F2 Option B not taken).

**Opportunity**: Centralise the teardown into one path so the disk/memory invariant is structural rather than re-asserted by hand in every branch.

- **Effort**: Small.
- **Tag**: **[harness-implementable]**.

### OPP-60: `--project=<dir>` Ignored by Subcommands

**Problem**: `extractProjectDir` (`harness-claude/index.ts`) locates the target directory with `args.indexOf("--project")`, which matches only the space-separated `--project <dir>` form and silently ignores the `--project=<dir>` equals form — falling back to the current directory. The main run path and `extractPositionals` both accept `=`, so the behaviour is inconsistent and surprising; the affected subcommands (`compare`, and any future read-only subcommand) then operate on the wrong directory with no error. Found 2026-06-07 during the OPP-57 review.

**Opportunity**: Make `extractProjectDir` recognise the `--project=` form too (or route it through the shared argument parser), so subcommands honour the documented flag in both forms.

- **Effort**: Small.
- **Tag**: **[harness-implementable]**.

---

## Part 2: Proposed Roadmap with Priorities

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

Each item is tagged **[harness-implementable]** (safe for the harness to build against itself — clear remit, green-keepable, test-first where noted) or **[human-led]** (contested architecture, core-loop surgery, or anything adjacent to the judge model or the 1.0 surface freeze). Several fixes are RED until written — they need a characterization test that fails first, so OPP-35 underpins the refactors.

#### 1.A — Correctness & Safety (critical — do first)

| OPP | Feature | Effort | Tag | Justification |
|-----|---------|--------|-----|---------------|
| OPP-29 | `--sprint N` branch safety | M | **[human-led]** | Commits can land on `main`, against the documented default. The last unguarded entry path. Test-first (RED until fixed). |
| OPP-31 | Reject empty/partial evaluator feedback | S | **[human-led]** | A well-formed empty feedback array ships as a vacuous PASS — the judge's terminal false-negative. Narrow empty-rejection now. |

#### 1.B — Judge Integrity & Test Foundations (high — mostly human-led)

| OPP | Feature | Effort | Tag | Justification |
|-----|---------|--------|-----|---------------|
| OPP-32 | Honest per-criterion gate verdict | S / M | **[human-led]** | Negotiated thresholds are dead at the gate; a self-declared FAIL shipped as PASS. Zero-risk WARN + distinct flag first; ties to the 1.0 format freeze. Confirms post-mortem #2. |
| OPP-35 | Characterization tests for the orchestration core | L | **[human-led]** | No test drives the sprint loop; the one "covering" test exercises a dead branch. Prerequisite for OPP-37/38. Confirms post-mortem #7. |
| OPP-36 | Offline judge-replay backtest + escalating judge | L | **[human-led]** | The only sanctioned route to a cheaper/escalating judge. Build the backtest first. Highest-value deeper bet. Confirms post-mortem §3. |
| OPP-37 | Extract shared run-setup from `harness.ts` | M | **[harness-implementable]** / **[human-led]** | Skill-resolution + branch-setup duplicated 3×. Pure extractions first; the `ensureRunBranch` part carries OPP-29. After OPP-35. |
| OPP-38 | Uniform gate + context assembly in `runSprintAttempts` | L | **[human-led]** | A 473-LOC function inlines three divergent gates (the source of the test-gate carry-forward gap). A uniform `gateSkip` makes divergence a compile-time impossibility. After OPP-35. |

#### 1.C — Cost, Hygiene & Observability (medium — mostly harness-implementable)

| OPP | Feature | Effort | Tag | Justification |
|-----|---------|--------|-----|---------------|
| OPP-33 | Document `--lint-gate` for dogfooding | S | **[harness-implementable]** | The self-check sequence shipped (`docs/CAPABILITIES.md` §1.42); what remains is a README sentence recommending the hard `--lint-gate` for dogfooding runs. Document only — do not flip the default. |
| OPP-34 | Stop refinement firing every sprint on Opus | M | **[human-led]** | The largest recoverable role cost runs unconditionally on Opus before the no-op check. WARN/metric first; conditional skip behind a flag + backtest. Confirms post-mortem #5. |
| OPP-41 | Remove the redundant `freezeCompletedSprints` helper | S | **[harness-implementable]** | Production-dead since the patch-based splice (§1.27) protects completed sprints structurally. The static one-export guard already shipped (§1.41) and `assertBranchAllowed` is retained under OPP-29 — delete only the dead helper. |
| OPP-56 | Mid-run steering gate editor guard | S | **[harness-implementable]** | The mid-run steering gate launches the editor via an unwrapped `execSync` — the same crash class the spec-approval gate already fixed. Wrap it in `tryExecEditor`. |
| OPP-58 | Centralise refinement teardown | S | **[harness-implementable]** | The `writeSpec + restoreRegressionData + return` teardown is hand-copied across six exit branches of `performSpecRefinement`; centralise it so the disk/memory invariant is structural. |
| OPP-60 | `--project=<dir>` ignored by subcommands | S | **[harness-implementable]** | `extractProjectDir` matches only the space-separated `--project <dir>` form, silently ignoring `--project=<dir>` and falling back to cwd; affects `compare` (and any read-only subcommand). Recognise the `=` form. |

#### 1.D — Docs, Security & 1.0 Surface (pre-1.0)

| OPP | Feature | Effort | Tag | Justification |
|-----|---------|--------|-----|---------------|
| OPP-44 | Tighten the security model (env allowlist + log redaction) | M | **[human-led]** | The trust boundary is documented (§1.39); what remains is scrubbing the project-script environment to an allowlist and redacting secret-shaped values in conversation logs. Report-first, test-first. |
| OPP-45 | Phantom flag; bound ambient settings inheritance | S–M | **[human-led]** | `--reviewer-max-turns` advertised but unimplemented (crashes on use); coding agents inherit user/project/local `.claude/` with no flag to bound it. Confirms seed #4/#1. |
| OPP-46 | Guard against re-adding the phantom `--reviewer-max-turns` flag | S | **[harness-implementable]** | The reference shipped (§1.40); add a regression test asserting the phantom flag stays absent from `CLI_FLAG_HELP` and is rejected by the parser. |
| OPP-47 | Lift Claude-specific vocabulary behind harness seams | S–M | **[human-led]** | Hardcoded Claude model IDs, cost zeroing for non-USD providers, `settingSources` literals — all latent friction for a `harness-gemini`. Cheap live-value items now; defer the rest. |
| OPP-54 | `.adhd/` commit governance (default-off, tiered) | M | **[human-led]** | An ungated hygiene commit puts `.adhd/` in git by default; the fallback `git add -A` can fold a mid-Generator artifact into the product commit. Decouple hygiene (path exclusion) from persistence (tiered flags); fixes the `regression.json`/`runs/` mismatches. Test-first detection edits. Breaking default change. |

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

#### 2.D — Governance & Policy

| OPP | Feature | Effort | Tag | Justification |
|-----|---------|--------|-----|---------------|
| OPP-55 | Standing (cross-cutting) requirements enforced every sprint | M–L | **[human-led]** | A cross-cutting rule (e.g. "remove a completed item from `docs/ROADMAP.md`") reaches the agents as context but never becomes an operative, owned, enforced obligation, so it is silently skipped — the same invisible-to-the-green-gate family as OPP-41. Declare once; inject as a Generator directive **and** an Evaluator criterion, with an optional authoritative command and an applicability guard so one rule is safe across many projects. Pure policy core in `shared/`, NL extraction behind a `harness-claude/` adapter. Pre-1.0 format-sensitive; the enforced counterpart to OPP-07's advisory skills. Its flagship first slice is the roadmap-upkeep rule (the cheap text-check formerly OPP-57 proved unworkable — see the design doc). |

**Rationale**: The trust/observability/safety wave (§1.32–§1.38) is complete, and the deep-review hardening (Phase 1) now leads engineering. Within Extend, the **"is it stuck?" cluster (2.A)** rises to the top: long unattended runs surfaced a real operability gap — no way to tell a reasoning model from a hung process, or to follow a run live. These are mostly small, low-risk wins (incremental logs, error/limit visibility, thinking activity), with the read-only `adhd status` next and the process-killing watchdog last (largest, riskiest, human-led). **2.B** adds after-the-fact forensics — a self-contained session bundle and contract-version diffing — plus the cost-durability gap. **2.C** holds the previously-planned reach and ecosystem items, now ranked below live observability. **2.D** opens a governance band: declaring a cross-cutting "standing" requirement once and enforcing it on every applicable sprint, closing the silent-skip gap a self-development run exposed.

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
| **Phase 1**<br/>*Harden (HIGH — leads)*<br/>from the deep review | 1.A | Correctness & safety | OPP-29, 31 | Branch safety; reject empty/partial evaluator feedback (vacuous PASS) |
| | 1.B | Judge integrity & test foundations | OPP-32,35,36,37,38 | Honest gate, orchestration test net, judge-replay, core refactors |
| | 1.C | Cost, hygiene & observability | OPP-33, 34, 41, 56, 58, 60 | Lint-gate dogfooding note, refinement cost, dead-helper removal, mid-run editor guard, refinement teardown, `--project=` parsing |
| | 1.D | Docs, security & 1.0 surface | OPP-44, 45, 46, 47, 54 | Security tightening, phantom flag + settings governance, phantom-flag guard, second-harness vocabulary, `.adhd/` commit governance |
| --- | --- | --- | --- | --- |
| **Phase 2**<br/>*Extend (MEDIUM)*<br/>§1.32–§1.38 shipped | 2.A | Live observability & liveness | OPP-27,48,49,50,51 | "Is it stuck?": error/limit visibility, incremental logs, thinking activity, `adhd status`, stream watchdog |
| | 2.B | Forensics & debugging | OPP-53,52,28 | Self-contained session bundle, `contract-diff`, cost persistence |
| | 2.C | Reach & ecosystem | OPP-26,10,07 | Remote notifications, adaptive retry, `adhd skill` CLI |
| | 2.D | Governance & policy | OPP-55 | Standing cross-cutting requirements enforced every sprint (Generator directive + Evaluator check; pure policy core in `shared/`) |
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
