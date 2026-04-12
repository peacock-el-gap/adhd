import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { commitAdhdMetadata } from "../shared/orchestration/git-ops.ts";

describe("commitAdhdMetadata", () => {
  const tmpDir = join(import.meta.dir, "__commit_adhd_test_tmp");
  const adhdDir = join(tmpDir, ".adhd");

  beforeEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    mkdirSync(join(adhdDir, "contracts"), { recursive: true });
    mkdirSync(join(adhdDir, "feedback"), { recursive: true });
    mkdirSync(join(adhdDir, "logs"), { recursive: true });

    // Init git repo
    execSync("git init", { cwd: tmpDir, stdio: "pipe" });
    execSync("git commit --allow-empty -m 'init'", { cwd: tmpDir, stdio: "pipe" });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("commits metadata files with correct message format", () => {
    // Create metadata files
    writeFileSync(join(adhdDir, "contracts", "sprint-2.json"), '{"test": true}');
    writeFileSync(join(adhdDir, "progress.json"), '{"status": "building"}');
    writeFileSync(join(adhdDir, "spec.md"), "# Test Spec");

    commitAdhdMetadata(tmpDir, tmpDir, 2, false);

    // Check commit message
    const lastCommitMsg = execSync("git log -1 --pretty=%s", { cwd: tmpDir, encoding: "utf-8" }).trim();
    expect(lastCommitMsg).toBe("[adhd] Sprint 2: contract + metadata");

    // Check committed files
    const committedFiles = execSync("git diff-tree --no-commit-id --name-only -r HEAD", {
      cwd: tmpDir,
      encoding: "utf-8",
    }).trim();
    expect(committedFiles).toContain(".adhd/contracts/sprint-2.json");
    expect(committedFiles).toContain(".adhd/progress.json");
    expect(committedFiles).toContain(".adhd/spec.md");
    // Should NOT include logs
    expect(committedFiles).not.toContain(".adhd/logs/");
  });

  test("includes logs when includeLogs is true", () => {
    writeFileSync(join(adhdDir, "contracts", "sprint-1.json"), '{"test": true}');
    writeFileSync(join(adhdDir, "progress.json"), '{"status": "building"}');
    writeFileSync(join(adhdDir, "spec.md"), "# Test Spec");
    writeFileSync(join(adhdDir, "logs", "generator.md"), "# Log");

    commitAdhdMetadata(tmpDir, tmpDir, 1, true);

    const committedFiles = execSync("git diff-tree --no-commit-id --name-only -r HEAD", {
      cwd: tmpDir,
      encoding: "utf-8",
    }).trim();
    expect(committedFiles).toContain(".adhd/logs/generator.md");
  });

  test("no-op when no .adhd/ directory exists", () => {
    const emptyDir = join(tmpDir, "empty-sub");
    mkdirSync(emptyDir, { recursive: true });
    execSync("git init", { cwd: emptyDir, stdio: "pipe" });
    execSync("git commit --allow-empty -m 'init'", { cwd: emptyDir, stdio: "pipe" });

    // Should not throw
    expect(() => commitAdhdMetadata(emptyDir, emptyDir, 1, false)).not.toThrow();
  });

  test("no-op when nothing to commit", () => {
    // .adhd/ exists but all files already committed
    writeFileSync(join(adhdDir, "spec.md"), "# Test");
    execSync("git add .adhd/", { cwd: tmpDir, stdio: "pipe" });
    execSync("git commit -m 'existing'", { cwd: tmpDir, stdio: "pipe" });

    const beforeSha = execSync("git rev-parse HEAD", { cwd: tmpDir, encoding: "utf-8" }).trim();
    commitAdhdMetadata(tmpDir, tmpDir, 1, false);
    const afterSha = execSync("git rev-parse HEAD", { cwd: tmpDir, encoding: "utf-8" }).trim();

    // No new commit should be created
    expect(afterSha).toBe(beforeSha);
  });
});
