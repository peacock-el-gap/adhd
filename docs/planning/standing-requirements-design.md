# Standing (Cross-Cutting) Requirements — Design & Implementation Reference

**Status:** design accepted 2026-06-07 (Peg + Claude); **refined 2026-06-07** after the
OPP-57 attempt — see **§14**.
**Companion to:** `docs/ROADMAP.md` → OPP-55.
**Relates to:** the *roadmap-upkeep* rule is this engine's **flagship first slice**. A cheap
deterministic text-check for it (formerly OPP-57) was built, reviewed, and **abandoned as
unworkable** on 2026-06-07; that attempt produced the refinement in §14 (owner + trigger,
documenter-executed completion reconciliation, delivery guarantee). Read §14 alongside §2/§6 —
where they differ for the roadmap-upkeep case, §14 governs.
**Audience:** an ADHD harness run (or a developer) implementing OPP-55. When you run the
harness on this feature, point it at OPP-55 in the roadmap and, optionally, at this file
as reference context (`--context docs/planning/standing-requirements-design.md`).

This document is self-contained. It records *what* a standing requirement is, *why* the
naïve approaches fail (with verified evidence), the *decisions* taken, and a concrete
*design* and *sprint plan* to implement them.

---

## 1. The problem, verified

A **standing requirement** is a cross-cutting rule that must hold on *every* sprint,
independent of that sprint's features — e.g. *"after completing a roadmap item, remove it
from `docs/ROADMAP.md` Part 1 and Part 2."* The harness currently has no reliable way to
apply one.

The triggering incident: a self-development run (Phase-1 hardening, Sprints 1–6)
implemented nine roadmap items and was explicitly told to keep `docs/ROADMAP.md` in sync.
It did not. Verified at commit `7794fee`:

- `docs/ROADMAP.md` was touched by exactly **one** branch commit (`d597b66`); Sprints 1–5
  never touched it. All nine in-scope OPPs remain in **both** Part 2 and Part 3.
- That one commit **overclaimed**: its message says it removed OPP-44 and OPP-46 from
  Part 2; its diff removes neither (it only *added* Part 1 entries §1.39/§1.40). The
  strings "OPP-44"/"OPP-46" appear only in the commit *message*, never in a diff hunk.

**Why it happened (root cause, refined from the original diagnosis):** the rule was not
"absent" or "distilled out." It was **present-but-never-made-operative**, through every
channel at once:

| Channel | Did the rule reach it? | Why it still failed |
|---|---|---|
| Project CLAUDE.md (lines 68–75) | **Yes** — loaded via `settingSources:["project"]` for all roles (`shared/tool-policy.ts:129`) | Ambient context; nothing converts it to action |
| Product spec (`.adhd/spec.md:463-470`, "Documentation Maintenance Note") | **Yes** — full spec injected into the Generator every attempt (`harness-claude/generator.ts:39`) | Visible-but-non-operative |
| Sprint contract | **No** | Negotiation only encodes features + testable criteria; "roadmap" appears **0 times** in `shared/`/`harness-claude/` source or prompts. Not "distilled out" — never *included* |
| Generator directive | **No** | First-attempt directive is *"Implement the features listed in this sprint contract"* (`generator.ts:45`); the instruction to satisfy *criteria* is gated behind the feedback header — **dormant until a retry** (`shared/prompts.ts:197-204`) |
| Evaluator | **No** | Evaluator is handed the contract + threshold + supplementary context, **not the spec** (`harness-claude/evaluator.ts:26-39`). With no roadmap criterion, it has nothing to score |
| Any gate | **No** | Lint/test/surface gates + the Opus Evaluator judge contract criteria only; `shared/doc-validation.ts` is advisory and checks README/CHANGELOG length only |

Net: the rule existed only as **passive context**, never as an **operative, owned,
enforced** per-sprint obligation. This is the same "invisible to the green gate" failure
family the roadmap already attributes to OPP-41.

---

## 2. Decisions taken (this discussion)

- **D1 — Operative + enforced, not passive.** The fix must make the requirement
  something the harness *does* (a directive) and *checks* (a gate/criterion), not merely
  something present in context.

- **D2 — Two faces: instruction + check.** Each standing requirement is injected into the
  **Generator as an up-front directive** *and* used by the **Evaluator as a check**.
  Rationale: the Generator is feature-directed on attempt 0; a check-only rule would pass
  attempt 0 (work undone) → Evaluator fails → retry → Generator finally sees it via
  feedback. That is a built-in **extra Opus-evaluation round per sprint per rule**, and is
  reactive/fragile (worse for a *removal* obligation). Driving the Generator up front
  avoids it.

- **D3 — A dedicated resolved set, not `contract.criteria`.** Standing requirements live
  in their own normalised set, injected at sprint time — **never merged into the persisted
  contract object.** Reasons: (a) `contract.criteria` is subject to the size-ceiling trim,
  which keeps the first *N* and drops the tail with **no priority logic**
  (`shared/contract-limits.ts:113-139`) — appended standing rules would be first to be
  dropped; (b) a `type:"standing"` discriminator on a criterion would *not* reach the
  Generator anyway (the `type` field only gates regression accumulation); (c) it sidesteps
  the 1.0 on-disk **contract** format freeze entirely.

- **D4 — Reuse the regression *patterns*, not its *type/plumbing*.** Borrow the durable
  `.adhd/*.json` store and the "build a markdown section → inject into the prompt" step.
  Do **not** reuse `RegressionCriterion` or the accumulation path, because a standing
  requirement diverges on every axis:
  - *Origin:* user-authored up front vs auto-harvested from passed sprints
    (`shared/regression.ts:113-114`).
  - *Injection target:* must reach the **Generator and** Evaluator; regression is
    **Evaluator-only** (`sprint-attempts.ts:308-314,399-404`).
  - *Applicability:* needs a real guard (`fileExists`); regression's only mechanism is
    tier + surface intersection — and that path is **dead in production** (accumulation
    hardcodes `tier:"core"`, `regression.ts:152`; the surface filter is exercised only by
    tests). Surfaces are a coarse 6-token "which code slice did this sprint touch"
    classifier — semantically wrong for "does this policy apply to this project."
  - *Check:* needs an optional command; neither `RegressionCriterion` nor
    `SprintCriterion` has any command field.
  - *Lifecycle:* always-on; regression carries retire/dedupe/`sprintNumber` machinery
    (and `contract.retire` is itself wired-but-inert — no prompt populates it).

- **D5 — Precedence: "no silent override."** A committed/shared rule is a floor. A
  personal/git-ignored layer may **add** rules but cannot **silently cancel** a committed
  one; cancelling requires an **explicit, visible waiver** (e.g. `--no-policy <name>`). A
  rule may optionally declare itself *overridable* (a soft default that yields to a more
  local instruction). This mirrors how an agent resolves contradictory orders: the most
  authoritative source wins; explicit/visible overrides are fine; hidden ones never win.
  It deliberately departs from Claude Code's local-wins settings precedence **only** for
  the one act of cancelling a committed requirement — precisely the silent-suppression
  failure mode that started this investigation.

- **D6 — Verification: AI judgement by default + optional per-rule check.** Each rule's
  check is configurable: a natural-language judgement the Evaluator applies, **or** an
  exact command, **or** both. **When a command is present, its exit status is the
  authoritative verdict** — the agent does not reinterpret the command's output (that is
  what makes it un-foolable; the d597b66 overclaim would have been caught by a grep). The
  command output is surfaced as evidence only.

- **D7 — Deliverable.** A new planned-work entry in `docs/ROADMAP.md` (OPP-55) plus this
  design doc. Implementation will be driven later by the harness itself, pointed at the
  roadmap item (+ this doc as reference).

---

## 3. Normalised data model

Every source compiles to one `StandingRequirement` shape (illustrative — settle exact
field names during implementation):

```jsonc
{
  "name": "roadmap-upkeep",              // stable id; used by waivers and audit
  "instruction": "After completing a roadmap item, remove it from docs/ROADMAP.md Part 1 and Part 2; describe any new capability in docs/CAPABILITIES.md; do not mark items done or add implementation detail.",
  "when": {                              // applicability guard; omitted = always applies
    "fileExists": ["docs/ROADMAP.md"],  // primary: portability across projects
    "surfaces": ["docs"]                 // optional: per-sprint scoping (see §6)
  },
  "check": {                            // how we verify; see D6
    "judgement": "Each roadmap item completed this sprint no longer appears in Part 1 or Part 2 of docs/ROADMAP.md.",
    "command": "scripts/check-roadmap-upkeep.sh",   // optional; exit 0 = pass
    "threshold": 7                       // for the judgement path only (1–10, matches contract criteria)
  },
  "enforcement": "hard",               // "hard" (floor) | "default" (overridable); see D5
  "source": "project:.adhd/policy.json" // provenance; written into the per-run audit
}
```

- `instruction` is mandatory (it is the Generator directive *and* the default judgement
  text if `check.judgement` is omitted).
- `check` is optional; with neither `command` nor `judgement`, the Evaluator judges
  against `instruction`.
- `command` exit status is authoritative; `judgement` uses the existing 1–10 score vs
  `threshold` convention.

---

## 4. Where it lives (SDK-independence)

| Layer | Responsibility |
|---|---|
| `shared/` (pure, no SDK) | `StandingRequirement` types; parse/validate `.adhd/policy.json`; resolve sources + precedence + waivers; evaluate the `when` guard; build the Generator directive section and the Evaluator check section; run the optional `command` check **via the existing `CommandExecutor` seam** (extend it to the policy gate — relates to OPP-47). Writing the per-run resolved/effective set for audit. |
| `harness-claude/` (SDK-specific) | The natural-language **extraction adapter**: read CLAUDE.md / `.claude` layers (and the run prompt) and emit *candidate* `StandingRequirement`s. Behind a small interface so a future `harness-{provider}` can supply its own. |

A future `harness-gemini` inherits the entire deterministic core unchanged; only the NL
extraction adapter is provider-specific.

---

## 5. Resolution & precedence

1. Gather sources, most-authoritative last:
   per-run prompt/flags → `.adhd/policy.local.json` (personal, git-ignored) →
   `.adhd/policy.json` (committed) → local CLAUDE.md → project CLAUDE.md → user CLAUDE.md.
2. Compile each to candidate `StandingRequirement`s (structured = authoritative;
   NL-extracted = candidates with `source` provenance).
3. Merge by `name`. **No silent downgrade (D5):** a lower/softer layer may *add* a rule or
   *tighten* one, but may not weaken/cancel a `hard` committed rule. A cancellation is
   honoured only from an explicit waiver (`--no-policy <name>`), which is logged.
4. Drop rules whose `when` guard is false for this project (e.g. no `docs/ROADMAP.md`).
5. Write the **resolved effective set** to the per-run audit (e.g.
   `.adhd/runs/<stamp>/effective-policy.json`) — every enforced rule, its source, and any
   applied waiver. This is the "nothing is enforced invisibly" guarantee.

NL extraction **only populates candidates**; it never decides per-sprint applicability —
so model drift can't silently change what is enforced (treatment rule from the brief,
preserved).

---

## 6. Injection points (the seams)

- **Generator directive** — add a "Standing Requirements (apply every sprint)" section to
  `generatorSupplementaryContext` (`shared/orchestration/sprint-attempts.ts:144-167`).
  This is **net-new plumbing** (regression criteria are *not* on the Generator path
  today). The Generator must be told to *do* these, alongside the features.
- **Evaluator check** — add a "Standing Requirements" section to the Evaluator's
  `supplementaryContext`, mirroring `buildRegressionSection`
  (`shared/regression.ts:237-265`). Each rule becomes a scored line keyed by `name`; the
  feedback-row mapping is keyed by name already, so no new eval wiring is needed for the
  judgement path.
- **Deterministic command gate** — for rules with a `command`, run it through the
  `CommandExecutor` seam and treat exit status as the verdict. Decide ordering relative to
  the existing pre-Evaluator gates (surface → lint → test); a failed standing-command gate
  should fail the attempt with feedback naming the rule, *carrying real findings forward*
  (don't repeat the test-gate carry-forward mistake — the shipped F3 fix).

---

## 7. Applicability guard

- **`fileExists` is the primary, portability mechanism.** A roadmap rule placed in *user*
  CLAUDE.md travels everywhere but is inert in a repo with no `docs/ROADMAP.md`. With
  Claude Code's own layering, cross-project *scoping* mostly dissolves (a project-level
  rule affects only that repo); the guard's remaining job is portability + per-sprint
  scoping.
- **`surfaces` is optional per-sprint scoping.** Implement a **fresh** guard — do not lean
  on regression's surface filter, which is dead in production and coarse.

---

## 8. On-disk format & the durable-asset question

- `.adhd/policy.json` is a new format → settle it **before** the 1.0 on-disk freeze
  (repo is 0.x; breaking changes allowed between minors).
- If `.adhd/policy.json` should persist on `main` for the harness's *own* development, it
  becomes a **third durable `.adhd` asset** alongside `usage.json`/`regression.json`. The
  squash-merge strip is **manual and unguarded** (no test/CI/hook). Promoting it requires
  editing **both** incantation copies (`docs/RELEASING.md:64-66` and `CLAUDE.md:90`) plus
  the "two durable assets" prose in both files — and ideally adding a guard that asserts
  only the durable assets survive on `main`, since today a forgotten clause fails silently.
- For a **target** project, `.adhd/policy.json` is just a normal committed file in *their*
  repo; the durable-asset concern is specific to ADHD-developing-itself.
- **Coordinate with OPP-54 (`.adhd/` commit governance).** That work edits the *same*
  durable-asset incantation (`docs/RELEASING.md` / `CLAUDE.md`): it folds `regression.json`
  into the commit allow-list so the documented `{usage.json, regression.json}` pair is
  actually committed. If both land, the final durable-asset set should be
  `{usage.json, regression.json, policy.json}`, and the strip-guard proposed here (§11
  sprint 6) should cover all three. Sequence the two so neither overwrites the other's edit
  to that prose.

---

## 9. Security / trust boundary

- A `command` check runs in the **same unsandboxed context** as the target's lint/test
  scripts the harness already runs (`README.md` Security section / OPP-44). For your own
  repo this is a boundary you already accept. The only genuinely new surface is a committed
  `command` traveling into a **different/untrusted** repo — covered by the existing "only
  run the harness against repositories you trust" rule. Document this explicitly.
- Natural-language checks add **no** execution surface.

---

## 10. Smaller decisions (recommended defaults)

- **`.adhd/policy.local.json`** — yes, support it as the personal/local layer. It can add
  or (when a rule is `enforcement:"default"`) override, but never silently cancel a `hard`
  committed rule (D5).
- **Threshold semantics** — reuse the existing 1–10 score vs `threshold` for the
  NL-judgement path (consistency with contract criteria / regression). Command checks are
  binary (exit status).
- **NL-extraction confidence/verification** — extract → write the resolved effective set
  with provenance → surface it for confirmation (reuse the spec-gate pattern in
  interactive mode; auto-accept + audit in non-interactive). Never enforce an unsurfaced
  extracted rule.

---

## 11. Suggested sprint decomposition (for the harness)

Test-first where the sprint adds a correctness gate.

1. **Pure policy core (`shared/`)** — `StandingRequirement` types; parse/validate
   `.adhd/policy.json`; resolve sources + precedence + waivers; `when`-guard evaluation;
   per-run effective-set audit. Unit tests for precedence ("no silent override"), waivers,
   and guard filtering.
2. **Evaluator-side enforcement** — section builder + criterion-by-name feedback mapping
   for the judgement path. Tests: a sprint that leaves a completed item in Part 1/2 fails.
3. **Generator-side directive** — inject the "Standing Requirements" section into
   `generatorSupplementaryContext`. Tests: the directive is present on attempt 0.
4. **Optional deterministic command check** — run via the `CommandExecutor` seam; exit
   status authoritative; gate ordering + carry-forward; trust-boundary docs. Tests
   including the d597b66 case (claims removal, removed nothing → command fails).
5. **NL extraction adapter (`harness-claude/`)** — candidates from CLAUDE.md/`.claude` +
   prompt; provenance; effective-set surfacing/audit.
6. **`.adhd/policy.json` durable-asset wiring** — release-doc updates + a strip guard.

---

## 12. Acceptance — the dogfood test

Run the harness on its own repo with the roadmap-upkeep rule as a standing requirement:

- Every completed item this run **must** be removed from Part 1 + Part 2 and (if it adds a
  capability) described in `docs/CAPABILITIES.md` — with no "done"/strikethrough/impl-detail.
- A sprint that leaves a completed OPP in Part 1/2 **must FAIL**.
- The deterministic command **must reject** a commit that *claims* removal without doing it
  (the exact d597b66 failure).
- The rule **must be inert** in a target project that has no `docs/ROADMAP.md`.

---

## 13. Risks

- **Generator-directive is net-new plumbing** — there is no existing Generator-injection
  seam for regression-style criteria; budget for it.
- **NL-extraction drift** — keep extraction to *candidate population* only; never let it
  decide applicability.
- **Command trust** — same boundary as target scripts; document, don't expand silently.
- **Durable-asset strip is unguarded** — promoting `.adhd/policy.json` to `main` without a
  guard risks silent loss or leakage; add the guard.
- **Don't lean on regression's dead paths** — the optional-tier/surface filter and
  `contract.retire` are wired-but-inert; reuse patterns, not that machinery.

---

## 14. Refinement from the OPP-57 attempt (2026-06-07)

The cheap, near-term roadmap-tidy check (formerly its own roadmap item, OPP-57) was built
with the harness and reviewed. It **failed by design**, and the failure sharpened this
engine's design in three ways. This section governs the *roadmap-upkeep* case where it
differs from §2/§6.

### 14.1 What was tried, and why it failed (post-mortem, verified)

- **The attempt.** A deterministic check: flag any `OPP-NN` id appearing in **both** the
  CHANGELOG `[Unreleased]` section **and** `docs/ROADMAP.md`. Built via a 3-sprint harness
  run — all sprints passed on the first attempt, all gates green, 1522 tests passing, clean
  SDK boundary. The code itself was good.
- **The defect.** Adversarial multi-agent review, independently reproduced, proved the check
  **vacuous**: run on this very repo it reported *"No roadmap drift detected"* while OPP-57
  was shipped on the branch **and** still present in `docs/ROADMAP.md` — the exact drift it
  exists to catch.
- **Root cause (a convention conflict, not a bug).** The project's **user-facing-CHANGELOG
  rule** (`docs/RELEASING.md`: never put internal symbol/`OPP-NN` ids in the changelog)
  means the CHANGELOG **structurally never carries OPP ids** — verified zero across
  v0.6.0–v0.9.0 and the current file. So the left side of the intersection is *always
  empty*; the detector can essentially never fire. The OPP-57 premise (that `[Unreleased]`
  carries OPP ids) contradicted an established convention.
- **No durable signal exists for the cheap path.** There is **no machine-readable record of
  "this OPP shipped"** anywhere on `main`: `docs/CAPABILITIES.md` carries zero OPP ids,
  feature commit subjects are user-facing. OPP ids live durably only in the roadmap
  (planned) and planning docs. So no deterministic *text-match* can detect roadmap drift —
  the case **requires agent judgement**.
- **The deeper lesson.** This is the same "invisible to the green gate" family as §1: the
  green gate certified a tool that cannot guard the thing it names. Confirms D1 — passive
  correctness (it compiles, it's tested) is not the same as *operative* correctness (it
  detects the real condition).

### 14.2 The refined design for the roadmap-upkeep rule (Peg + Claude)

Roadmap-upkeep is **not** a per-sprint Generator directive (the §2/§6 default). It is an
**end-of-run, completion-triggered, Documenter-executed, Evaluator-judged** obligation. Four
roles, divided by stakes:

- **Generator — stays out of the roadmap.** It builds the feature; it does **not** edit
  `ROADMAP.md`/`CAPABILITIES.md`. Mid-run roadmap surgery is premature (an item often spans
  several sprints) and dilutes the generator's focus.
- **Evaluator — makes the authoritative completion judgement.** At **item** granularity: was
  the *roadmap item's intent* fully delivered — not merely "all sprints passed" (which would
  miss planner under-scoping)? It is handed the roadmap item's own text plus the accumulated
  record of what was built, and returns *fully done → move* / *partial → what remains* /
  *not done*. **Start binary** (fully done → move; otherwise leave untouched); defer the
  partial-rewrite case. This puts the riskiest decision (when to remove from the roadmap) on
  the strongest judge (Opus).
- **Harness — accumulates the evidence.** Across the run it collects a structured
  "what was built and verified" digest (same pattern as BDD-regression accumulation) and
  feeds it to the documenter at completion.
- **Documenter — executes the edit.** At end of run, with full-run context, it moves the
  completed item out of `ROADMAP.md` and into `CAPABILITIES.md`, keeping both consistent.
  This is mechanical (the *decision* was already made by the evaluator), so it can stay on
  the cheap tier.

**Verification of the documenter's edit** keeps a deterministic role — not for detecting
drift (that failed), but for **validating the edit is structurally sound**: did the
roadmap's item count drop by exactly what was moved, is the roadmap still well-formed across
its **three** locations (the `### OPP-NN` body, the priority-table row, the Summary View
entry)? Plus the release-time human/Claude review as backstop.

### 14.3 The general lesson for the engine — owner + trigger + delivery guarantee

The attempt generalises the normalised model (§3) in three ways:

1. **A rule declares an OWNER agent and a TRIGGER**, not only `instruction`+`check`. The §3
   default (Generator directive + Evaluator check, per sprint) stays the common case;
   roadmap-upkeep is the first rule that binds the **documenter** and fires **on run
   completion**. Add `owner: "generator"|"evaluator"|"documenter"` and
   `trigger: "per-sprint"|"on-completion"` to `StandingRequirement`.
2. **A delivery guarantee** answers the failure that started all of this — a rule written in
   the prompt/CLAUDE.md that is *silently dropped*. Two levels: **prove delivery**
   (a deterministic assertion that the rule text was actually injected into its owner
   agent's prompt, recorded in the per-run effective-policy audit, §5) **and prove action**
   (the judgement/command check). Delivery without action is the silent-ignore failure;
   action-check without delivery is the silent-drop failure — guard both.
3. **Don't over-inject.** Keep rules few, owned, and scoped (the §7 applicability guard), or
   they dilute back into the ambient-context noise this engine exists to escape.

### 14.4 Impact on the sprint plan (§11) and acceptance (§12)

- Re-express the roadmap-upkeep acceptance (§12) against the owner/trigger model: the
  **documenter** performs the move at completion; the **evaluator** judges item completion;
  a **structural check** validates the edit. (The "a sprint that leaves a completed OPP in
  the roadmap must FAIL" criterion still holds — it now fails at the end-of-run check rather
  than per-sprint.)
- **Nothing is carried forward from the abandoned OPP-57 build.** Its pure id/section
  string-extraction is not what this design needs; the code lives only in the local archive
  tag `archive/feat/opp-57-roadmap-drift-detector`, should it ever be wanted.
