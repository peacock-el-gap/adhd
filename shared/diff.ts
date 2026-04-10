import { execSync } from "node:child_process";

const MAX_DIFF_CHARS = 8000;

/**
 * Compute a git diff between a previous SHA and the current HEAD.
 * Returns undefined if the diff should be skipped (attempt 0, no beforeSha, git failure, etc.).
 * Returns a formatted "## Changes Since Last Attempt" section string for injection into
 * the Evaluator's supplementaryContext.
 * @param workDir - The project root directory (must be a git repository)
 * @param beforeSha - The git SHA of the previous attempt's commit
 * @param attempt - The current attempt number (0-based; skips diff on attempt 0)
 * @returns Formatted diff section string, or undefined if diff should be skipped
 */
export function computeDiffSection(workDir: string, beforeSha: string, attempt: number): string | undefined {
  // Skip on first attempt
  if (attempt <= 0) return undefined;

  // Skip if no beforeSha
  if (!beforeSha || beforeSha.trim() === "") return undefined;

  let diffOutput: string;
  try {
    diffOutput = execSync(`git diff ${beforeSha}..HEAD`, {
      cwd: workDir,
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
    });
  } catch {
    // Git not available, bad SHA, or other failure — graceful degradation
    return undefined;
  }

  // Handle empty diff
  if (!diffOutput || diffOutput.trim() === "") {
    return "\n\n## Changes Since Last Attempt\n\n[No changes detected]";
  }

  // Truncate if needed
  let body: string;
  if (diffOutput.length > MAX_DIFF_CHARS) {
    body = `${diffOutput.slice(0, MAX_DIFF_CHARS)}\n[diff truncated — showing first ${MAX_DIFF_CHARS} chars of ${diffOutput.length} total]`;
  } else {
    body = diffOutput;
  }

  return `\n\n## Changes Since Last Attempt\n\n${body}`;
}
