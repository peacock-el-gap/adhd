# Troubleshooting

The failure modes that are hard to spot — because the harness is built to degrade gracefully rather than
crash, several problems surface as *quietly wrong behaviour* rather than an error. Here is where to look.

## First stop: the logs

Every run writes detailed, timestamped markdown conversation logs to
`.adhd/logs/<YYYY.MM.DD-HH.MM.SS>/` — one file per agent / sprint / attempt (`planner.md`,
`sprint-N-contract.md`, `sprint-N-attempt-M-generator.md`, `evaluator.md`, …), regardless of log level.
When something looks off, read the relevant file there first. Optional Langfuse tracing
(`LANGFUSE_*` env vars) is fire-and-forget — if it can't reach the server it warns and continues, so a
missing trace never affects the run.

## Silent failure modes

- **Contract parse fallback.** If a negotiated contract fails to parse as JSON, the harness logs a
  truncated preview, writes the raw text to `.adhd/logs/<session>/*-contract-parse-error.txt`, and falls
  back to a generic default contract so the run continues. The tell is scoring that suddenly flattens or
  stops matching the sprint's intent. Check for that error file.
- **Scout silently skipped in greenfield.** `--scout` only runs on an existing codebase. In greenfield
  there is nothing to read, so it is skipped with no digest — the Generator gets default idiom guidance
  instead. If `.adhd/scout-digest.json` is missing after a `--scout` run, this is why.
- **A skill shadowing another.** Skills resolve project (`.adhd/skills/local/`) > user (`~/.adhd/skills/`)
  > harness built-ins. A stale override at a higher scope silently masks the harness version. If agent
  behaviour seems wrong after a harness upgrade, check `~/.adhd/skills/` and `.adhd/skills/local/` for
  leftover overrides.
- **Contract size ceiling disabled by a bad value.** `--max-features` / `--max-criteria` /
  `--max-surfaces` set to `0` or a negative number degrade to *no cap* rather than erroring — so a
  fat-fingered flag silently lets contracts balloon. Use positive integers.
- **Evaluator weaker than Generator.** Only a startup warning, never a stop. If quality is mysteriously
  low, confirm the Evaluator tier is ≥ the Generator tier (see `cost-and-models.md`).

## Common operational issues

- **The run stalls waiting for input.** Interactive gates (spec approval, contract preview, evaluator
  override, steering) pause for a human with a countdown. In CI or any headless run, pass
  `--no-interactive` or `--gate-timeout 0`.
- **`.adhd/` ended up in commits.** The harness respects `.gitignore` and never force-adds ignored paths.
  If `.adhd/` is not gitignored, its files can be swept into commits (e.g. by the commit-enforcement
  fallback, which stages the whole tree when an agent leaves changes uncommitted). Add `.adhd/` to
  `.gitignore`.
- **Unrelated uncommitted work got committed.** The commit-enforcement fallback runs `git add -A` if an
  agent leaves the tree dirty. Start from a clean tree so only the harness's own product changes are
  captured.
- **"Where did my code go?"** By default commits are on the auto-created topic branch
  `adhd/<slug>-<timestamp>`, not your current branch. `git branch` will show it; use `--allow-main` next
  time if you wanted commits on the current branch.
- **Resume ran on the wrong branch.** `--resume` switches back to the branch recorded in
  `.adhd/progress.json`. If you manually changed branches first, it may run on the new one. Stay on the
  run's original branch when resuming.
- **API key / runtime errors at startup.** Ensure `ANTHROPIC_API_KEY` is set (or present in the project's
  `.adhd/.env`) and that `bun` is installed. Note `.adhd/.env` is loaded into the environment of every
  script the harness runs (lint, tests, MCP servers) — treat it as secret and never commit it.

## When in doubt

Re-run with `--verbose` (or `--debug` for SDK-level detail), reproduce with a single sprint via
`--sprint N`, and compare a good run against a bad one with `adhd compare`.
