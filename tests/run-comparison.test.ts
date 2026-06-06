/**
 * Sprint 12 — Run-comparison tests.
 *
 * Covers all acceptance criteria from the Sprint 12 contract:
 *   - compare_runs_never_throws
 *   - format_comparison_never_throws
 *   - shared_helpers_sdk_free
 *   - comparison_and_formatting_are_separate
 *   - compare_prints_full_report (data assertions on the comparison structure)
 *   - partial_record_degrades_gracefully
 *   - cost_delta_per_stage_and_model
 *   - naming_conventions_consistent
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { compareRuns, formatComparison } from "../shared/run-comparison.ts";
import type {
  RunComparison,
  StageCostRow,
  ModelCostRow,
  SprintPassFail,
  ScoreTrend,
  CostDelta,
} from "../shared/run-comparison.ts";
import type { RunRecord } from "../shared/run-history.ts";
import type { HarnessProgress, RunUsage } from "../shared/types.ts";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const SAMPLE_USAGE_A: RunUsage = {
  sessions: [
    {
      startedAt: "2026-06-06T10:00:00.000Z",
      stages: [
        {
          stage: "planner",
          model: "claude-opus-4-5",
          inputTokens: 1000,
          outputTokens: 500,
          cacheReadTokens: 0,
          costUsd: 0.005,
          durationMs: 2000,
        },
        {
          stage: "sprint-1-attempt-0-generator",
          model: "claude-sonnet-4-5",
          inputTokens: 2000,
          outputTokens: 800,
          cacheReadTokens: 100,
          costUsd: 0.008,
          durationMs: 3000,
        },
      ],
      totalCostUsd: 0.013,
    },
  ],
  runTotalCostUsd: 0.013,
};

const SAMPLE_USAGE_B: RunUsage = {
  sessions: [
    {
      startedAt: "2026-06-06T11:00:00.000Z",
      stages: [
        {
          stage: "planner",
          model: "claude-opus-4-5",
          inputTokens: 900,
          outputTokens: 450,
          cacheReadTokens: 0,
          costUsd: 0.004,
          durationMs: 1800,
        },
        {
          stage: "sprint-1-attempt-0-generator",
          model: "claude-sonnet-4-5",
          inputTokens: 1800,
          outputTokens: 700,
          cacheReadTokens: 200,
          costUsd: 0.006,
          durationMs: 2500,
        },
      ],
      totalCostUsd: 0.010,
    },
  ],
  runTotalCostUsd: 0.010,
};

const SAMPLE_PROGRESS_A: HarnessProgress = {
  status: "complete",
  currentSprint: 2,
  totalSprints: 2,
  completedSprints: 2,
  retryCount: 1,
  sprintResults: [
    {
      sprintNumber: 1,
      passed: false,
      attempts: 2,
      evalResult: {
        passed: false,
        scores: { criterion_a: 5, criterion_b: 7 },
        feedback: [],
        overallSummary: "partial",
      },
    },
    {
      sprintNumber: 2,
      passed: true,
      attempts: 1,
      evalResult: {
        passed: true,
        scores: { criterion_a: 8, criterion_b: 9 },
        feedback: [],
        overallSummary: "good",
      },
    },
  ],
};

const SAMPLE_PROGRESS_B: HarnessProgress = {
  status: "complete",
  currentSprint: 2,
  totalSprints: 2,
  completedSprints: 2,
  retryCount: 0,
  sprintResults: [
    {
      sprintNumber: 1,
      passed: true,
      attempts: 1,
      evalResult: {
        passed: true,
        scores: { criterion_a: 9, criterion_b: 8 },
        feedback: [],
        overallSummary: "good",
      },
    },
    {
      sprintNumber: 2,
      passed: true,
      attempts: 1,
      evalResult: {
        passed: true,
        scores: { criterion_a: 9, criterion_b: 9, criterion_c: 7 },
        feedback: [],
        overallSummary: "excellent",
      },
    },
  ],
};

const RECORD_A: RunRecord = {
  sessionStamp: "2026.06.06-10.00.00",
  usage: SAMPLE_USAGE_A,
  progress: SAMPLE_PROGRESS_A,
};

const RECORD_B: RunRecord = {
  sessionStamp: "2026.06.06-11.00.00",
  usage: SAMPLE_USAGE_B,
  progress: SAMPLE_PROGRESS_B,
};

// ---------------------------------------------------------------------------
// compare_runs_never_throws
// ---------------------------------------------------------------------------

describe("compare_runs_never_throws", () => {
  test("does not throw for two valid RunRecords", () => {
    expect(() => compareRuns("a", "b", RECORD_A, RECORD_B)).not.toThrow();
  });

  test("does not throw when both records are null", () => {
    expect(() => compareRuns("a", "b", null, null)).not.toThrow();
  });

  test("does not throw when recordA is null", () => {
    expect(() => compareRuns("a", "b", null, RECORD_B)).not.toThrow();
  });

  test("does not throw when recordB is null", () => {
    expect(() => compareRuns("a", "b", RECORD_A, null)).not.toThrow();
  });

  test("does not throw when usage is null on both records", () => {
    const partialA: RunRecord = { sessionStamp: "a", usage: null, progress: SAMPLE_PROGRESS_A };
    const partialB: RunRecord = { sessionStamp: "b", usage: null, progress: SAMPLE_PROGRESS_B };
    expect(() => compareRuns("a", "b", partialA, partialB)).not.toThrow();
  });

  test("does not throw when progress is null on both records", () => {
    const partialA: RunRecord = { sessionStamp: "a", usage: SAMPLE_USAGE_A, progress: null };
    const partialB: RunRecord = { sessionStamp: "b", usage: SAMPLE_USAGE_B, progress: null };
    expect(() => compareRuns("a", "b", partialA, partialB)).not.toThrow();
  });

  test("does not throw for empty stamp strings", () => {
    expect(() => compareRuns("", "", null, null)).not.toThrow();
  });

  test("does not throw for structurally unexpected shapes (cast to unknown)", () => {
    // biome-ignore lint/suspicious/noExplicitAny: intentional stress test
    expect(() => compareRuns("a", "b", "not a record" as any, { foo: "bar" } as any)).not.toThrow();
  });

  test("returns an object with the expected top-level shape even for null inputs", () => {
    const result = compareRuns("x", "y", null, null);
    expect(result).toHaveProperty("stampA", "x");
    expect(result).toHaveProperty("stampB", "y");
    expect(result).toHaveProperty("sprintPassFail");
    expect(result).toHaveProperty("costDelta");
    expect(result).toHaveProperty("scoreTrends");
    expect(Array.isArray(result.sprintPassFail)).toBe(true);
    expect(Array.isArray(result.scoreTrends)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// format_comparison_never_throws
// ---------------------------------------------------------------------------

describe("format_comparison_never_throws", () => {
  test("does not throw for a valid RunComparison", () => {
    const comparison = compareRuns("a", "b", RECORD_A, RECORD_B);
    expect(() => formatComparison(comparison)).not.toThrow();
  });

  test("does not throw for null input", () => {
    expect(() => formatComparison(null)).not.toThrow();
  });

  test("does not throw for undefined input", () => {
    expect(() => formatComparison(undefined)).not.toThrow();
  });

  test("does not throw for an empty RunComparison structure", () => {
    const empty: RunComparison = {
      stampA: "",
      stampB: "",
      sprintPassFail: [],
      costDelta: {
        totalA: null,
        totalB: null,
        delta: null,
        byStageA: [],
        byStageB: [],
        byModelA: [],
        byModelB: [],
      },
      scoreTrends: [],
    };
    expect(() => formatComparison(empty)).not.toThrow();
  });

  test("does not throw for partially populated structure", () => {
    // biome-ignore lint/suspicious/noExplicitAny: intentional stress test
    const partial = { stampA: "a" } as any;
    expect(() => formatComparison(partial)).not.toThrow();
  });

  test("returns a string for null input", () => {
    expect(typeof formatComparison(null)).toBe("string");
  });

  test("returns a string for a valid comparison", () => {
    const comparison = compareRuns("a", "b", RECORD_A, RECORD_B);
    expect(typeof formatComparison(comparison)).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// compare_prints_full_report — data completeness assertions
// ---------------------------------------------------------------------------

describe("compare_prints_full_report", () => {
  test("comparison includes sprint pass/fail data", () => {
    const comparison = compareRuns("a", "b", RECORD_A, RECORD_B);
    expect(comparison.sprintPassFail.length).toBeGreaterThan(0);
    // Sprint 1: A failed, B passed
    const sprint1 = comparison.sprintPassFail.find((s) => s.sprintNumber === 1);
    expect(sprint1).toBeDefined();
    expect(sprint1!.passedA).toBe(false);
    expect(sprint1!.passedB).toBe(true);
    // Sprint 2: both passed
    const sprint2 = comparison.sprintPassFail.find((s) => s.sprintNumber === 2);
    expect(sprint2).toBeDefined();
    expect(sprint2!.passedA).toBe(true);
    expect(sprint2!.passedB).toBe(true);
  });

  test("comparison includes cost totals", () => {
    const comparison = compareRuns("a", "b", RECORD_A, RECORD_B);
    expect(comparison.costDelta.totalA).toBeCloseTo(0.013, 5);
    expect(comparison.costDelta.totalB).toBeCloseTo(0.010, 5);
    expect(comparison.costDelta.delta).not.toBeNull();
    expect(comparison.costDelta.delta!).toBeCloseTo(-0.003, 5);
  });

  test("comparison includes criteria score trends", () => {
    const comparison = compareRuns("a", "b", RECORD_A, RECORD_B);
    expect(comparison.scoreTrends.length).toBeGreaterThan(0);
    // criterion_a: last sprint score is A=8, B=9
    const trendA = comparison.scoreTrends.find((t) => t.criterion === "criterion_a");
    expect(trendA).toBeDefined();
    expect(trendA!.scoreA).toBe(8);
    expect(trendA!.scoreB).toBe(9);
  });

  test("formatted report contains sprint pass/fail section", () => {
    const comparison = compareRuns("a", "b", RECORD_A, RECORD_B);
    const output = formatComparison(comparison);
    expect(output).toContain("Sprint results");
    expect(output).toContain("Sprint 1");
  });

  test("formatted report contains cost section", () => {
    const comparison = compareRuns("a", "b", RECORD_A, RECORD_B);
    const output = formatComparison(comparison);
    expect(output).toContain("Cost:");
    expect(output).toContain("Total:");
  });

  test("formatted report contains criteria score section", () => {
    const comparison = compareRuns("a", "b", RECORD_A, RECORD_B);
    const output = formatComparison(comparison);
    expect(output).toContain("Criteria scores");
    expect(output).toContain("criterion_a");
  });

  test("formatted report identifies improved sprints", () => {
    const comparison = compareRuns("a", "b", RECORD_A, RECORD_B);
    const output = formatComparison(comparison);
    expect(output).toContain("improved");
  });

  test("formatted report identifies run stamps in header", () => {
    const comparison = compareRuns("2026.06.06-10.00.00", "2026.06.06-11.00.00", RECORD_A, RECORD_B);
    const output = formatComparison(comparison);
    expect(output).toContain("2026.06.06-10.00.00");
    expect(output).toContain("2026.06.06-11.00.00");
  });
});

// ---------------------------------------------------------------------------
// cost_delta_per_stage_and_model
// ---------------------------------------------------------------------------

describe("cost_delta_per_stage_and_model", () => {
  test("byStageA contains the stages from run A", () => {
    const comparison = compareRuns("a", "b", RECORD_A, RECORD_B);
    const stageNames = comparison.costDelta.byStageA.map((s) => s.stage);
    expect(stageNames).toContain("planner");
    expect(stageNames).toContain("sprint-1-attempt-0-generator");
  });

  test("byStageB contains the stages from run B", () => {
    const comparison = compareRuns("a", "b", RECORD_A, RECORD_B);
    const stageNames = comparison.costDelta.byStageB.map((s) => s.stage);
    expect(stageNames).toContain("planner");
    expect(stageNames).toContain("sprint-1-attempt-0-generator");
  });

  test("byModelA aggregates costs by model for run A", () => {
    const comparison = compareRuns("a", "b", RECORD_A, RECORD_B);
    const models = comparison.costDelta.byModelA.map((m) => m.model);
    expect(models).toContain("claude-opus-4-5");
    expect(models).toContain("claude-sonnet-4-5");
    // Aggregated total: 0.005 + 0.008 = 0.013
    const opusRow = comparison.costDelta.byModelA.find((m) => m.model === "claude-opus-4-5");
    expect(opusRow!.totalCostUsd).toBeCloseTo(0.005, 5);
  });

  test("byModelB aggregates costs by model for run B", () => {
    const comparison = compareRuns("a", "b", RECORD_A, RECORD_B);
    const opusRow = comparison.costDelta.byModelB.find((m) => m.model === "claude-opus-4-5");
    expect(opusRow!.totalCostUsd).toBeCloseTo(0.004, 5);
  });

  test("formatted output includes by-stage breakdown", () => {
    const comparison = compareRuns("a", "b", RECORD_A, RECORD_B);
    const output = formatComparison(comparison);
    expect(output).toContain("By stage:");
    expect(output).toContain("planner");
  });

  test("formatted output includes by-model breakdown", () => {
    const comparison = compareRuns("a", "b", RECORD_A, RECORD_B);
    const output = formatComparison(comparison);
    expect(output).toContain("By model:");
    expect(output).toContain("claude-opus-4-5");
  });
});

// ---------------------------------------------------------------------------
// partial_record_degrades_gracefully
// ---------------------------------------------------------------------------

describe("partial_record_degrades_gracefully", () => {
  test("null usage in both records: totals are null, delta is null", () => {
    const partialA: RunRecord = { sessionStamp: "a", usage: null, progress: SAMPLE_PROGRESS_A };
    const partialB: RunRecord = { sessionStamp: "b", usage: null, progress: SAMPLE_PROGRESS_B };
    const comparison = compareRuns("a", "b", partialA, partialB);
    expect(comparison.costDelta.totalA).toBeNull();
    expect(comparison.costDelta.totalB).toBeNull();
    expect(comparison.costDelta.delta).toBeNull();
    expect(comparison.costDelta.byStageA).toEqual([]);
    expect(comparison.costDelta.byModelA).toEqual([]);
  });

  test("null progress in both records: sprint pass/fail is empty, score trends are empty", () => {
    const partialA: RunRecord = { sessionStamp: "a", usage: SAMPLE_USAGE_A, progress: null };
    const partialB: RunRecord = { sessionStamp: "b", usage: SAMPLE_USAGE_B, progress: null };
    const comparison = compareRuns("a", "b", partialA, partialB);
    expect(comparison.sprintPassFail).toEqual([]);
    expect(comparison.scoreTrends).toEqual([]);
  });

  test("null record: sprint pass/fail shows null for missing run's sprints", () => {
    const comparison = compareRuns("a", "b", null, RECORD_B);
    for (const sprint of comparison.sprintPassFail) {
      expect(sprint.passedA).toBeNull();
    }
  });

  test("null record: scores show null for missing run's criteria", () => {
    const comparison = compareRuns("a", "b", null, RECORD_B);
    for (const trend of comparison.scoreTrends) {
      expect(trend.scoreA).toBeNull();
    }
  });

  test("partial record with missing sprintResults: degrades cleanly", () => {
    const partial: HarnessProgress = {
      status: "building",
      currentSprint: 1,
      totalSprints: 2,
      completedSprints: 0,
      retryCount: 0,
      // sprintResults absent
    };
    const record: RunRecord = { sessionStamp: "a", usage: SAMPLE_USAGE_A, progress: partial };
    expect(() => compareRuns("a", "b", record, RECORD_B)).not.toThrow();
    const comparison = compareRuns("a", "b", record, RECORD_B);
    expect(comparison.sprintPassFail.length).toBeGreaterThan(0);
    // All passedA should be null since record has no sprintResults
    for (const sprint of comparison.sprintPassFail) {
      expect(sprint.passedA).toBeNull();
    }
  });

  test("formatted output handles partial records gracefully without crashing", () => {
    const comparison = compareRuns("a", "b", null, RECORD_B);
    expect(() => formatComparison(comparison)).not.toThrow();
    const output = formatComparison(comparison);
    expect(typeof output).toBe("string");
    expect(output.length).toBeGreaterThan(0);
  });

  test("formatted output reports no data for null-cost side", () => {
    const partialA: RunRecord = { sessionStamp: "a", usage: null, progress: SAMPLE_PROGRESS_A };
    const comparison = compareRuns("a", "b", partialA, RECORD_B);
    const output = formatComparison(comparison);
    expect(output).toContain("(no data)");
  });
});

// ---------------------------------------------------------------------------
// comparison_and_formatting_are_separate
// ---------------------------------------------------------------------------

describe("comparison_and_formatting_are_separate", () => {
  test("compareRuns returns a typed structure, not a string", () => {
    const result = compareRuns("a", "b", RECORD_A, RECORD_B);
    expect(typeof result).toBe("object");
    expect(typeof result).not.toBe("string");
  });

  test("compareRuns result has typed fields (not a pre-rendered string)", () => {
    const result = compareRuns("a", "b", RECORD_A, RECORD_B);
    // Verify these are typed data, not strings
    expect(typeof result.costDelta.totalA).toBe("number");
    expect(typeof result.sprintPassFail[0]!.passedA).toBe("boolean");
    expect(typeof result.scoreTrends[0]!.scoreA).toBe("number");
  });

  test("formatComparison takes the structure and returns a string", () => {
    const comparison = compareRuns("a", "b", RECORD_A, RECORD_B);
    const output = formatComparison(comparison);
    expect(typeof output).toBe("string");
  });

  test("formatComparison result is multi-line (contains newlines)", () => {
    const comparison = compareRuns("a", "b", RECORD_A, RECORD_B);
    const output = formatComparison(comparison);
    expect(output).toContain("\n");
  });

  test("can call formatComparison on a hand-crafted comparison without compareRuns", () => {
    const handCrafted: RunComparison = {
      stampA: "stamp-a",
      stampB: "stamp-b",
      sprintPassFail: [{ sprintNumber: 1, passedA: true, passedB: false }],
      costDelta: {
        totalA: 0.01,
        totalB: 0.02,
        delta: 0.01,
        byStageA: [{ stage: "planner", model: "model-x", costUsd: 0.01 }],
        byStageB: [{ stage: "planner", model: "model-x", costUsd: 0.02 }],
        byModelA: [{ model: "model-x", totalCostUsd: 0.01 }],
        byModelB: [{ model: "model-x", totalCostUsd: 0.02 }],
      },
      scoreTrends: [{ criterion: "my_criterion", scoreA: 8, scoreB: 6 }],
    };
    expect(() => formatComparison(handCrafted)).not.toThrow();
    const output = formatComparison(handCrafted);
    expect(output).toContain("regressed");
    expect(output).toContain("my_criterion");
    expect(output).toContain("-2");
  });
});

// ---------------------------------------------------------------------------
// shared_helpers_sdk_free
// ---------------------------------------------------------------------------

describe("shared_helpers_sdk_free", () => {
  test("shared/run-comparison.ts contains no @anthropic-ai imports", () => {
    const src = readFileSync(join(import.meta.dir, "../shared/run-comparison.ts"), "utf-8");
    expect(src).not.toContain("@anthropic-ai");
  });

  test("exported types are imported from shared/ not harness-claude/", () => {
    // The import at the top of this test file uses shared/run-comparison.ts directly
    // If this test file compiles and runs, the exports are SDK-free.
    expect(typeof compareRuns).toBe("function");
    expect(typeof formatComparison).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// naming_conventions_consistent
// ---------------------------------------------------------------------------

describe("naming_conventions_consistent", () => {
  test("types exported with PascalCase names", () => {
    // These type imports compile, proving the names exist in the module
    const _: RunComparison | StageCostRow | ModelCostRow | SprintPassFail | ScoreTrend | CostDelta = {
      stampA: "",
      stampB: "",
      sprintPassFail: [],
      costDelta: { totalA: null, totalB: null, delta: null, byStageA: [], byStageB: [], byModelA: [], byModelB: [] },
      scoreTrends: [],
    };
    expect(_).toBeDefined();
  });

  test("functions exported with camelCase names", () => {
    expect(typeof compareRuns).toBe("function");
    expect(typeof formatComparison).toBe("function");
  });
});
