import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { gitDir } from "../files.ts";
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
 * Commit .adhd/ metadata after a sprint passes evaluation.
 * Only invoked when --commit-adhd or --commit-adhd-logs is set.
 *
 * Commits .adhd/contracts/, .adhd/feedback/, .adhd/progress.json, and .adhd/spec.md.
 * When includeLogs is true, also commits .adhd/logs/.
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

    // Stage specific metadata paths
    const pathsToStage = [".adhd/contracts/", ".adhd/feedback/", ".adhd/progress.json", ".adhd/spec.md"];
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

    // Check if there's anything staged
    const stagedResult = execSync("git diff --cached --name-only", { cwd: gDir, encoding: "utf-8" });
    const staged = (stagedResult ?? "").toString().trim();
    if (!staged) return;

    execSync(`git commit -m "[adhd] Sprint ${sprint}: contract + metadata"`, { cwd: gDir, stdio: "pipe" });
    log("HARNESS", `Committed .adhd/ metadata for sprint ${sprint}${includeLogs ? " (including logs)" : ""}`);
  } catch (err) {
    logError("HARNESS", `Failed to commit .adhd/ metadata: ${err instanceof Error ? err.message : String(err)}`);
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
