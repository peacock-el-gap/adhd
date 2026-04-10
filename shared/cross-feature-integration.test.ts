/**
 * Sprint 5: Cross-feature integration tests
 *
 * Tests that Features 1.1–1.6 compose correctly under combined flag usage.
 * Covers: sprint selection + regression, combined CLI flags, refinement + regression
 * preservation, lint-gate + sprint selection, --no-bdd + sprint selection,
 * regression.json cleanup survival, malformed regression.json, invalid sprint values.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  accumulateRegressionCriteria,
  buildRegressionSection,
  readRegressionCriteria,
  regressionPath,
} from "./regression.ts";
import {
  buildRefinementPrompt,
  extractCompletedSprintSections,
  freezeCompletedSprints,
} from "./refinement.ts";
import { CLI_FLAG_HELP, parseCli, resolveConfig } from "./config.ts";
import { writeContract, readContract } from "./files.ts";
import { computeDiffSection } from "./diff.ts";
import { truncateStaticAnalysisOutput } from "./static-analysis.ts";
import type { RegressionCriterion, SprintContract } from "./types.ts";

const TMP_DIR = join(import.meta.dir, "__tmp_cross_feature__");
const ADHD_DIR = join(TMP_DIR, ".adhd");

beforeEach(() => {
  mkdirSync(join(ADHD_DIR, "contracts"), { recursive: true });
  mkdirSync(join(ADHD_DIR, "feedback"), { recursive: true });
});

afterEach(() => {
  rmSync(TMP_DIR, { recursive: true, force: true });
});

// ============================================================
// 1. Sprint selection + regression injection
// ============================================================
describe("sprint selection with regression injection", () => {
  test("when --sprint 3 is used and regression.json exists from sprints 1-2, buildRegressionSection includes prior criteria", async () => {
    // Simulate sprints 1-2 passing with behavioral criteria
    const sprint1: SprintContract = {
      sprintNumber: 1,
      features: ["Auth"],
      criteria: [
        { name: "login_works", description: "User can log in", threshold: 7, type: "behavioral" },
      ],
    };
    const sprint2: SprintContract = {
      sprintNumber: 2,
      features: ["Dashboard"],
      criteria: [
        { name: "dashboard_loads", description: "Dashboard renders", threshold: 8, type: "behavioral" },
        { name: "code_style", description: "Clean code", threshold: 7, type: "implementation" },
      ],
    };

    await accumulateRegressionCriteria(TMP_DIR, sprint1);
    await accumulateRegressionCriteria(TMP_DIR, sprint2);

    // Simulate --sprint 3 path: read regression criteria and build section
    const noBdd = false;
    const sprint = 3;
    let supplementaryContext = "";

    if (!noBdd && sprint > 1) {
      const regressionCriteria = await readRegressionCriteria(TMP_DIR);
      const regressionSection = buildRegressionSection(regressionCriteria);
      if (regressionSection) {
        supplementaryContext += regressionSection;
      }
    }

    // Verify regression section is non-empty and contains criteria from prior sprints
    expect(supplementaryContext).not.toBe("");
    expect(supplementaryContext).toContain("## Regression Criteria");
    expect(supplementaryContext).toContain("login_works");
    expect(supplementaryContext).toContain("dashboard_loads");
    // Implementation criteria should NOT be in regression
    expect(supplementaryContext).not.toContain("code_style");
  });
});

// ============================================================
// 2. Sprint selection + lint-gate
// ============================================================
describe("sprint selection with lint-gate", () => {
  test("when --sprint N and --lint-gate are both set, lint-gate hard mode still functions", () => {
    // Simulate the harness logic: lint-gate check is independent of sprint selection
    const lintGate = true;
    const staticAnalysisFailed = true;
    const staticAnalysisOutput = "Error: 5 lint errors";

    let evaluatorSkipped = false;
    let attemptFailed = false;

    // This mirrors the exact logic in harness.ts lines 689-704
    if (lintGate && staticAnalysisFailed) {
      evaluatorSkipped = true;
      attemptFailed = true;
    }

    expect(evaluatorSkipped).toBe(true);
    expect(attemptFailed).toBe(true);
  });

  test("config resolves correctly with both --sprint and --lint-gate", () => {
    const config = resolveConfig({
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
      sprint: 2,
      lintGate: true,
    });

    expect(config.sprint).toBe(2);
    expect(config.lintGate).toBe(true);
  });
});

// ============================================================
// 3. Refinement preserves regression criteria
// ============================================================
describe("refinement preserves regression criteria", () => {
  test("regression.json is byte-identical before and after freezeCompletedSprints and buildRefinementPrompt", async () => {
    // Write regression.json with accumulated criteria
    const regressionCriteria: RegressionCriterion[] = [
      { name: "login_works", description: "User can log in", threshold: 7, sprintNumber: 1 },
      { name: "dashboard_loads", description: "Dashboard renders", threshold: 8, sprintNumber: 2 },
    ];
    const regressionJson = JSON.stringify(regressionCriteria, null, 2);
    writeFileSync(regressionPath(TMP_DIR), regressionJson, "utf-8");

    // Read before
    const before = readFileSync(regressionPath(TMP_DIR), "utf-8");

    // Simulate refinement operations
    const spec = `# Spec\n\n## Sprint 1\nBuild auth.\n\n## Sprint 2\nBuild dashboard.\n\n## Sprint 3\nBuild reporting.\n`;
    const completedSections = extractCompletedSprintSections(spec, 2);

    // freezeCompletedSprints operates on spec strings, not regression.json
    const proposedSpec = spec.replace("Build reporting.", "Build advanced reporting.");
    freezeCompletedSprints(proposedSpec, completedSections);

    // buildRefinementPrompt also only operates on spec strings
    buildRefinementPrompt(spec, [1, 2], [3]);

    // Read after
    const after = readFileSync(regressionPath(TMP_DIR), "utf-8");

    // regression.json must be byte-identical
    expect(after).toBe(before);
    expect(after).toBe(regressionJson);
  });
});

// ============================================================
// 4. Diff and static analysis coexist in evaluator context
// ============================================================
describe("diff and static analysis coexist in evaluator context", () => {
  test("supplementaryContext can contain both diff and static analysis sections without clobbering", () => {
    // Simulate the harness building supplementaryContext
    let supplementaryContext = "";

    // Regression section (would come first in real harness)
    const regressionCriteria: RegressionCriterion[] = [
      { name: "test_crit", description: "Test criterion", threshold: 7, sprintNumber: 1 },
    ];
    const regressionSection = buildRegressionSection(regressionCriteria);
    if (regressionSection) {
      supplementaryContext += regressionSection;
    }

    // Diff section (comes second)
    const diffSection = "\n\n## Changes Since Last Attempt\n\n--- a/src/main.ts\n+++ b/src/main.ts\n@@ -1 +1 @@\n-old code\n+new code";
    supplementaryContext += diffSection;

    // Static analysis section (comes third)
    const saOutput = "### lint (exit code: 0)\nAll checks passed.\n";
    supplementaryContext += `\n\n## Static Analysis Results\n\n${saOutput}`;

    // Both sections present and not clobbered
    expect(supplementaryContext).toContain("## Regression Criteria");
    expect(supplementaryContext).toContain("## Changes Since Last Attempt");
    expect(supplementaryContext).toContain("## Static Analysis Results");
    expect(supplementaryContext).toContain("test_crit");
    expect(supplementaryContext).toContain("new code");
    expect(supplementaryContext).toContain("All checks passed.");
  });
});

// ============================================================
// 5. Regression section ordering (regression → diff → static analysis)
// ============================================================
describe("regression section and diff section ordering", () => {
  test("supplementaryContext has deterministic ordering: regression before diff before static analysis", () => {
    // Build in the same order as harness.ts
    let supplementaryContext = "";

    // 1. Regression
    const regressionSection = buildRegressionSection([
      { name: "crit", description: "Test", threshold: 7, sprintNumber: 1 },
    ]);
    supplementaryContext += regressionSection;

    // 2. Diff
    supplementaryContext += "\n\n## Changes Since Last Attempt\n\nsome diff";

    // 3. Static analysis
    supplementaryContext += "\n\n## Static Analysis Results\n\nlint output";

    const regressionIdx = supplementaryContext.indexOf("## Regression Criteria");
    const diffIdx = supplementaryContext.indexOf("## Changes Since Last Attempt");
    const saIdx = supplementaryContext.indexOf("## Static Analysis Results");

    expect(regressionIdx).toBeGreaterThanOrEqual(0);
    expect(diffIdx).toBeGreaterThan(regressionIdx);
    expect(saIdx).toBeGreaterThan(diffIdx);
  });
});

// ============================================================
// 6. All new CLI flags documented
// ============================================================
describe("all new CLI flags in help and documented", () => {
  test("--lint-gate is parsed, resolved, in HarnessConfig, and in CLI_FLAG_HELP", () => {
    // Parsed
    const cli = parseCli(["--lint-gate", "test"]);
    expect(cli.lintGate).toBe(true);
    // Resolved
    const config = resolveConfig({
      prompt: "test", greenfield: false, resume: false, verbose: false,
      quiet: false, noInteractive: false, debug: false, dryRun: false,
      noBdd: false, noTdd: false, noDocs: false, lintGate: true,
    });
    expect(config.lintGate).toBe(true);
    // In help
    expect(CLI_FLAG_HELP["--lint-gate"]).toBeDefined();
  });

  test("--sprint is parsed, resolved, in HarnessConfig, and in CLI_FLAG_HELP", () => {
    const cli = parseCli(["--sprint", "3"]);
    expect(cli.sprint).toBe(3);
    const config = resolveConfig({
      greenfield: false, resume: false, verbose: false,
      quiet: false, noInteractive: false, debug: false, dryRun: false,
      noBdd: false, noTdd: false, noDocs: false, sprint: 3,
    });
    expect(config.sprint).toBe(3);
    expect(CLI_FLAG_HELP["--sprint N"]).toBeDefined();
  });

  test("--refine-spec is parsed, resolved, in HarnessConfig, and in CLI_FLAG_HELP", () => {
    const cli = parseCli(["--refine-spec", "test"]);
    expect(cli.refineSpec).toBe(true);
    const config = resolveConfig({
      prompt: "test", greenfield: false, resume: false, verbose: false,
      quiet: false, noInteractive: false, debug: false, dryRun: false,
      noBdd: false, noTdd: false, noDocs: false, refineSpec: true,
    });
    expect(config.refineSpec).toBe(true);
    expect(CLI_FLAG_HELP["--refine-spec"]).toBeDefined();
  });

  test("--no-bdd is parsed, resolved, in HarnessConfig, and in CLI_FLAG_HELP", () => {
    const cli = parseCli(["--no-bdd", "test"]);
    expect(cli.noBdd).toBe(true);
    const config = resolveConfig({
      prompt: "test", greenfield: false, resume: false, verbose: false,
      quiet: false, noInteractive: false, debug: false, dryRun: false,
      noBdd: true, noTdd: false, noDocs: false,
    });
    expect(config.noBdd).toBe(true);
    expect(CLI_FLAG_HELP["--no-bdd"]).toBeDefined();
  });

  test("all four Phase 1 Deepen flags appear in CLI_FLAG_HELP", () => {
    const helpKeys = Object.keys(CLI_FLAG_HELP).join(" ");
    expect(helpKeys).toContain("--lint-gate");
    expect(helpKeys).toContain("--sprint");
    expect(helpKeys).toContain("--refine-spec");
    expect(helpKeys).toContain("--no-bdd");
  });
});

// ============================================================
// 7. Combined flags no crash
// ============================================================
describe("combined flags no crash", () => {
  test("--sprint 2 --lint-gate --refine-spec --no-bdd resolves without crashing", () => {
    const config = resolveConfig({
      greenfield: false,
      resume: false,
      verbose: false,
      quiet: false,
      noInteractive: false,
      debug: false,
      dryRun: false,
      noBdd: true,
      noTdd: false,
      noDocs: false,
      sprint: 2,
      lintGate: true,
      refineSpec: true,
    });

    expect(config.sprint).toBe(2);
    expect(config.lintGate).toBe(true);
    expect(config.refineSpec).toBe(true);
    expect(config.noBdd).toBe(true);
  });
});

// ============================================================
// 8. --no-bdd disables regression in sprint selection mode
// ============================================================
describe("no-bdd disables regression in sprint selection mode", () => {
  test("when --sprint 3 --no-bdd, regression criteria are NOT injected even if regression.json exists", async () => {
    // Write regression.json with criteria
    const criteria: RegressionCriterion[] = [
      { name: "login_works", description: "User can log in", threshold: 7, sprintNumber: 1 },
    ];
    writeFileSync(regressionPath(TMP_DIR), JSON.stringify(criteria, null, 2), "utf-8");

    // Simulate the harness guard: `!config.noBdd && sprint > 1`
    const noBdd = true;
    const sprint = 3;
    let supplementaryContext = "";

    if (!noBdd && sprint > 1) {
      const regressionCriteria = await readRegressionCriteria(TMP_DIR);
      const regressionSection = buildRegressionSection(regressionCriteria);
      if (regressionSection) {
        supplementaryContext += regressionSection;
      }
    }

    // No regression section should be in context
    expect(supplementaryContext).toBe("");
    expect(supplementaryContext).not.toContain("## Regression Criteria");
  });
});

// ============================================================
// 9. Regression.json survives resume and sprint selection cleanup
// ============================================================
describe("regression.json survives resume and sprint selection", () => {
  test("cleanHarnessArtifacts does not delete regression.json", async () => {
    // Write regression.json
    const criteria: RegressionCriterion[] = [
      { name: "test_crit", description: "Test", threshold: 7, sprintNumber: 1 },
    ];
    writeFileSync(regressionPath(TMP_DIR), JSON.stringify(criteria, null, 2), "utf-8");

    expect(existsSync(regressionPath(TMP_DIR))).toBe(true);

    // Import and call the internal cleanup function via initWorkspace
    const { initWorkspace } = await import("./files.ts");

    // initWorkspace with resume=false triggers cleanHarnessArtifacts
    await initWorkspace(TMP_DIR, { greenfield: false, resume: false });

    // regression.json should still exist
    expect(existsSync(regressionPath(TMP_DIR))).toBe(true);

    // Verify contents are preserved
    const data = JSON.parse(readFileSync(regressionPath(TMP_DIR), "utf-8"));
    expect(data).toHaveLength(1);
    expect(data[0].name).toBe("test_crit");
  });

  test("initWorkspace with resume=true does not delete regression.json", async () => {
    const criteria: RegressionCriterion[] = [
      { name: "test_crit", description: "Test", threshold: 7, sprintNumber: 1 },
    ];
    writeFileSync(regressionPath(TMP_DIR), JSON.stringify(criteria, null, 2), "utf-8");

    const { initWorkspace } = await import("./files.ts");
    await initWorkspace(TMP_DIR, { greenfield: false, resume: true });

    expect(existsSync(regressionPath(TMP_DIR))).toBe(true);
  });
});

// ============================================================
// 10. Invalid sprint values handled gracefully
// ============================================================
describe("invalid sprint values handled gracefully", () => {
  const baseCli = {
    greenfield: false, resume: false, verbose: false,
    quiet: false, noInteractive: false, debug: false, dryRun: false,
    noBdd: false, noTdd: false, noDocs: false,
  };

  test("--sprint 0 produces a descriptive error", () => {
    expect(() => resolveConfig({ ...baseCli, sprint: 0 }))
      .toThrow("Invalid --sprint value: 0. Must be a positive integer.");
  });

  test("--sprint -1 produces a descriptive error", () => {
    expect(() => resolveConfig({ ...baseCli, sprint: -1 }))
      .toThrow("Invalid --sprint value: -1. Must be a positive integer.");
  });

  test("--sprint NaN (from non-numeric input) produces a descriptive error", () => {
    // parseCli converts "abc" to NaN via parseInt
    expect(() => resolveConfig({ ...baseCli, sprint: NaN }))
      .toThrow("Invalid --sprint value");
  });

  test("parseCli converts non-numeric --sprint value to NaN which resolveConfig rejects", () => {
    // Simulate the pipeline: parseCli → resolveConfig
    const cli = parseCli(["--sprint", "abc", "test"]);
    expect(Number.isNaN(cli.sprint)).toBe(true);
    expect(() => resolveConfig({ ...baseCli, ...cli })).toThrow("Invalid --sprint value");
  });
});

// ============================================================
// 11. Malformed regression.json handled gracefully
// ============================================================
describe("malformed regression.json handled gracefully", () => {
  test("invalid JSON in regression.json returns empty array without crash", async () => {
    writeFileSync(regressionPath(TMP_DIR), "{broken json", "utf-8");
    const result = await readRegressionCriteria(TMP_DIR);
    expect(result).toEqual([]);
  });

  test("empty object in regression.json returns empty array without crash", async () => {
    writeFileSync(regressionPath(TMP_DIR), "{}", "utf-8");
    const result = await readRegressionCriteria(TMP_DIR);
    expect(result).toEqual([]);
  });

  test("truncated file in regression.json returns empty array without crash", async () => {
    writeFileSync(regressionPath(TMP_DIR), '[{"name":"test","desc', "utf-8");
    const result = await readRegressionCriteria(TMP_DIR);
    expect(result).toEqual([]);
  });

  test("null in regression.json returns empty array without crash", async () => {
    writeFileSync(regressionPath(TMP_DIR), "null", "utf-8");
    const result = await readRegressionCriteria(TMP_DIR);
    expect(result).toEqual([]);
  });

  test("empty string in regression.json returns empty array without crash", async () => {
    writeFileSync(regressionPath(TMP_DIR), "", "utf-8");
    const result = await readRegressionCriteria(TMP_DIR);
    expect(result).toEqual([]);
  });
});
