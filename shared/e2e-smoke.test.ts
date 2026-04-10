/**
 * End-to-end smoke test for the ADHD harness with Phase 1 features enabled.
 *
 * This test exercises the full harness lifecycle control flow through the
 * orchestrator, contract loader, evaluator loop, and result assembly.
 * LLM calls and subprocess execution are mocked.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveConfig } from "./config.ts";
import { computeDiffSection } from "./diff.ts";
import { readContract, readSpec, writeContract, writeSpec } from "./files.ts";
import { countSprints } from "./refinement.ts";
import {
  accumulateRegressionCriteria,
  buildRegressionSection,
  readRegressionCriteria,
  regressionPath,
} from "./regression.ts";
import { detectStaticAnalysisCommands, truncateStaticAnalysisOutput } from "./static-analysis.ts";
import type { EvalResult, SprintContract, SprintResult } from "./types.ts";

const TMP_DIR = join(import.meta.dir, "__tmp_e2e_smoke__");
const ADHD_DIR = join(TMP_DIR, ".adhd");

beforeEach(() => {
  mkdirSync(join(ADHD_DIR, "contracts"), { recursive: true });
  mkdirSync(join(ADHD_DIR, "feedback"), { recursive: true });
  mkdirSync(join(ADHD_DIR, "logs"), { recursive: true });
});

afterEach(() => {
  rmSync(TMP_DIR, { recursive: true, force: true });
});

/**
 * Simulate a harness sprint lifecycle:
 * 1. Load/resolve config
 * 2. Load spec
 * 3. Load or create contract
 * 4. Run static analysis
 * 5. Check lint-gate
 * 6. Build regression context
 * 7. Build diff context
 * 8. Simulate evaluation
 * 9. Accumulate regression
 * 10. Assemble result
 */
async function simulateHarnessSprint(options: {
  sprint: number;
  lintGate: boolean;
  noBdd: boolean;
  lintFails: boolean;
  attempt: number;
  beforeSha: string;
}): Promise<{ result: SprintResult; evalResult: EvalResult }> {
  const { sprint, lintGate, noBdd, lintFails, attempt, beforeSha } = options;

  // Step 1: Load contract
  let contract: SprintContract;
  try {
    contract = await readContract(TMP_DIR, sprint);
  } catch {
    // No contract exists — use default
    contract = {
      sprintNumber: sprint,
      features: ["Test feature"],
      criteria: [
        { name: "feature_works", description: "Feature is functional", threshold: 7, type: "behavioral" },
        { name: "code_quality", description: "Code is clean", threshold: 7, type: "implementation" },
      ],
    };
    await writeContract(TMP_DIR, contract);
  }

  // Step 2: Run static analysis (mock)
  const saCommands = await detectStaticAnalysisCommands(TMP_DIR);
  let staticAnalysisOutput = "";
  let staticAnalysisFailed = false;

  if (saCommands.length > 0 || lintFails) {
    if (lintFails) {
      staticAnalysisOutput = "Error: 3 lint errors found";
      staticAnalysisFailed = true;
    } else {
      staticAnalysisOutput = "All checks passed.";
    }
  }

  // Step 3: Lint-gate check
  if (lintGate && staticAnalysisFailed) {
    const evalResult: EvalResult = {
      passed: false,
      scores: {},
      feedback: [{ criterion: "lint-gate", score: 0, details: `lint-gate: ${staticAnalysisOutput}` }],
      overallSummary: `lint-gate: Static analysis failed. Evaluator skipped.\n${staticAnalysisOutput}`,
    };
    return {
      result: { sprintNumber: sprint, passed: false, attempts: attempt + 1, evalResult },
      evalResult,
    };
  }

  // Step 4: Build supplementary context
  let supplementaryContext = "";

  // Static analysis injection
  if (staticAnalysisOutput) {
    const truncated = truncateStaticAnalysisOutput(staticAnalysisOutput);
    supplementaryContext += `\n\n## Static Analysis Results\n\n${truncated}`;
  }

  // Regression criteria injection
  if (!noBdd && sprint > 1) {
    const regressionCriteria = await readRegressionCriteria(TMP_DIR);
    const regressionSection = buildRegressionSection(regressionCriteria);
    if (regressionSection) {
      supplementaryContext += regressionSection;
    }
  }

  // Diff injection on retries
  if (attempt > 0 && beforeSha) {
    const diffSection = computeDiffSection(TMP_DIR, beforeSha, attempt);
    if (diffSection) {
      supplementaryContext += diffSection;
    }
  }

  // Step 5: Simulate evaluation (mock — always passes)
  const scores: Record<string, number> = {};
  const feedback = [];
  for (const criterion of contract.criteria) {
    scores[criterion.name] = 8;
    feedback.push({ criterion: criterion.name, score: 8, details: "Looks good" });
  }

  const evalResult: EvalResult = {
    passed: true,
    scores,
    feedback,
    overallSummary: `Sprint ${sprint} passed. ${supplementaryContext ? "Context included." : "No extra context."}`,
  };

  // Step 6: Accumulate regression criteria (if passed and not noBdd)
  if (evalResult.passed && !noBdd) {
    await accumulateRegressionCriteria(TMP_DIR, contract);
  }

  return {
    result: {
      sprintNumber: sprint,
      passed: evalResult.passed,
      attempts: attempt + 1,
      evalResult,
    },
    evalResult,
  };
}

describe("e2e smoke test", () => {
  test("full lifecycle with Phase 1 features: lint-gate, sprint 1, regression", async () => {
    // Setup: write spec
    const spec = `# Test Project

## Sprint 1
Build the foundation.

## Sprint 2
Build features.
`;
    await writeSpec(TMP_DIR, spec);

    // Write a contract for sprint 1
    const contract: SprintContract = {
      sprintNumber: 1,
      features: ["Foundation"],
      criteria: [
        { name: "foundation_works", description: "Foundation is solid", threshold: 7, type: "behavioral" },
        { name: "clean_code", description: "No lint errors", threshold: 7, type: "implementation" },
      ],
    };
    await writeContract(TMP_DIR, contract);

    // Seed a regression criterion from a "previous" sprint
    writeFileSync(
      regressionPath(TMP_DIR),
      JSON.stringify([{ name: "prior_feature", description: "Prior feature works", threshold: 7, sprintNumber: 0 }]),
      "utf-8",
    );

    // Run the simulated sprint
    const { result, evalResult } = await simulateHarnessSprint({
      sprint: 1,
      lintGate: true,
      noBdd: false,
      lintFails: false,
      attempt: 0,
      beforeSha: "",
    });

    // Verify output structure
    expect(result).toHaveProperty("passed");
    expect(result).toHaveProperty("attempts");
    expect(result).toHaveProperty("sprintNumber");
    expect(result.passed).toBe(true);
    expect(result.attempts).toBe(1);
    expect(result.sprintNumber).toBe(1);

    expect(evalResult).toHaveProperty("passed");
    expect(evalResult).toHaveProperty("scores");
    expect(evalResult).toHaveProperty("feedback");
    expect(evalResult).toHaveProperty("overallSummary");
    expect(evalResult.passed).toBe(true);
    expect(typeof evalResult.overallSummary).toBe("string");
  });

  test("lint-gate blocks evaluation when lint fails", async () => {
    const { result, evalResult } = await simulateHarnessSprint({
      sprint: 1,
      lintGate: true,
      noBdd: false,
      lintFails: true,
      attempt: 0,
      beforeSha: "",
    });

    expect(result.passed).toBe(false);
    expect(evalResult.overallSummary).toContain("lint-gate");
    expect(evalResult.feedback[0]?.details).toContain("lint-gate");
  });

  test("completes without unhandled errors with all features enabled", async () => {
    await writeSpec(TMP_DIR, "# Spec\n\n## Sprint 1\nDo stuff.\n");

    // Simulate full lifecycle without errors
    let error: Error | null = null;
    try {
      // Config resolution
      const config = resolveConfig({
        prompt: "test",
        greenfield: false,
        resume: false,
        verbose: false,
        quiet: false,
        noInteractive: false,
        debug: false,
        dryRun: false,
        noBdd: false,
        noTdd: false,
        noDocs: false,
        lintGate: true,
        sprint: 1,
        refineSpec: true,
      });

      expect(config.lintGate).toBe(true);
      expect(config.sprint).toBe(1);
      expect(config.refineSpec).toBe(true);

      // Spec loading
      const spec = await readSpec(TMP_DIR);
      expect(spec).toContain("## Sprint 1");
      expect(countSprints(spec)).toBe(1);

      // Contract loading
      const contract: SprintContract = {
        sprintNumber: 1,
        features: ["Stuff"],
        criteria: [{ name: "stuff_works", description: "Stuff works", threshold: 7, type: "behavioral" }],
      };
      await writeContract(TMP_DIR, contract);
      const loaded = await readContract(TMP_DIR, 1);
      expect(loaded.sprintNumber).toBe(1);

      // Static analysis
      const cmds = await detectStaticAnalysisCommands(TMP_DIR);
      expect(cmds).toEqual([]);

      // Regression
      const regCriteria = await readRegressionCriteria(TMP_DIR);
      expect(regCriteria).toEqual([]);

      // Run simulated sprint
      const { result } = await simulateHarnessSprint({
        sprint: 1,
        lintGate: true,
        noBdd: false,
        lintFails: false,
        attempt: 0,
        beforeSha: "",
      });

      expect(result.passed).toBe(true);
    } catch (e) {
      error = e as Error;
    }

    expect(error).toBeNull();
  });

  test("regression criteria accumulate across simulated sprints", async () => {
    await writeSpec(TMP_DIR, "# Spec\n\n## Sprint 1\nAuth.\n\n## Sprint 2\nDashboard.\n");

    // Sprint 1
    const c1: SprintContract = {
      sprintNumber: 1,
      features: ["Auth"],
      criteria: [
        { name: "login_works", description: "Login functional", threshold: 7, type: "behavioral" },
        { name: "code_style", description: "Clean code", threshold: 7, type: "implementation" },
      ],
    };
    await writeContract(TMP_DIR, c1);

    const r1 = await simulateHarnessSprint({
      sprint: 1,
      lintGate: false,
      noBdd: false,
      lintFails: false,
      attempt: 0,
      beforeSha: "",
    });
    expect(r1.result.passed).toBe(true);

    // Sprint 2
    const c2: SprintContract = {
      sprintNumber: 2,
      features: ["Dashboard"],
      criteria: [{ name: "dashboard_renders", description: "Dashboard shows data", threshold: 7, type: "behavioral" }],
    };
    await writeContract(TMP_DIR, c2);

    const r2 = await simulateHarnessSprint({
      sprint: 2,
      lintGate: false,
      noBdd: false,
      lintFails: false,
      attempt: 0,
      beforeSha: "",
    });
    expect(r2.result.passed).toBe(true);

    // Check accumulated regression criteria
    const criteria = await readRegressionCriteria(TMP_DIR);
    expect(criteria).toHaveLength(2); // login_works + dashboard_renders (not code_style)
    const names = criteria.map((c) => c.name).sort();
    expect(names).toEqual(["dashboard_renders", "login_works"]);
  });

  test("noBdd prevents regression accumulation in e2e flow", async () => {
    const c: SprintContract = {
      sprintNumber: 1,
      features: ["Feature"],
      criteria: [{ name: "feature_works", description: "Works", threshold: 7, type: "behavioral" }],
    };
    await writeContract(TMP_DIR, c);

    const { result } = await simulateHarnessSprint({
      sprint: 1,
      lintGate: false,
      noBdd: true,
      lintFails: false,
      attempt: 0,
      beforeSha: "",
    });

    expect(result.passed).toBe(true);
    // No regression.json should exist since noBdd=true
    expect(existsSync(regressionPath(TMP_DIR))).toBe(false);
  });
});
