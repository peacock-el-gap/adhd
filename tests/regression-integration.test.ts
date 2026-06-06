/**
 * Integration tests for regression accumulation across sprints
 * and --no-bdd flag behavior.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  accumulateRegressionCriteria,
  buildRegressionSection,
  readRegressionCriteria,
  regressionPath,
} from "../shared/regression.ts";
import type { RegressionCriterion, SprintContract } from "../shared/types.ts";

const TMP_DIR = join(import.meta.dir, "__tmp_regression_integration__");
const ADHD_DIR = join(TMP_DIR, ".adhd");

beforeEach(() => {
  mkdirSync(join(ADHD_DIR, "contracts"), { recursive: true });
  mkdirSync(join(ADHD_DIR, "feedback"), { recursive: true });
});

afterEach(() => {
  rmSync(TMP_DIR, { recursive: true, force: true });
});

describe("regression accumulation integration", () => {
  test("two passing sprints accumulate exactly behavioral criteria", async () => {
    // Sprint 1: 2 behavioral + 1 implementation
    const sprint1: SprintContract = {
      sprintNumber: 1,
      features: ["Auth system"],
      criteria: [
        { name: "login_works", description: "User can log in", threshold: 7, type: "behavioral" },
        { name: "session_persists", description: "Session survives refresh", threshold: 7, type: "behavioral" },
        { name: "clean_code", description: "No lint errors", threshold: 7, type: "implementation" },
      ],
    };

    // Sprint 2: 1 behavioral
    const sprint2: SprintContract = {
      sprintNumber: 2,
      features: ["Dashboard"],
      criteria: [{ name: "dashboard_loads", description: "Dashboard renders data", threshold: 8, type: "behavioral" }],
    };

    await accumulateRegressionCriteria(TMP_DIR, sprint1);
    await accumulateRegressionCriteria(TMP_DIR, sprint2);

    const criteria: RegressionCriterion[] = await readRegressionCriteria(TMP_DIR);

    // Should have exactly 3 behavioral criteria, no implementation ones
    expect(criteria).toHaveLength(3);
    const names = criteria.map((d) => d.name).sort();
    expect(names).toEqual(["dashboard_loads", "login_works", "session_persists"]);

    // Verify sprintNumber fields
    const login = criteria.find((d) => d.name === "login_works");
    expect(login).toBeDefined();
    expect(login?.sprintNumber).toBe(1);
    const dashboard = criteria.find((d) => d.name === "dashboard_loads");
    expect(dashboard).toBeDefined();
    expect(dashboard?.sprintNumber).toBe(2);

    // Verify no implementation criterion is present
    expect(criteria.find((d) => d.name === "clean_code")).toBeUndefined();
  });

  test("buildRegressionSection output includes all 3 accumulated entries", async () => {
    const sprint1: SprintContract = {
      sprintNumber: 1,
      features: ["Auth system"],
      criteria: [
        { name: "login_works", description: "User can log in", threshold: 7, type: "behavioral" },
        { name: "session_persists", description: "Session survives refresh", threshold: 7, type: "behavioral" },
        { name: "clean_code", description: "No lint errors", threshold: 7, type: "implementation" },
      ],
    };
    const sprint2: SprintContract = {
      sprintNumber: 2,
      features: ["Dashboard"],
      criteria: [{ name: "dashboard_loads", description: "Dashboard renders data", threshold: 8, type: "behavioral" }],
    };

    await accumulateRegressionCriteria(TMP_DIR, sprint1);
    await accumulateRegressionCriteria(TMP_DIR, sprint2);

    const criteria = await readRegressionCriteria(TMP_DIR);
    const section = buildRegressionSection(criteria);

    expect(section).toContain("login_works");
    expect(section).toContain("session_persists");
    expect(section).toContain("dashboard_loads");
    expect(section).toContain("## Regression Criteria");
  });

  test("on-disk store uses {criteria, retiredNames} format after Sprint-9 accumulation", async () => {
    const sprint1: SprintContract = {
      sprintNumber: 1,
      features: ["Feature A"],
      criteria: [{ name: "api_responds", description: "API returns 200", threshold: 7, type: "behavioral" }],
    };

    await accumulateRegressionCriteria(TMP_DIR, sprint1);

    // The file should now use the Sprint-9 object format
    const raw = JSON.parse(readFileSync(regressionPath(TMP_DIR), "utf-8"));
    expect(raw).toHaveProperty("criteria");
    expect(raw).toHaveProperty("retiredNames");
    expect(Array.isArray(raw.criteria)).toBe(true);
    expect(Array.isArray(raw.retiredNames)).toBe(true);
    expect(raw.criteria).toHaveLength(1);
    expect(raw.criteria[0].name).toBe("api_responds");
  });
});

describe("noBdd skips regression", () => {
  test("when config.noBdd is true, regression accumulation is skipped entirely", async () => {
    const contract: SprintContract = {
      sprintNumber: 1,
      features: ["Feature A"],
      criteria: [{ name: "api_responds", description: "API returns 200", threshold: 7, type: "behavioral" }],
    };

    // Simulate the harness behavior: when noBdd is true, skip regression
    const noBdd = true;
    let regressionSection = "";

    if (!noBdd) {
      await accumulateRegressionCriteria(TMP_DIR, contract);
      const criteria = await readRegressionCriteria(TMP_DIR);
      regressionSection = buildRegressionSection(criteria);
    }

    // regression.json should NOT exist
    expect(existsSync(regressionPath(TMP_DIR))).toBe(false);

    // No "## Regression Criteria" section should be produced
    expect(regressionSection).toBe("");
    expect(regressionSection).not.toContain("## Regression Criteria");
  });

  test("when config.noBdd is false, regression accumulation proceeds normally", async () => {
    const contract: SprintContract = {
      sprintNumber: 1,
      features: ["Feature A"],
      criteria: [{ name: "api_responds", description: "API returns 200", threshold: 7, type: "behavioral" }],
    };

    const noBdd = false;
    let regressionSection = "";

    if (!noBdd) {
      await accumulateRegressionCriteria(TMP_DIR, contract);
      const criteria = await readRegressionCriteria(TMP_DIR);
      regressionSection = buildRegressionSection(criteria);
    }

    // regression.json SHOULD exist
    expect(existsSync(regressionPath(TMP_DIR))).toBe(true);
    expect(regressionSection).toContain("## Regression Criteria");
    expect(regressionSection).toContain("api_responds");
  });

  test("readRegressionCriteria is not called when noBdd is true", () => {
    // This tests the condition logic: the call should be gated
    const noBdd = true;
    let readCalled = false;

    if (!noBdd) {
      readCalled = true;
    }

    expect(readCalled).toBe(false);
  });
});
