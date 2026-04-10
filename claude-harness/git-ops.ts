import { execSync } from "node:child_process";
import { join } from "node:path";
import { promptGate } from "../shared/interaction.ts";
import { log, logError } from "../shared/logger.ts";
import type { HarnessProgress, ResolvedConfig } from "../shared/types.ts";
import { UserAbortError } from "./error-handling.ts";

export async function revertToCheckpoint(
  workDir: string,
  isGreenfield: boolean,
  progress: HarnessProgress,
): Promise<void> {
  const gitDir = isGreenfield ? join(workDir, "app") : workDir;
  const sha = progress.lastPassedCommitSha ?? "";

  try {
    const currentHead = execSync("git rev-parse HEAD", { cwd: gitDir, encoding: "utf-8" }).trim();
    if (currentHead === sha) {
      log("HARNESS", "HEAD matches checkpoint — no revert needed");
      return;
    }

    log("HARNESS", `Reverting commits after checkpoint ${sha.slice(0, 8)}...`);
    execSync(
      `git revert --no-commit ${sha}..HEAD && git commit -m "Revert incomplete sprint ${progress.completedSprints + 1} attempt"`,
      { cwd: gitDir, stdio: "pipe" },
    );
    log("HARNESS", "Revert successful");
  } catch (err) {
    // Revert failed (conflicts) — warn and continue
    logError("HARNESS", `Git revert failed (conflicts?). Continuing without revert. Error: ${err}`);
    try {
      execSync("git revert --abort", { cwd: gitDir, stdio: "ignore" });
    } catch {
      // Already clean
    }
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
