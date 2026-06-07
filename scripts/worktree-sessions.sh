#!/usr/bin/env bash
# worktree-sessions.sh — Spin up N parallel investigation worktrees, each with
# its own branch, dependencies, shared memory, and (optionally) a VS Code window.
#
# Each "topic slug" you pass becomes one isolated workspace:
#   branch     <prefix><slug>                  e.g. explore/scope-audit
#   directory  <parent>/<repo>-<slug>          e.g. ../adhd-scope-audit
#   memory     ~/.claude/projects/<derived>/memory  → linked to this repo's store
#
# All worktrees branch off the SAME base commit, so the parallel discussions
# start from one consistent state. Reconcile them afterwards on an integration
# branch (see "Next steps" printed at the end).
#
# Usage:
#   ./scripts/worktree-sessions.sh [options] <slug> [<slug> ...]
#   ./scripts/worktree-sessions.sh --remove  [options] <slug> [<slug> ...]
#
# Options:
#   --base <ref>      Commit/branch all worktrees start from (default: HEAD)
#   --prefix <pfx>    Branch name prefix (default: "explore/")
#   --parent <dir>    Where worktree dirs are created (default: repo's parent dir)
#   --memory <mode>   symlink | copy | none (default: symlink)
#                       symlink — share ONE memory store with the main repo;
#                                 new memories accumulate straight back. (recommended)
#                       copy    — seed a private copy per worktree (merge back by hand)
#                       none    — start each worktree with empty memory
#   --no-install      Skip `bun install` in each worktree
#   --no-code         Don't open VS Code windows (just print the commands)
#   --remove          Tear down the worktrees/branches/memory links for the slugs
#   --force           With --remove: force-remove dirty worktrees and unmerged branches
#   --dry-run         Print what would happen; change nothing
#   -h, --help        Show this help
#
# Examples:
#   # Create three HITL investigation workspaces and open a window for each:
#   ./scripts/worktree-sessions.sh scope-audit artifact-policy policy-home
#
#   # Same, but don't open editors and don't reinstall deps:
#   ./scripts/worktree-sessions.sh --no-code --no-install scope-audit artifact-policy
#
#   # Branch off a specific commit instead of HEAD:
#   ./scripts/worktree-sessions.sh --base 7794fee scope-audit artifact-policy policy-home
#
#   # Preview without touching anything:
#   ./scripts/worktree-sessions.sh --dry-run scope-audit artifact-policy policy-home
#
#   # Clean up when the investigation is done (refuses to drop unmerged work):
#   ./scripts/worktree-sessions.sh --remove scope-audit artifact-policy policy-home
#
# Note: the memory store is shared via symlink, so all sessions plus the main
# repo write to one MEMORY.md index. At human-in-the-loop pace collisions are
# unlikely; glance at MEMORY.md afterwards if several sessions added memories.

set -euo pipefail

# ── Defaults ──
BASE_REF="HEAD"
BRANCH_PREFIX="explore/"
PARENT_OVERRIDE=""
MEM_MODE="symlink"
DO_INSTALL=true
DO_CODE=true
ACTION="create"
FORCE=false
DRY_RUN=false
CLAUDE_PROJECTS="${CLAUDE_PROJECTS:-$HOME/.claude/projects}"

usage() { sed -n '2,/^set -euo/p' "$0" | sed '$d; s/^# \{0,1\}//'; }

# ── Pretty logging (color only on a tty) ──
if [[ -t 1 ]]; then B="\033[1m"; DIM="\033[2m"; GRN="\033[32m"; YLW="\033[33m"; RED="\033[31m"; R="\033[0m"
else B=""; DIM=""; GRN=""; YLW=""; RED=""; R=""; fi
log()  { printf "   %b\n" "$1"; }
hdr()  { printf "\n${B}%b${R}\n" "$1"; }
warn() { printf "   ${YLW}! %b${R}\n" "$1" >&2; }
die()  { printf "${RED}error:${R} %b\n" "$1" >&2; exit 1; }

# Execute, or in dry-run just print the command.
_x() {
  if $DRY_RUN; then printf "      ${DIM}would run:${R} %s\n" "$*"
  else "$@"; fi
}

# ── Parse args ──
SLUGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --base)       BASE_REF="${2:-}"; shift 2 ;;
    --prefix)     BRANCH_PREFIX="${2:-}"; shift 2 ;;
    --parent)     PARENT_OVERRIDE="${2:-}"; shift 2 ;;
    --memory)     MEM_MODE="${2:-}"; shift 2 ;;
    --no-install) DO_INSTALL=false; shift ;;
    --no-code)    DO_CODE=false; shift ;;
    --remove)     ACTION="remove"; shift ;;
    --force)      FORCE=true; shift ;;
    --dry-run)    DRY_RUN=true; shift ;;
    -h|--help)    usage; exit 0 ;;
    --)           shift; while [[ $# -gt 0 ]]; do SLUGS+=("$1"); shift; done ;;
    -*)           die "unknown option: $1  (try --help)" ;;
    *)            SLUGS+=("$1"); shift ;;
  esac
done

[[ ${#SLUGS[@]} -eq 0 ]] && die "no topic slugs given.  e.g. $0 scope-audit artifact-policy policy-home"
case "$MEM_MODE" in symlink|copy|none) ;; *) die "--memory must be symlink|copy|none (got: $MEM_MODE)" ;; esac

# ── Resolve repo geometry (works whether run from the main repo or a worktree) ──
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "not inside a git repository"
MAIN_REPO=$(git worktree list --porcelain | sed -n '1s/^worktree //p')
[[ -n "$MAIN_REPO" ]] || die "could not determine main worktree path"
REPO_NAME=$(basename "$MAIN_REPO")
PARENT="${PARENT_OVERRIDE:-$(dirname "$MAIN_REPO")}"

# Claude Code derives a project's memory dir from the worktree's absolute path,
# replacing '/' and '.' with '-'. Mirror that mapping so our symlink lands right.
project_dir_for() { local p="$1"; p="${p//\//-}"; p="${p//./-}"; printf '%s/%s' "$CLAUDE_PROJECTS" "$p"; }
CANONICAL_MEMORY="$(project_dir_for "$MAIN_REPO")/memory"

# Derive per-slug names once.
declare -a BRANCHES DIRS PROJDIRS
for slug in "${SLUGS[@]}"; do
  BRANCHES+=("${BRANCH_PREFIX}${slug}")
  DIRS+=("${PARENT}/${REPO_NAME}-${slug}")
  PROJDIRS+=("$(project_dir_for "${PARENT}/${REPO_NAME}-${slug}")")
done

# ════════════════════════════════════════════════════════════════════════════
# REMOVE
# ════════════════════════════════════════════════════════════════════════════
if [[ "$ACTION" == "remove" ]]; then
  hdr "Removing ${#SLUGS[@]} worktree(s)${DRY_RUN:+ (dry-run)}"
  for i in "${!SLUGS[@]}"; do
    wt="${DIRS[$i]}"; br="${BRANCHES[$i]}"; mem="${PROJDIRS[$i]}/memory"
    hdr "▸ ${SLUGS[$i]}"
    # Memory: only ever remove a symlink we created; never a real directory.
    if [[ -L "$mem" ]]; then log "unlink memory  ${DIM}$mem${R}"; _x rm "$mem"
    elif [[ -e "$mem" ]]; then warn "memory at $mem is a real directory — left untouched"; fi
    # Worktree: git refuses if dirty unless --force.
    if git -C "$MAIN_REPO" worktree list --porcelain | grep -qx "worktree $wt"; then
      log "remove worktree  ${DIM}$wt${R}"
      if $FORCE; then _x git -C "$MAIN_REPO" worktree remove --force "$wt"
      else _x git -C "$MAIN_REPO" worktree remove "$wt"; fi
    else warn "no worktree registered at $wt — skipping"; fi
    # Branch: safe delete (-d) refuses unmerged work unless --force (-D).
    if git -C "$MAIN_REPO" show-ref --verify --quiet "refs/heads/$br"; then
      log "delete branch  ${DIM}$br${R}"
      if $FORCE; then _x git -C "$MAIN_REPO" branch -D "$br"
      else _x git -C "$MAIN_REPO" branch -d "$br"; fi
    else warn "no branch $br — skipping"; fi
  done
  $DRY_RUN || _x git -C "$MAIN_REPO" worktree prune
  hdr "Done."
  exit 0
fi

# ════════════════════════════════════════════════════════════════════════════
# CREATE
# ════════════════════════════════════════════════════════════════════════════
BASE_SHA=$(git -C "$MAIN_REPO" rev-parse --short "$BASE_REF" 2>/dev/null) \
  || die "base ref not found: $BASE_REF"

# Tools.
$DO_INSTALL && ! command -v bun  >/dev/null 2>&1 && { warn "bun not found — skipping installs"; DO_INSTALL=false; }
$DO_CODE    && ! command -v code >/dev/null 2>&1 && { warn "'code' not found — won't open editors"; DO_CODE=false; }

# Canonical memory must exist for symlink/copy.
if [[ "$MEM_MODE" != none && ! -d "$CANONICAL_MEMORY" ]]; then
  warn "canonical memory dir not found ($CANONICAL_MEMORY) — using --memory none"
  MEM_MODE=none
fi

hdr "Plan${DRY_RUN:+ (dry-run)}"
log "repo      ${B}$REPO_NAME${R}  ${DIM}($MAIN_REPO)${R}"
log "base      ${B}$BASE_SHA${R}  ${DIM}($BASE_REF)${R}"
log "memory    ${B}$MEM_MODE${R}"
log "install   $([ $DO_INSTALL = true ] && echo yes || echo no)    code: $([ $DO_CODE = true ] && echo yes || echo no)"
for i in "${!SLUGS[@]}"; do
  log "  • ${B}${SLUGS[$i]}${R}  →  branch ${BRANCHES[$i]}  ${DIM}${DIRS[$i]}${R}"
done

# Pre-flight: refuse to start if any dir or branch already exists.
conflict=false
for i in "${!SLUGS[@]}"; do
  [[ -e "${DIRS[$i]}" ]] && { warn "directory already exists: ${DIRS[$i]}"; conflict=true; }
  git -C "$MAIN_REPO" show-ref --verify --quiet "refs/heads/${BRANCHES[$i]}" \
    && { warn "branch already exists: ${BRANCHES[$i]}"; conflict=true; }
done
$conflict && die "resolve the conflicts above (or '$0 --remove ...') and re-run."

# Build each worktree.
for i in "${!SLUGS[@]}"; do
  wt="${DIRS[$i]}"; br="${BRANCHES[$i]}"; proj="${PROJDIRS[$i]}"
  hdr "▸ ${SLUGS[$i]}"

  log "create worktree  ${DIM}$wt${R}  (branch $br off $BASE_SHA)"
  _x git -C "$MAIN_REPO" worktree add "$wt" -b "$br" "$BASE_REF"

  if [[ "$MEM_MODE" != none ]]; then
    dest="$proj/memory"
    if [[ -e "$dest" || -L "$dest" ]]; then
      warn "memory exists at $dest — leaving as-is"
    else
      _x mkdir -p "$proj"
      if [[ "$MEM_MODE" == symlink ]]; then
        log "link memory  ${DIM}$dest → $CANONICAL_MEMORY${R}"
        _x ln -s "$CANONICAL_MEMORY" "$dest"
      else
        log "copy memory  ${DIM}$CANONICAL_MEMORY → $dest${R}"
        _x cp -r "$CANONICAL_MEMORY" "$dest"
      fi
    fi
  fi

  if $DO_INSTALL; then
    log "bun install"
    if $DRY_RUN; then printf "      ${DIM}would run:${R} (cd %s && bun install)\n" "$wt"
    else ( cd "$wt" && bun install ); fi
  fi

  if $DO_CODE; then
    log "open VS Code window"
    _x code -n "$wt"
  fi
done

# ── Next steps ──
hdr "Next steps"
if ! $DO_CODE; then
  log "Open each workspace in its own window:"
  for wt in "${DIRS[@]}"; do printf "      code -n %s\n" "$wt"; done
fi
log "When done, reconcile onto a fresh integration branch:"
printf "      git -C %s switch -c integrate/<topic> %s\n" "$MAIN_REPO" "$BASE_SHA"
printf "      git -C %s diff %s%s   ${DIM}# review a path before pulling it in${R}\n" "$MAIN_REPO" "$BRANCH_PREFIX" "${SLUGS[0]}"
log "Tear everything down with:"
printf "      %s --remove %s\n" "$0" "${SLUGS[*]}"
echo
