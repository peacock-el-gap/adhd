import { truncateStaticAnalysisOutput } from "./static-analysis.ts";

/**
 * Compact structured result from a single verification (test) run.
 * All numeric fields are non-negative; total === passCount + failCount.
 */
export interface VerificationResult {
  /** Overall pass/fail. null means not run (no test command detected). */
  passed: boolean | null;
  /** Total tests detected (passCount + failCount). */
  total: number;
  /** Number of passing tests (0 when not parseable). */
  passCount: number;
  /** Number of failing tests (0 when not parseable). */
  failCount: number;
  /** Names of failing tests extracted from output. Empty if none or unparseable. */
  failingTests: string[];
  /** Raw test output, possibly truncated to the bounded size limit. */
  output: string;
}

/**
 * Sentinel result returned when no test command is available.
 * Pass/fail is null; all counts are zero; failing list is empty.
 */
export const VERIFICATION_NO_OP: VerificationResult = Object.freeze({
  passed: null,
  total: 0,
  passCount: 0,
  failCount: 0,
  failingTests: [],
  output: "",
});

/**
 * Parse raw test runner output into structured counts and failing test names.
 * Handles Bun, Jest/Vitest summary lines, and TAP-format output.
 * Returns non-negative integers; total is always passCount + failCount.
 * Never throws.
 */
export function parseTestOutput(
  raw: string,
  exitCode: number,
): {
  passed: boolean;
  total: number;
  passCount: number;
  failCount: number;
  failingTests: string[];
} {
  try {
    const lines = raw.split("\n");
    let passCount = 0;
    let failCount = 0;
    const failingTests: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();

      // Bun format: "N pass" or "N passed"
      const bunPass = trimmed.match(/^(\d+)\s+pass(?:ed)?$/i);
      if (bunPass) {
        passCount = parseInt(bunPass[1] ?? "0", 10);
        continue;
      }

      // Bun format: "N fail" or "N failed"
      const bunFail = trimmed.match(/^(\d+)\s+fail(?:ed)?$/i);
      if (bunFail) {
        failCount = parseInt(bunFail[1] ?? "0", 10);
        continue;
      }

      // Mocha format: "N passing"
      const mochaPassing = trimmed.match(/^(\d+)\s+passing/i);
      if (mochaPassing) {
        passCount = parseInt(mochaPassing[1] ?? "0", 10);
        continue;
      }

      // Mocha format: "N failing"
      const mochaFailing = trimmed.match(/^(\d+)\s+failing/i);
      if (mochaFailing) {
        failCount = parseInt(mochaFailing[1] ?? "0", 10);
        continue;
      }

      // Jest/Vitest format: "Tests: 2 failed, 5 passed, 7 total"
      const jestSummary = trimmed.match(/Tests:\s+(?:(\d+)\s+failed,\s+)?(?:(\d+)\s+passed,\s+)?(\d+)\s+total/i);
      if (jestSummary) {
        if (jestSummary[1]) failCount = parseInt(jestSummary[1], 10);
        if (jestSummary[2]) passCount = parseInt(jestSummary[2], 10);
        continue;
      }

      // Bun failing: " ✗ test name (Xms)" or " × test name"
      const bunFailing = trimmed.match(/^[✗×]\s+(.+)/u);
      if (bunFailing) {
        failingTests.push(stripTimingSuffix(bunFailing[1] ?? ""));
        continue;
      }

      // Jest/Vitest failing: "  ✕ test name (Xms)"
      const jestFailing = trimmed.match(/^✕\s+(.+)/u);
      if (jestFailing) {
        failingTests.push(stripTimingSuffix(jestFailing[1] ?? ""));
        continue;
      }

      // TAP format: "not ok N - test name" or "not ok N test name"
      const tapFailing = trimmed.match(/^not ok\s+\d+\s*[-–]?\s*(.+)/iu);
      if (tapFailing) {
        failingTests.push((tapFailing[1] ?? "").trim());
      }
    }

    const total = passCount + failCount;
    const passed = exitCode === 0;

    return { passed, total, passCount, failCount, failingTests };
  } catch {
    // Absolute last resort — return safe zeroes
    return { passed: exitCode === 0, total: 0, passCount: 0, failCount: 0, failingTests: [] };
  }
}

/**
 * Combine truncation and parsing into a single VerificationResult.
 * Reuses the shared truncateStaticAnalysisOutput limit so test output is
 * bounded by the same rule as lint/typecheck output.
 */
export function buildVerificationResult(raw: string, exitCode: number): VerificationResult {
  const output = truncateStaticAnalysisOutput(raw);
  const { passed, total, passCount, failCount, failingTests } = parseTestOutput(raw, exitCode);
  return { passed, total, passCount, failCount, failingTests, output };
}

/**
 * Build a failed VerificationResult that captures a spawn/execution error.
 * Used when the test command cannot be launched or throws an unhandled exception.
 */
export function buildErrorVerificationResult(errorMessage: string): VerificationResult {
  return {
    passed: false,
    total: 0,
    passCount: 0,
    failCount: 0,
    failingTests: [],
    output: truncateStaticAnalysisOutput(errorMessage),
  };
}

// ---------------------------------------------------------------------------
// Failure classification (Sprint 2)
// ---------------------------------------------------------------------------

/**
 * The result of classifying post-Generator test failures against a pre-Generator
 * baseline. Used to distinguish breaks the Generator introduced from failures
 * that were already present before any code changes.
 */
export interface FailureClassification {
  /** Tests that were already failing before the Generator ran. */
  preExisting: string[];
  /** Tests that started failing after the Generator ran. */
  newlyIntroduced: string[];
  /**
   * True when a valid baseline was available and classification was performed.
   * False when baseline.passed === null (no test command was found, i.e. the
   * baseline equals VERIFICATION_NO_OP) or when inputs were malformed — in
   * that case both arrays are empty and failures remain unclassified.
   */
  classified: boolean;
}

/**
 * Diff post-Generator failing tests against a pre-Generator baseline to label
 * each failure as pre-existing or newly introduced.
 *
 * - **Pre-existing**: the test name appears in both the baseline and post-run result.
 * - **Newly introduced**: the test name is in the post-run result but not the baseline.
 * - A test that was failing in the baseline but passing after the Generator ran
 *   (i.e. fixed) does not appear in either output set.
 *
 * Returns `{ preExisting: [], newlyIntroduced: [], classified: false }` when:
 * - `baseline` or `postRun` is `null`/`undefined`.
 * - `baseline.passed === null` (no test command detected — equals `VERIFICATION_NO_OP`).
 * - `failingTests` fields are missing or malformed.
 *
 * Never throws. Order-independent: the result depends on set membership, not
 * on the order of test names in either array.
 */
export function classifyFailures(
  baseline: VerificationResult | null | undefined,
  postRun: VerificationResult | null | undefined,
): FailureClassification {
  const unclassified: FailureClassification = { preExisting: [], newlyIntroduced: [], classified: false };
  try {
    // No baseline available (no test command, or malformed input)
    if (baseline == null || baseline.passed === null) {
      return unclassified;
    }

    const baselineSet = new Set(safeStringArray(baseline.failingTests));
    const postFailingTests = safeStringArray(postRun?.failingTests);

    const preExisting: string[] = [];
    const newlyIntroduced: string[] = [];

    for (const name of postFailingTests) {
      if (baselineSet.has(name)) {
        preExisting.push(name);
      } else {
        newlyIntroduced.push(name);
      }
    }

    return { preExisting, newlyIntroduced, classified: true };
  } catch {
    // Absolute last resort — return safe unclassified result
    return unclassified;
  }
}

// ---------------------------------------------------------------------------
// Section builders for prompt injection (Sprint 3)
// ---------------------------------------------------------------------------

/**
 * Build a supplementary-context section describing the pre-Generator
 * verification baseline for injection into the Generator prompt.
 *
 * The Generator uses this to understand which tests were already failing
 * before the sprint started, so it doesn't waste turns on pre-existing issues.
 *
 * Returns an empty string when the baseline was not run (passed === null).
 * Never throws.
 */
export function buildBaselineVerificationSection(baseline: VerificationResult | null | undefined): string {
  try {
    if (baseline == null || baseline.passed === null) return "";

    const lines: string[] = [];
    lines.push("## Verification Baseline (pre-sprint state — do not re-run the full suite)");
    lines.push("");
    lines.push(
      `The test suite was run before your code changes. ${baseline.passCount} test(s) passed, ${baseline.failCount} failed.`,
    );

    if (baseline.failingTests.length > 0) {
      lines.push("");
      lines.push("These tests were **already failing before you started** — you are not responsible for them:");
      for (const t of baseline.failingTests) {
        lines.push(`  - ${t}`);
      }
    } else {
      lines.push("");
      lines.push("All tests were passing before your changes began.");
    }

    lines.push("");
    lines.push(
      "Run the full suite only once at the end if you need a final check. For investigating a specific failure, run only the relevant test file.",
    );

    return lines.join("\n");
  } catch {
    return "";
  }
}

/**
 * Build a supplementary-context section describing the post-Generator
 * verification result (with failure classification) for injection into the
 * Evaluator prompt.
 *
 * The Evaluator uses this as the authoritative test result and is told not
 * to re-run the full suite.
 *
 * Returns an empty string when the result was not run (passed === null).
 * Never throws.
 */
export function buildPostVerificationSection(
  postRun: VerificationResult | null | undefined,
  classification: FailureClassification | null | undefined,
): string {
  try {
    if (postRun == null || postRun.passed === null) return "";

    const lines: string[] = [];
    lines.push("## Verification Result (authoritative — do not re-run the full suite)");
    lines.push("");

    const verdict = postRun.passed ? "PASSED" : "FAILED";
    lines.push(
      `The test suite ran after the Generator completed: **${verdict}** — ${postRun.passCount} passing, ${postRun.failCount} failing (${postRun.total} total).`,
    );

    if (postRun.failingTests.length > 0) {
      lines.push("");

      const cls = classification;
      if (cls?.classified) {
        if (cls.newlyIntroduced.length > 0) {
          lines.push("**Newly introduced failures** (caused by this sprint's changes):");
          for (const t of cls.newlyIntroduced) {
            lines.push(`  - ${t}`);
          }
        }
        if (cls.preExisting.length > 0) {
          lines.push("");
          lines.push("**Pre-existing failures** (were failing before this sprint — do not penalise):");
          for (const t of cls.preExisting) {
            lines.push(`  - ${t}`);
          }
        }
      } else {
        lines.push("Failing tests (classification not available — all treated as unclassified):");
        for (const t of postRun.failingTests) {
          lines.push(`  - ${t}`);
        }
      }
    }

    if (postRun.output) {
      lines.push("");
      lines.push("### Test output");
      lines.push("```");
      lines.push(postRun.output);
      lines.push("```");
    }

    lines.push("");
    lines.push(
      "This result is authoritative. Do not re-run the full test suite. If you need to investigate a specific failure, run only the relevant test file.",
    );

    return lines.join("\n");
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Safely extract a string array from an unknown value.
 * Returns an empty array for null, undefined, non-arrays, or arrays containing
 * non-string entries (non-strings are filtered out silently).
 * Never throws.
 */
function safeStringArray(value: unknown): string[] {
  try {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

/** Strip trailing timing annotation like "(123ms)" from a test name. */
function stripTimingSuffix(name: string): string {
  return name.replace(/\s*\(\d+ms\)\s*$/, "").trim();
}
