# ADHD run lifecycle

What actually happens between `adhd "..."` and a finished run, and the distinctions people get wrong.

## The lifecycle, end to end

1. **Config resolution.** Settings come from CLI flags, then `.adhd/.env`, then environment, then
   built-in defaults (in that precedence). Run `adhd --help` to see every default.
2. **Dirty-tree check** (interactive). If the working tree has uncommitted changes, the harness warns —
   it does not stop. `.adhd/` itself is excluded from this check, so harness bookkeeping never counts as
   "dirty".
3. **Plan.** The Planner expands the prompt into `.adhd/spec.md`: a product spec broken into a handful of
   sprints, each with Given/When/Then acceptance scenarios. It may pause to ask a clarifying question.
4. **Spec approval** (interactive). Review in the terminal, or open it in your editor with
   `--editor "code --wait"`. Approve, edit, request a revision (the Planner iterates), or abort. With
   `--dry-run` the run stops here — nothing is built.
5. **Scout** (optional, `--scout`). A read-only pass over an existing codebase that records its
   conventions into `.adhd/scout-digest.json` and feeds them to the Generator. Skipped in greenfield.
6. **Branch** (default). A topic branch `adhd/<slug>-<timestamp>` is created so commits never land on the
   current branch. `--branch <name>` overrides the name; `--allow-main` skips branching entirely.
7. **Sprint loop** (per sprint):
   - **Contract negotiation** — Generator proposes testable criteria, Evaluator reviews and tightens
     them, until both agree. Saved to `.adhd/contracts/sprint-N.json`. This is the definition of "done".
   - **Build** — the Generator implements the sprint and commits.
   - **Static analysis** — lint/typecheck run if detected; soft feedback unless `--lint-gate`. Tests run
     if `--test-gate`, compared against a pre-build baseline.
   - **Evaluate** — the Evaluator reads the code, tries to break it, scores each criterion 1–10. All
     criteria ≥ `--threshold` ⇒ **pass**. Feedback is written to `.adhd/feedback/sprint-N-round-R.json`.
   - **Retry or advance** — on failure, retry with feedback (up to `--max-retries`). On pass, checkpoint
     to `.adhd/progress.json` (records the git SHA), then an interactive **steering** gate: continue, skip
     the next sprint, edit the spec, or abort.
   - Optional **Reviewer** (`--review`) and **spec refinement** (`--refine-spec`) happen here.
8. **Document** (unless `--no-docs`). The Documenter writes README/CHANGELOG (and API docs when relevant)
   from the spec, code, and contracts. Advisory — a Documenter failure does not fail the run.
9. **Run snapshot.** Terminal state (cost, progress) is saved under `.adhd/runs/<timestamp>/` for later
   comparison. These snapshots are local-only and never committed.

**Exit codes:** `0` all sprints passed · `1` a sprint could not pass the Evaluator · `2` infrastructure
error (progress is saved — re-run with `--resume`).

## `--resume` vs `--sprint N` vs `--dry-run` — they are not the same

People reach for the wrong one constantly:

- **`--dry-run`** — plan and stop. Generates the spec and shows the approval gate, then exits before any
  building. Zero generation cost. Use it to preview the plan.
- **`--resume`** — *recovery*. Picks up from the last checkpoint and continues from the **next unfinished
  sprint**. It does **not** re-run completed sprints. It re-reads `.adhd/progress.json` and switches back
  to the branch the run was on. Safe to call repeatedly.
- **`--sprint N`** — *re-run one specific sprint*. Requires an existing `.adhd/spec.md`. Use it to redo or
  iterate on a single sprint. Cannot be combined with `--resume`.

So: interrupted run you want to finish ⇒ `--resume`. Want to redo sprint 3 ⇒ `--sprint 3`. Want to see the
plan without paying ⇒ `--dry-run`.

## BDD regression accumulation (default on)

Behavioural criteria from each passing sprint accumulate in `.adhd/regression.json`. Every subsequent
sprint's Evaluator checks **both** the new criteria **and** all accumulated ones — that is how the harness
catches a later sprint breaking an earlier behaviour. Retiring a criterion is explicit (a `retire:` field
in a contract), never automatic. `--no-bdd` turns off *both* the Given/When/Then scenarios and this
accumulation, so use it deliberately.

## Comparing runs

`adhd compare <run-a> <run-b>` compares two preserved snapshots from `.adhd/runs/` — sprint deltas, cost
delta, criteria trends. `adhd compare` with no arguments lists the available runs. Useful for "did this
config change actually help?"
