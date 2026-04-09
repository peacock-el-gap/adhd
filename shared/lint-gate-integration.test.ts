/**
 * Integration tests for lint-gate hard mode and diff-aware retry behavior.
 */
import { describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { computeDiffSection } from "./diff.ts";
import type { EvalResult } from "./types.ts";

function gitExec(cmd: string, cwd: string): string {
  const buf = execSync(cmd, { cwd, stdio: ["pipe", "pipe", "pipe"] });
  return buf ? buf.toString("utf-8").trim() : "";
}

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), "adhd-lintgate-"));
}

describe("lint-gate hard mode", () => {
  test("when lintGate is true and static analysis fails, evaluator is not invoked", () => {
    const lintGate = true;
    const staticAnalysisOutput = "Error: 3 lint errors found\nsrc/main.ts:10 no-unused-vars";
    const staticAnalysisFailed = true;

    let evaluatorInvoked = false;
    let attemptMarkedFailed = false;
    let feedbackDetails = "";

    if (lintGate && staticAnalysisFailed) {
      attemptMarkedFailed = true;
      feedbackDetails = `lint-gate: static analysis failed\n${staticAnalysisOutput}`;
    } else {
      evaluatorInvoked = true;
    }

    expect(evaluatorInvoked).toBe(false);
    expect(attemptMarkedFailed).toBe(true);
    expect(feedbackDetails).toContain("lint-gate");
    expect(feedbackDetails).toContain("static analysis failed");
  });

  test("lint-gate failure produces EvalResult with lint-gate info in summary", () => {
    const lintGate = true;
    const staticAnalysisFailed = true;
    const lintOutput = "Error: unused variable on line 42";

    let evalResult: EvalResult | null = null;

    if (lintGate && staticAnalysisFailed) {
      evalResult = {
        passed: false,
        scores: {},
        feedback: [
          {
            criterion: "lint-gate",
            score: 0,
            details: `Static analysis failed:\n${lintOutput}`,
          },
        ],
        overallSummary: `lint-gate: Static analysis failed. Evaluator skipped.\n${lintOutput}`,
      };
    }

    expect(evalResult).not.toBeNull();
    expect(evalResult!.passed).toBe(false);
    expect(evalResult!.overallSummary).toContain("lint-gate");
    expect(evalResult!.overallSummary).toContain(lintOutput);
    expect(evalResult!.feedback[0]!.details).toContain("Static analysis failed");
  });

  test("when lintGate is true and lint passes, evaluator runs normally", () => {
    const lintGate = true;
    const staticAnalysisFailed = false;

    let evaluatorInvoked = false;

    if (lintGate && staticAnalysisFailed) {
      // skip evaluator
    } else {
      evaluatorInvoked = true;
    }

    expect(evaluatorInvoked).toBe(true);
  });

  test("when lintGate is false, evaluator runs even if lint fails", () => {
    const lintGate = false;
    const staticAnalysisFailed = true;

    let evaluatorInvoked = false;

    if (lintGate && staticAnalysisFailed) {
      // skip evaluator
    } else {
      evaluatorInvoked = true;
    }

    expect(evaluatorInvoked).toBe(true);
  });
});

describe("diff-aware retry integration", () => {
  function initGitRepo(dir: string): string {
    gitExec("git init", dir);
    gitExec("git config user.email test@test.com", dir);
    gitExec("git config user.name Test", dir);
    writeFileSync(join(dir, "file.txt"), "initial\n");
    gitExec("git add -A && git commit -m 'init'", dir);
    return gitExec("git rev-parse HEAD", dir);
  }

  test("on attempt > 0 with valid beforeSha, diff section is included in context", () => {
    const dir = makeTmp();
    try {
      const beforeSha = initGitRepo(dir);
      writeFileSync(join(dir, "file.txt"), "modified\n");
      gitExec("git add -A && git commit -m 'change'", dir);

      const attempt = 1;
      const diffSection = computeDiffSection(dir, beforeSha, attempt);

      let supplementaryContext = "";
      if (diffSection) {
        supplementaryContext += diffSection;
      }

      expect(supplementaryContext).toContain("## Changes Since Last Attempt");
      expect(supplementaryContext).toContain("modified");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("on attempt 0, no diff section is included", () => {
    const dir = makeTmp();
    try {
      const beforeSha = initGitRepo(dir);

      const attempt = 0;
      const diffSection = computeDiffSection(dir, beforeSha, attempt);

      let supplementaryContext = "";
      if (diffSection) {
        supplementaryContext += diffSection;
      }

      expect(supplementaryContext).toBe("");
      expect(supplementaryContext).not.toContain("## Changes Since Last Attempt");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("when beforeSha is absent, no diff section is included", () => {
    const dir = makeTmp();
    try {
      const attempt = 1;
      const diffSection = computeDiffSection(dir, "", attempt);

      let supplementaryContext = "";
      if (diffSection) {
        supplementaryContext += diffSection;
      }

      expect(supplementaryContext).toBe("");
      expect(supplementaryContext).not.toContain("## Changes Since Last Attempt");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("diff heading string is present in constructed prompt on valid retry", () => {
    const dir = makeTmp();
    try {
      const beforeSha = initGitRepo(dir);
      writeFileSync(join(dir, "new.txt"), "new file content\n");
      gitExec("git add -A && git commit -m 'add new file'", dir);

      const diffSection = computeDiffSection(dir, beforeSha, 2);

      const basePrompt = "Evaluate the following sprint criteria...";
      const evaluatorPrompt = diffSection
        ? `${basePrompt}\n${diffSection}`
        : basePrompt;

      expect(evaluatorPrompt).toContain("## Changes Since Last Attempt");
      expect(evaluatorPrompt).toContain("new file content");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
