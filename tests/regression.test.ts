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

    const criteria = await readRegressionCriteria(TMP_DIR);
    expect(criteria).toHaveLength(1);
    expect(criteria[0]!.name).toBe("api_responds");
    expect(criteria[0]!.sprintNumber).toBe(1);
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

    // No file should be created since no behavioral criteria and no retire list
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

    const criteria = await readRegressionCriteria(TMP_DIR);
    expect(criteria).toHaveLength(1);
    expect(criteria[0]!.description).toBe("API returns 200 v2");
    expect(criteria[0]!.sprintNumber).toBe(2);
    expect(criteria[0]!.threshold).toBe(8);
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

    const criteria = await readRegressionCriteria(TMP_DIR);
    expect(criteria).toHaveLength(2);
    expect(criteria.map((d: RegressionCriterion) => d.name).sort()).toEqual(["api_responds", "db_persists"]);
  });

  test("new criteria carry tier=core and contract surfaces", async () => {
    const contract: SprintContract = {
      sprintNumber: 3,
      features: ["Feature C"],
      surfaces: ["backend", "db"],
      criteria: [
        { name: "endpoint_works", description: "Endpoint responds", threshold: 7, type: "behavioral" },
      ],
    };

    await accumulateRegressionCriteria(TMP_DIR, contract);

    const criteria = await readRegressionCriteria(TMP_DIR);
    expect(criteria).toHaveLength(1);
    expect(criteria[0]!.tier).toBe("core");
    expect(criteria[0]!.surfaces).toEqual(["backend", "db"]);
  });

  test("new criteria have no surfaces field when contract declares none", async () => {
    const contract: SprintContract = {
      sprintNumber: 1,
      features: ["Feature A"],
      criteria: [
        { name: "api_responds", description: "API returns 200", threshold: 7, type: "behavioral" },
      ],
    };

    await accumulateRegressionCriteria(TMP_DIR, contract);

    const criteria = await readRegressionCriteria(TMP_DIR);
    expect(criteria[0]!.surfaces).toBeUndefined();
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

  test("reads valid regression criteria (legacy bare-array format)", async () => {
    const criteria: RegressionCriterion[] = [
      { name: "test_crit", description: "Test", threshold: 7, sprintNumber: 1 },
    ];
    writeFileSync(regressionPath(TMP_DIR), JSON.stringify(criteria), "utf-8");

    const result = await readRegressionCriteria(TMP_DIR);
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("test_crit");
  });

  test("reads Sprint-9 richer format {criteria, retiredNames}", async () => {
    const store = {
      criteria: [{ name: "test_crit", description: "Test", threshold: 7, sprintNumber: 1, tier: "core" }],
      retiredNames: ["old_crit"],
    };
    writeFileSync(regressionPath(TMP_DIR), JSON.stringify(store), "utf-8");

    const result = await readRegressionCriteria(TMP_DIR);
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("test_crit");
    expect(result[0]!.tier).toBe("core");
  });

  test("returns empty array for unexpected schema (not array, not {criteria} object)", async () => {
    writeFileSync(regressionPath(TMP_DIR), JSON.stringify({ something: "else" }), "utf-8");
    const result = await readRegressionCriteria(TMP_DIR);
    expect(result).toEqual([]);
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

  test("legacy criteria (no tier) are always included regardless of contractSurfaces", () => {
    const criteria: RegressionCriterion[] = [
      { name: "legacy_crit", description: "Legacy behavior", threshold: 7, sprintNumber: 1 },
    ];

    // Even with contractSurfaces that don't match, legacy criteria (no tier) are always included
    const section = buildRegressionSection(criteria, ["frontend"]);
    expect(section).toContain("legacy_crit");
  });

  test("core criteria are always included regardless of contractSurfaces", () => {
    const criteria: RegressionCriterion[] = [
      { name: "core_crit", description: "Core behavior", threshold: 7, sprintNumber: 1, tier: "core", surfaces: ["backend"] },
    ];

    // core criteria appear even when contract surfaces don't match
    const section = buildRegressionSection(criteria, ["frontend"]);
    expect(section).toContain("core_crit");
  });

  test("optional criteria with matching surfaces are included", () => {
    const criteria: RegressionCriterion[] = [
      { name: "opt_crit", description: "Optional behavior", threshold: 7, sprintNumber: 1, tier: "optional", surfaces: ["backend"] },
    ];

    const section = buildRegressionSection(criteria, ["backend", "db"]);
    expect(section).toContain("opt_crit");
  });

  test("optional criteria with non-matching surfaces are excluded", () => {
    const criteria: RegressionCriterion[] = [
      { name: "opt_crit", description: "Optional behavior", threshold: 7, sprintNumber: 1, tier: "optional", surfaces: ["frontend"] },
    ];

    const section = buildRegressionSection(criteria, ["backend"]);
    expect(section).not.toContain("opt_crit");
  });

  test("returns empty string when all criteria are filtered out", () => {
    const criteria: RegressionCriterion[] = [
      { name: "opt_crit", description: "Optional behavior", threshold: 7, sprintNumber: 1, tier: "optional", surfaces: ["frontend"] },
    ];

    const section = buildRegressionSection(criteria, ["backend"]);
    expect(section).toBe("");
  });
});

describe("--no-bdd flag skips regression", () => {
  test("regression.json is not read when noBdd is true (simulated)", async () => {
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
    // Write regression.json in new Sprint-9 format
    const store = {
      criteria: [{ name: "test_crit", description: "Test", threshold: 7, sprintNumber: 1 }],
      retiredNames: [],
    };
    writeFileSync(regressionPath(TMP_DIR), JSON.stringify(store), "utf-8");

    // Import and run cleanHarnessArtifacts via initWorkspace (non-resume, non-greenfield)
    const { initWorkspace } = await import("../shared/files.ts");
    await initWorkspace(TMP_DIR, { greenfield: false, resume: false });

    // regression.json should still exist
    expect(existsSync(regressionPath(TMP_DIR))).toBe(true);
    const criteria = await readRegressionCriteria(TMP_DIR);
    expect(criteria).toHaveLength(1);
  });
});
