# Phase 1 Follow-up — Execution Plan

**Status:** active execution plan, written to be picked up in a **fresh conversation**.
It is self-contained: it restates the state, the decisions, and the order of work, and
points to the detailed docs for specifics. **Archive this file once Phase 1 has shipped
and OPP-54–59 are resolved** (per the Planning → archives lifecycle).
**Date:** 2026-06-07.

> **Update 2026-06-07 (progress) — read this first.**
> - **S1** (roadmap → `CAPABILITIES.md` restructure) and **S2** (Phase 1 shipped as
>   **v0.9.0**) are **done and on `main`.** Ignore the "Start at S1 / where things stand"
>   framing below — it predates the release.
> - **S3 is resolved by abandonment.** OPP-57 (cheap roadmap drift-detector) was built with
>   the harness (3/3 sprints, all gates green) and reviewed — then found **unworkable**: the
>   user-facing CHANGELOG never carries `OPP-NN` ids by convention, so the detector's
>   intersection is always empty and it can never fire (full post-mortem +
>   refined design: `standing-requirements-design.md` **§14**). Its intent **folds into
>   OPP-55**. The OPP-57 roadmap entry is removed; a newly-found bug **OPP-60**
>   (`--project=` ignored by subcommands) was added. The abandoned build is preserved at the
>   local tag `archive/feat/opp-57-roadmap-drift-detector`.
> - **Remaining work:** **S4** (OPP-56 + OPP-58; OPP-59 dropped) · **S5** (OPP-54) · **S6**
>   (OPP-55 — now sharpened by §14) · plus the small **OPP-60** fix. Where the body below
>   says "build OPP-57," that step is superseded; the `adhd`-invocation guidance in §5/§6
>   still applies to S4/S5.

**Read these for the detail behind each step:**
- `docs/ROADMAP.md` — the live opportunity list (already contains OPP-54 and OPP-55).
- `docs/planning/phase1-hardening-followup.md` — the umbrella plan; **§4 is the detailed
  checklist** for the roadmap restructure and the source for OPP-56–59.
- `docs/planning/commit-governance.md` — full plan for OPP-54.
- `docs/planning/standing-requirements-design.md` — full design for OPP-55.
- `docs/RELEASING.md` — the release ritual (squash-merge, version, tag, archive).

---

## 0. Operating principle — Claude does the work

**No step in this plan requires human hands.** Every step is executed by Claude — either
the autonomous **`adhd` harness** (the point is to dogfood it) or **Claude Code
interactively** (direct edits in a conversation). A step is assigned to a human **only if it
is undoubtedly proven Claude cannot do it**, and nothing here meets that bar.

The human's role is limited to:
- **Decisions** (product/risk calls) — the relevant ones are already made (see §2).
- **Approving the irreversible publish** — pushing to `origin` and creating the GitHub
  release. Claude can and will run these commands; it just pauses for your "go" first
  (or you pre-authorize once and Claude runs releases unattended). This is a *decision*,
  not labour.

---

## 1. Where things stand (2026-06-07)

**Branches:**
- `main` (v0.8.0) — has the contributor script under `scripts/`. Does **not** yet have the
  Phase 1 hardening work.
- `dev/phase1-harness-hardening` — the Phase 1 hardening code (the 6-sprint self-dev run;
  tip `7794fee`). Not released.
- `dev/phase1-followup-consolidation` — **the intended Phase 1 release branch.** It is
  `dev/phase1-harness-hardening` plus commits that consolidate the three planning docs,
  add OPP-54/55 to the roadmap, and add this plan. **This is where the next work happens.**
- `dev/phase1-roadmap-sync` — empty/reserved; will be archived (we do the restructure on
  the consolidation branch instead).

**Already done:** three parallel "explore" investigations were consolidated into the three
planning docs; their branches are archived (`archive/explore/*`) and worktrees removed; the
worktree helper is tracked at `scripts/worktree-sessions.sh` on `main`.

**The `adhd` command (this is why the harness can build even the risky items):** the global
`adhd` is a **separate clone**, bun-linked from `/home/psz/dev/PSZ/harness` (its own `main`).
Editing *this* repo does not change the command. When you `cd` into this repo and run
`adhd "..."`, the **running** harness is the separate clone's code, and the **target** it
edits is this repo. So the harness changing this repo's core-loop code (e.g. OPP-54's
output-detection) does **not** alter the harness that is running — the self-modification
hazard that would normally make those changes risky to automate simply isn't present.

---

## 2. Decisions locked

- **Numbering (final, no gaps):** 54 `.adhd/` commit governance · 55 standing requirements
  (the "write-a-rule-once" engine) · 56 mid-run gate editor guard · 57 roadmap drift-detector
  (the cheap roadmap-tidy check) · 58 centralise refinement teardown · 59 strict numeric
  env-var parsing.
- **Roadmap-tidy: cheap first.** ~~Build the cheap warning check (**OPP-57**) now; the full
  enforcement engine (**OPP-55**) is planned for **later**, not now.~~ **SUPERSEDED
  2026-06-07** (see top banner): the cheap deterministic check proved unworkable — the
  user-facing CHANGELOG carries no OPP ids to match. The roadmap-upkeep case needs agent
  judgement, so it folds into **OPP-55** as its flagship first slice (design:
  `standing-requirements-design.md` §14). There is no cheap interim check.
- **Sequencing (Option A):** do the roadmap restructure on the consolidation branch, then
  release Phase 1 as **one** merge (Phase-1 code + consolidation docs + restructure ship
  together).
- **Claude builds everything (see §0).** Default to the `adhd` harness; Claude Code
  interactive only where it is clearly safer or simpler, and as a fallback.

---

## 3. Who does the work (none of it is a human)

| Item | In plain words | Built by | Human role |
|---|---|---|---|
| Roadmap restructure | Move Part 1 into `CAPABILITIES.md`; remove finished items; add OPP-56–59 | **Claude Code (direct edits)** | optional review |
| OPP-57 | Cheap roadmap-tidy **warning** check | **`adhd` harness** | approve publish |
| OPP-56 | Wrap the mid-run editor launch so a bad command can't crash it | **`adhd` harness** | approve publish |
| OPP-58 | Remove duplicated teardown code in one function | **`adhd` harness** | approve publish |
| OPP-59 | Reject non-whole-number env settings (match the CLI) | **`adhd` harness** | approve publish |
| OPP-54 | `.adhd/` commit governance (default-off, tiered) | **`adhd` harness** (close review) | review diff, approve publish |
| OPP-55 | Full "write-a-rule-once" enforcement engine | **`adhd` harness** (close review) | review diff, approve publish |

**The two "[human-led]" tags (OPP-54, OPP-55) do not mean "a human writes it."** They mean
*review this carefully*. The reason it's safe to let the harness build them: the `adhd`
command runs from a separate clone (§1), so the running harness is never the code being
edited — no live self-corruption. The only residual risk is a subtle regression slipping
past the harness's own green gate; that is handled by (a) feeding the harness the test-first
spec it needs — `commit-governance.md` §6 for OPP-54, `standing-requirements-design.md` §11
for OPP-55 — and (b) Claude reviewing the diff before release. **Fallback:** if the harness
genuinely can't land the detection edits cleanly, Claude Code does them interactively —
still no human coding.

---

## 4. The sequence (in order)

**S1 — Roadmap restructure (Claude Code, doc-only).** On `dev/phase1-followup-consolidation`,
follow `phase1-hardening-followup.md` §3.4 + §4.1–4.5:
- Move ROADMAP Part 1 → new `docs/CAPABILITIES.md` (keep the §-numbering).
- Remove fully-shipped items (OPP-30, 39, 40, 42, 43); trim the partials (OPP-33, 41, 44,
  46); re-home residuals (OPP-29, 35, 47).
- Add OPP-56–59 to the roadmap (they currently live only in the planning doc).
- **Reconcile with the consolidation:** OPP-54 and OPP-55 are **already** in the roadmap —
  do **not** re-add them; only add 56–59.
- Do this **before** building OPP-57: afterwards the roadmap holds only opportunities, which
  makes the drift-check trivial (§3.3).
- Gate: `bun run typecheck && bun run lint && bun run test` (doc-only, stays green).

**S2 — Release Phase 1 (Claude Code; you only approve the publish).** Per `docs/RELEASING.md`,
on the consolidation branch, Claude: picks the next version above `main` (currently 0.8.0),
bumps `package.json`, rewrites `CHANGELOG.md` for **users** (Phase-1 features only; no
sprint/internal terms), squash-merges the branch → `main`, strips `.adhd/` except
`usage.json`/`regression.json`, and stages the tag. **The one gated action is publishing —**
`git push origin main` + `git push origin vX` + `gh release create` — which Claude runs on
your "go" (or pre-authorise). Then Claude archives + deletes the now-redundant
`dev/phase1-harness-hardening` and `dev/phase1-roadmap-sync`. Result: `main` has the script,
the Phase 1 code, the consolidated planning docs, `CAPABILITIES.md`, and a clean roadmap with
OPP-54–59.

**S3 — OPP-57 cheap roadmap check (`adhd` harness). [RESOLVED 2026-06-07 — abandoned; see
top banner.]** Built and reviewed; the cheap deterministic premise is unworkable, so it was
**not** released. The work is archived (`archive/feat/opp-57-roadmap-drift-detector`) and its
intent folded into OPP-55 (`standing-requirements-design.md` §14). The original step text:
*from the repo root, Claude runs `adhd` (see §5), reviews the harness's branch, then releases
it per `docs/RELEASING.md`, archives the branch; you only approve the publish.*

**S4 — OPP-56, 58, 59 small fixes (`adhd` harness).** One harness run can cover all three
(small Phase-1 residuals). Claude reviews → releases → archives.

**S5 — OPP-54 commit governance (`adhd` harness, close review).** Claude runs the harness
pointed at `commit-governance.md` §6 (test-first; the detection edits are load-bearing) and
reviews the diff closely before release. Fallback: Claude Code interactive if the harness
can't land the edits cleanly. Independent of S3/S4, so it can move earlier or later.

**S6 — Later: OPP-55 full engine (`adhd` harness, close review).** When the cheap check is no
longer enough, Claude runs the harness pointed at `standing-requirements-design.md` §11.
Coordinate its third durable-asset edit with OPP-54 (both touch the same
`RELEASING.md`/`CLAUDE.md` durable-asset lines — see the cross-notes in both planning docs).

---

## 5. How Claude runs `adhd` to self-develop (with the right flags)

Plain `adhd "prompt"` is wrong for these runs. Two things drive the flags: (a) **Claude
drives the harness from a non-interactive shell**, so the interactive gates must not block;
(b) self-developing *this* repo needs the quality gates, conventions, and specs wired in.

**Recommended base flags (every run):**

| Flag | Why |
|---|---|
| `--no-interactive` | **Required** — Claude runs `adhd` in a non-TTY shell; an interactive gate would hang it. The `--dry-run` preview below replaces the spec-approval gate. (`--gate-timeout 0` is equivalent.) |
| `--lint-gate --test-gate` | Hard gates: a lint/type failure or a newly-broken test fails the attempt *before* the Opus judge — protects the ~1.5k-test suite. `--lint-gate` is the documented dogfooding setting. |
| `--review` | Advisory Reviewer code-craft pass after each passing sprint (catches quality issues pass/fail won't). |
| `--scout` | Read-only pass that surfaces this repo's conventions for the Generator — important for the `shared/` SDK-independence rule. |
| `--branch feat/opp-NN-…` | Name the topic branch explicitly. |
| `--commit-adhd` | Keep the `.adhd/` audit trail on the branch (stripped at release except `usage.json`/`regression.json`). |
| `--notify` | Desktop pings on gates/errors, for your awareness while Claude drives. |
| `--context …` | Inject the specs: `docs/ROADMAP.md`, `docs/INTERNALS.md`, `CLAUDE.md`, **and the item's planning doc**. |

**Workflow per item:**
1. **Preview** — run the command with `--dry-run` (planner only); Claude reviews the spec. If
   it's off, fix the prompt/context and preview again. (This is the review checkpoint, since
   Claude can't answer an interactive gate over a pipe.)
2. **Build** — rerun without `--dry-run`, **in the background** (these runs are long), and
   monitor. The harness works on its own topic branch with green gates.
3. **Ship** — Claude reviews the diff and runs the release (§6); you approve the publish. The
   harness does **not** release itself.

**Per-item tuning:**
- **OPP-57** (small, alone): `--max-sprints 4 --max-features 1`; planning doc
  `docs/planning/phase1-hardening-followup.md`. **[OPP-57 abandoned — see top banner; this
  line is kept only as a sizing template. Note: when the planner emits a multi-feature
  sprint, `--max-features 1` *drops* the extra features — set `--max-features` to cover the
  largest sprint, as the OPP-57 run did with `--max-features 3`.]**
- **OPP-56/58/59** (small batch): `--max-sprints 8 --max-features 3 --refine-spec`.
- **OPP-54 / OPP-55** (delicate/large): add `--model-generator opus` (sharper edits to
  load-bearing code; the Evaluator stays Opus by default — **never downgrade the judge**),
  `--refine-spec`, a higher `--max-sprints`; point `--context` at the full design
  (`commit-governance.md` §6 / `standing-requirements-design.md` §11). Review the diff
  closely before release.

**Example — OPP-57 build run** (preview first with the same line + `--dry-run`):
```bash
cd /home/psz/dev/PSZ/adhd
adhd --no-interactive --lint-gate --test-gate --review --scout --notify \
  --commit-adhd --branch feat/opp-57-roadmap-drift-detector \
  --max-sprints 4 --max-features 1 \
  --context docs/ROADMAP.md --context docs/INTERNALS.md --context CLAUDE.md \
  --context docs/planning/phase1-hardening-followup.md \
  "Implement OPP-57 (roadmap drift-detector) from docs/ROADMAP.md — a deterministic \
check (test/tooling) flagging any OPP id present in BOTH the CHANGELOG [Unreleased] \
section AND docs/ROADMAP.md. Keep shared/ free of SDK imports. Prefer small sprints."
```

---

## 6. The release ritual after every piece (Claude executes it)

Same each time (`docs/RELEASING.md`): green gate → pick version above `main` → user-facing
CHANGELOG → squash-merge → strip `.adhd/` (keep `usage.json` + `regression.json`) → annotated
`vX` tag → **[gated: your go]** push `main` + tag → `gh release create` → archive
(`archive/<branch>`) then delete the branch (never push topic branches or `archive/*` tags).
