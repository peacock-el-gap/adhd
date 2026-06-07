/**
 * Tests for F3 — Carry real evaluator findings through the test-gate skip.
 *
 * The test gate (--test-gate) short-circuits the Evaluator when newly-introduced
 * test failures are detected. Like the surface-coverage and lint gates, it must
 * carry the most recent real Evaluator findings forward into its synthesised
 * skip result so the next Generator attempt keeps working on the actual defect
 * rather than receiving boilerplate feedback.
 *
 * This file targets the test-gate branch specifically. The surface-coverage gate
 * and lint gate carry-forward paths are covered in surface-coverage-gate.test.ts;
 * this test file must not import from or depend on those paths.
 *
 * TDD note: the initial commit of this file had `runTestGate` omitting
 * `lastRealEval` from its buildSkippedEvaluatorResult call, mirroring the
 * broken production state and making the carry-forward assertions RED. The
 * subsequent commit fixed both the helper and the production call site in
 * sprint-attempts.ts.
 */
import { describe, expect, test } from "bun:test";
import { buildSkippedEvaluatorResult } from "../shared/eval-result.ts";
import type { EvalResult, SprintContract } from "../shared/types.ts";

// ── Fixtures ────────────────────────────────────────────────────────

const CONTRACT: SprintContract = {
  sprintNumber: 4,
  features: ["test gate carry-forward"],
  surfaces: ["backend", "tests"],
  criteria: [
    { name: "criterion_x", description: "x", threshold: 8 },
    { name: "criterion_y", description: "y", threshold: 7 },
  ],
};

const REAL_EVAL: EvalResult = {
  passed: false,
  scores: { criterion_x: 4, criterion_y: 6 },
  feedback: [
    { criterion: "criterion_x", score: 4, details: "REAL: input validation is missing in the handler" },
    { criterion: "criterion_y", score: 6, details: "REAL: test coverage is thin for edge cases" },
  ],
  overallSummary: "REAL eval: the handler does not validate its input; edge cases are untested.",
};

/**
 * Mirrors the test-gate skip construction in sprint-attempts.ts.
 *
 * `lastRealEval` is forwarded as the fourth argument to
 * buildSkippedEvaluatorResult, matching the corrected production code and the
 * pattern already used by the surface-coverage and lint gates.
 */
function runTestGate(
  contract: SprintContract,
  newlyIntroducedFailures: string[],
  lastRealEval?: EvalResult,
): { evaluatorSkipped: boolean; evalResult?: EvalResult } {
  if (newlyIntroducedFailures.length === 0) {
    return { evaluatorSkipped: false };
  }

  const count = newlyIntroducedFailures.length;
  const failingList = newlyIntroducedFailures.join(", ");

  const evalResult = buildSkippedEvaluatorResult(
    contract,
    `Evaluator skipped due to --test-gate: ${count} newly-introduced test failure(s): ${failingList}.`,
    `Test gate (--test-gate) triggered: ${count} test(s) started failing after the Generator ran: ${failingList}. Fix the failing tests on the next attempt. The Evaluator was skipped to save cost.`,
    lastRealEval,
  );

  return { evaluatorSkipped: true, evalResult };
}

// ── Test-gate skip carries real findings forward ─────────────────────

describe("test gate carry-forward of last real evaluation", () => {
  test("when a prior real evaluation exists, its per-criterion findings appear in the skip result", () => {
    const { evaluatorSkipped, evalResult } = runTestGate(
      CONTRACT,
      ["tests/handler.test.ts"],
      REAL_EVAL,
    );

    expect(evaluatorSkipped).toBe(true);
    expect(evalResult).toBeDefined();
    // Real per-criterion details must be carried forward.
    const x = evalResult?.feedback.find((f) => f.criterion === "criterion_x");
    expect(x?.details).toContain("input validation is missing");
    expect(x?.score).toBe(4);
    // Gate-skip note is appended alongside the real finding.
    expect(x?.details).toContain("test-gate");
    // Real scores carried forward, not blanked to {}.
    expect(evalResult?.scores).toEqual({ criterion_x: 4, criterion_y: 6 });
    // Overall summary references the carried-forward findings.
    expect(evalResult?.overallSummary).toContain("handler does not validate");
  });

  test("when a prior real evaluation exists, its overall summary is appended to the skip result", () => {
    const { evalResult } = runTestGate(
      CONTRACT,
      ["tests/parser.test.ts", "tests/router.test.ts"],
      REAL_EVAL,
    );

    expect(evalResult?.overallSummary).toContain("REAL eval:");
    expect(evalResult?.overallSummary).toContain("edge cases are untested");
    // The test-gate trigger reason is also present.
    expect(evalResult?.overallSummary).toContain("Test gate");
    expect(evalResult?.overallSummary).toContain("tests/parser.test.ts");
  });

  test("when no prior real evaluation exists (first attempt), the result is the safe boilerplate default", () => {
    const { evaluatorSkipped, evalResult } = runTestGate(
      CONTRACT,
      ["tests/core.test.ts"],
      // no lastRealEval
    );

    expect(evaluatorSkipped).toBe(true);
    expect(evalResult).toBeDefined();
    // Graceful degradation: boilerplate shape, no crash.
    expect(evalResult?.passed).toBe(false);
    expect(evalResult?.scores).toEqual({});
    for (const entry of evalResult?.feedback ?? []) {
      expect(entry.score).toBe(0);
      expect(entry.details).toContain("test-gate");
    }
    // Overall summary is non-empty.
    expect(typeof evalResult?.overallSummary).toBe("string");
    expect((evalResult?.overallSummary ?? "").length).toBeGreaterThan(0);
  });

  test("when the test gate does not fire (no newly-introduced failures), the evaluator is not skipped", () => {
    const { evaluatorSkipped, evalResult } = runTestGate(CONTRACT, [], REAL_EVAL);

    expect(evaluatorSkipped).toBe(false);
    expect(evalResult).toBeUndefined();
  });
});

// ── Parity across the three pre-evaluator gates ──────────────────────

describe("test gate parity with surface and lint gates", () => {
  test("all three gates carry the same prior real findings forward when they skip", () => {
    const { evalResult: testGateResult } = runTestGate(CONTRACT, ["tests/x.test.ts"], REAL_EVAL);

    // Surface and lint gates already pass lastRealEval correctly.
    const surfaceResult = buildSkippedEvaluatorResult(
      CONTRACT,
      "Evaluator skipped: surface coverage check failed.",
      "Surface coverage check failed.",
      REAL_EVAL,
    );

    const lintResult = buildSkippedEvaluatorResult(
      CONTRACT,
      "Evaluator skipped due to --lint-gate: static analysis failed",
      "Static analysis failed (--lint-gate).",
      REAL_EVAL,
    );

    // All three must carry the real score for criterion_x forward.
    expect(testGateResult?.scores.criterion_x).toBe(4);
    expect(surfaceResult.scores.criterion_x).toBe(4);
    expect(lintResult.scores.criterion_x).toBe(4);

    // All three must carry the real criterion_x detail forward.
    const testX = testGateResult?.feedback.find((f) => f.criterion === "criterion_x");
    const surfaceX = surfaceResult.feedback.find((f) => f.criterion === "criterion_x");
    const lintX = lintResult.feedback.find((f) => f.criterion === "criterion_x");

    expect(testX?.details).toContain("input validation is missing");
    expect(surfaceX?.details).toContain("input validation is missing");
    expect(lintX?.details).toContain("input validation is missing");
  });
});
