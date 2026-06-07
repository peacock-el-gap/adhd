import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { commitAdhdMetadata, commitFinalMetadata } from "../shared/orchestration/git-ops.ts";

/**
 * Tests for the extended Tier-A metadata path set (OPP-54 Sprint 4).
 *
 * Validates that:
 * - regression.json, reviews/, scout-digest.json, baseline-verification-*.json
 *   are staged and committed under --commit-adhd
 * - runs/, skills/, and .env are never committed under any flag
 * - Tier-B adds only logs/ on top of Tier-A
 * - Missing paths are skipped silently
 */

function initTestRepo(dir: string): void {
  mkdirSync(dir, { recursive: true });
  execSync("git init", { cwd: dir, stdio: "pipe" });
  execSync("git commit --allow-empty -m 'init'", { cwd: dir, stdio: "pipe" });
}

function getCommittedFiles(dir: string): string {
  return execSync("git diff-tree --no-commit-id --name-only -r HEAD", {
    cwd: dir,
    encoding: "utf-8",
  }).trim();
}

function getHeadSha(dir: string): string {
  return execSync("git rev-parse HEAD", { cwd: dir, encoding: "utf-8" }).trim();
}

describe("Tier-A metadata paths — commitAdhdMetadata", () => {
  const tmpDir = join(import.meta.dir, "__tier_a_commit_adhd_tmp");
  const adhdDir = join(tmpDir, ".adhd");

  beforeEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    mkdirSync(join(adhdDir, "contracts"), { recursive: true });
    mkdirSync(join(adhdDir, "feedback"), { recursive: true });
    mkdirSync(join(adhdDir, "reviews"), { recursive: true });
    mkdirSync(join(adhdDir, "logs"), { recursive: true });
    mkdirSync(join(adhdDir, "runs"), { recursive: true });
    mkdirSync(join(adhdDir, "skills"), { recursive: true });
    initTestRepo(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("stages and commits regression.json alongside core metadata", () => {
    writeFileSync(join(adhdDir, "contracts", "sprint-1.json"), "{}");
    writeFileSync(join(adhdDir, "regression.json"), '{"suites": []}');

    commitAdhdMetadata(tmpDir, tmpDir, 1, false);

    const files = getCommittedFiles(tmpDir);
    expect(files).toContain(".adhd/regression.json");
    expect(files).toContain(".adhd/contracts/sprint-1.json");
  });

  test("stages and commits reviews/ directory", () => {
    writeFileSync(join(adhdDir, "reviews", "sprint-1.md"), "# Review");
    writeFileSync(join(adhdDir, "spec.md"), "# Spec");

    commitAdhdMetadata(tmpDir, tmpDir, 1, false);

    const files = getCommittedFiles(tmpDir);
    expect(files).toContain(".adhd/reviews/sprint-1.md");
  });

  test("stages and commits scout-digest.json", () => {
    writeFileSync(join(adhdDir, "scout-digest.json"), '{"digest": "test"}');
    writeFileSync(join(adhdDir, "spec.md"), "# Spec");

    commitAdhdMetadata(tmpDir, tmpDir, 1, false);

    const files = getCommittedFiles(tmpDir);
    expect(files).toContain(".adhd/scout-digest.json");
  });

  test("stages and commits baseline-verification-*.json glob", () => {
    writeFileSync(join(adhdDir, "baseline-verification-sprint1.json"), '{"pass": true}');
    writeFileSync(join(adhdDir, "baseline-verification-sprint2.json"), '{"pass": false}');
    writeFileSync(join(adhdDir, "spec.md"), "# Spec");

    commitAdhdMetadata(tmpDir, tmpDir, 1, false);

    const files = getCommittedFiles(tmpDir);
    expect(files).toContain(".adhd/baseline-verification-sprint1.json");
    expect(files).toContain(".adhd/baseline-verification-sprint2.json");
  });

  test("all four new Tier-A families present together are committed", () => {
    writeFileSync(join(adhdDir, "contracts", "sprint-1.json"), "{}");
    writeFileSync(join(adhdDir, "progress.json"), "{}");
    writeFileSync(join(adhdDir, "spec.md"), "# Spec");
    writeFileSync(join(adhdDir, "usage.json"), "{}");
    writeFileSync(join(adhdDir, "regression.json"), "{}");
    writeFileSync(join(adhdDir, "reviews", "sprint-1.md"), "# Review");
    writeFileSync(join(adhdDir, "scout-digest.json"), "{}");
    writeFileSync(join(adhdDir, "baseline-verification-sprint1.json"), "{}");

    commitAdhdMetadata(tmpDir, tmpDir, 1, false);

    const files = getCommittedFiles(tmpDir);
    // Original Tier-A
    expect(files).toContain(".adhd/contracts/sprint-1.json");
    expect(files).toContain(".adhd/progress.json");
    expect(files).toContain(".adhd/spec.md");
    expect(files).toContain(".adhd/usage.json");
    // New Tier-A additions
    expect(files).toContain(".adhd/regression.json");
    expect(files).toContain(".adhd/reviews/sprint-1.md");
    expect(files).toContain(".adhd/scout-digest.json");
    expect(files).toContain(".adhd/baseline-verification-sprint1.json");
  });

  test("runs/ is never committed even when present on disk", () => {
    writeFileSync(join(adhdDir, "runs", "run-001.json"), '{"run": 1}');
    writeFileSync(join(adhdDir, "spec.md"), "# Spec");

    commitAdhdMetadata(tmpDir, tmpDir, 1, false);

    const files = getCommittedFiles(tmpDir);
    expect(files).not.toContain(".adhd/runs/");
    expect(files).not.toContain("run-001.json");
  });

  test("skills/ is never committed even when present on disk", () => {
    writeFileSync(join(adhdDir, "skills", "skill.md"), "# Skill");
    writeFileSync(join(adhdDir, "spec.md"), "# Spec");

    commitAdhdMetadata(tmpDir, tmpDir, 1, false);

    const files = getCommittedFiles(tmpDir);
    expect(files).not.toContain(".adhd/skills/");
    expect(files).not.toContain("skill.md");
  });

  test(".env is never committed even when present on disk", () => {
    writeFileSync(join(adhdDir, ".env"), "SECRET=foo");
    writeFileSync(join(adhdDir, "spec.md"), "# Spec");

    commitAdhdMetadata(tmpDir, tmpDir, 1, false);

    const files = getCommittedFiles(tmpDir);
    expect(files).not.toContain(".env");
  });

  test("runs/ is never committed even under --commit-adhd-logs (Tier B)", () => {
    writeFileSync(join(adhdDir, "runs", "run-001.json"), '{"run": 1}');
    writeFileSync(join(adhdDir, "logs", "gen.md"), "# Log");
    writeFileSync(join(adhdDir, "spec.md"), "# Spec");

    commitAdhdMetadata(tmpDir, tmpDir, 1, true);

    const files = getCommittedFiles(tmpDir);
    expect(files).toContain(".adhd/logs/gen.md");
    expect(files).not.toContain(".adhd/runs/");
    expect(files).not.toContain("run-001.json");
  });

  test("skills/ is never committed even under --commit-adhd-logs (Tier B)", () => {
    writeFileSync(join(adhdDir, "skills", "skill.md"), "# Skill");
    writeFileSync(join(adhdDir, "logs", "gen.md"), "# Log");
    writeFileSync(join(adhdDir, "spec.md"), "# Spec");

    commitAdhdMetadata(tmpDir, tmpDir, 1, true);

    const files = getCommittedFiles(tmpDir);
    expect(files).toContain(".adhd/logs/gen.md");
    expect(files).not.toContain(".adhd/skills/");
  });

  test("Tier-B commits full Tier-A set plus logs/ and nothing else", () => {
    writeFileSync(join(adhdDir, "contracts", "sprint-1.json"), "{}");
    writeFileSync(join(adhdDir, "feedback", "sprint-1.json"), "{}");
    writeFileSync(join(adhdDir, "progress.json"), "{}");
    writeFileSync(join(adhdDir, "spec.md"), "# Spec");
    writeFileSync(join(adhdDir, "usage.json"), "{}");
    writeFileSync(join(adhdDir, "regression.json"), "{}");
    writeFileSync(join(adhdDir, "reviews", "sprint-1.md"), "# Review");
    writeFileSync(join(adhdDir, "scout-digest.json"), "{}");
    writeFileSync(join(adhdDir, "baseline-verification-sprint1.json"), "{}");
    writeFileSync(join(adhdDir, "logs", "gen.md"), "# Log");
    // These should never be committed
    writeFileSync(join(adhdDir, "runs", "run-001.json"), "{}");
    writeFileSync(join(adhdDir, "skills", "skill.md"), "# Skill");

    commitAdhdMetadata(tmpDir, tmpDir, 1, true);

    const files = getCommittedFiles(tmpDir);
    // All Tier-A present
    expect(files).toContain(".adhd/contracts/sprint-1.json");
    expect(files).toContain(".adhd/feedback/sprint-1.json");
    expect(files).toContain(".adhd/progress.json");
    expect(files).toContain(".adhd/spec.md");
    expect(files).toContain(".adhd/usage.json");
    expect(files).toContain(".adhd/regression.json");
    expect(files).toContain(".adhd/reviews/sprint-1.md");
    expect(files).toContain(".adhd/scout-digest.json");
    expect(files).toContain(".adhd/baseline-verification-sprint1.json");
    // Plus logs
    expect(files).toContain(".adhd/logs/gen.md");
    // Never committed
    expect(files).not.toContain(".adhd/runs/");
    expect(files).not.toContain(".adhd/skills/");
  });

  test("missing new Tier-A paths are skipped silently and commit succeeds", () => {
    // Only spec.md present — all four new paths are missing
    writeFileSync(join(adhdDir, "spec.md"), "# Spec");

    expect(() => commitAdhdMetadata(tmpDir, tmpDir, 1, false)).not.toThrow();

    const files = getCommittedFiles(tmpDir);
    expect(files).toContain(".adhd/spec.md");
  });

  test("no commit when nothing is staged (all paths missing except directory stubs)", () => {
    // .adhd/ exists but no files inside the staged families
    const beforeSha = getHeadSha(tmpDir);
    commitAdhdMetadata(tmpDir, tmpDir, 1, false);
    const afterSha = getHeadSha(tmpDir);

    expect(afterSha).toBe(beforeSha);
  });
});

describe("Tier-A metadata paths — commitFinalMetadata", () => {
  const tmpDir = join(import.meta.dir, "__tier_a_commit_final_tmp");
  const adhdDir = join(tmpDir, ".adhd");

  beforeEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    mkdirSync(join(adhdDir, "contracts"), { recursive: true });
    mkdirSync(join(adhdDir, "feedback"), { recursive: true });
    mkdirSync(join(adhdDir, "reviews"), { recursive: true });
    mkdirSync(join(adhdDir, "logs"), { recursive: true });
    mkdirSync(join(adhdDir, "runs"), { recursive: true });
    mkdirSync(join(adhdDir, "skills"), { recursive: true });
    initTestRepo(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("commits new Tier-A families in the final metadata commit", () => {
    writeFileSync(join(adhdDir, "progress.json"), '{"status": "complete"}');
    writeFileSync(join(adhdDir, "usage.json"), "{}");
    writeFileSync(join(adhdDir, "regression.json"), "{}");
    writeFileSync(join(adhdDir, "reviews", "sprint-1.md"), "# Review");
    writeFileSync(join(adhdDir, "scout-digest.json"), "{}");
    writeFileSync(join(adhdDir, "baseline-verification-sprint1.json"), "{}");

    commitFinalMetadata(tmpDir, tmpDir, false);

    const files = getCommittedFiles(tmpDir);
    expect(files).toContain(".adhd/regression.json");
    expect(files).toContain(".adhd/reviews/sprint-1.md");
    expect(files).toContain(".adhd/scout-digest.json");
    expect(files).toContain(".adhd/baseline-verification-sprint1.json");
  });

  test("runs/ and skills/ are never committed in final metadata", () => {
    writeFileSync(join(adhdDir, "progress.json"), "{}");
    writeFileSync(join(adhdDir, "runs", "run-001.json"), "{}");
    writeFileSync(join(adhdDir, "skills", "skill.md"), "# Skill");

    commitFinalMetadata(tmpDir, tmpDir, false);

    const files = getCommittedFiles(tmpDir);
    expect(files).not.toContain(".adhd/runs/");
    expect(files).not.toContain(".adhd/skills/");
  });

  test("no-flags path: not calling the function leaves HEAD unchanged", () => {
    writeFileSync(join(adhdDir, "progress.json"), "{}");
    writeFileSync(join(adhdDir, "regression.json"), "{}");

    const commitAdhd = false;
    const beforeSha = getHeadSha(tmpDir);

    if (commitAdhd) {
      commitFinalMetadata(tmpDir, tmpDir, false);
    }

    const afterSha = getHeadSha(tmpDir);
    expect(afterSha).toBe(beforeSha);
  });
});
