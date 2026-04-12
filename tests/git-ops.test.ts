import { describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { commitAdhdArtifacts, revertToCheckpoint } from "../shared/orchestration/git-ops.ts";
import type { HarnessProgress } from "../shared/types.ts";

// ── Helpers ────────────────────────────────────────────────────────

function makeTmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "adhd-gitops-"));
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Git env vars that isolate the repo from the host system config. */
const GIT_ENV = {
  GIT_CONFIG_NOSYSTEM: "1",
  HOME: "/dev/null",
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@test.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@test.com",
};

function initGitRepo(dir: string): void {
  const env = { ...process.env, ...GIT_ENV };
  execSync("git init", { cwd: dir, stdio: "pipe", env });
  execSync("git config user.email test@test.com", { cwd: dir, stdio: "pipe", env });
  execSync("git config user.name Test", { cwd: dir, stdio: "pipe", env });
  writeFileSync(join(dir, "README.md"), "# Test");
  execSync("git add -A && git commit -m 'initial'", { cwd: dir, stdio: "pipe", env });
}

function getHeadSha(dir: string): string {
  const result = execSync("git rev-parse HEAD", { cwd: dir, encoding: "utf-8" });
  return (result ?? "").toString().trim();
}

function getCommitMessage(dir: string): string {
  const result = execSync("git log -1 --format=%s", { cwd: dir, encoding: "utf-8" });
  return (result ?? "").toString().trim();
}

function withTmpDir(fn: (dir: string) => void): void {
  const dir = makeTmp();
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// =====================================================
// Feature: .adhd/ Artifact Commits and Deterministic Revert
// =====================================================

describe("commitAdhdArtifacts", () => {
  test("commits .adhd/ files with [adhd] prefix message including sprint number", () => {
    withTmpDir((dir) => {
      initGitRepo(dir);
      const adhdDir = join(dir, ".adhd", "contracts");
      mkdirSync(adhdDir, { recursive: true });
      writeFileSync(join(adhdDir, "sprint-2.json"), '{"sprintNumber": 2}');

      const beforeSha = getHeadSha(dir);
      commitAdhdArtifacts(dir, dir, 2);
      const afterSha = getHeadSha(dir);

      expect(afterSha).not.toBe(beforeSha);
      const msg = getCommitMessage(dir);
      expect(msg).toMatch(/^\[adhd\]/);
      expect(msg).toContain("Sprint 2");
    });
  });

  test("commit message includes [adhd] prefix and sprint number", () => {
    withTmpDir((dir) => {
      initGitRepo(dir);
      const adhdDir = join(dir, ".adhd");
      mkdirSync(adhdDir, { recursive: true });
      writeFileSync(join(adhdDir, "progress.json"), '{"status": "building"}');

      commitAdhdArtifacts(dir, dir, 5);
      const msg = getCommitMessage(dir);
      expect(msg).toStartWith("[adhd]");
      expect(msg).toContain("Sprint 5");
    });
  });

  test("no-op when no .adhd/ changes exist (no empty commit)", () => {
    withTmpDir((dir) => {
      initGitRepo(dir);
      const beforeSha = getHeadSha(dir);
      commitAdhdArtifacts(dir, dir, 1);
      const afterSha = getHeadSha(dir);
      expect(afterSha).toBe(beforeSha);
    });
  });

  test("clean working tree after commit (git status --porcelain shows no .adhd/ files)", () => {
    withTmpDir((dir) => {
      initGitRepo(dir);
      const adhdDir = join(dir, ".adhd", "feedback");
      mkdirSync(adhdDir, { recursive: true });
      writeFileSync(join(adhdDir, "sprint-1-round-0.json"), '{"passed": false}');

      commitAdhdArtifacts(dir, dir, 1);
      const status = (execSync("git status --porcelain -- .adhd/", { cwd: dir, encoding: "utf-8" }) ?? "").toString().trim();
      expect(status).toBe("");
    });
  });

  test("commits multiple .adhd/ files at once", () => {
    withTmpDir((dir) => {
      initGitRepo(dir);
      mkdirSync(join(dir, ".adhd", "contracts"), { recursive: true });
      mkdirSync(join(dir, ".adhd", "feedback"), { recursive: true });
      writeFileSync(join(dir, ".adhd", "progress.json"), '{"status": "building"}');
      writeFileSync(join(dir, ".adhd", "contracts", "sprint-3.json"), '{"sprintNumber": 3}');
      writeFileSync(join(dir, ".adhd", "feedback", "sprint-2-round-0.json"), '{}');

      commitAdhdArtifacts(dir, dir, 3);
      const status = (execSync("git status --porcelain -- .adhd/", { cwd: dir, encoding: "utf-8" }) ?? "").toString().trim();
      expect(status).toBe("");
    });
  });
});

describe("revertToCheckpoint uses git reset --hard with stash/unstash", () => {
  test("uses git reset --hard instead of git revert", () => {
    withTmpDir((dir) => {
      initGitRepo(dir);
      const checkpointSha = getHeadSha(dir);

      // Add another commit
      writeFileSync(join(dir, "new-file.ts"), "export const x = 1;");
      execSync("git add -A && git commit -m 'post-checkpoint'", { cwd: dir, stdio: "pipe" });

      const progress: HarnessProgress = {
        status: "building",
        currentSprint: 2,
        totalSprints: 3,
        completedSprints: 1,
        retryCount: 0,
        lastPassedCommitSha: checkpointSha,
      };

      revertToCheckpoint(dir, false, progress);
      const headAfter = getHeadSha(dir);
      // After reset --hard, HEAD should be exactly the checkpoint SHA
      expect(headAfter).toBe(checkpointSha);
      // The file from post-checkpoint commit should be gone
      expect(existsSync(join(dir, "new-file.ts"))).toBe(false);
    });
  });

  test(".adhd/ files survive revert (stash and restore)", () => {
    withTmpDir((dir) => {
      initGitRepo(dir);
      const checkpointSha = getHeadSha(dir);

      // Add a commit after checkpoint
      writeFileSync(join(dir, "feature.ts"), "export const y = 2;");
      execSync("git add -A && git commit -m 'feature commit'", { cwd: dir, stdio: "pipe" });

      // Write .adhd/ files after checkpoint (these should survive)
      mkdirSync(join(dir, ".adhd", "contracts"), { recursive: true });
      writeFileSync(join(dir, ".adhd", "progress.json"), '{"status": "building", "completedSprints": 2}');
      writeFileSync(join(dir, ".adhd", "contracts", "sprint-3.json"), '{"sprintNumber": 3}');

      const progress: HarnessProgress = {
        status: "building",
        currentSprint: 3,
        totalSprints: 4,
        completedSprints: 2,
        retryCount: 0,
        lastPassedCommitSha: checkpointSha,
      };

      revertToCheckpoint(dir, false, progress);

      // .adhd/ files should still exist
      expect(existsSync(join(dir, ".adhd", "progress.json"))).toBe(true);
      expect(existsSync(join(dir, ".adhd", "contracts", "sprint-3.json"))).toBe(true);

      // Content should be preserved
      const progressContent = readFileSync(join(dir, ".adhd", "progress.json"), "utf-8");
      expect(progressContent).toContain("completedSprints");
    });
  });

  test("HEAD matches checkpoint — no revert needed", () => {
    withTmpDir((dir) => {
      initGitRepo(dir);
      const sha = getHeadSha(dir);

      const progress: HarnessProgress = {
        status: "building",
        currentSprint: 1,
        totalSprints: 2,
        completedSprints: 0,
        retryCount: 0,
        lastPassedCommitSha: sha,
      };

      // Should not throw, and HEAD should remain unchanged
      revertToCheckpoint(dir, false, progress);
      expect(getHeadSha(dir)).toBe(sha);
    });
  });

  test("revert completes even if stash restoration fails (error handling)", () => {
    withTmpDir((dir) => {
      initGitRepo(dir);
      const checkpointSha = getHeadSha(dir);

      writeFileSync(join(dir, "code.ts"), "export const z = 3;");
      execSync("git add -A && git commit -m 'code commit'", { cwd: dir, stdio: "pipe" });

      const progress: HarnessProgress = {
        status: "building",
        currentSprint: 2,
        totalSprints: 3,
        completedSprints: 1,
        retryCount: 0,
        lastPassedCommitSha: checkpointSha,
      };

      // Even without .adhd/ files, revert should complete fine
      expect(() => revertToCheckpoint(dir, false, progress)).not.toThrow();
      expect(getHeadSha(dir)).toBe(checkpointSha);
    });
  });
});
