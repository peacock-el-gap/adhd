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

/**
 * True for harness metadata paths under `.adhd/`.
 *
 * The attempt loop captures `beforeSha` *before* committing the `.adhd/`
 * metadata, so the raw `beforeSha..HEAD` range always includes those metadata
 * files alongside the Generator's real code commit. They must be excluded so
 * the surface coverage check measures only product changes and the classifier
 * is never fooled by a metadata path (e.g. a `.adhd/*.ts` file that would
 * otherwise classify to a surface).
 */
function isAdhdMetadataPath(path: string): boolean {
  const normalized = path.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  return normalized === ".adhd" || normalized.startsWith(".adhd/");
}

/**
 * List the product files changed between a previous SHA and the current HEAD,
 * by name only (`git diff --name-only beforeSha..HEAD`). This is the
 * changed-file feed for the surface coverage gate — it answers "which files did
 * this attempt actually touch?" so the harness can compare them against the
 * surfaces the contract declared.
 *
 * Follows the exact graceful-degradation contract of {@link computeDiffSection}:
 * returns `undefined` on the first attempt (attempt 0), an empty/whitespace
 * `beforeSha`, or any git failure, and never throws. Harness metadata under
 * `.adhd/` is filtered out (see {@link isAdhdMetadataPath}); after filtering the
 * list may legitimately be empty (e.g. only `.adhd/` files changed), which the
 * caller treats the same as "nothing to check".
 *
 * @param workDir - The project root directory (must be a git repository)
 * @param beforeSha - The git SHA captured before the Generator ran
 * @param attempt - The current attempt number (0-based; skips on attempt 0)
 * @returns the list of changed product paths, or `undefined` when no list can
 *   be computed
 */
export function computeChangedFiles(workDir: string, beforeSha: string, attempt: number): string[] | undefined {
  // Skip on first attempt — mirrors computeDiffSection's degradation contract.
  if (attempt <= 0) return undefined;

  // Skip if no beforeSha
  if (!beforeSha || beforeSha.trim() === "") return undefined;

  let nameOnlyOutput: string;
  try {
    nameOnlyOutput = execSync(`git diff --name-only ${beforeSha}..HEAD`, {
      cwd: workDir,
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
    });
  } catch {
    // Git not available, bad SHA, or other failure — graceful degradation
    return undefined;
  }

  return nameOnlyOutput
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !isAdhdMetadataPath(line));
}
