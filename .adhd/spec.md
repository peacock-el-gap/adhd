# Per-Model Usage Tracking

## Product Overview

The ADHD harness is a multi-stage agent orchestration tool that drives a
Planner → Generator → Evaluator → Documenter pipeline against a
user-supplied repository, with cost and token usage already tracked per
stage in `.adhd/usage.json`. Today the tracker shows *what* each stage
cost, but not *which model* produced that cost — a real gap now that
each agent role can be pinned to a different model via
`--model-planner`, `--model-generator`, `--model-evaluator`, and
`--model-documenter`.

This spec adds **per-model attribution** to the existing usage tracking
subsystem. Every recorded `StageUsage` carries the resolved model name
that was actually used; the terminal session summary gains a per-stage
model column and a new per-model rollup view; and the persisted
`.adhd/usage.json` records the model alongside tokens and cost.

**Who it's for:** ADHD harness operators who run mixed-model sprints
and need accurate cost attribution per provider/model — for example,
to reason about whether a cheaper Sonnet planner combined with an
Opus evaluator is actually cost-effective relative to single-model
runs.

**Core value proposition:** Turn the cost summary from "what stages
cost" into "what stages cost, on which model, and how each model
contributed to the total" — without breaking compatibility with
existing usage logs and without coupling `shared/` to any LLM SDK.

## Tech Stack

The existing harness stack is preserved; this work is purely additive:

- **Runtime:** Bun
- **Language:** TypeScript (strict)
- **Lint/format:** Biome
- **Testing:** Bun's built-in test runner
- **Tracing (out of scope):** Langfuse/OTEL via `shared/tracing.ts`
- **Persistence:** Plain JSON file at `.adhd/usage.json`
- **No new runtime dependencies** are introduced.

Source layout (matches existing project conventions):

- `shared/` — SDK-independent domain types, pure logic, orchestration
- `harness-claude/` — Claude Agent SDK specific wrappers (call sites)
- `tests/` — unit and integration tests
- `docs/` — internal documentation, roadmap

The SDK-independence rule from `CLAUDE.md` continues to hold:
**`shared/` must have zero LLM-SDK imports.**

## Design Language

This is a CLI feature with no GUI, so the "design language" is the
*shape and rhythm of terminal output and persisted JSON*. The goals
mirror the rest of the harness: dense but legible, monospaced-grid
friendly, and parseable.

### Terminal Aesthetic

- **Tone:** professional engineer's console — terse, factual, no
  emoji noise unless the surrounding summary already uses them.
- **Alignment:** all numeric columns right-aligned; text columns
  left-aligned. The new `model` column is left-aligned text and
  visually grouped immediately after the stage name so a reader can
  scan "stage on model" together.
- **Width:** the per-stage summary already targets ~100 cols; the model
  column should not blow this out. Long model identifiers (e.g.
  `claude-opus-4-20250514`) are kept intact in the rollup but may be
  abbreviated to the last segment after the final `-` in the per-stage
  table if width is tight.
- **Section break:** the per-model rollup is separated from the
  per-stage breakdown by a single blank line and a section header
  consistent with the existing summary's typographic style (same rule
  characters, same casing).
- **Sort order:** per-stage rows preserve their existing chronological
  order; per-model rollup is sorted by **total USD descending** so the
  expensive model is always at the top.

### JSON Aesthetic

- Stable key order within each stage entry: `stage`, `model`,
  `inputTokens`, `outputTokens`, `cacheReadTokens`, `costUsd`,
  `durationMs`. (Order is documentation; readers should not depend on
  it, but writers produce it consistently for diff-friendliness.)
- Unknown/legacy entries serialize the literal string `"unknown"` for
  the `model` field on rewrite — never `null`, never omitted.

### Component Style

- Two pure helpers (one for the per-stage table, one for the per-model
  rollup) that return `string[]` of formatted lines. The print routine
  joins them. This keeps formatting testable without log capture.
- A pure aggregator that takes `StageUsage[]` and returns a sorted
  `ModelRollupRow[]` — also testable in isolation.

## Feature List

### Feature 1 — `model` field on `StageUsage`

**User story:** As a harness operator, I want every recorded stage's
usage entry to carry the model that produced it, so I can later
attribute cost per model.

**Description:** Extend `StageUsage` in `shared/types.ts` with a
required `model: string` field. The `UsageTracker.recordStage` API
gains a required `model` parameter on its public interface. The
abstract interface in `shared/` propagates the change so all harnesses
must comply.

**Sprint:** Sprint 1

**Acceptance scenarios:**

- **Given** a fresh session, **when** any stage records usage with a
  model name, **then** the resulting `StageUsage` entry has that
  exact string in its `model` field.
- **Given** the abstract `UsageTracker` interface, **when** a
  TypeScript build runs, **then** every existing call site is required
  to pass a `model` argument (no defaulted optional).
- **Given** the SDK-independence rule, **when** `shared/` is searched
  for LLM-SDK imports, **then** no new imports were introduced by this
  feature.

### Feature 2 — Wire resolved model from every Claude call site

**User story:** As an operator running mixed-model sprints, I want
each agent role's recorded model to match what was actually used for
that SDK call, so the rollup is accurate.

**Description:** At every Claude harness call site that ends in a
`recordStage` invocation (planner, planner-revision, generator,
evaluator, documenter, contract proposal, contract review), pass the
correct `config.resolvedModel*` value:

- Planner and planner-revision → `resolvedModelPlanner`
- Generator → `resolvedModelGenerator`
- Evaluator → `resolvedModelEvaluator`
- Documenter → `resolvedModelDocumenter`
- Contract proposal → generator's model (matches existing wiring)
- Contract review → evaluator's model (matches existing wiring)

**Sprint:** Sprint 1

**Acceptance scenarios:**

- **Given** a run with `--model-planner=A --model-generator=B
  --model-evaluator=C --model-documenter=D`, **when** the run
  completes, **then** every persisted stage entry carries the model
  matching its agent role per the mapping above.
- **Given** a run with no per-agent overrides, **when** the run
  completes, **then** every stage entry carries the default resolved
  model and the per-model rollup contains exactly one row.
- **Given** the contract negotiation phase, **when** proposal and
  review stages are recorded, **then** the proposal stage's model
  equals `resolvedModelGenerator` and the review stage's model equals
  `resolvedModelEvaluator`.

### Feature 3 — Per-stage model column in terminal summary

**User story:** As an operator scanning the post-run summary, I want
to see *on which model* each stage ran without cross-referencing
flags, so I can debug surprising costs at a glance.

**Description:** Extend `UsageTracker.printSummary` to render the
per-stage breakdown with a model column placed immediately after the
stage name. Numeric columns remain right-aligned; the model column is
left-aligned text. Existing tokens and cost columns retain their
formatting and remain readable at the harness's customary terminal
width.

**Sprint:** Sprint 1

**Acceptance scenarios:**

- **Given** a multi-stage session, **when** the summary prints,
  **then** every row shows the stage's model alongside the existing
  tokens/cost/duration columns.
- **Given** the formatting helper, **when** it is invoked with a
  realistic sample, **then** the returned strings can be asserted on
  directly in a unit test (no log-capture indirection required).
- **Given** an unusually long model identifier, **when** the row is
  rendered, **then** the total line width remains within the
  established budget without truncating numeric columns.

### Feature 4 — Per-model rollup section in terminal summary

**User story:** As an operator, I want a one-glance "what did each
model cost me this run" view, sorted by spend, so I can decide
whether to keep using the more expensive model.

**Description:** After the per-stage breakdown, print a clearly
labelled rollup section: one row per distinct model used in the
session, with that model's total input tokens, total output tokens,
and total USD across all stages that used it. Rows are sorted by
total USD descending. The section is always printed — even when only
one model was used — so the output shape is predictable.

**Sprint:** Sprint 1

**Acceptance scenarios:**

- **Given** a run that used three different models, **when** the
  summary prints, **then** the rollup contains three rows sorted by
  total USD descending.
- **Given** a run that used one model only, **when** the summary
  prints, **then** the rollup is still present and contains exactly
  one row.
- **Given** the rollup aggregator, **when** invoked with a list of
  `StageUsage` containing the same model across multiple stages,
  **then** the model's row sums input tokens, output tokens, and USD
  correctly across all those stages.

### Feature 5 — Persist `model` in `.adhd/usage.json` with backward compatibility

**User story:** As an operator with historical usage data, I want my
older `.adhd/usage.json` files to keep loading after I update the
harness, so I don't lose history or break tooling.

**Description:** Persist the `model` field on every stage entry in
`.adhd/usage.json`. On load, an entry without a `model` field is
materialised in memory as `model: "unknown"`. The next `save()` call
rewrites the file in the new shape — no separate migration step.
`runTotalCostUsd` and `totalCostUsd` aggregates retain their
existing meaning.

**Sprint:** Sprint 1

**Acceptance scenarios:**

- **Given** a `.adhd/usage.json` whose stages omit `model`, **when**
  the tracker loads it, **then** loading succeeds and every loaded
  stage exposes `model === "unknown"`.
- **Given** a freshly-written `.adhd/usage.json` from this version,
  **when** the tracker loads it, **then** every stage's `model` is
  exactly the string that was recorded — round-trip preserves the
  field byte-for-byte.
- **Given** a legacy file is loaded and then a new stage is recorded,
  **when** `save()` is called, **then** the rewritten file contains
  `model` on **every** stage (legacy entries serialize as
  `"unknown"`).

### Feature 6 — Documentation refresh (Generator-owned, no Documenter)

**User story:** As a future contributor reading the docs, I want
README, INTERNALS, ROADMAP, and CHANGELOG to reflect per-model
tracking accurately, so I can understand and trust the cost data.

**Description:** Because this run uses `--no-docs`, the Generator
owns updates to four files in the same sprint as the implementation:

- **`README.md`** — *What to Expect → Cost tracking* paragraph
  extended; *Features → Observability* bullet extended to mention
  per-model attribution.
- **`docs/INTERNALS.md`** — *Cost Tracking* section rewritten to
  describe the two summary views and the new persisted `model` field.
- **`docs/ROADMAP.md`** — *Part 1 §1.11 Observability Stack* bullet 3
  extended; **no** additions to Part 2 or Part 3 (the roadmap is
  forward-looking only, per `CLAUDE.md`).
- **`CHANGELOG.md`** — new top-level section
  `## Phase 1.6: Observability Sharpening` appended *after* the
  Phase 1.5 block, with a single sprint entry titled
  `### Sprint 1 -- Per-Model Usage Tracking` formatted exactly like
  prior sprint entries (Features line, bullets, Verified line).

**Sprint:** Sprint 1

**Acceptance scenarios:**

- **Given** the spec is implemented, **when** the four documentation
  files are read, **then** each contains the changes described above
  in the locations described above.
- **Given** `docs/ROADMAP.md`, **when** Parts 2 and 3 are inspected,
  **then** they contain no entry for "per-model usage tracking" (it
  belongs only to Part 1's inventory).
- **Given** `CHANGELOG.md`, **when** the new Phase 1.6 block is
  compared structurally to the existing Phase 1.5 block, **then** it
  uses the same heading levels, the same line ordering (Features →
  bullets → Verified), and is positioned immediately after Phase 1.5.

### Feature 7 — Quality gates and tests

**User story:** As a maintainer, I want this change to ship with the
same quality bar as the rest of `shared/` — no `any` casts, clean
biome/typecheck, and meaningful unit tests on the pure helpers.

**Description:** Add unit tests in `tests/` (alongside existing usage
tests) covering the four behavioural pillars below; ensure
`bun run typecheck` and `bun run lint` continue to pass; introduce no
LLM-SDK imports into `shared/`.

**Sprint:** Sprint 1

**Acceptance scenarios:**

- **Given** `recordStage` is called with a model string, **when** the
  resulting tracker state is read, **then** the stored `StageUsage`
  has that exact `model`.
- **Given** the per-stage formatting helper and the rollup
  aggregator, **when** unit tests assert their string/structured
  outputs, **then** assertions are direct (the preferred approach is
  to extract pure helpers; log-capture is acceptable as a fallback).
- **Given** an older `usage.json` file lacking `model` fields,
  **when** the tracker loads it, **then** loading does not throw and
  all entries report `model: "unknown"`.
- **Given** a save/load round-trip on a tracker that recorded
  multiple models, **when** the loaded state is compared to the
  saved state, **then** every stage's `model` is preserved exactly.
- **Given** the project's lint and typecheck commands, **when** they
  run after this change, **then** both exit zero with no `any` casts
  introduced.

## Out of Scope

These constraints are part of the spec because they bound the work:

- **No new CLI flag.** Per-model tracking is on by default.
- **No change to single-model run behaviour** beyond the addition of
  the rollup row (which still prints, with one row).
- **No Langfuse trace shape changes.** If model already flows into
  trace metadata, leave it alone.
- **No CHANGELOG restructuring.** Existing phases remain as they are;
  Phase 1.6 is appended.
- **No defaulted/optional `model` parameter** in production
  `recordStage` call paths — the abstract interface requires it.
  ("Unknown" exists only for legacy-file load.)

## Sprint Plan

This work is delivered as a single sprint, in line with the
single-sprint scope described in the brief. The sprint is
self-contained, independently testable, and includes its own
documentation.

## Sprint 1 — Per-Model Usage Tracking

**Theme:** Add per-model attribution to the existing usage tracker
end-to-end (type → call sites → terminal summary → persisted JSON →
docs).

**Scope (all features above):**

1. Add required `model` field to `StageUsage` and propagate the
   parameter through the abstract `UsageTracker` interface.
2. Wire `config.resolvedModel*` from every Claude call site
   (planner, planner-revision, generator, evaluator, documenter,
   contract proposal, contract review).
3. Add the per-stage model column to the terminal session summary.
4. Add the per-model rollup section after the per-stage breakdown,
   sorted by total USD descending; always printed.
5. Persist `model` on every stage in `.adhd/usage.json`; load
   legacy files as `"unknown"`; rewrite in new shape on next save;
   verify save/load round-trip.
6. Update `README.md`, `docs/INTERNALS.md`, `docs/ROADMAP.md`, and
   `CHANGELOG.md` per the rules in Feature 6 (Generator-owned, since
   `--no-docs` is in effect for this run).
7. Cover the behavioural pillars with unit tests in `tests/`; keep
   `bun run typecheck` and `bun run lint` green; introduce no
   `any` casts and no LLM-SDK imports into `shared/`.

**Independently testable:** the sprint can be exercised by running
the harness with mixed `--model-*` flags and inspecting both the
terminal summary and `.adhd/usage.json`, plus the unit tests on the
pure helpers and the legacy-load path.

**Definition of done:** all acceptance scenarios in Features 1–7
hold; the four documentation files reflect the new capability; lint
and typecheck pass; no SDK leakage into `shared/`.
