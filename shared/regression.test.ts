import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  accumulateRegressionCriteria,
  buildRegressionSection,
  readRegressionCriteria,
  regressionPath,
} from "./regression.ts";
import type { RegressionCriterion, SprintContract } from "./types.ts";

const TMP_DIR = join(import.meta.dir, "__tmp_regression_unit__");
const ADHD_DIR = join(TMP_DIR, ".adhd");

beforeEach(() => {
  mkdirSync(join(ADHD_DIR, "contracts"), { recursive: true });
  mkdirSync(join(ADHD_DIR, "feedback"), { recursive: true });
});

afterEach(() => {
  rmSync(TMP_DIR, { recursive: true, force: true });
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

  test("returns empty array for non-array JSON", async () => {
    writeFileSync(regressionPath(TMP_DIR), '{"not":"array"}', "utf-8");
    const result = await readRegressionCriteria(TMP_DIR);
    expect(result).toEqual([]);
  });

  test("reads valid regression criteria from file", async () => {
    const criteria: RegressionCriterion[] = [
      { name: "test_crit", description: "Test criterion", threshold: 7, sprintNumber: 1 },
    ];
    writeFileSync(regressionPath(TMP_DIR), JSON.stringify(criteria), "utf-8");

    const result = await readRegressionCriteria(TMP_DIR);
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe("test_crit");
    expect(result[0]?.sprintNumber).toBe(1);
  });
});

describe("accumulateRegressionCriteria", () => {
  test("filters only behavioral criteria", async () => {
    const contract: SprintContract = {
      sprintNumber: 1,
      features: ["Feature A"],
      criteria: [
        { name: "api_responds", description: "API returns 200", threshold: 7, type: "behavioral" },
        { name: "code_clean", description: "No lint errors", threshold: 7, type: "implementation" },
        { name: "untyped", description: "No type field", threshold: 7 },
      ],
    };

    await accumulateRegressionCriteria(TMP_DIR, contract);

    const data = JSON.parse(readFileSync(regressionPath(TMP_DIR), "utf-8"));
    expect(data).toHaveLength(1);
    expect(data[0].name).toBe("api_responds");
    expect(data[0].sprintNumber).toBe(1);
  });

  test("does not write file when no behavioral criteria exist", async () => {
    const contract: SprintContract = {
      sprintNumber: 1,
      features: ["Feature A"],
      criteria: [{ name: "code_clean", description: "No lint errors", threshold: 7, type: "implementation" }],
    };

    await accumulateRegressionCriteria(TMP_DIR, contract);
    expect(existsSync(regressionPath(TMP_DIR))).toBe(false);
  });

  test("deduplication by name replaces older entries", async () => {
    const contract1: SprintContract = {
      sprintNumber: 1,
      features: ["Feature A"],
      criteria: [{ name: "api_responds", description: "v1", threshold: 7, type: "behavioral" }],
    };
    const contract2: SprintContract = {
      sprintNumber: 2,
      features: ["Feature B"],
      criteria: [{ name: "api_responds", description: "v2", threshold: 8, type: "behavioral" }],
    };

    await accumulateRegressionCriteria(TMP_DIR, contract1);
    await accumulateRegressionCriteria(TMP_DIR, contract2);

    const data = JSON.parse(readFileSync(regressionPath(TMP_DIR), "utf-8"));
    expect(data).toHaveLength(1);
    expect(data[0].description).toBe("v2");
    expect(data[0].sprintNumber).toBe(2);
    expect(data[0].threshold).toBe(8);
  });

  test("accumulates criteria from multiple sprints", async () => {
    const contract1: SprintContract = {
      sprintNumber: 1,
      features: ["Feature A"],
      criteria: [{ name: "api_responds", description: "API returns 200", threshold: 7, type: "behavioral" }],
    };
    const contract2: SprintContract = {
      sprintNumber: 2,
      features: ["Feature B"],
      criteria: [{ name: "db_persists", description: "Data persists", threshold: 7, type: "behavioral" }],
    };

    await accumulateRegressionCriteria(TMP_DIR, contract1);
    await accumulateRegressionCriteria(TMP_DIR, contract2);

    const data: RegressionCriterion[] = JSON.parse(readFileSync(regressionPath(TMP_DIR), "utf-8"));
    expect(data).toHaveLength(2);
    expect(data.map((d) => d.name).sort()).toEqual(["api_responds", "db_persists"]);
  });
});

describe("buildRegressionSection", () => {
  test("returns empty string for empty criteria", () => {
    expect(buildRegressionSection([])).toBe("");
  });

  test("produces correct markdown format with sprint numbers and thresholds", () => {
    const criteria: RegressionCriterion[] = [
      { name: "api_responds", description: "API returns 200", threshold: 7, sprintNumber: 1 },
      { name: "db_persists", description: "Data persists", threshold: 8, sprintNumber: 2 },
    ];

    const section = buildRegressionSection(criteria);
    expect(section).toContain("## Regression Criteria");
    expect(section).toContain("**api_responds** (from sprint 1, threshold: 7/10)");
    expect(section).toContain("**db_persists** (from sprint 2, threshold: 8/10)");
    expect(section).toContain("API returns 200");
    expect(section).toContain("Data persists");
  });

  test("includes instruction text about scoring", () => {
    const criteria: RegressionCriterion[] = [{ name: "test", description: "Test", threshold: 7, sprintNumber: 1 }];

    const section = buildRegressionSection(criteria);
    expect(section).toContain("MUST still pass");
  });
});
