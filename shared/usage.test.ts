import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createUsageTracker } from "./usage.ts";

describe("usage", () => {
  it("creates a tracker that records stages", () => {
    const tracker = createUsageTracker("/tmp/test-usage");
    expect(tracker).toBeDefined();
    expect(typeof tracker.recordStage).toBe("function");
    expect(typeof tracker.printSummary).toBe("function");
    expect(typeof tracker.save).toBe("function");
  });

  it("records a stage and saves to disk", async () => {
    const dir = await mkdtemp(join(tmpdir(), "usage-"));
    await mkdir(join(dir, ".adhd"), { recursive: true });

    const tracker = createUsageTracker(dir);
    tracker.recordStage("planner", {
      total_cost_usd: 0.05,
      duration_ms: 1000,
      usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 10 },
    });

    await tracker.save();

    const raw = await readFile(join(dir, ".adhd", "usage.json"), "utf-8");
    const data = JSON.parse(raw);
    expect(data.sessions).toHaveLength(1);
    expect(data.sessions[0].stages).toHaveLength(1);
    expect(data.sessions[0].stages[0].stage).toBe("planner");
    expect(data.sessions[0].stages[0].costUsd).toBe(0.05);
    expect(data.runTotalCostUsd).toBe(0.05);
  });

  it("records multiple stages with correct totals", async () => {
    const dir = await mkdtemp(join(tmpdir(), "usage-"));
    await mkdir(join(dir, ".adhd"), { recursive: true });

    const tracker = createUsageTracker(dir);
    tracker.recordStage("planner", { total_cost_usd: 0.05 });
    tracker.recordStage("generator", { total_cost_usd: 0.1 });

    await tracker.save();

    const raw = await readFile(join(dir, ".adhd", "usage.json"), "utf-8");
    const data = JSON.parse(raw);
    expect(data.sessions[0].stages).toHaveLength(2);
    expect(data.sessions[0].totalCostUsd).toBeCloseTo(0.15);
  });

  it("handles missing usage fields gracefully", () => {
    const tracker = createUsageTracker("/tmp/test-usage");
    expect(() => tracker.recordStage("evaluator", {})).not.toThrow();
  });
});
