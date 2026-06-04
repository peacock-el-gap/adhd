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
import { computeChangedFiles } from "../shared/diff.ts";
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
 * Mirror of the gate's control flow in sprint-attempts.ts. Returns whether the
 * Evaluator would be invoked, plus the EvalResult written on a coverage failure.
 */
function runCoverageGate(
  contract: SprintContract,
  beforeSha: string,
  attempt: number,
): { evaluatorInvoked: boolean; evalResult?: EvalResult } {
  const declared = normalizeSurfaces(contract.surfaces) ?? [];
  if (declared.length === 0) return { evaluatorInvoked: true };

  const changedFiles = computeChangedFiles(dir, beforeSha, attempt);
  if (!changedFiles || changedFiles.length === 0) return { evaluatorInvoked: true };

  const { covered, missing } = checkSurfaceCoverage(declared, changedFiles);
  if (missing.length === 0) return { evaluatorInvoked: true };

  const missingList = missing.join(", ");
  const evalResult = buildSkippedEvaluatorResult(
    contract,
    `Evaluator skipped: surface coverage check failed. Declared surface(s) not touched: ${missingList}.`,
    `Surface coverage check failed. The contract declared these surfaces but the Generator did not touch them: ${missingList}. Surfaces actually touched: ${covered.join(", ") || "none"}.`,
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
