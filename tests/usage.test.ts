import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import {
  aggregateByModel,
  createUsageTracker,
  formatModelRollup,
  formatStageTable,
  type SDKResultFields,
} from "../shared/usage.ts";
import type { StageUsage } from "../shared/types.ts";

describe("createUsageTracker", () => {
  const tmpDir = join(import.meta.dir, "__usage_test_tmp");
  const adhdDir = join(tmpDir, ".adhd");
  const usagePath = join(adhdDir, "usage.json");

  beforeEach(() => {
    mkdirSync(adhdDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // --- recordStage ---

  test("recordStage accumulates entries", async () => {
    const tracker = createUsageTracker(tmpDir);
    const result: SDKResultFields = {
      total_cost_usd: 1.5,
      duration_ms: 10000,
      usage: { input_tokens: 5000, output_tokens: 2000, cache_read_input_tokens: 1000 },
    };
    tracker.recordStage("planner", "claude-sonnet-4-20250514", result);
    tracker.recordStage("generator", "claude-opus-4-20250514", { ...result, total_cost_usd: 2.0 });

    // Verify via save + read
    await tracker.save();
    const saved = JSON.parse(readFileSync(usagePath, "utf-8"));
    expect(saved.sessions).toHaveLength(1);
    expect(saved.sessions[0].stages).toHaveLength(2);
    expect(saved.sessions[0].stages[0].stage).toBe("planner");
    expect(saved.sessions[0].stages[1].stage).toBe("generator");
  });

  test("recordStage stores model field exactly", async () => {
    const tracker = createUsageTracker(tmpDir);
    tracker.recordStage("planner", "claude-sonnet-4-20250514", { total_cost_usd: 0.01 });
    await tracker.save();

    const saved = JSON.parse(readFileSync(usagePath, "utf-8"));
    const stage = saved.sessions[0].stages[0];
    expect(stage.model).toBe("claude-sonnet-4-20250514");
  });

  test("recordStage handles missing SDK fields gracefully", async () => {
    const tracker = createUsageTracker(tmpDir);
    // All fields missing — should default to 0
    tracker.recordStage("empty", "some-model", {});
    await tracker.save();

    const saved = JSON.parse(readFileSync(usagePath, "utf-8"));
    const stage = saved.sessions[0].stages[0];
    expect(stage.inputTokens).toBe(0);
    expect(stage.outputTokens).toBe(0);
    expect(stage.cacheReadTokens).toBe(0);
    expect(stage.costUsd).toBe(0);
    expect(stage.durationMs).toBe(0);
  });

  test("recordStage computes running total", async () => {
    const tracker = createUsageTracker(tmpDir);
    tracker.recordStage("a", "model-a", { total_cost_usd: 1.0 });
    tracker.recordStage("b", "model-b", { total_cost_usd: 2.5 });
    await tracker.save();

    const saved = JSON.parse(readFileSync(usagePath, "utf-8"));
    expect(saved.sessions[0].totalCostUsd).toBe(3.5);
  });

  // --- save ---

  test("save creates usage.json when none exists", async () => {
    const tracker = createUsageTracker(tmpDir);
    tracker.recordStage("planner", "claude-sonnet", { total_cost_usd: 0.42 });
    await tracker.save();

    const saved = JSON.parse(readFileSync(usagePath, "utf-8"));
    expect(saved.sessions).toHaveLength(1);
    expect(saved.runTotalCostUsd).toBe(0.42);
  });

  test("save appends to existing sessions", async () => {
    // Pre-existing usage data
    const existing = {
      sessions: [{ startedAt: "2026-01-01T00:00:00Z", stages: [], totalCostUsd: 5.0 }],
      runTotalCostUsd: 5.0,
    };
    writeFileSync(usagePath, JSON.stringify(existing));

    const tracker = createUsageTracker(tmpDir);
    tracker.recordStage("evaluator", "claude-opus", { total_cost_usd: 1.2 });
    await tracker.save();

    const saved = JSON.parse(readFileSync(usagePath, "utf-8"));
    expect(saved.sessions).toHaveLength(2);
    expect(saved.runTotalCostUsd).toBe(6.2);
  });

  test("save recovers from corrupted usage.json", async () => {
    writeFileSync(usagePath, "not valid json{{{");

    const tracker = createUsageTracker(tmpDir);
    tracker.recordStage("planner", "claude-sonnet", { total_cost_usd: 1.0 });
    await tracker.save();

    const saved = JSON.parse(readFileSync(usagePath, "utf-8"));
    expect(saved.sessions).toHaveLength(1);
    expect(saved.runTotalCostUsd).toBe(1.0);
  });

  // --- printSummary ---

  test("printSummary does not throw with no stages", () => {
    const tracker = createUsageTracker(tmpDir);
    expect(() => tracker.printSummary()).not.toThrow();
  });

  test("printSummary does not throw with stages", () => {
    const tracker = createUsageTracker(tmpDir);
    tracker.recordStage("planner", "claude-sonnet-4-20250514", {
      total_cost_usd: 0.42,
      duration_ms: 5000,
      usage: { input_tokens: 12000, output_tokens: 3000 },
    });
    tracker.recordStage("sprint-1-attempt-0-generator", "claude-opus-4-20250514", {
      total_cost_usd: 3.80,
      duration_ms: 60000,
      usage: { input_tokens: 45000, output_tokens: 22000 },
    });
    expect(() => tracker.printSummary()).not.toThrow();
  });

  // --- session metadata ---

  test("session startedAt is a valid ISO timestamp", async () => {
    const tracker = createUsageTracker(tmpDir);
    tracker.recordStage("x", "model-x", {});
    await tracker.save();

    const saved = JSON.parse(readFileSync(usagePath, "utf-8"));
    const ts = new Date(saved.sessions[0].startedAt);
    expect(ts.getTime()).not.toBeNaN();
  });

  // --- legacy load (Feature 5) ---

  test("loading legacy usage.json without model field does not throw", async () => {
    const legacy = {
      sessions: [
        {
          startedAt: "2026-01-01T00:00:00Z",
          stages: [
            { stage: "planner", inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, costUsd: 0.01, durationMs: 5000 },
            { stage: "generator", inputTokens: 200, outputTokens: 100, cacheReadTokens: 0, costUsd: 0.02, durationMs: 10000 },
          ],
          totalCostUsd: 0.03,
        },
      ],
      runTotalCostUsd: 0.03,
    };
    writeFileSync(usagePath, JSON.stringify(legacy));

    // Load + save via a new tracker that adds a stage
    const tracker = createUsageTracker(tmpDir);
    expect(() => tracker.recordStage("evaluator", "claude-sonnet", { total_cost_usd: 0.01 })).not.toThrow();
    await tracker.save();

    const saved = JSON.parse(readFileSync(usagePath, "utf-8"));
    // Legacy session is still present
    expect(saved.sessions).toHaveLength(2);
    // Legacy stages now have model: "unknown"
    const legacyStages = saved.sessions[0].stages;
    expect(legacyStages[0].model).toBe("unknown");
    expect(legacyStages[1].model).toBe("unknown");
    // New session stage has the real model
    const newStage = saved.sessions[1].stages[0];
    expect(newStage.model).toBe("claude-sonnet");
  });

  // --- save/load round-trip (Feature 5) ---

  test("save/load round-trip preserves model for multiple models", async () => {
    const tracker = createUsageTracker(tmpDir);
    tracker.recordStage("planner", "alpha", { total_cost_usd: 0.01 });
    tracker.recordStage("generator", "beta", { total_cost_usd: 0.02 });
    tracker.recordStage("evaluator", "gamma", { total_cost_usd: 0.03 });
    await tracker.save();

    // Load raw JSON and verify all models are preserved
    const saved = JSON.parse(readFileSync(usagePath, "utf-8"));
    const stages = saved.sessions[0].stages;
    expect(stages[0].model).toBe("alpha");
    expect(stages[1].model).toBe("beta");
    expect(stages[2].model).toBe("gamma");
  });

  // --- JSON key order (Feature 5) ---

  test("persisted stage entries have keys in spec-defined order", async () => {
    const tracker = createUsageTracker(tmpDir);
    tracker.recordStage("planner", "claude-sonnet", {
      total_cost_usd: 0.01,
      duration_ms: 5000,
      usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 10 },
    });
    await tracker.save();

    const raw = readFileSync(usagePath, "utf-8");
    // Find the first stage object and verify key order
    const stageMatch = raw.match(/"stage"[\s\S]*?"model"[\s\S]*?"inputTokens"[\s\S]*?"outputTokens"[\s\S]*?"cacheReadTokens"[\s\S]*?"costUsd"[\s\S]*?"durationMs"/);
    expect(stageMatch).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Pure helper unit tests (Features 3, 4, 7)
// ---------------------------------------------------------------------------

describe("formatStageTable", () => {
  const sampleStages: StageUsage[] = [
    { stage: "planner", model: "claude-sonnet-4-20250514", inputTokens: 12000, outputTokens: 3000, cacheReadTokens: 0, costUsd: 0.42, durationMs: 5000 },
    { stage: "sprint-1-attempt-0-generator", model: "claude-opus-4-20250514", inputTokens: 45000, outputTokens: 22000, cacheReadTokens: 500, costUsd: 3.80, durationMs: 60000 },
  ];

  test("returns a string[] with one row per stage plus totals", () => {
    const lines = formatStageTable(sampleStages);
    // At least 2 data rows + separator + totals
    expect(lines.length).toBeGreaterThanOrEqual(4);
  });

  test("each data row contains the model name as left-aligned text", () => {
    const lines = formatStageTable(sampleStages);
    const dataLines = lines.slice(0, 2);
    expect(dataLines[0]).toContain("claude-sonnet-4-20250514");
    expect(dataLines[1]).toContain("claude-opus-4-20250514");
  });

  test("each data row contains the stage name", () => {
    const lines = formatStageTable(sampleStages);
    expect(lines[0]).toContain("planner");
    expect(lines[1]).toContain("sprint-1-attempt-0-generator");
  });

  test("model column appears before cost column in each row", () => {
    const lines = formatStageTable(sampleStages);
    const row = lines[0]!;
    const modelPos = row.indexOf("claude-sonnet-4-20250514");
    const costPos = row.indexOf("$");
    expect(modelPos).toBeLessThan(costPos);
  });

  test("returns empty array for empty input", () => {
    expect(formatStageTable([])).toEqual([]);
  });
});

describe("aggregateByModel", () => {
  test("sums tokens and cost correctly for repeated model", () => {
    const stages: StageUsage[] = [
      { stage: "s1", model: "X", inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, costUsd: 0.01, durationMs: 1000 },
      { stage: "s2", model: "X", inputTokens: 200, outputTokens: 80, cacheReadTokens: 0, costUsd: 0.02, durationMs: 2000 },
      { stage: "s3", model: "X", inputTokens: 300, outputTokens: 120, cacheReadTokens: 0, costUsd: 0.03, durationMs: 3000 },
    ];
    const rows = aggregateByModel(stages);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.model).toBe("X");
    expect(rows[0]!.inputTokens).toBe(600);
    expect(rows[0]!.outputTokens).toBe(250);
    expect(rows[0]!.costUsd).toBeCloseTo(0.06, 5);
  });

  test("sorts by total USD descending", () => {
    const stages: StageUsage[] = [
      { stage: "s1", model: "cheap", inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0.05, durationMs: 0 },
      { stage: "s2", model: "expensive", inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0.20, durationMs: 0 },
      { stage: "s3", model: "mid", inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0.10, durationMs: 0 },
    ];
    const rows = aggregateByModel(stages);
    expect(rows[0]!.model).toBe("expensive");
    expect(rows[1]!.model).toBe("mid");
    expect(rows[2]!.model).toBe("cheap");
  });

  test("handles single model (one row)", () => {
    const stages: StageUsage[] = [
      { stage: "planner", model: "solo-model", inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, costUsd: 0.01, durationMs: 1000 },
    ];
    const rows = aggregateByModel(stages);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.model).toBe("solo-model");
  });

  test("returns empty array for empty input", () => {
    expect(aggregateByModel([])).toEqual([]);
  });
});

describe("formatModelRollup", () => {
  test("returns lines with section header and one row per model", () => {
    const rows = [
      { model: "claude-opus-4-20250514", inputTokens: 45000, outputTokens: 22000, costUsd: 3.80 },
      { model: "claude-sonnet-4-20250514", inputTokens: 12000, outputTokens: 3000, costUsd: 0.42 },
    ];
    const lines = formatModelRollup(rows);
    expect(lines.length).toBeGreaterThanOrEqual(3); // blank + header + 2 model rows
    const combined = lines.join("\n");
    expect(combined).toContain("claude-opus-4-20250514");
    expect(combined).toContain("claude-sonnet-4-20250514");
    expect(combined).toContain("Per-model");
  });

  test("works with a single-model rollup", () => {
    const rows = [{ model: "solo-model", inputTokens: 100, outputTokens: 50, costUsd: 0.01 }];
    const lines = formatModelRollup(rows);
    const combined = lines.join("\n");
    expect(combined).toContain("solo-model");
    expect(combined).toContain("Per-model");
  });

  test("returns empty array for empty input", () => {
    expect(formatModelRollup([])).toEqual([]);
  });
});
