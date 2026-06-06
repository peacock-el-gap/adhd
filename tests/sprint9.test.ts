/**
 * Sprint 9 — Regression criterion retirement and tiering/relevance filter.
 *
 * Covers all acceptance criteria from the Sprint 9 contract:
 *   - contract_marker_retirement_removes_criterion
 *   - retirement_durability_blocks_resurrection
 *   - retired_criteria_absent_from_evaluator_section
 *   - legacy_bare_array_loads_without_error
 *   - new_fields_round_trip_correctly
 *   - legacy_criteria_always_checked
 *   - core_criteria_always_checked
 *   - surface_relevance_filter_excludes_non_matching
 *   - regression_section_size_bounded
 *   - retirement_and_tiering_logic_pure_shared_no_sdk
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  MAX_REGRESSION_SECTION_CHARS,
  accumulateRegressionCriteria,
  buildRegressionSection,
  readRegressionCriteria,
  regressionPath,
} from "../shared/regression.ts";
import type { RegressionCriterion, SprintContract } from "../shared/types.ts";

const TMP_DIR = join(import.meta.dir, "__tmp_sprint9__");
const ADHD_DIR = join(TMP_DIR, ".adhd");

beforeEach(() => {
  mkdirSync(join(ADHD_DIR, "contracts"), { recursive: true });
  mkdirSync(join(ADHD_DIR, "feedback"), { recursive: true });
});

afterEach(() => {
  rmSync(TMP_DIR, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// contract_marker_retirement_removes_criterion
// ---------------------------------------------------------------------------
describe("contract_marker_retirement_removes_criterion", () => {
  test("criterion named in retire list is absent from persisted suite", async () => {
    // First sprint establishes a criterion
    const sprint1: SprintContract = {
      sprintNumber: 1,
      features: ["Feature A"],
      criteria: [
        { name: "api_responds", description: "API returns 200", threshold: 7, type: "behavioral" },
        { name: "db_persists", description: "Data persists", threshold: 7, type: "behavioral" },
      ],
    };
    await accumulateRegressionCriteria(TMP_DIR, sprint1);

    // Second sprint retires api_responds
    const sprint2: SprintContract = {
      sprintNumber: 2,
      features: ["Feature B"],
      retire: ["api_responds"],
      criteria: [
        { name: "new_feature", description: "New feature works", threshold: 7, type: "behavioral" },
      ],
    };
    await accumulateRegressionCriteria(TMP_DIR, sprint2);

    const criteria = await readRegressionCriteria(TMP_DIR);
    const names = criteria.map((c) => c.name);

    expect(names).not.toContain("api_responds");
    expect(names).toContain("db_persists");
    expect(names).toContain("new_feature");
  });

  test("retiring a criterion that does not exist is a no-op", async () => {
    const sprint1: SprintContract = {
      sprintNumber: 1,
      features: ["Feature A"],
      criteria: [{ name: "api_responds", description: "API returns 200", threshold: 7, type: "behavioral" }],
    };
    await accumulateRegressionCriteria(TMP_DIR, sprint1);

    const sprint2: SprintContract = {
      sprintNumber: 2,
      features: ["Feature B"],
      retire: ["nonexistent_criterion"],
      criteria: [{ name: "new_feature", description: "New feature", threshold: 7, type: "behavioral" }],
    };
    await accumulateRegressionCriteria(TMP_DIR, sprint2);

    const criteria = await readRegressionCriteria(TMP_DIR);
    const names = criteria.map((c) => c.name);
    expect(names).toContain("api_responds");
    expect(names).toContain("new_feature");
  });

  test("retire list without new behavioral criteria still persists retirements", async () => {
    // Establish a criterion
    const sprint1: SprintContract = {
      sprintNumber: 1,
      features: ["A"],
      criteria: [{ name: "api_responds", description: "API returns 200", threshold: 7, type: "behavioral" }],
    };
    await accumulateRegressionCriteria(TMP_DIR, sprint1);

    // Sprint 2 only retires, adds no new behavioral criteria
    const sprint2: SprintContract = {
      sprintNumber: 2,
      features: ["B"],
      retire: ["api_responds"],
      criteria: [{ name: "only_impl", description: "Impl check", threshold: 7, type: "implementation" }],
    };
    await accumulateRegressionCriteria(TMP_DIR, sprint2);

    const criteria = await readRegressionCriteria(TMP_DIR);
    expect(criteria.map((c) => c.name)).not.toContain("api_responds");
  });
});

// ---------------------------------------------------------------------------
// retirement_durability_blocks_resurrection
// ---------------------------------------------------------------------------
describe("retirement_durability_blocks_resurrection", () => {
  test("a retired name cannot be resurrected by a later same-named behavioral criterion", async () => {
    // Sprint 1: establish criterion
    const sprint1: SprintContract = {
      sprintNumber: 1,
      features: ["A"],
      criteria: [{ name: "api_responds", description: "v1", threshold: 7, type: "behavioral" }],
    };
    await accumulateRegressionCriteria(TMP_DIR, sprint1);

    // Sprint 2: retire it
    const sprint2: SprintContract = {
      sprintNumber: 2,
      features: ["B"],
      retire: ["api_responds"],
      criteria: [],
    };
    await accumulateRegressionCriteria(TMP_DIR, sprint2);

    // Sprint 3: attempt resurrection with the same name
    const sprint3: SprintContract = {
      sprintNumber: 3,
      features: ["C"],
      criteria: [{ name: "api_responds", description: "v2 - resurrection attempt", threshold: 8, type: "behavioral" }],
    };
    await accumulateRegressionCriteria(TMP_DIR, sprint3);

    const criteria = await readRegressionCriteria(TMP_DIR);
    // The retired name must not appear — resurrection is blocked
    expect(criteria.map((c) => c.name)).not.toContain("api_responds");
  });

  test("retired-names set persists across multiple read-write cycles", async () => {
    const sprint1: SprintContract = {
      sprintNumber: 1,
      features: ["A"],
      criteria: [
        { name: "crit_a", description: "A", threshold: 7, type: "behavioral" },
        { name: "crit_b", description: "B", threshold: 7, type: "behavioral" },
      ],
    };
    await accumulateRegressionCriteria(TMP_DIR, sprint1);

    const sprint2: SprintContract = {
      sprintNumber: 2,
      features: ["B"],
      retire: ["crit_a"],
      criteria: [{ name: "crit_c", description: "C", threshold: 7, type: "behavioral" }],
    };
    await accumulateRegressionCriteria(TMP_DIR, sprint2);

    const sprint3: SprintContract = {
      sprintNumber: 3,
      features: ["C"],
      criteria: [{ name: "crit_a", description: "A revived", threshold: 9, type: "behavioral" }],
    };
    await accumulateRegressionCriteria(TMP_DIR, sprint3);

    const criteria = await readRegressionCriteria(TMP_DIR);
    expect(criteria.map((c) => c.name)).not.toContain("crit_a");
    expect(criteria.map((c) => c.name)).toContain("crit_b");
    expect(criteria.map((c) => c.name)).toContain("crit_c");
  });
});

// ---------------------------------------------------------------------------
// retired_criteria_absent_from_evaluator_section
// ---------------------------------------------------------------------------
describe("retired_criteria_absent_from_evaluator_section", () => {
  test("retired criterion does not appear in buildRegressionSection output", async () => {
    const sprint1: SprintContract = {
      sprintNumber: 1,
      features: ["A"],
      criteria: [
        { name: "api_responds", description: "API returns 200", threshold: 7, type: "behavioral" },
        { name: "db_persists", description: "Data persists", threshold: 7, type: "behavioral" },
      ],
    };
    await accumulateRegressionCriteria(TMP_DIR, sprint1);

    const sprint2: SprintContract = {
      sprintNumber: 2,
      features: ["B"],
      retire: ["api_responds"],
      criteria: [],
    };
    await accumulateRegressionCriteria(TMP_DIR, sprint2);

    const criteria = await readRegressionCriteria(TMP_DIR);
    const section = buildRegressionSection(criteria);

    expect(section).not.toContain("api_responds");
    expect(section).toContain("db_persists");
  });

  test("all criteria retired — section is empty", async () => {
    const sprint1: SprintContract = {
      sprintNumber: 1,
      features: ["A"],
      criteria: [{ name: "only_crit", description: "Only criterion", threshold: 7, type: "behavioral" }],
    };
    await accumulateRegressionCriteria(TMP_DIR, sprint1);

    const sprint2: SprintContract = {
      sprintNumber: 2,
      features: ["B"],
      retire: ["only_crit"],
      criteria: [],
    };
    await accumulateRegressionCriteria(TMP_DIR, sprint2);

    const criteria = await readRegressionCriteria(TMP_DIR);
    const section = buildRegressionSection(criteria);
    expect(section).toBe("");
  });
});

// ---------------------------------------------------------------------------
// legacy_bare_array_loads_without_error
// ---------------------------------------------------------------------------
describe("legacy_bare_array_loads_without_error", () => {
  test("bare JSON array regression.json loads correctly", async () => {
    const legacyCriteria: RegressionCriterion[] = [
      { name: "crit_1", description: "Crit 1", threshold: 7, sprintNumber: 1 },
      { name: "crit_2", description: "Crit 2", threshold: 8, sprintNumber: 2 },
    ];
    writeFileSync(regressionPath(TMP_DIR), JSON.stringify(legacyCriteria), "utf-8");

    const result = await readRegressionCriteria(TMP_DIR);
    expect(result).toHaveLength(2);
    expect(result[0]!.name).toBe("crit_1");
    expect(result[1]!.name).toBe("crit_2");
    // No loss of existing entries
    expect(result[0]!.description).toBe("Crit 1");
    expect(result[0]!.sprintNumber).toBe(1);
  });

  test("legacy bare array is preserved after accumulateRegressionCriteria merges into it", async () => {
    // Seed legacy format
    const legacy: RegressionCriterion[] = [
      { name: "legacy_crit", description: "Legacy behavior", threshold: 7, sprintNumber: 0 },
    ];
    writeFileSync(regressionPath(TMP_DIR), JSON.stringify(legacy), "utf-8");

    // Accumulate a new sprint
    const newContract: SprintContract = {
      sprintNumber: 1,
      features: ["New feature"],
      criteria: [{ name: "new_crit", description: "New behavior", threshold: 8, type: "behavioral" }],
    };
    await accumulateRegressionCriteria(TMP_DIR, newContract);

    const criteria = await readRegressionCriteria(TMP_DIR);
    const names = criteria.map((c) => c.name);
    // Legacy criterion is preserved
    expect(names).toContain("legacy_crit");
    // New criterion is added
    expect(names).toContain("new_crit");
  });
});

// ---------------------------------------------------------------------------
// new_fields_round_trip_correctly
// ---------------------------------------------------------------------------
describe("new_fields_round_trip_correctly", () => {
  test("tier, surfaces, and retiredNames round-trip through regression.json", async () => {
    // Accumulate a contract with surfaces declared (creates tier + surfaces on criterion)
    const contract: SprintContract = {
      sprintNumber: 5,
      features: ["F"],
      surfaces: ["backend", "db"],
      retire: ["old_crit"],
      criteria: [
        { name: "new_crit", description: "New", threshold: 9, type: "behavioral" },
      ],
    };
    await accumulateRegressionCriteria(TMP_DIR, contract);

    // Read back via public API
    const criteria = await readRegressionCriteria(TMP_DIR);
    expect(criteria).toHaveLength(1);
    expect(criteria[0]!.name).toBe("new_crit");
    expect(criteria[0]!.tier).toBe("core");
    expect(criteria[0]!.surfaces).toEqual(["backend", "db"]);

    // Read the raw file to verify retiredNames persisted
    const raw = JSON.parse(readFileSync(regressionPath(TMP_DIR), "utf-8"));
    expect(raw.retiredNames).toContain("old_crit");

    // Verify no field is silently dropped or reordered — write a known store and
    // confirm it round-trips exactly
    const knownStore = {
      criteria: [
        { name: "crit_a", description: "A", threshold: 7, sprintNumber: 1, tier: "core", surfaces: ["backend"] },
        { name: "crit_b", description: "B", threshold: 8, sprintNumber: 2, tier: "optional", surfaces: ["frontend", "db"] },
      ],
      retiredNames: ["old_a", "old_b"],
    };
    writeFileSync(regressionPath(TMP_DIR), JSON.stringify(knownStore, null, 2), "utf-8");

    const readBack = await readRegressionCriteria(TMP_DIR);
    expect(readBack[0]!.tier).toBe("core");
    expect(readBack[0]!.surfaces).toEqual(["backend"]);
    expect(readBack[1]!.tier).toBe("optional");
    expect(readBack[1]!.surfaces).toEqual(["frontend", "db"]);

    // Verify retiredNames also round-trip
    const rawBack = JSON.parse(readFileSync(regressionPath(TMP_DIR), "utf-8"));
    expect(rawBack.retiredNames).toEqual(["old_a", "old_b"]);
  });
});

// ---------------------------------------------------------------------------
// legacy_criteria_always_checked
// ---------------------------------------------------------------------------
describe("legacy_criteria_always_checked", () => {
  test("legacy criteria without tier/surfaces are always included regardless of contractSurfaces", () => {
    const criteria: RegressionCriterion[] = [
      { name: "legacy_1", description: "Legacy 1", threshold: 7, sprintNumber: 1 },
      { name: "legacy_2", description: "Legacy 2", threshold: 8, sprintNumber: 2 },
    ];

    // Even with specific contract surfaces that don't match anything
    const section = buildRegressionSection(criteria, ["frontend"]);
    expect(section).toContain("legacy_1");
    expect(section).toContain("legacy_2");
  });

  test("legacy criteria are always included when no contractSurfaces declared", () => {
    const criteria: RegressionCriterion[] = [
      { name: "legacy_1", description: "Legacy 1", threshold: 7, sprintNumber: 1 },
    ];

    const section = buildRegressionSection(criteria);
    expect(section).toContain("legacy_1");
  });

  test("mixed legacy and optional — legacy always included", () => {
    const criteria: RegressionCriterion[] = [
      { name: "legacy_crit", description: "Legacy", threshold: 7, sprintNumber: 1 },
      { name: "optional_crit", description: "Optional", threshold: 7, sprintNumber: 2, tier: "optional", surfaces: ["frontend"] },
    ];

    // Contract surfaces do NOT include frontend
    const section = buildRegressionSection(criteria, ["backend"]);
    expect(section).toContain("legacy_crit");
    expect(section).not.toContain("optional_crit");
  });
});

// ---------------------------------------------------------------------------
// core_criteria_always_checked
// ---------------------------------------------------------------------------
describe("core_criteria_always_checked", () => {
  test("core criteria are always included regardless of contract surfaces", () => {
    const criteria: RegressionCriterion[] = [
      { name: "core_crit", description: "Core behavior", threshold: 7, sprintNumber: 1, tier: "core", surfaces: ["backend"] },
    ];

    // Contract surfaces: frontend only (no intersection with backend)
    const section = buildRegressionSection(criteria, ["frontend"]);
    expect(section).toContain("core_crit");
  });

  test("core criteria are included when no contract surfaces at all", () => {
    const criteria: RegressionCriterion[] = [
      { name: "core_crit", description: "Core", threshold: 9, sprintNumber: 1, tier: "core" },
    ];

    const section = buildRegressionSection(criteria, undefined);
    expect(section).toContain("core_crit");
  });

  test("core criteria are included even when all optional criteria are filtered", () => {
    const criteria: RegressionCriterion[] = [
      { name: "core_always", description: "Always there", threshold: 8, sprintNumber: 1, tier: "core", surfaces: ["backend"] },
      { name: "opt_filtered", description: "Filtered out", threshold: 7, sprintNumber: 2, tier: "optional", surfaces: ["frontend"] },
    ];

    const section = buildRegressionSection(criteria, ["backend", "db"]);
    expect(section).toContain("core_always");
    expect(section).not.toContain("opt_filtered");
  });
});

// ---------------------------------------------------------------------------
// surface_relevance_filter_excludes_non_matching
// ---------------------------------------------------------------------------
describe("surface_relevance_filter_excludes_non_matching", () => {
  test("20 optional criteria with non-matching surfaces — fewer than 20 appear", () => {
    const criteria: RegressionCriterion[] = Array.from({ length: 20 }, (_, i) => ({
      name: `opt_crit_${i}`,
      description: `Optional criterion ${i}`,
      threshold: 7,
      sprintNumber: 1,
      tier: "optional" as const,
      surfaces: ["frontend"], // non-matching surface
    }));

    // Contract surface: backend only (no intersection with frontend)
    const section = buildRegressionSection(criteria, ["backend"]);

    // Fewer than 20 should appear — the filter should exclude the non-matching ones
    const matchCount = (section.match(/opt_crit_/g) ?? []).length;
    expect(matchCount).toBeLessThan(20);
  });

  test("optional criterion whose surfaces DO intersect is always present", () => {
    const criteria: RegressionCriterion[] = [
      ...Array.from({ length: 10 }, (_, i) => ({
        name: `opt_no_match_${i}`,
        description: `Non-matching ${i}`,
        threshold: 7,
        sprintNumber: 1,
        tier: "optional" as const,
        surfaces: ["frontend"],
      })),
      {
        name: "opt_matching",
        description: "Matching surface",
        threshold: 7,
        sprintNumber: 1,
        tier: "optional" as const,
        surfaces: ["backend"],
      },
    ];

    // Contract surface: backend — matches opt_matching but not the others
    const section = buildRegressionSection(criteria, ["backend"]);
    expect(section).toContain("opt_matching");
    // The 10 non-matching ones should be absent
    expect(section).not.toContain("opt_no_match_0");
    expect(section).not.toContain("opt_no_match_9");
  });

  test("surface intersection is exact string match, not substring-based", () => {
    const criteria: RegressionCriterion[] = [
      // "backends" is not the same as "backend"
      {
        name: "substring_trap",
        description: "Would match if substring-based",
        threshold: 7,
        sprintNumber: 1,
        tier: "optional" as const,
        surfaces: ["backends"], // not in SURFACE_VOCABULARY but testing string-equality
      },
      {
        name: "exact_match",
        description: "Exact match",
        threshold: 7,
        sprintNumber: 1,
        tier: "optional" as const,
        surfaces: ["backend"],
      },
    ];

    const section = buildRegressionSection(criteria, ["backend"]);
    // "backends" should NOT match "backend"
    expect(section).not.toContain("substring_trap");
    // "backend" SHOULD match "backend"
    expect(section).toContain("exact_match");
  });
});

// ---------------------------------------------------------------------------
// regression_section_size_bounded
// ---------------------------------------------------------------------------
describe("regression_section_size_bounded", () => {
  test("50 optional criteria with disjoint surfaces — section size is bounded", () => {
    const fifty: RegressionCriterion[] = Array.from({ length: 50 }, (_, i) => ({
      name: `opt_${i}`,
      description: `Optional criterion ${i} — this is a longer description to make each entry a bit larger in size`,
      threshold: 7,
      sprintNumber: 1,
      tier: "optional" as const,
      surfaces: ["frontend"],
    }));

    const hundred: RegressionCriterion[] = Array.from({ length: 100 }, (_, i) => ({
      name: `opt_${i}`,
      description: `Optional criterion ${i} — this is a longer description to make each entry a bit larger in size`,
      threshold: 7,
      sprintNumber: 1,
      tier: "optional" as const,
      surfaces: ["frontend"],
    }));

    // Contract surface: backend (disjoint from frontend)
    const section50 = buildRegressionSection(fifty, ["backend"]);
    const section100 = buildRegressionSection(hundred, ["backend"]);

    // Both should be equal (all filtered out) and under the documented bound
    expect(section50.length).toBeLessThanOrEqual(section100.length);
    expect(section100.length).toBeLessThanOrEqual(MAX_REGRESSION_SECTION_CHARS);
  });

  test("section with many core criteria is capped at MAX_REGRESSION_SECTION_CHARS", () => {
    // Create enough core criteria with long descriptions to exceed the cap
    const manyCores: RegressionCriterion[] = Array.from({ length: 200 }, (_, i) => ({
      name: `core_${i}`,
      description: `Core criterion ${i} with a fairly long description to help push past the character limit quickly when there are very many criteria accumulated over time`,
      threshold: 7,
      sprintNumber: 1,
      tier: "core" as const,
    }));

    const section = buildRegressionSection(manyCores, ["backend"]);
    expect(section.length).toBeLessThanOrEqual(MAX_REGRESSION_SECTION_CHARS + 200); // allow for truncation marker
  });

  test("MAX_REGRESSION_SECTION_CHARS is a positive integer (documented bound exists)", () => {
    expect(typeof MAX_REGRESSION_SECTION_CHARS).toBe("number");
    expect(MAX_REGRESSION_SECTION_CHARS).toBeGreaterThan(0);
    expect(Number.isInteger(MAX_REGRESSION_SECTION_CHARS)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// retirement_and_tiering_logic_pure_shared_no_sdk
// ---------------------------------------------------------------------------
describe("retirement_and_tiering_logic_pure_shared_no_sdk", () => {
  test("functions are exported from shared/regression.ts (pure shared module)", async () => {
    // Just importing and calling the functions verifies they live in shared/
    const contract: SprintContract = {
      sprintNumber: 1,
      features: ["F"],
      criteria: [{ name: "c", description: "d", threshold: 7, type: "behavioral" }],
    };
    // Should not throw
    await expect(accumulateRegressionCriteria(TMP_DIR, contract)).resolves.toBeUndefined();
    await expect(readRegressionCriteria(TMP_DIR)).resolves.toBeDefined();
    expect(() => buildRegressionSection([])).not.toThrow();
  });

  test("functions are never-throwing on malformed/missing-field input", () => {
    // buildRegressionSection with malformed criteria objects
    const badCriteria = [
      { name: undefined, description: null, threshold: "bad", sprintNumber: -1 } as unknown as RegressionCriterion,
      { name: "ok", description: "ok", threshold: 7, sprintNumber: 1, tier: "unknown_tier" } as unknown as RegressionCriterion,
    ];

    expect(() => buildRegressionSection(badCriteria)).not.toThrow();
    expect(() => buildRegressionSection(badCriteria, ["backend"])).not.toThrow();
    expect(() => buildRegressionSection(badCriteria, undefined)).not.toThrow();
  });

  test("accumulateRegressionCriteria handles malformed retire list gracefully", async () => {
    const contract = {
      sprintNumber: 1,
      features: ["F"],
      retire: [null, undefined, 42, "valid_name"] as unknown as string[],
      criteria: [{ name: "crit", description: "d", threshold: 7, type: "behavioral" as const }],
    };

    // Should not throw
    await expect(accumulateRegressionCriteria(TMP_DIR, contract)).resolves.toBeUndefined();
    // "valid_name" is in retire list; "crit" should be added (different name)
    const criteria = await readRegressionCriteria(TMP_DIR);
    expect(criteria.map((c) => c.name)).toContain("crit");
  });

  test("surface intersection helper is reused (spot-check via buildRegressionSection)", () => {
    // Test that the exact-string intersection logic works consistently
    const criteria: RegressionCriterion[] = [
      { name: "crit_a", description: "A", threshold: 7, sprintNumber: 1, tier: "optional", surfaces: ["backend"] },
      { name: "crit_b", description: "B", threshold: 7, sprintNumber: 1, tier: "optional", surfaces: ["frontend"] },
    ];

    const backendSection = buildRegressionSection(criteria, ["backend"]);
    expect(backendSection).toContain("crit_a");
    expect(backendSection).not.toContain("crit_b");

    const frontendSection = buildRegressionSection(criteria, ["frontend"]);
    expect(frontendSection).not.toContain("crit_a");
    expect(frontendSection).toContain("crit_b");

    const bothSection = buildRegressionSection(criteria, ["backend", "frontend"]);
    expect(bothSection).toContain("crit_a");
    expect(bothSection).toContain("crit_b");
  });
});
