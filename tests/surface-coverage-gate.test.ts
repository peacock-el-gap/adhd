/**
 * Tests for the surface coverage gate (F3): the cheap, AI-free check that fails
 * an attempt before the Evaluator runs when the Generator left a declared
 * surface untouched.
 *
 * The orchestration loop in shared/orchestration/sprint-attempts.ts wires real
 * SDK agents through dependency injection, so these tests exercise the gate's
 * decision the same way lint-gate-integration.test.ts does: they drive the real
 * pure/IO helpers the gate is built from (computeChangedFiles,
 * checkSurfaceCoverage, buildSkippedEvaluatorResult) and assert the resulting
 * control flow — Evaluator skipped, EvalResult shape, retry-feedback handoff.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeChangedFilesSince } from "../shared/diff.ts";
import { buildSkippedEvaluatorResult } from "../shared/eval-result.ts";
import { checkSurfaceCoverage, normalizeSurfaces } from "../shared/surfaces.ts";
import type { EvalResult, SprintContract } from "../shared/types.ts";

// ── Helpers ────────────────────────────────────────────────────────

let dir: string;

function gitExec(cmd: string): string {
  return execSync(cmd, { cwd: dir, encoding: "utf-8" }).trim();
}

function initGitRepo(): string {
  gitExec("git init");
  gitExec("git config user.email test@test.com");
  gitExec("git config user.name Test");
  writeFileSync(join(dir, "seed.txt"), "seed\n");
  gitExec("git add -A && git commit -m init");
  return gitExec("git rev-parse HEAD");
}

function commitFile(relPath: string, content: string, message: string): void {
  const full = join(dir, relPath);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
  gitExec("git add -A");
  gitExec(`git commit -m '${message}'`);
}

const CONTRACT: SprintContract = {
  sprintNumber: 3,
  features: ["coverage gate"],
  surfaces: ["backend", "frontend"],
  criteria: [
    { name: "criterion_a", description: "a", threshold: 8 },
    { name: "criterion_b", description: "b", threshold: 7 },
  ],
};

/**
 * Mirror of the gate's control flow in sprint-attempts.ts. Coverage is measured
 * cumulatively from the sprint's base checkpoint (`sprintBaseSha`) across all
 * attempts so far, and attempt 0 is exempt (the Evaluator always runs first).
 * Returns whether the Evaluator would be invoked, plus the EvalResult written on
 * a coverage failure. `priorRealEval` is the last actual Evaluator result, which
 * the gate carries forward into a skip's feedback (Fix #2).
 */
function runCoverageGate(
  contract: SprintContract,
  sprintBaseSha: string,
  attempt: number,
  priorRealEval?: EvalResult,
): { evaluatorInvoked: boolean; evalResult?: EvalResult } {
  const declared = normalizeSurfaces(contract.surfaces) ?? [];
  if (declared.length === 0) return { evaluatorInvoked: true };

  // Attempt 0 is exempt — the Evaluator always runs on the first attempt.
  const changedFiles = attempt > 0 ? computeChangedFilesSince(dir, sprintBaseSha) : undefined;
  if (!changedFiles || changedFiles.length === 0) return { evaluatorInvoked: true };

  const { covered, missing } = checkSurfaceCoverage(declared, changedFiles);
  if (missing.length === 0) return { evaluatorInvoked: true };

  const missingList = missing.join(", ");
  const evalResult = buildSkippedEvaluatorResult(
    contract,
    `Evaluator skipped: surface coverage check failed. Declared surface(s) not touched: ${missingList}.`,
    `Surface coverage check failed. The contract declared these surfaces but the Generator did not touch them: ${missingList}. Surfaces actually touched: ${covered.join(", ") || "none"}.`,
    priorRealEval,
  );
  return { evaluatorInvoked: false, evalResult };
}

beforeEach(() => {
  dir = execSync(`mktemp -d ${join(tmpdir(), "adhd-coverage-XXXXXX")}`, { encoding: "utf-8" }).trim();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

// ── buildSkippedEvaluatorResult ────────────────────────────────────

describe("buildSkippedEvaluatorResult", () => {
  test("produces the same shape the lint-gate failure produces", () => {
    const result = buildSkippedEvaluatorResult(CONTRACT, "per-criterion reason", "overall summary");
    expect(result.passed).toBe(false);
    expect(result.scores).toEqual({});
    expect(result.feedback).toHaveLength(CONTRACT.criteria.length);
    for (const entry of result.feedback) {
      expect(entry.score).toBe(0);
      expect(entry.details).toBe("per-criterion reason");
    }
    expect(result.feedback.map((f) => f.criterion)).toEqual(["criterion_a", "criterion_b"]);
    expect(result.overallSummary).toBe("overall summary");
  });
});

// ── Coverage gate decision ─────────────────────────────────────────

describe("surface coverage gate decision", () => {
  test("fails before the Evaluator when a declared surface is untouched", () => {
    const beforeSha = initGitRepo();
    commitFile("shared/server.ts", "export const x = 1;\n", "backend only");

    const { evaluatorInvoked, evalResult } = runCoverageGate(CONTRACT, beforeSha, 1);

    expect(evaluatorInvoked).toBe(false);
    expect(evalResult).toBeDefined();
    // The EvalResult shape matches the lint gate's failure shape.
    expect(evalResult?.passed).toBe(false);
    expect(evalResult?.scores).toEqual({});
    expect(evalResult?.feedback.every((f) => f.score === 0)).toBe(true);
    // overallSummary names exactly the uncovered surface.
    expect(evalResult?.overallSummary).toContain("frontend");
    expect(evalResult?.overallSummary).not.toContain("not touch them: backend");
  });

  test("passes and lets the Evaluator run when all declared surfaces are touched", () => {
    const beforeSha = initGitRepo();
    mkdirSync(join(dir, "shared"), { recursive: true });
    writeFileSync(join(dir, "shared", "server.ts"), "export const x = 1;\n");
    mkdirSync(join(dir, "ui"), { recursive: true });
    writeFileSync(join(dir, "ui", "App.tsx"), "export const A = () => null;\n");
    gitExec("git add -A");
    gitExec("git commit -m 'backend and frontend'");

    const { evaluatorInvoked, evalResult } = runCoverageGate(CONTRACT, beforeSha, 1);
    expect(evaluatorInvoked).toBe(true);
    expect(evalResult).toBeUndefined();
  });

  test("skips the gate (Evaluator runs) when the contract declares no surfaces", () => {
    const beforeSha = initGitRepo();
    commitFile("shared/server.ts", "export const x = 1;\n", "backend only");

    const legacyContract: SprintContract = { ...CONTRACT, surfaces: undefined };
    const { evaluatorInvoked } = runCoverageGate(legacyContract, beforeSha, 1);
    expect(evaluatorInvoked).toBe(true);
  });

  test("skips the gate when the changed-file list cannot be computed (attempt 0)", () => {
    const beforeSha = initGitRepo();
    commitFile("shared/server.ts", "export const x = 1;\n", "backend only");

    const { evaluatorInvoked } = runCoverageGate(CONTRACT, beforeSha, 0);
    expect(evaluatorInvoked).toBe(true);
  });

  test("skips the gate when only .adhd/ metadata changed (empty product list)", () => {
    const beforeSha = initGitRepo();
    commitFile(".adhd/progress.json", "{}\n", "adhd metadata only");

    const { evaluatorInvoked } = runCoverageGate(CONTRACT, beforeSha, 1);
    expect(evaluatorInvoked).toBe(true);
  });

  test("excludes .adhd/ metadata so it cannot satisfy a declared surface", () => {
    const beforeSha = initGitRepo();
    // A .adhd/*.tsx file would classify as frontend if not excluded — it must
    // not count toward the declared `frontend` surface.
    mkdirSync(join(dir, "shared"), { recursive: true });
    writeFileSync(join(dir, "shared", "server.ts"), "export const x = 1;\n");
    mkdirSync(join(dir, ".adhd"), { recursive: true });
    writeFileSync(join(dir, ".adhd", "Widget.tsx"), "export const W = () => null;\n");
    gitExec("git add -A");
    gitExec("git commit -m 'backend plus adhd tsx'");

    const { evaluatorInvoked, evalResult } = runCoverageGate(CONTRACT, beforeSha, 1);
    // frontend is still missing because the only .tsx was under .adhd/.
    expect(evaluatorInvoked).toBe(false);
    expect(evalResult?.overallSummary).toContain("frontend");
  });

  test("coverage failure feedback flows to the next Generator attempt", () => {
    const beforeSha = initGitRepo();
    commitFile("shared/server.ts", "export const x = 1;\n", "backend only");

    const { evalResult } = runCoverageGate(CONTRACT, beforeSha, 1);
    // The loop assigns this to lastEval and passes it as previousFeedback to the
    // next runGenerator call — assert it carries the missed surface.
    const previousFeedback = evalResult;
    expect(previousFeedback?.overallSummary).toContain("frontend");
    expect(previousFeedback?.feedback.some((f) => f.details.includes("frontend"))).toBe(true);
  });
});

// ── Cumulative coverage (Fix #1) ───────────────────────────────────

describe("cumulative surface coverage across attempts", () => {
  // Contract touching backend + tests, the realistic convergence case.
  const BT_CONTRACT: SprintContract = { ...CONTRACT, surfaces: ["backend", "tests"] };

  test("a surface touched on an earlier attempt stays covered on a later one", () => {
    const base = initGitRepo();

    // Attempt 1 commits only backend. Measured cumulatively from the base, the
    // `tests` surface is still untouched, so the gate fails this attempt — the
    // same decision the original per-attempt gate made.
    commitFile("shared/server.ts", "export const x = 1;\n", "attempt 1: backend");
    const a1 = runCoverageGate(BT_CONTRACT, base, 1);
    expect(a1.evaluatorInvoked).toBe(false);
    expect(a1.evalResult?.overallSummary).toContain("tests");

    // Attempt 2 commits only tests. Cumulatively from the base, backend (from
    // attempt 1) AND tests (from attempt 2) are now both covered, so the gate
    // passes and the Evaluator runs. The old per-attempt gate would have failed
    // here ("backend not touched this attempt") and ping-ponged forever.
    commitFile("tests/server.test.ts", "test('x', () => {});\n", "attempt 2: tests");
    const a2 = runCoverageGate(BT_CONTRACT, base, 2);
    expect(a2.evaluatorInvoked).toBe(true);
    expect(a2.evalResult).toBeUndefined();
  });

  test("still fails when, cumulatively, a declared surface is never touched", () => {
    const base = initGitRepo();
    // Two attempts, both touching only backend; `tests` is never covered.
    commitFile("shared/server.ts", "export const x = 1;\n", "attempt 1: backend");
    commitFile("shared/other.ts", "export const y = 2;\n", "attempt 2: backend again");
    const a2 = runCoverageGate(BT_CONTRACT, base, 2);
    expect(a2.evaluatorInvoked).toBe(false);
    expect(a2.evalResult?.overallSummary).toContain("tests");
  });
});

// ── Preserving the real evaluation on a gate skip (Fix #2) ──────────

describe("real evaluation preserved across a gate skip", () => {
  const realEval: EvalResult = {
    passed: false,
    scores: { criterion_a: 5, criterion_b: 6 },
    feedback: [
      { criterion: "criterion_a", score: 5, details: "REAL: missing null check in the parser" },
      { criterion: "criterion_b", score: 6, details: "REAL: thin test coverage" },
    ],
    overallSummary: "REAL eval: close, but the parser still drops empty input.",
  };

  test("merges the prior real per-criterion details and scores into the skip result", () => {
    const skipped = buildSkippedEvaluatorResult(
      CONTRACT,
      "Evaluator skipped: surface coverage check failed. Declared surface(s) not touched: frontend.",
      "Surface coverage check failed. ... frontend.",
      realEval,
    );
    const a = skipped.feedback.find((f) => f.criterion === "criterion_a");
    // The real defect is carried forward...
    expect(a?.details).toContain("missing null check");
    // ...alongside the gate-skip note.
    expect(a?.details).toContain("surface coverage check failed");
    expect(a?.score).toBe(5);
    // Real scores preserved, not blanked to {}.
    expect(skipped.scores).toEqual({ criterion_a: 5, criterion_b: 6 });
    // Overall summary references the carried-forward findings.
    expect(skipped.overallSummary).toContain("parser still drops empty input");
  });

  test("without a prior real eval, degrades to the original boilerplate shape", () => {
    const skipped = buildSkippedEvaluatorResult(CONTRACT, "boilerplate reason", "skip summary");
    expect(skipped.scores).toEqual({});
    expect(skipped.feedback.every((f) => f.score === 0 && f.details === "boilerplate reason")).toBe(true);
    expect(skipped.overallSummary).toBe("skip summary");
  });

  test("the surface gate carries the real eval forward when it skips", () => {
    const base = initGitRepo();
    commitFile("shared/server.ts", "export const x = 1;\n", "backend only");
    // The gate skips (frontend missing) but is handed the last real eval.
    const { evalResult } = runCoverageGate(CONTRACT, base, 1, realEval);
    expect(evalResult?.feedback.some((f) => f.details.includes("missing null check"))).toBe(true);
    expect(evalResult?.overallSummary).toContain("parser still drops empty input");
    // The missed surface note is still present too.
    expect(evalResult?.overallSummary).toContain("frontend");
  });
});
