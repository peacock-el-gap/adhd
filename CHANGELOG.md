# Changelog

All notable changes to this project are documented here, from the point of view of someone using the harness. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
