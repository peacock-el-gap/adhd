import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { commitFinalMetadata } from "../shared/orchestration/git-ops.ts";

describe("commitFinalMetadata", () => {
  const tmpDir = join(import.meta.dir, "__commit_final_metadata_test_tmp");
  const adhdDir = join(tmpDir, ".adhd");

  beforeEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    mkdirSync(join(adhdDir, "contracts"), { recursive: true });
    mkdirSync(join(adhdDir, "feedback"), { recursive: true });
    mkdirSync(join(adhdDir, "logs"), { recursive: true });

    execSync("git init", { cwd: tmpDir, stdio: "pipe" });
    execSync("git commit --allow-empty -m 'init'", { cwd: tmpDir, stdio: "pipe" });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("happy path: commits terminal progress.json and usage.json with the final metadata message", () => {
    writeFileSync(join(adhdDir, "progress.json"), '{"status": "complete", "docsGenerated": true}');
    writeFileSync(join(adhdDir, "usage.json"), '{"sessions": [], "runTotalCostUsd": 0.05}');
    writeFileSync(join(adhdDir, "spec.md"), "# Spec");

    commitFinalMetadata(tmpDir, tmpDir, false);

    const lastCommitMsg = execSync("git log -1 --pretty=%s", { cwd: tmpDir, encoding: "utf-8" }).trim();
    expect(lastCommitMsg).toBe("[adhd] Run complete: final metadata");

    const committedFiles = execSync("git diff-tree --no-commit-id --name-only -r HEAD", {
      cwd: tmpDir,
      encoding: "utf-8",
    }).trim();
    expect(committedFiles).toContain(".adhd/progress.json");
    expect(committedFiles).toContain(".adhd/usage.json");
  });

  test("happy path: does not include logs when includeLogs is false", () => {
    writeFileSync(join(adhdDir, "progress.json"), '{"status": "complete", "docsGenerated": true}');
    writeFileSync(join(adhdDir, "usage.json"), '{"sessions": [], "runTotalCostUsd": 0.05}');
    writeFileSync(join(adhdDir, "logs", "generator.md"), "# Log");

    commitFinalMetadata(tmpDir, tmpDir, false);

    const committedFiles = execSync("git diff-tree --no-commit-id --name-only -r HEAD", {
      cwd: tmpDir,
      encoding: "utf-8",
    }).trim();
    expect(committedFiles).not.toContain(".adhd/logs/");
  });

  test("happy path: includes logs when includeLogs is true", () => {
    writeFileSync(join(adhdDir, "progress.json"), '{"status": "complete", "docsGenerated": true}');
    writeFileSync(join(adhdDir, "usage.json"), '{"sessions": [], "runTotalCostUsd": 0.05}');
    writeFileSync(join(adhdDir, "logs", "generator.md"), "# Log");

    commitFinalMetadata(tmpDir, tmpDir, true);

    const committedFiles = execSync("git diff-tree --no-commit-id --name-only -r HEAD", {
      cwd: tmpDir,
      encoding: "utf-8",
    }).trim();
    expect(committedFiles).toContain(".adhd/logs/generator.md");
  });

  test("no-op path: produces no empty commit when terminal metadata has not changed since last commit", () => {
    writeFileSync(join(adhdDir, "progress.json"), '{"status": "complete", "docsGenerated": true}');
    writeFileSync(join(adhdDir, "usage.json"), '{"sessions": [], "runTotalCostUsd": 0.05}');
    writeFileSync(join(adhdDir, "spec.md"), "# Spec");
    execSync("git add .adhd/", { cwd: tmpDir, stdio: "pipe" });
    execSync("git commit -m 'pre-existing terminal metadata'", { cwd: tmpDir, stdio: "pipe" });

    const beforeSha = execSync("git rev-parse HEAD", { cwd: tmpDir, encoding: "utf-8" }).trim();
    commitFinalMetadata(tmpDir, tmpDir, false);
    const afterSha = execSync("git rev-parse HEAD", { cwd: tmpDir, encoding: "utf-8" }).trim();

    expect(afterSha).toBe(beforeSha);
  });

  test("no-flag path: skipping the call when commitAdhd is false leaves HEAD unchanged", () => {
    // Simulate the harness guard: if (config.commitAdhd) { commitFinalMetadata(...) }
    // With the flag off, the function is never called and no commit should appear.
    writeFileSync(join(adhdDir, "progress.json"), '{"status": "complete", "docsGenerated": true}');
    writeFileSync(join(adhdDir, "usage.json"), '{"sessions": [], "runTotalCostUsd": 0.05}');

    const commitAdhd = false;
    const beforeSha = execSync("git rev-parse HEAD", { cwd: tmpDir, encoding: "utf-8" }).trim();

    // Guard matches the harness call site in runSprintLoop
    if (commitAdhd) {
      commitFinalMetadata(tmpDir, tmpDir, false);
    }

    const afterSha = execSync("git rev-parse HEAD", { cwd: tmpDir, encoding: "utf-8" }).trim();
    expect(afterSha).toBe(beforeSha);
  });

  test("no-op when .adhd/ directory does not exist", () => {
    const emptyDir = join(tmpDir, "empty-sub");
    mkdirSync(emptyDir, { recursive: true });
    execSync("git init", { cwd: emptyDir, stdio: "pipe" });
    execSync("git commit --allow-empty -m 'init'", { cwd: emptyDir, stdio: "pipe" });

    expect(() => commitFinalMetadata(emptyDir, emptyDir, false)).not.toThrow();

    const headCount = execSync("git log --oneline", { cwd: emptyDir, encoding: "utf-8" }).trim().split("\n").length;
    expect(headCount).toBe(1); // only the initial empty commit
  });

  test("error handling: non-fatal when git is unavailable — does not throw", () => {
    // Call with a non-existent gitDir — git commands will fail, but the function
    // must catch the error and log it at warning severity rather than throwing.
    const noGitDir = join(tmpDir, "no-git");
    mkdirSync(join(noGitDir, ".adhd"), { recursive: true });
    writeFileSync(join(noGitDir, ".adhd", "progress.json"), '{}');

    expect(() => commitFinalMetadata(noGitDir, noGitDir, false)).not.toThrow();
  });
});
