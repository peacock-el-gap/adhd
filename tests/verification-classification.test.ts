import { describe, expect, test } from "bun:test";
import {
  VERIFICATION_NO_OP,
  classifyFailures,
  type FailureClassification,
  type VerificationResult,
} from "../shared/verification.ts";

// ---------------------------------------------------------------------------
// Helper: build a VerificationResult with specific failing tests
// ---------------------------------------------------------------------------

function makeResult(failingTests: string[], passed = false): VerificationResult {
  return {
    passed,
    total: failingTests.length,
    passCount: 0,
    failCount: failingTests.length,
    failingTests,
    output: "",
  };
}

function makeGreenResult(): VerificationResult {
  return {
    passed: true,
    total: 3,
    passCount: 3,
    failCount: 0,
    failingTests: [],
    output: "",
  };
}

// ---------------------------------------------------------------------------
// (1) Pre-existing + newly-introduced split
// ---------------------------------------------------------------------------

describe("classifyFailures — pre-existing + newly-introduced split", () => {
  test("classifies test-A and test-B as pre-existing, test-C as newly introduced", () => {
    const baseline = makeResult(["test-A", "test-B"]);
    const postRun = makeResult(["test-A", "test-B", "test-C"]);

    const result = classifyFailures(baseline, postRun);

    expect(result.classified).toBe(true);
    expect(result.preExisting).toContain("test-A");
    expect(result.preExisting).toContain("test-B");
    expect(result.newlyIntroduced).toContain("test-C");
    expect(result.preExisting).not.toContain("test-C");
    expect(result.newlyIntroduced).not.toContain("test-A");
    expect(result.newlyIntroduced).not.toContain("test-B");
  });

  test("a test fixed by the Generator does not appear in either output set", () => {
    const baseline = makeResult(["test-A", "test-B"]);
    // test-B was fixed (no longer failing), test-C is new
    const postRun = makeResult(["test-A", "test-C"]);

    const result = classifyFailures(baseline, postRun);

    expect(result.classified).toBe(true);
    expect(result.preExisting).toEqual(["test-A"]);
    expect(result.newlyIntroduced).toEqual(["test-C"]);
    // test-B was fixed — should not appear anywhere
    expect(result.preExisting).not.toContain("test-B");
    expect(result.newlyIntroduced).not.toContain("test-B");
  });

  test("all post-run failures pre-existing when post-run subset of baseline", () => {
    const baseline = makeResult(["test-A", "test-B", "test-C"]);
    const postRun = makeResult(["test-A", "test-B"]);

    const result = classifyFailures(baseline, postRun);

    expect(result.classified).toBe(true);
    expect(result.preExisting).toHaveLength(2);
    expect(result.newlyIntroduced).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// (2) Empty baseline — all failures newly introduced
// ---------------------------------------------------------------------------

describe("classifyFailures — empty baseline (green project)", () => {
  test("all post-run failures are newly introduced when baseline had no failures", () => {
    const baseline = makeGreenResult();
    const postRun = makeResult(["test-X", "test-Y"]);

    const result = classifyFailures(baseline, postRun);

    expect(result.classified).toBe(true);
    expect(result.preExisting).toEqual([]);
    expect(result.newlyIntroduced).toContain("test-X");
    expect(result.newlyIntroduced).toContain("test-Y");
  });

  test("all green after generator on green baseline — both sets empty, classified true", () => {
    const baseline = makeGreenResult();
    const postRun = makeGreenResult();

    const result = classifyFailures(baseline, postRun);

    expect(result.classified).toBe(true);
    expect(result.preExisting).toEqual([]);
    expect(result.newlyIntroduced).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// (3) null / VERIFICATION_NO_OP baseline — unclassified
// ---------------------------------------------------------------------------

describe("classifyFailures — VERIFICATION_NO_OP baseline", () => {
  test("returns classified: false when baseline is VERIFICATION_NO_OP", () => {
    const postRun = makeResult(["test-A"]);
    const result = classifyFailures(VERIFICATION_NO_OP, postRun);

    expect(result.classified).toBe(false);
    expect(result.preExisting).toEqual([]);
    expect(result.newlyIntroduced).toEqual([]);
  });

  test("returns classified: false when baseline is null", () => {
    const postRun = makeResult(["test-A"]);
    const result = classifyFailures(null, postRun);

    expect(result.classified).toBe(false);
    expect(result.preExisting).toEqual([]);
    expect(result.newlyIntroduced).toEqual([]);
  });

  test("returns classified: false when baseline is undefined", () => {
    const postRun = makeResult(["test-A"]);
    const result = classifyFailures(undefined, postRun);

    expect(result.classified).toBe(false);
  });

  test("sprint attempt can proceed: result is a valid FailureClassification object", () => {
    const result = classifyFailures(VERIFICATION_NO_OP, VERIFICATION_NO_OP);
    // Structural shape check — Sprint 3+ will consume this
    const keys: (keyof FailureClassification)[] = ["preExisting", "newlyIntroduced", "classified"];
    for (const key of keys) {
      expect(key in result).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// (4) Post-run result with no failures
// ---------------------------------------------------------------------------

describe("classifyFailures — post-run result with no failures", () => {
  test("both sets empty when post-run has no failing tests", () => {
    const baseline = makeResult(["test-A", "test-B"]);
    const postRun = makeGreenResult();

    const result = classifyFailures(baseline, postRun);

    expect(result.classified).toBe(true);
    expect(result.preExisting).toEqual([]);
    expect(result.newlyIntroduced).toEqual([]);
  });

  test("classified is true even when post-run is all green", () => {
    const baseline = makeResult(["test-A"]);
    const postRun = makeGreenResult();

    const result = classifyFailures(baseline, postRun);

    expect(result.classified).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// (5) Order-independence
// ---------------------------------------------------------------------------

describe("classifyFailures — order-independence", () => {
  test("produces identical output regardless of baseline array order", () => {
    const postRun = makeResult(["test-A", "test-B", "test-C"]);

    const resultAbc = classifyFailures(makeResult(["test-A", "test-B"]), postRun);
    const resultBa = classifyFailures(makeResult(["test-B", "test-A"]), postRun);

    expect(resultAbc.classified).toBe(resultBa.classified);
    expect(new Set(resultAbc.preExisting)).toEqual(new Set(resultBa.preExisting));
    expect(new Set(resultAbc.newlyIntroduced)).toEqual(new Set(resultBa.newlyIntroduced));
  });

  test("produces identical output regardless of post-run array order", () => {
    const baseline = makeResult(["test-A"]);

    const resultAbc = classifyFailures(baseline, makeResult(["test-A", "test-B", "test-C"]));
    const resultCba = classifyFailures(baseline, makeResult(["test-C", "test-B", "test-A"]));

    expect(new Set(resultAbc.preExisting)).toEqual(new Set(resultCba.preExisting));
    expect(new Set(resultAbc.newlyIntroduced)).toEqual(new Set(resultCba.newlyIntroduced));
  });
});

// ---------------------------------------------------------------------------
// (6) Malformed / edge-case inputs — must not throw
// ---------------------------------------------------------------------------

describe("classifyFailures — malformed inputs never throw", () => {
  test("does not throw when baseline failingTests is not an array", () => {
    const malformed = { passed: false, total: 0, passCount: 0, failCount: 0, failingTests: "bad" as unknown as string[], output: "" };
    const postRun = makeResult(["test-A"]);
    expect(() => classifyFailures(malformed, postRun)).not.toThrow();
  });

  test("does not throw when post-run failingTests is not an array", () => {
    const baseline = makeResult(["test-A"]);
    const malformed = { passed: false, total: 0, passCount: 0, failCount: 0, failingTests: null as unknown as string[], output: "" };
    expect(() => classifyFailures(baseline, malformed)).not.toThrow();
  });

  test("does not throw when both arguments are null", () => {
    expect(() => classifyFailures(null, null)).not.toThrow();
  });

  test("does not throw when both arguments are undefined", () => {
    expect(() => classifyFailures(undefined, undefined)).not.toThrow();
  });

  test("does not throw when failingTests contains non-string entries", () => {
    const weirdBaseline = {
      passed: false,
      total: 0,
      passCount: 0,
      failCount: 0,
      failingTests: [42, null, "real-test", undefined] as unknown as string[],
      output: "",
    };
    const postRun = makeResult(["real-test", "new-test"]);

    let result!: FailureClassification;
    expect(() => {
      result = classifyFailures(weirdBaseline, postRun);
    }).not.toThrow();

    // "real-test" should be pre-existing (it was in baseline as a string)
    expect(result.preExisting).toContain("real-test");
    // "new-test" should be newly introduced
    expect(result.newlyIntroduced).toContain("new-test");
  });

  test("returns classified: false (not an error) for null/undefined inputs", () => {
    const result = classifyFailures(null, undefined);
    expect(result.classified).toBe(false);
    expect(result.preExisting).toEqual([]);
    expect(result.newlyIntroduced).toEqual([]);
  });
});
