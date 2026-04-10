import { describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeDiffSection } from "./diff.ts";

function gitExec(cmd: string, cwd: string): string {
  const buf = execSync(cmd, { cwd, stdio: ["pipe", "pipe", "pipe"] });
  return buf ? buf.toString("utf-8").trim() : "";
}

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), "adhd-diff-unit-"));
}

function initGitRepo(dir: string): string {
  gitExec("git init", dir);
  gitExec("git config user.email test@test.com", dir);
  gitExec("git config user.name Test", dir);
  writeFileSync(join(dir, "file.txt"), "initial content\n");
  gitExec("git add -A && git commit -m 'init'", dir);
  return gitExec("git rev-parse HEAD", dir);
}

describe("computeDiffSection", () => {
  test("returns undefined on attempt 0", () => {
    const dir = makeTmp();
    try {
      const result = computeDiffSection(dir, "abc123", 0);
      expect(result).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("returns undefined when beforeSha is empty", () => {
    const dir = makeTmp();
    try {
      const result = computeDiffSection(dir, "", 1);
      expect(result).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("returns undefined when beforeSha is whitespace only", () => {
    const dir = makeTmp();
    try {
      const result = computeDiffSection(dir, "   ", 1);
      expect(result).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("returns undefined when git fails (no git repo)", () => {
    const dir = makeTmp();
    try {
      // Ensure git can't find any repo by setting GIT_CEILING_DIRECTORIES
      const result = computeDiffSection(dir, "abc123", 1);
      expect(result).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("returns undefined when git fails (invalid SHA)", () => {
    const dir = makeTmp();
    try {
      initGitRepo(dir);
      const result = computeDiffSection(dir, "invalid_sha_that_does_not_exist", 1);
      expect(result).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("truncates diff at 8000 chars with correct warning format", () => {
    const dir = makeTmp();
    try {
      const beforeSha = initGitRepo(dir);
      const largeContent = `${"x".repeat(10000)}\n`;
      writeFileSync(join(dir, "large.txt"), largeContent);
      gitExec("git add -A && git commit -m 'large change'", dir);

      const result = computeDiffSection(dir, beforeSha, 1);
      expect(result).toBeDefined();
      expect(result).toContain("## Changes Since Last Attempt");
      expect(result).toContain("[diff truncated — showing first 8000 chars of");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("returns formatted section with correct heading on valid diff", () => {
    const dir = makeTmp();
    try {
      const beforeSha = initGitRepo(dir);
      writeFileSync(join(dir, "file.txt"), "modified content\n");
      gitExec("git add -A && git commit -m 'modify'", dir);

      const result = computeDiffSection(dir, beforeSha, 1);
      expect(result).toBeDefined();
      expect(result).toContain("## Changes Since Last Attempt");
      expect(result).toContain("modified content");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("returns no-changes message when diff is empty", () => {
    const dir = makeTmp();
    try {
      const sha = initGitRepo(dir);
      const result = computeDiffSection(dir, sha, 1);
      expect(result).toBeDefined();
      expect(result).toContain("[No changes detected]");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
