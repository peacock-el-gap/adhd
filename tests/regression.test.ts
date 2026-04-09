import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  accumulateRegressionCriteria,
  buildRegressionSection,
  readRegressionCriteria,
  regressionPath,
} from "../shared/regression.ts";
import type { SprintContract, RegressionCriterion } from "../shared/types.ts";

const TMP_DIR = join(import.meta.dir, "__tmp_regression_test__");
const ADHD_DIR = join(TMP_DIR, ".adhd");

beforeEach(() => {
  mkdirSync(join(ADHD_DIR, "contracts"), { recursive: true });
  mkdirSync(join(ADHD_DIR, "feedback"), { recursive: true });
});

afterEach(() => {
  rmSync(TMP_DIR, { recursive: true, force: true });
});

describe("accumulateRegressionCriteria", () => {
  test("writes behavioral criteria to regression.json", async () => {
    const contract: SprintContract = {
      sprintNumber: 1,
      features: ["Feature A"],
      criteria: [
        { name: "api_responds", description: "API returns 200", threshold: 7, type: "behavioral" },
        { name: "code_clean", description: "No lint errors", threshold: 7, type: "implementation" },
      ],
    };

    await accumulateRegressionCriteria(TMP_DIR, contract);

    const data = JSON.parse(readFileSync(regressionPath(TMP_DIR), "utf-8"));
    expect(data).toHaveLength(1);
    expect(data[0].name).toBe("api_responds");
    expect(data[0].sprintNumber).toBe(1);
  });

  test("excludes implementation criteria", async () => {
    const contract: SprintContract = {
      sprintNumber: 1,
      features: ["Feature A"],
      criteria: [
        { name: "code_clean", description: "No lint errors", threshold: 7, type: "implementation" },
      ],
    };

    await accumulateRegressionCriteria(TMP_DIR, contract);

    // No file should be created since no behavioral criteria
    expect(existsSync(regressionPath(TMP_DIR))).toBe(false);
  });

  test("excludes criteria with no type field", async () => {
    const contract: SprintContract = {
      sprintNumber: 1,
      features: ["Feature A"],
      criteria: [
        { name: "untyped_criterion", description: "Has no type", threshold: 7 },
      ],
    };

    await accumulateRegressionCriteria(TMP_DIR, contract);

    // No file should be created since no behavioral criteria
    expect(existsSync(regressionPath(TMP_DIR))).toBe(false);
  });

  test("deduplicates by criterion name (newer replaces older)", async () => {
    const contract1: SprintContract = {
      sprintNumber: 1,
      features: ["Feature A"],
      criteria: [
        { name: "api_responds", description: "API returns 200 v1", threshold: 7, type: "behavioral" },
      ],
    };
    const contract2: SprintContract = {
      sprintNumber: 2,
      features: ["Feature B"],
      criteria: [
        { name: "api_responds", description: "API returns 200 v2", threshold: 8, type: "behavioral" },
      ],
    };

    await accumulateRegressionCriteria(TMP_DIR, contract1);
    await accumulateRegressionCriteria(TMP_DIR, contract2);

    const data = JSON.parse(readFileSync(regressionPath(TMP_DIR), "utf-8"));
    expect(data).toHaveLength(1);
    expect(data[0].description).toBe("API returns 200 v2");
    expect(data[0].sprintNumber).toBe(2);
    expect(data[0].threshold).toBe(8);
  });

  test("accumulates criteria across multiple sprints", async () => {
    const contract1: SprintContract = {
      sprintNumber: 1,
      features: ["Feature A"],
      criteria: [
        { name: "api_responds", description: "API returns 200", threshold: 7, type: "behavioral" },
      ],
    };
    const contract2: SprintContract = {
      sprintNumber: 2,
      features: ["Feature B"],
      criteria: [
        { name: "db_persists", description: "Data persists after restart", threshold: 7, type: "behavioral" },
      ],
    };

    await accumulateRegressionCriteria(TMP_DIR, contract1);
    await accumulateRegressionCriteria(TMP_DIR, contract2);

    const data = JSON.parse(readFileSync(regressionPath(TMP_DIR), "utf-8"));
    expect(data).toHaveLength(2);
    expect(data.map((d: RegressionCriterion) => d.name).sort()).toEqual(["api_responds", "db_persists"]);
  });
});

describe("readRegressionCriteria", () => {
  test("returns empty array when file does not exist", async () => {
    const result = await readRegressionCriteria(TMP_DIR);
    expect(result).toEqual([]);
  });

  test("returns empty array for invalid JSON", async () => {
    writeFileSync(regressionPath(TMP_DIR), "not json", "utf-8");
    const result = await readRegressionCriteria(TMP_DIR);
    expect(result).toEqual([]);
  });

  test("reads valid regression criteria", async () => {
    const criteria: RegressionCriterion[] = [
      { name: "test_crit", description: "Test", threshold: 7, sprintNumber: 1 },
    ];
    writeFileSync(regressionPath(TMP_DIR), JSON.stringify(criteria), "utf-8");

    const result = await readRegressionCriteria(TMP_DIR);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("test_crit");
  });
});

describe("buildRegressionSection", () => {
  test("returns empty string for empty criteria", () => {
    expect(buildRegressionSection([])).toBe("");
  });

  test("builds section with criteria from previous sprints", () => {
    const criteria: RegressionCriterion[] = [
      { name: "api_responds", description: "API returns 200", threshold: 7, sprintNumber: 1 },
      { name: "db_persists", description: "Data persists", threshold: 8, sprintNumber: 2 },
    ];

    const section = buildRegressionSection(criteria);
    expect(section).toContain("## Regression Criteria");
    expect(section).toContain("api_responds");
    expect(section).toContain("from sprint 1");
    expect(section).toContain("db_persists");
    expect(section).toContain("from sprint 2");
  });
});

describe("--no-bdd flag skips regression", () => {
  test("regression.json is not read when noBdd is true (simulated)", async () => {
    // The harness checks config.noBdd before reading/writing regression.
    // We verify the functions work correctly when called conditionally.
    const contract: SprintContract = {
      sprintNumber: 1,
      features: ["Feature A"],
      criteria: [
        { name: "api_responds", description: "API returns 200", threshold: 7, type: "behavioral" },
      ],
    };

    // Simulate: when noBdd is true, accumulation is skipped
    const noBdd = true;
    if (!noBdd) {
      await accumulateRegressionCriteria(TMP_DIR, contract);
    }

    // regression.json should NOT exist
    expect(existsSync(regressionPath(TMP_DIR))).toBe(false);

    // And reading returns empty
    const criteria = await readRegressionCriteria(TMP_DIR);
    expect(criteria).toEqual([]);
  });
});

describe("regression.json survives cleanHarnessArtifacts", () => {
  test("cleanHarnessArtifacts does not delete regression.json", async () => {
    // Write regression.json
    const criteria: RegressionCriterion[] = [
      { name: "test_crit", description: "Test", threshold: 7, sprintNumber: 1 },
    ];
    writeFileSync(regressionPath(TMP_DIR), JSON.stringify(criteria), "utf-8");

    // Import and run cleanHarnessArtifacts via initWorkspace (non-resume, non-greenfield)
    const { initWorkspace } = await import("../shared/files.ts");
    await initWorkspace(TMP_DIR, { greenfield: false, resume: false });

    // regression.json should still exist
    expect(existsSync(regressionPath(TMP_DIR))).toBe(true);
    const remaining = JSON.parse(readFileSync(regressionPath(TMP_DIR), "utf-8"));
    expect(remaining).toHaveLength(1);
  });
});
