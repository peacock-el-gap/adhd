# scripts/

Contributor-facing helper scripts (not part of the shipped harness).

| Script | Purpose |
|---|---|
| [`worktree-sessions.sh`](worktree-sessions.sh) | Spin up N parallel investigation worktrees off one base commit — each its own branch, deps, and shared memory link — then tear them down safely. Run `./scripts/worktree-sessions.sh --help`. |

These are developer tools, so they are not covered by the SemVer guarantees that
apply to the harness CLI, `.adhd/` formats, and `AgentRunners` interface.
