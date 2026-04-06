import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { createUsageTracker, type SDKResultFields } from "../shared/usage.ts";

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
    tracker.recordStage("planner", result);
    tracker.recordStage("generator", { ...result, total_cost_usd: 2.0 });

    // Verify via save + read
    await tracker.save();
    const saved = JSON.parse(readFileSync(usagePath, "utf-8"));
    expect(saved.sessions).toHaveLength(1);
    expect(saved.sessions[0].stages).toHaveLength(2);
    expect(saved.sessions[0].stages[0].stage).toBe("planner");
    expect(saved.sessions[0].stages[1].stage).toBe("generator");
  });

  test("recordStage handles missing SDK fields gracefully", async () => {
    const tracker = createUsageTracker(tmpDir);
    // All fields missing — should default to 0
    tracker.recordStage("empty", {});
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
    tracker.recordStage("a", { total_cost_usd: 1.0 });
    tracker.recordStage("b", { total_cost_usd: 2.5 });
    await tracker.save();

    const saved = JSON.parse(readFileSync(usagePath, "utf-8"));
    expect(saved.sessions[0].totalCostUsd).toBe(3.5);
  });

  // --- save ---

  test("save creates usage.json when none exists", async () => {
    const tracker = createUsageTracker(tmpDir);
    tracker.recordStage("planner", { total_cost_usd: 0.42 });
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
    tracker.recordStage("evaluator", { total_cost_usd: 1.2 });
    await tracker.save();

    const saved = JSON.parse(readFileSync(usagePath, "utf-8"));
    expect(saved.sessions).toHaveLength(2);
    expect(saved.runTotalCostUsd).toBe(6.2);
  });

  test("save recovers from corrupted usage.json", async () => {
    writeFileSync(usagePath, "not valid json{{{");

    const tracker = createUsageTracker(tmpDir);
    tracker.recordStage("planner", { total_cost_usd: 1.0 });
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
    tracker.recordStage("planner", {
      total_cost_usd: 0.42,
      duration_ms: 5000,
      usage: { input_tokens: 12000, output_tokens: 3000 },
    });
    tracker.recordStage("sprint-1-attempt-0-generator", {
      total_cost_usd: 3.80,
      duration_ms: 60000,
      usage: { input_tokens: 45000, output_tokens: 22000 },
    });
    expect(() => tracker.printSummary()).not.toThrow();
  });

  // --- session metadata ---

  test("session startedAt is a valid ISO timestamp", async () => {
    const tracker = createUsageTracker(tmpDir);
    tracker.recordStage("x", {});
    await tracker.save();

    const saved = JSON.parse(readFileSync(usagePath, "utf-8"));
    const ts = new Date(saved.sessions[0].startedAt);
    expect(ts.getTime()).not.toBeNaN();
  });
});
