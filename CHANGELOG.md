# Changelog

All notable changes to this project are documented here, from the point of view of someone using the harness. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [v0.11.0] - 2026-06-07

### Added
- **A Claude Code skill for driving the harness.** A new `adhd-harness` skill ships in the repo (under `.claude/skills/`). When you ask Claude Code to run, configure, or troubleshoot the `adhd` command in one of your projects, it now works from an accurate reference — the available flags, the run lifecycle, cost and model guidance, and common pitfalls — instead of guessing. A bundled helper script keeps the flag reference in sync with `adhd --help`.

## [v0.10.0] - 2026-06-07

Predictable, default-off handling of the harness's own metadata. **Breaking behavioural change** — see Changed.

### Changed
- **The harness no longer commits its `.adhd/` metadata to your repository by default.** Previously it committed its own working files (contracts, feedback, logs, and so on) on every attempt unless they were gitignored. Now nothing under `.adhd/` is written to git unless you opt in: `--commit-adhd` commits a structured audit record, and `--commit-adhd-logs` commits that record plus the raw conversation logs. Run snapshots under `.adhd/runs/` are never committed. **If you relied on the old behaviour, add `--commit-adhd` to your runs.**
- **`--commit-adhd` now captures the complete audit record** — in addition to the contracts, feedback, spec, progress, and cost ledger it already committed, it now also commits the behavioural regression suite, the reviewer reports, the codebase scout digest, and the per-sprint verification baselines.

### Fixed
- **Harness bookkeeping can no longer leak into your product commits.** A file the harness wrote while the code generator was running could previously be folded into the generated code's commit by the safety-net auto-commit. The harness now stages only product changes for that commit and always respects your `.gitignore` — it never force-adds an ignored path.

## [v0.9.0] - 2026-06-07

Correctness, safety, and documentation hardening.

### Added
- **Deterministic self-check sequence in Generator guidance** — the Generator now runs auto-fix, lint, type-check, and test checks before producing its final code, in that sequence, to catch and fix deterministic issues before invoking the costly Evaluator.
- **Security section in README** — explains the trust boundary clearly: the harness runs unsandboxed, executes the target repository's scripts and configured assets, and should only be pointed at repositories you trust.
- **Environment-variable reference in README** — a complete table of every accepted environment variable, its flag equivalent, and its purpose, consistent with what `--help` reports.
- **Environment-variable names in `--help`** — every flag with a backing environment variable now lists it in its help description (previously only some model flags did).
- **Reviewer and `adhd compare` in `--help`** — the Reviewer agent and the `compare` subcommand are now listed in the help output alongside their descriptions.
- **Environment-variable-only settings listed in `--help`** — `LOG_LEVEL`, `TZ_DISPLAY`, and Langfuse tracing keys now appear in a dedicated section of the help output.
- **Invalid log-level warning** — setting `LOG_LEVEL` to an unrecognised value now emits an amber warning naming the offending value and the fallback level applied (`normal`), instead of silently ignoring the setting.

### Changed
- **Run-duration description** — the README's "10–60 minutes" figure is replaced with a per-sprint breakdown that scales honestly with sprint count.
- **Cost ledger accuracy improvements** — the Reviewer stage is now tagged per sprint (preventing per-sprint rows from colliding), resume calls are now individually recorded as ledger entries, and the turn-limit warning now uses each agent's actual configured cap rather than a deprecated global cap.

### Fixed
- **Malformed numeric configuration values are now rejected with clear errors** — non-integer or NaN values passed to `--threshold`, `--max-sprints`, `--max-retries` (or their environment variable equivalents) now throw a named error at configuration resolution rather than silently proceeding with corrupted state.
- **Empty-spec refinement no longer leaves a blank spec on disk** — when progressive spec refinement produces an empty result, the original spec is now restored on disk to match the in-memory value, preventing later resuming or editing operations from reading an empty document.
- **Test-gate skip now preserves real evaluator findings** — when the test gate skips the Evaluator, prior real evaluation findings are now carried into the synthesised result instead of boilerplate, closing the feedback ping-pong that could re-occur on test-gate retries.
- **Interactive gates are now robust to missing or misconfigured editors** — when launching an external editor at the spec-approval gate, a missing or misconfigured editor command no longer crashes the harness; instead a clear message is shown and the operator is returned to the gate prompt.
- **Empty spec revisions are now caught with a clear message** — choosing to revise the spec but submitting empty feedback no longer silently re-prompts; the gate shows a message explaining that no feedback was provided and re-presents the choices.
- **Documenter degradations are now routed through the warning channel** — non-fatal documentation failures now emit warnings (amber/WARN) rather than plain output, so severity-based log filters catch them.
- **Phantom `--reviewer-max-turns` flag removed from documentation** — this flag was advertised in the v0.8.0 changelog but was never implemented. The claim is removed; the Reviewer uses the read-only agent's default turn cap.

## [v0.8.0] - 2026-06-06

Branch safety by default, two new optional agents, and run-to-run comparison.

### Added

- **`--scout` — codebase conventions pass** — A read-only agent that runs once before the sprint loop on existing projects. It surfaces naming conventions, error-handling patterns, testing style, and architectural layout, then injects a summary into the generator's context so it writes more idiomatic code from the start. Skipped for greenfield projects. Cost appears as its own line in `.adhd/usage.json`.
- **`--review` — code-craft reviewer** — A read-only agent that runs after each passing sprint and reports on naming, duplication, maintainability, and architectural fit. Advisory only — it never affects pass/fail. Reports are saved per sprint to `.adhd/reviews/sprint-{n}.json`. Configurable model via `--model-reviewer`.
- **`adhd compare` — run-to-run comparison** — Each run's cost and progress are now preserved under `.adhd/runs/<timestamp>/`. `adhd compare <run-a> <run-b>` prints a structured diff of sprint pass/fail, cost (per-stage and per-model), and criteria score trends. Running `adhd compare` with no arguments lists available runs newest first.
- **Per-session log folders** — Each run's conversation logs are now grouped under `.adhd/logs/<timestamp>/` instead of landing flat in `.adhd/logs/`. When a contract parse fails, the diagnostic file lands in the same folder. Resume writes into a new sibling folder.
- **Complete cost-ledger commits** — When `--commit-adhd` is enabled, the cost ledger (`.adhd/usage.json`) is now included in each per-sprint metadata commit. A final metadata commit is also written after documentation, capturing the completed checkpoint and full cost record. Both degrade to no-ops when nothing changed.
- **Contract parse failures are warnings, not errors** — When the harness falls back to a generic contract because the model returned invalid JSON, it now logs an amber warning instead of a red error. The test suite passes with zero red output on a green run.

### Changed

- **Default auto-branching (breaking)** — The harness now creates a dedicated topic branch (`adhd/<slug>-<timestamp>`) before the sprint loop in existing-project mode, so all commits land there instead of on your current branch. To run on the current branch as before, pass `--allow-main`. `--branch <name>` still works as an explicit name override. `--resume` switches back to the recorded branch automatically. `--greenfield` is unaffected.

## [v0.7.0] - 2026-06-06

Cutting the cost of a run. Most of what a run costs comes from re-reading the whole agent conversation on every turn, not from generating code. This release attacks that from many sides — the harness verifies once and shares the result, asks agents to read less and re-read nothing, limits how long each agent runs, hands agents a ready-made map of the project, refines the spec with patches instead of full rewrites, keeps the growing regression suite from bloating every review, controls which tools each agent can reach, and gives you both visibility and a ceiling on spend — all without weakening the build-versus-review quality gate.

### Added
- **Your tests run once per attempt, centrally** — the harness detects your project's test command, runs it a single time per attempt, and gives the result to both the generator (as a starting point) and the evaluator (as the authority), with both told not to run the suite again.
- **Already-failing tests are recognised** — the harness records which tests were red before an attempt began, so agents don't spend turns working out which failures they caused versus ones that were already broken.
- **An optional test gate** — `--test-gate` skips the paid review when an attempt introduces new test failures, saving that cost on a broken build.
- **Agents read less** — the generator and evaluator are now guided to search first and read only the slice of a file they need, never re-read a file already shown to them, run only the relevant tests, and finish with a brief summary instead of a long recap.
- **A turn limit for each agent** — `--planner-max-turns`, `--generator-max-turns`, `--evaluator-max-turns` and `--documenter-max-turns` cap how many turns each agent may take, replacing the single shared limit. Each defaults to 50.
- **A ready-made map of your project** — once per run the harness builds a compact map of the project's layout and key definitions and gives it to the generator and the planner.
- **Leaner spec refinement** — with `--refine-spec`, the planner now revises only the work still ahead instead of rewriting the entire spec each time.
- **Smaller scope-agreement steps** — when the harness and a reviewer settle the scope of a piece of work, the reviewer now returns only its verdict and a short note of any changes.
- **Retiring outdated expectations** — a behaviour you deliberately change or drop can be retired from the accumulated set of regression checks.
- **A regression suite that stays lean** — accumulated behavioural checks are split into always-run and as-needed, with the as-needed ones run only when they're relevant to the parts the current work touches.
- **Control over each agent's tools** — agents that don't write code no longer pick up unrelated external tools; `--disable-mcp` turns external tools off entirely, and `--mcp-servers` adds specific ones back.
- **A heads-up when an override costs more** — if a single `--model` choice puts every agent on a pricier model than the defaults, the harness tells you at startup.
- **A spending limit per piece of work** — `--sprint-token-budget` sets a token budget for each unit of work.

### Changed
- Test results are shown to the agents as a structured summary — pass/fail counts and the names of failing tests — instead of raw command output.
- Default models updated to the current versions. A run with no `--model` flag now uses a mix per agent (planner and evaluator on the strongest tier, generator on the middle tier, documenter on the lightest) instead of one model for everything.

## [v0.6.2] - 2026-06-05

### Added
- **A guard against running on your main branch** — the harness now refuses to start on `main` or `master` and asks you to switch to a topic branch first. Pass `--allow-main` to override.

### Fixed
- **The coverage check now counts a sprint's whole effort, not just its last attempt.**
- **A skipped evaluation no longer throws away the evaluator's last real feedback.**

## [v0.6.1] - 2026-06-05

### Fixed
- **The test suite passes in a single `bun test`** — running the plain `bun test` command now works (previously required two separate passes).

## [v0.6.0] - 2026-06-04

Contract precision and model governance.

### Added
- **Surface-aware sprints** — each sprint now declares which parts of the codebase it will touch (backend, frontend, database, tests, docs, config).
- **Coverage check before evaluation** — on a retry, if the work didn't touch a part the sprint promised, the attempt is failed straight away, before the paid evaluation runs.
- **Limits on sprint size** — `--max-features`, `--max-criteria` and `--max-surfaces` cap how large a single sprint can grow.
- **A model per agent** — choose the model for each agent with `--model-planner`, `--model-generator`, `--model-evaluator` and `--model-documenter`.
- **Mismatched-model warning** — if the evaluator is set to a weaker model than the generator, the harness warns you at startup.

### Changed
- Default models updated to the current versions.

## [v0.5.1] - 2026-05-30

No user-facing changes — internal code consolidation and test-suite stability only.

## [v0.5.0] - 2026-05-10

### Added
- **Cost broken down by model** — the end-of-run summary now shows tokens and dollar cost per model, with a per-model total.

### Fixed
- Very long evaluator responses no longer cause occasional run failures.
- Using `--dry-run` and then `--resume` no longer skips the sprints and jumps straight to documentation.

> First release under the current version scheme; the earlier `v0.01`–`v0.04` tags were renumbered to `v0.1.0`–`v0.4.0` on the same commits.

## [v0.4.0] - 2026-04-12

Reliability and day-to-day improvements.

### Added
- `--notify` — a desktop notification each time the harness pauses for you.
- `--commit-adhd` and `--commit-adhd-logs` — record the harness's own working files (contracts, feedback, progress) into git as it goes.
- A diagnostic file is now written when a sprint's contract can't be read.

### Changed
- Log files are timestamped, so resuming or retrying a run no longer overwrites earlier logs.
- Resuming a run reuses contracts already on disk and recovers more reliably.

### Fixed
- Ordinary text that merely mentions "Sprint N" no longer inflates the sprint count.

## [v0.3.0] - 2026-04-11

No user-facing changes — internal rework toward provider-independence.

## [v0.2.0] - 2026-04-10

Smarter sprints within the existing workflow.

### Added
- **Behaviour kept across sprints** — behavioural checks accumulate as the run proceeds (`--no-bdd` to turn this off).
- **Automatic lint/typecheck** — your project's own lint and typecheck commands run after each build and feed the evaluation.
- `--sprint N` — re-run a single sprint without redoing the ones before it.
- `--refine-spec` — let the planner adjust the remaining sprints after each one finishes.
- **Quality built into the contract** — every sprint must include code-quality checks.
- On a retry, the evaluator is shown what changed since the previous attempt.

## [v0.1.0] - 2026-04-09

Initial release — a four-agent harness (planner, generator, evaluator, documenter) that turns a short prompt into a spec, builds it sprint by sprint with a build-and-evaluate loop, agrees the scope of each sprint up front, checkpoints after each one so runs can resume, and pauses at approval gates you control.
