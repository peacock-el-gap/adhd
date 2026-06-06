import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { gitDir, USAGE_FILE } from "../files.ts";
import { promptGate } from "../interaction.ts";
import { log, logError } from "../logger.ts";
import { notify } from "../notifications.ts";
import type { CommitSource, HarnessProgress, ResolvedConfig } from "../types.ts";
import { UserAbortError } from "./error-handling.ts";

/**
 * Minimal structural type for `execSync`. Deliberately narrower than
 * `typeof execSync` — its overloads reject a simple `(cmd) => string` fake,
 * which the unit tests rely on. Lives in `shared/` because it describes a
 * `node:child_process` shape, not an LLM SDK (CLAUDE.md SDK-independence rule).
 */
export type ExecLike = (
  command: string,
  options?: { cwd?: string; encoding?: string; stdio?: string },
) => string | Buffer;

/** Options for the shared agent-directed commit primitive. */
export interface EnsureAgentCommitOptions {
  workDir: string;
  gitDir: string;
  agentLabel: "generator" | "documenter";
  beforeSha: string;
  /** Message for the harness-level fallback auto-commit. Must be a complete sentence. */
  fallbackMessage: string;
  /**
   * Injected resume-runner that asks the agent (via its SDK session) to commit.
   * Implementations construct the appropriate SDK query() call; this primitive
   * stays SDK-independent. Returning normally means "resume attempt finished";
   * the primitive re-checks the tree to decide whether it actually committed.
   * If omitted, the primitive skips the resume tier and goes straight to fallback.
   */
  runResume?: () => Promise<void>;
  /**
   * Injected subprocess runner. Defaults to the real `execSync`; tests inject a
   * fake so the suite can run process-globally without `mock.module`. Only this
   * primitive reads it — the other functions in this file keep using `execSync`
   * directly (they are exercised by the real-git tests).
   */
  exec?: ExecLike;
}

/**
 * Three-tier agent-directed commit recovery. Shared by generator and documenter.
 *
 * 1. Agent committed and tree is clean → "agent".
 * 2. Tree dirty → invoke runResume, re-check tree. Clean → "resume".
 * 3. Still dirty → harness-level fallback auto-commit with fallbackMessage → "fallback".
 * 4. HEAD unchanged and tree clean → "none" (agent produced no output).
 */
export async function ensureAgentCommit(opts: EnsureAgentCommitOptions): Promise<CommitSource> {
  const { gitDir: gDir, agentLabel, beforeSha, fallbackMessage, runResume } = opts;
  const exec = opts.exec ?? execSync;

  const currentSha = exec("git rev-parse HEAD", { cwd: gDir, encoding: "utf-8" }).toString().trim();
  const dirty = exec("git status --porcelain", { cwd: gDir, encoding: "utf-8" }).toString().trim();

  if (currentSha !== beforeSha && !dirty) {
    return "agent";
  }

  if (!dirty) {
    log("HARNESS", `WARNING: ${agentLabel} produced no file changes and no commits`);
    return "none";
  }

  if (runResume) {
    log("HARNESS", `${agentLabel} left uncommitted changes — requesting commit via session resume...`);
    try {
      await runResume();
    } catch (err) {
      const e = err as { message?: string; stderr?: unknown; stdout?: unknown; cause?: unknown };
      const detail = [
        e.message ?? String(err),
        e.stderr ? `stderr=${String(e.stderr).slice(0, 500)}` : "",
        e.stdout ? `stdout=${String(e.stdout).slice(0, 500)}` : "",
        e.cause ? `cause=${String(e.cause).slice(0, 200)}` : "",
      ]
        .filter(Boolean)
        .join(" | ");
      log("HARNESS", `WARNING: Resume session for ${agentLabel} commit failed: ${detail}`);
    }

    const postResumeDirty = exec("git status --porcelain", { cwd: gDir, encoding: "utf-8" }).toString().trim();
    if (!postResumeDirty) {
      log("HARNESS", `${agentLabel} committed via session resume`);
      return "resume";
    }
  }

  log("HARNESS", `WARNING: ${agentLabel} still did not commit — harness fallback auto-commit`);
  exec(`git add -A && git commit -m ${JSON.stringify(fallbackMessage)}`, { cwd: gDir, stdio: "pipe" });
  return "fallback";
}

/**
 * Commit all pending .adhd/ files (contracts, progress, feedback, etc.)
 * with a descriptive [adhd] prefix commit message.
 *
 * No-op if there are no .adhd/ changes to commit (avoids empty commits).
 */
export function commitAdhdArtifacts(workDir: string, gDir: string, sprint: number): void {
  try {
    // Check if .adhd/ has any pending changes (staged, modified, or untracked)
    const adhdPath = join(workDir, ".adhd");
    if (!existsSync(adhdPath)) return;

    // Stage all .adhd/ files
    execSync("git add .adhd/", { cwd: gDir, stdio: "pipe" });

    // Check if there's anything staged for .adhd/
    const stagedResult = execSync("git diff --cached --name-only -- .adhd/", { cwd: gDir, encoding: "utf-8" });
    const staged = (stagedResult ?? "").toString().trim();
    if (!staged) {
      return;
    }

    execSync(`git commit -m "[adhd] Sprint ${sprint}: artifacts"`, { cwd: gDir, stdio: "pipe" });
    log("HARNESS", `Committed .adhd/ artifacts for sprint ${sprint}`);
  } catch (err) {
    // If commit fails (e.g., nothing to commit), log and continue
    logError("HARNESS", `Failed to commit .adhd/ artifacts: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * The canonical set of .adhd/ paths staged by every metadata commit.
 * Shared by both the per-sprint and end-of-run commit helpers so the path set
 * is defined once and never duplicated.
 */
const ADHD_METADATA_PATHS = [
  ".adhd/contracts/",
  ".adhd/feedback/",
  ".adhd/progress.json",
  ".adhd/spec.md",
  USAGE_FILE,
] as const;

/**
 * Stage all canonical .adhd/ metadata paths (plus optionally .adhd/logs/) and
 * return true if anything ended up staged, false if the working tree is clean.
 *
 * This is the shared staging primitive called by both commitAdhdMetadata and
 * commitFinalMetadata — the path set and add loop live here and nowhere else.
 */
function stageAdhdMetadataPaths(gDir: string, includeLogs: boolean): boolean {
  const pathsToStage: string[] = [...ADHD_METADATA_PATHS];
  if (includeLogs) {
    pathsToStage.push(".adhd/logs/");
  }

  for (const p of pathsToStage) {
    try {
      execSync(`git add ${p}`, { cwd: gDir, stdio: "pipe" });
    } catch {
      // Path may not exist yet — skip silently
    }
  }

  const stagedResult = execSync("git diff --cached --name-only", { cwd: gDir, encoding: "utf-8" });
  return (stagedResult ?? "").toString().trim().length > 0;
}

/**
 * Commit .adhd/ metadata after a sprint passes evaluation.
 * Only invoked when --commit-adhd or --commit-adhd-logs is set.
 *
 * Commits .adhd/contracts/, .adhd/feedback/, .adhd/progress.json, .adhd/spec.md,
 * and .adhd/usage.json. When includeLogs is true, also commits .adhd/logs/.
 *
 * @param workDir - Project root directory
 * @param gDir - Git working directory
 * @param sprint - Sprint number for the commit message
 * @param includeLogs - Whether to include .adhd/logs/ (from --commit-adhd-logs)
 */
export function commitAdhdMetadata(workDir: string, gDir: string, sprint: number, includeLogs: boolean): void {
  try {
    const adhdPath = join(workDir, ".adhd");
    if (!existsSync(adhdPath)) return;

    if (!stageAdhdMetadataPaths(gDir, includeLogs)) return;

    execSync(`git commit -m "[adhd] Sprint ${sprint}: contract + metadata"`, { cwd: gDir, stdio: "pipe" });
    log("HARNESS", `Committed .adhd/ metadata for sprint ${sprint}${includeLogs ? " (including logs)" : ""}`);
  } catch (err) {
    logError("HARNESS", `Failed to commit .adhd/ metadata: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Commit .adhd/ metadata after the entire run completes (final end-of-run checkpoint).
 * Only invoked when --commit-adhd or --commit-adhd-logs is set.
 *
 * Captures the terminal progress.json (status complete/failed, docs-generated flag)
 * and the final usage.json alongside the standard metadata paths. Uses a distinct
 * "[adhd] Run complete: final metadata" commit message so the end-of-run checkpoint
 * is clearly distinguishable from per-sprint metadata commits.
 *
 * No-op when nothing has changed since the last commit (avoids empty commits).
 * Non-fatal: errors are caught and logged at warning severity.
 *
 * @param workDir - Project root directory
 * @param gDir - Git working directory
 * @param includeLogs - Whether to include .adhd/logs/ (from --commit-adhd-logs)
 */
export function commitFinalMetadata(workDir: string, gDir: string, includeLogs: boolean): void {
  try {
    const adhdPath = join(workDir, ".adhd");
    if (!existsSync(adhdPath)) return;

    if (!stageAdhdMetadataPaths(gDir, includeLogs)) return;

    execSync('git commit -m "[adhd] Run complete: final metadata"', { cwd: gDir, stdio: "pipe" });
    log("HARNESS", `Committed final .adhd/ metadata${includeLogs ? " (including logs)" : ""}`);
  } catch (err) {
    log(
      "HARNESS",
      `WARNING: Failed to commit final .adhd/ metadata: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Stash .adhd/ files so they survive a git reset --hard.
 * Returns true if files were stashed, false otherwise.
 */
function stashAdhdFiles(workDir: string, gDir: string): boolean {
  try {
    const adhdPath = join(workDir, ".adhd");
    if (!existsSync(adhdPath)) return false;

    // Check if there are any .adhd/ files (tracked or untracked)
    const statusResult = execSync("git status --porcelain -- .adhd/", { cwd: gDir, encoding: "utf-8" });
    const status = (statusResult ?? "").toString().trim();
    // Also check for untracked .adhd/ files not yet in git
    const untrackedResult = execSync("git ls-files --others --exclude-standard -- .adhd/", {
      cwd: gDir,
      encoding: "utf-8",
    });
    const untrackedCheck = (untrackedResult ?? "").toString().trim();

    if (!status && !untrackedCheck) return false;

    // Stage and stash just the .adhd/ files
    execSync("git add .adhd/", { cwd: gDir, stdio: "pipe" });
    execSync('git stash push -m "adhd-revert-preserve" -- .adhd/', { cwd: gDir, stdio: "pipe" });
    log("HARNESS", "Stashed .adhd/ files before reset");
    return true;
  } catch (err) {
    logError("HARNESS", `Failed to stash .adhd/ files: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

/**
 * Restore .adhd/ files from stash after a git reset --hard.
 */
function unstashAdhdFiles(gDir: string): void {
  try {
    execSync("git stash pop", { cwd: gDir, stdio: "pipe" });
    log("HARNESS", "Restored .adhd/ files after reset");
  } catch (err) {
    logError(
      "HARNESS",
      `Failed to restore .adhd/ files from stash: ${err instanceof Error ? err.message : String(err)}`,
    );
    // Try to drop the stash entry if pop failed due to conflicts
    try {
      execSync("git checkout --theirs -- .adhd/", { cwd: gDir, stdio: "ignore" });
      execSync("git stash drop", { cwd: gDir, stdio: "ignore" });
    } catch {
      // Best effort — continue regardless
    }
  }
}

export function revertToCheckpoint(workDir: string, isGreenfield: boolean, progress: HarnessProgress): void {
  const gDir = gitDir(workDir, isGreenfield);
  const sha = progress.lastPassedCommitSha ?? "";

  try {
    const headResult = execSync("git rev-parse HEAD", { cwd: gDir, encoding: "utf-8" });
    const currentHead = (headResult ?? "").toString().trim();
    if (currentHead === sha) {
      log("HARNESS", "HEAD matches checkpoint — no revert needed");
      return;
    }

    log("HARNESS", `Resetting to checkpoint ${sha.slice(0, 8)}...`);

    // Stash .adhd/ files before reset so they survive
    const stashed = stashAdhdFiles(workDir, gDir);

    // Use git reset --hard instead of git revert --no-commit
    execSync(`git reset --hard ${sha}`, { cwd: gDir, stdio: "pipe" });
    log("HARNESS", "Reset successful");

    // Restore .adhd/ files from stash
    if (stashed) {
      unstashAdhdFiles(gDir);
    }
  } catch (err) {
    logError("HARNESS", `Git reset failed. Continuing without revert. Error: ${err}`);
  }
}

/** Default branches the run-on-main guard protects from accidental commits. */
const DEFAULT_BRANCHES: ReadonlySet<string> = new Set(["main", "master"]);

/**
 * Pure predicate: must the harness refuse to run because it is sitting on a
 * default branch and would commit there? Side-effect free so it is unit-testable
 * without a git repo.
 *
 * Refuse only when ALL hold: not greenfield (greenfield commits to its own
 * `app/` repo, never the host's main), no `--allow-main` override, and the
 * current branch is a known default (`main`/`master`). An unknown branch
 * (`undefined` — not a git repo, or detached HEAD) never blocks: the guard
 * protects against a known footgun, it does not invent new failure modes.
 */
export function shouldRefuseOnDefaultBranch(opts: {
  branch: string | undefined;
  isGreenfield: boolean;
  allowMain: boolean;
}): boolean {
  if (opts.isGreenfield) return false;
  if (opts.allowMain) return false;
  if (!opts.branch) return false;
  return DEFAULT_BRANCHES.has(opts.branch.trim());
}

/** The current git branch in `dir`, or `undefined` if it can't be determined. */
export function currentGitBranch(dir: string): string | undefined {
  try {
    const branch = execSync("git branch --show-current", { cwd: dir, encoding: "utf-8" }).trim();
    return branch || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Refuse to run when the harness would commit to a default branch (main/master)
 * without `--allow-main`. ADHD commits to whatever branch is checked out, so a
 * run on `main` silently writes self-development commits to the wrong place.
 * Throws a clear, actionable error BEFORE any commit happens; a no-op for
 * greenfield runs (own `app/` repo) and topic branches.
 */
export function assertBranchAllowed(config: ResolvedConfig): void {
  if (config.isGreenfield) return;
  const branch = currentGitBranch(gitDir(config.workDir, config.isGreenfield));
  if (shouldRefuseOnDefaultBranch({ branch, isGreenfield: config.isGreenfield, allowMain: config.allowMain })) {
    throw new Error(
      `Refusing to run on '${branch}': ADHD commits to the checked-out branch. ` +
        `Create a topic branch (git switch -c dev/<name>) or pass --allow-main to override.`,
    );
  }
}

/** Options for ensureTopicBranch. */
export interface EnsureTopicBranchOptions {
  /** The fully-formed branch name (e.g. `"adhd/my-task-20260606-143045"`). */
  branchName: string;
  /** The git working directory (the directory that contains `.git`). */
  gitDir: string;
  /**
   * Injected subprocess runner — defaults to `execSync`.
   * Tests inject a fake so the suite never touches a real git repository.
   */
  exec?: ExecLike;
}

/**
 * Create and switch to a topic branch, or check out an existing one.
 *
 * - **New branch**: runs `git checkout -b <name>` from the current HEAD.
 * - **Existing branch**: runs `git checkout <name>`, preserving its history.
 *
 * Encapsulates the branch-name derivation / creation / checkout /
 * collision-handling logic in one place so no git command sequences are
 * duplicated elsewhere.
 *
 * On any git failure this function throws a meaningful `Error` — never
 * swallows or downgrades to a warning — because a pre-flight branch failure
 * must halt the run before any sprint code executes.
 */
export function ensureTopicBranch(opts: EnsureTopicBranchOptions): void {
  const exec = opts.exec ?? execSync;
  const { branchName, gitDir: gDir } = opts;

  // Determine whether the branch already exists locally.
  let branchExists: boolean;
  try {
    const out = exec(`git branch --list ${JSON.stringify(branchName)}`, {
      cwd: gDir,
      encoding: "utf-8",
    })
      .toString()
      .trim();
    branchExists = out.length > 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Unable to list branches in '${gDir}': ${msg}`);
  }

  try {
    if (branchExists) {
      // Branch exists — check it out to reuse; existing commits are preserved.
      exec(`git checkout ${JSON.stringify(branchName)}`, { cwd: gDir, stdio: "pipe" });
    } else {
      // Branch does not exist — create from HEAD and switch to it.
      exec(`git checkout -b ${JSON.stringify(branchName)}`, { cwd: gDir, stdio: "pipe" });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const action = branchExists ? "check out existing" : "create";
    throw new Error(`Failed to ${action} topic branch '${branchName}': ${msg}`);
  }
}

export async function checkDirtyTree(config: ResolvedConfig): Promise<void> {
  let status: string;
  try {
    status = execSync("git status --porcelain", { cwd: config.workDir, encoding: "utf-8" }).trim();
  } catch {
    // Not a git repo — nothing to check
    return;
  }
  if (!status) return; // Clean tree

  const lines = status.split("\n");
  const modified = lines.filter((l) => l.startsWith(" M") || l.startsWith("M ") || l.startsWith("MM")).length;
  const untracked = lines.filter((l) => l.startsWith("??")).length;
  const other = lines.length - modified - untracked;

  let summary = "";
  if (modified > 0) summary += `${modified} modified file(s)`;
  if (untracked > 0) summary += `${summary ? ", " : ""}${untracked} untracked file(s)`;
  if (other > 0) summary += `${summary ? ", " : ""}${other} other change(s)`;

  notify("Working tree is dirty — action required", { notify: config.notify });
  const result = await promptGate(
    `Working tree is dirty:\n  - ${summary}\nGenerator will modify files and commit. Uncommitted changes may be mixed into its commits.`,
    [
      { key: "c", label: "Continue anyway", isDefault: true },
      { key: "s", label: "Stash changes first (git stash), then continue", isDefault: false },
      { key: "a", label: "Abort", isDefault: false },
    ],
    0, // No timeout — blocking pre-flight check
    config.interactive,
  );

  if (result.key === "a") {
    log("HARNESS", "Aborted by user.");
    throw new UserAbortError("Dirty tree check aborted");
  }
  if (result.key === "s") {
    execSync("git stash", { cwd: config.workDir, stdio: "pipe" });
    log("HARNESS", "Changes stashed. Recover with: git stash pop");
  }
}
