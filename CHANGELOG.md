# Changelog

All notable changes to this project are documented here, from the point of view of someone using the harness. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [v0.7.0] - 2026-06-06

Cutting the cost of a run. Most of what a run costs comes from re-reading the whole agent conversation on every turn, not from generating code. This release attacks that from many sides — the harness verifies once and shares the result, asks agents to read less and re-read nothing, limits how long each agent runs, hands agents a ready-made map of the project, refines the spec with patches instead of full rewrites, keeps the growing regression suite from bloating every review, controls which tools each agent can reach, and gives you both visibility and a ceiling on spend — all without weakening the build-versus-review quality gate.

### Added
- **Your tests run once per attempt, centrally** — the harness detects your project's test command, runs it a single time per attempt, and gives the result to both the generator (as a starting point) and the evaluator (as the authority), with both told not to run the suite again. Before, each agent ran the full suite repeatedly and paid to re-read that output on every later turn.
- **Already-failing tests are recognised** — the harness records which tests were red before an attempt began, so agents don't spend turns working out which failures they caused versus ones that were already broken.
- **An optional test gate** — `--test-gate` skips the paid review when an attempt introduces new test failures, saving that cost on a broken build (a counterpart to the existing `--lint-gate`).
- **Agents read less** — the generator and evaluator are now guided to search first and read only the slice of a file they need, never re-read a file already shown to them, run only the relevant tests, and finish with a brief summary instead of a long recap.
- **A turn limit for each agent** — `--planner-max-turns`, `--generator-max-turns`, `--evaluator-max-turns` and `--documenter-max-turns` (and the matching settings) cap how many turns each agent may take, replacing the single shared limit. Each defaults to 50, so nothing changes unless you set them.
- **A ready-made map of your project** — once per run the harness builds a compact map of the project's layout and key definitions and gives it to the generator and the planner, so they don't spend turns rediscovering the codebase.
- **Leaner spec refinement** — with `--refine-spec`, the planner now revises only the work still ahead instead of rewriting the entire spec each time; the parts already done are left as they are.
- **Smaller scope-agreement steps** — when the harness and a reviewer settle the scope of a piece of work, the reviewer now returns only its verdict and a short note of any changes, rather than restating the whole agreement.
- **Retiring outdated expectations** — a behaviour you deliberately change or drop can be retired from the accumulated set of regression checks, so an old expectation stops failing correct new work and won't quietly creep back later.
- **A regression suite that stays lean** — accumulated behavioural checks are split into always-run and as-needed, with the as-needed ones run only when they're relevant to the parts the current work touches, so a large suite no longer slows and inflates every review.
- **Control over each agent's tools** — agents that don't write code no longer pick up unrelated external tools (MCP servers) from your environment; `--disable-mcp` turns external tools off entirely, and `--mcp-servers` adds specific ones back.
- **A heads-up when an override costs more** — if a single `--model` choice puts every agent on a pricier model than the cost-optimised per-agent defaults, the harness tells you at startup (and still runs).
- **A spending limit per piece of work** — `--sprint-token-budget` sets a token budget for each unit of work: you're warned at 80%, and at 100% the harness pauses to ask whether to continue or stop (when running unattended it notes the overage and carries on). It does nothing unless you set it.

### Changed
- Test results are shown to the agents as a structured summary — pass/fail counts and the names of failing tests — instead of raw command output.

## [v0.6.2] - 2026-06-05

### Added
- **A guard against running on your main branch** — the harness commits to whatever branch is checked out, so it now refuses to start on `main` or `master` and asks you to switch to a topic branch first. Pass `--allow-main` to override when you really mean to. Projects created with `--greenfield` are unaffected, since they use their own folder.

### Fixed
- **The coverage check now counts a sprint's whole effort, not just its last attempt.** The check that confirms a sprint touched every part it promised used to look only at the most recent attempt. A sprint that built one part on its first attempt and then fixed an unrelated part on the next could be failed for "not touching" the first part — and could get stuck repeating that forever. Coverage is now measured across all of a sprint's attempts together, so a sprint that legitimately works on different parts across attempts converges instead of stalling.
- **A skipped evaluation no longer throws away the evaluator's last real feedback.** When a cheap pre-check (the coverage check or `--lint-gate`) skips the paid evaluation, the next attempt now still receives the evaluator's most recent real findings alongside the note about what the pre-check caught — so it keeps working on the actual problem instead of only "you missed part X."

## [v0.6.1] - 2026-06-05

### Fixed
- **The test suite passes in a single `bun test`** — running the plain `bun test` command used to report two dozen false failures, so the suite had to be run in two separate passes to stay green. A few tests replaced their dependencies in a way that leaked into unrelated tests sharing the same process; those tests now receive their stand-ins directly instead. Contributors (and the harness's own agents while it improves itself) can trust the obvious command again. No change to how the harness runs.

## [v0.6.0] - 2026-06-04

Contract precision and model governance.

### Added
- **Surface-aware sprints** — each sprint now declares which parts of the codebase it will touch (backend, frontend, database, tests, docs, config).
- **Coverage check before evaluation** — on a retry, if the work didn't touch a part the sprint promised, the attempt is failed straight away, before the paid evaluation runs.
- **Limits on sprint size** — `--max-features`, `--max-criteria` and `--max-surfaces` (and the matching `MAX_FEATURES` / `MAX_CRITERIA` / `MAX_SURFACES` settings) cap how large a single sprint can grow; an oversized sprint is trimmed automatically instead of being accepted.
- **A model per agent** — choose the model for each agent with `--model-planner`, `--model-generator`, `--model-evaluator` and `--model-documenter`, or set the model used while agreeing a sprint's scope with `--model-contract`. With no model flags, each agent uses a sensible default.
- **Mismatched-model warning** — if the evaluator is set to a weaker model than the generator, the harness warns you at startup and continues (the reviewer should never be weaker than the builder).

### Changed
- Default models updated to the current versions. A run with no `--model` flag now uses a mix per agent (planner and evaluator on the strongest tier, generator on the middle tier, documenter on the lightest) instead of one model for everything — lower cost with no loss of review quality.

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
- `--notify` — a desktop notification each time the harness pauses for you (a terminal bell sounds by default).
- `--commit-adhd` and `--commit-adhd-logs` — record the harness's own working files (contracts, feedback, progress) into git as it goes, for an audit trail.
- A diagnostic file is now written when a sprint's contract can't be read, instead of the problem passing silently.

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
- **Behaviour kept across sprints** — behavioural checks accumulate as the run proceeds, so a later sprint can't silently break something an earlier sprint established (`--no-bdd` to turn this off).
- **Automatic lint/typecheck** — your project's own lint and typecheck commands run after each build and feed the evaluation; `--lint-gate` makes a failure fail the attempt.
- `--sprint N` — re-run a single sprint without redoing the ones before it.
- `--refine-spec` — let the planner adjust the remaining sprints after each one finishes, for your approval.
- **Quality built into the contract** — every sprint must include code-quality checks (naming, duplication, error handling), scored as strictly as the functional ones.
- On a retry, the evaluator is shown what changed since the previous attempt.

## [v0.1.0] - 2026-04-09

Initial release — a four-agent harness (planner, generator, evaluator, documenter) that turns a short prompt into a spec, builds it sprint by sprint with a build-and-evaluate loop, agrees the scope of each sprint up front, checkpoints after each one so runs can resume, and pauses at approval gates you control.
