import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { computeChangedFiles, computeDiffSection } from "../shared/diff.ts";

const TMP_DIR = join(import.meta.dir, "__tmp_diff_test__");

beforeEach(() => {
  mkdirSync(TMP_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TMP_DIR, { recursive: true, force: true });
});

/** Helper to set up a git repo and return the initial SHA */
function initGitRepo(): string {
  execSync("git init", { cwd: TMP_DIR });
  execSync("git config user.email test@test.com", { cwd: TMP_DIR });
  execSync("git config user.name Test", { cwd: TMP_DIR });
  writeFileSync(join(TMP_DIR, "file.txt"), "initial content\n");
  execSync("git add -A && git commit -m 'init'", { cwd: TMP_DIR });
  return execSync("git rev-parse HEAD", { cwd: TMP_DIR, encoding: "utf-8" }).trim();
}

describe("computeDiffSection", () => {
  test("returns undefined on attempt 0 (first attempt)", () => {
    const result = computeDiffSection(TMP_DIR, "abc123", 0);
    expect(result).toBeUndefined();
  });

  test("returns undefined when beforeSha is empty string", () => {
    const result = computeDiffSection(TMP_DIR, "", 1);
    expect(result).toBeUndefined();
  });

  test("returns undefined when beforeSha is whitespace only", () => {
    const result = computeDiffSection(TMP_DIR, "   ", 1);
    expect(result).toBeUndefined();
  });

  test("returns undefined when git is not available (no git repo)", () => {
    // TMP_DIR has no git repo initialized
    const result = computeDiffSection(TMP_DIR, "abc123", 1);
    expect(result).toBeUndefined();
  });

  test("generates diff section with known beforeSha when changes exist", () => {
    const beforeSha = initGitRepo();
    // Make a change and commit
    writeFileSync(join(TMP_DIR, "file.txt"), "modified content\n");
    execSync("git add -A && git commit -m 'modify'", { cwd: TMP_DIR });

    const result = computeDiffSection(TMP_DIR, beforeSha, 1);
    expect(result).toBeDefined();
    expect(result).toContain("## Changes Since Last Attempt");
    expect(result).toContain("modified content");
    expect(result).toContain("-initial content");
  });

  test("handles empty diff (no changes since beforeSha)", () => {
    const sha = initGitRepo();
    // HEAD is still at sha, so diff is empty
    const result = computeDiffSection(TMP_DIR, sha, 1);
    expect(result).toBeDefined();
    expect(result).toContain("## Changes Since Last Attempt");
    expect(result).toContain("[No changes detected]");
    // Must not contain empty/whitespace-only diff block
    expect(result).not.toMatch(/## Changes Since Last Attempt\n\n\s*$/);
  });

  test("truncates diff output exceeding 8000 characters", () => {
    const beforeSha = initGitRepo();
    // Create a large file to generate a big diff
    const largeContent = "x".repeat(10000) + "\n";
    writeFileSync(join(TMP_DIR, "large.txt"), largeContent);
    execSync("git add -A && git commit -m 'large change'", { cwd: TMP_DIR });

    const result = computeDiffSection(TMP_DIR, beforeSha, 1);
    expect(result).toBeDefined();
    expect(result).toContain("## Changes Since Last Attempt");
    expect(result).toContain("[diff truncated");
    expect(result).toContain("showing first 8000 chars of");
  });

  test("graceful degradation with invalid SHA", () => {
    initGitRepo();
    const result = computeDiffSection(TMP_DIR, "invalid_sha_that_does_not_exist", 1);
    expect(result).toBeUndefined();
  });

  test("works with attempt > 1", () => {
    const beforeSha = initGitRepo();
    writeFileSync(join(TMP_DIR, "file.txt"), "attempt 3 changes\n");
    execSync("git add -A && git commit -m 'retry'", { cwd: TMP_DIR });

    const result = computeDiffSection(TMP_DIR, beforeSha, 3);
    expect(result).toBeDefined();
    expect(result).toContain("## Changes Since Last Attempt");
  });
});

describe("computeChangedFiles", () => {
  test("returns undefined on attempt 0 (first attempt)", () => {
    expect(computeChangedFiles(TMP_DIR, "abc123", 0)).toBeUndefined();
  });

  test("returns undefined when beforeSha is empty string", () => {
    expect(computeChangedFiles(TMP_DIR, "", 1)).toBeUndefined();
  });

  test("returns undefined when beforeSha is whitespace only", () => {
    expect(computeChangedFiles(TMP_DIR, "   ", 1)).toBeUndefined();
  });

  test("returns undefined when git is not available (no git repo)", () => {
    expect(computeChangedFiles(TMP_DIR, "abc123", 1)).toBeUndefined();
  });

  test("returns undefined with an invalid SHA (graceful degradation, no throw)", () => {
    initGitRepo();
    expect(() => computeChangedFiles(TMP_DIR, "invalid_sha_xyz", 1)).not.toThrow();
    expect(computeChangedFiles(TMP_DIR, "invalid_sha_xyz", 1)).toBeUndefined();
  });

  test("returns the list of changed paths between beforeSha and HEAD", () => {
    const beforeSha = initGitRepo();
    writeFileSync(join(TMP_DIR, "server.ts"), "export const x = 1;\n");
    writeFileSync(join(TMP_DIR, "README.md"), "# docs\n");
    execSync("git add -A && git commit -m 'add files'", { cwd: TMP_DIR });

    const result = computeChangedFiles(TMP_DIR, beforeSha, 1);
    expect(result).toBeDefined();
    expect(result).toContain("server.ts");
    expect(result).toContain("README.md");
  });

  test("returns an empty list when only .adhd/ metadata changed", () => {
    const beforeSha = initGitRepo();
    mkdirSync(join(TMP_DIR, ".adhd", "contracts"), { recursive: true });
    writeFileSync(join(TMP_DIR, ".adhd", "progress.json"), "{}\n");
    execSync("git add -A && git commit -m 'adhd metadata'", { cwd: TMP_DIR });

    const result = computeChangedFiles(TMP_DIR, beforeSha, 1);
    expect(result).toEqual([]);
  });

  test("excludes .adhd/ paths even when they would classify to a surface", () => {
    const beforeSha = initGitRepo();
    mkdirSync(join(TMP_DIR, ".adhd"), { recursive: true });
    // A .ts file under .adhd/ would classify as `backend` if not excluded.
    writeFileSync(join(TMP_DIR, ".adhd", "snapshot.ts"), "export const y = 2;\n");
    writeFileSync(join(TMP_DIR, "real.ts"), "export const z = 3;\n");
    execSync("git add -A && git commit -m 'mixed'", { cwd: TMP_DIR });

    const result = computeChangedFiles(TMP_DIR, beforeSha, 1);
    expect(result).toEqual(["real.ts"]);
    expect(result).not.toContain(".adhd/snapshot.ts");
  });
});
