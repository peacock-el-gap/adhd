import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { gitDir } from "../files.ts";
import { promptGate } from "../interaction.ts";
import { log, logError } from "../logger.ts";
import { notify } from "../notifications.ts";
import type { HarnessProgress, ResolvedConfig } from "../types.ts";
import { UserAbortError } from "./error-handling.ts";

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
