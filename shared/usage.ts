import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { log } from "./logger.ts";
import type { RunUsage, SessionUsage, StageUsage } from "./types.ts";

/**
 * SDK result message shape (subset of fields we read).
 * Both SDKResultSuccess and SDKResultError include these.
 */
export interface SDKResultFields {
  total_cost_usd?: number;
  duration_ms?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
  };
  stop_reason?: string | null;
  num_turns?: number;
  is_error?: boolean;
}

export interface UsageTracker {
  recordStage(stage: string, result: SDKResultFields): void;
  printSummary(): void;
  save(): Promise<void>;
}

export function createUsageTracker(workDir: string): UsageTracker {
  const session: SessionUsage = {
    startedAt: new Date().toISOString(),
    stages: [],
    totalCostUsd: 0,
  };

  return {
    recordStage(stage: string, result: SDKResultFields): void {
      const entry: StageUsage = {
        stage,
        inputTokens: result.usage?.input_tokens ?? 0,
        outputTokens: result.usage?.output_tokens ?? 0,
        cacheReadTokens: result.usage?.cache_read_input_tokens ?? 0,
        costUsd: result.total_cost_usd ?? 0,
        durationMs: result.duration_ms ?? 0,
      };
      session.stages.push(entry);
      session.totalCostUsd = session.stages.reduce((sum, s) => sum + s.costUsd, 0);
    },

    printSummary(): void {
      if (session.stages.length === 0) return;

      log("HARNESS", "Session cost summary:");
      const maxLabel = Math.max(...session.stages.map((s) => s.stage.length), 0);
      for (const s of session.stages) {
        const label = s.stage.padEnd(maxLabel);
        const cost = `$${s.costUsd.toFixed(2)}`.padStart(8);
        const inK = `${(s.inputTokens / 1000).toFixed(0)}K in`;
        const outK = `${(s.outputTokens / 1000).toFixed(0)}K out`;
        log("HARNESS", `  ${label}  ${cost}  (${inK} / ${outK})`);
      }
      log("HARNESS", `  ${"─".repeat(maxLabel + 30)}`);
      log("HARNESS", `  ${"Session total".padEnd(maxLabel)}  $${session.totalCostUsd.toFixed(2).padStart(7)}`);
    },

    async save(): Promise<void> {
      const usagePath = join(workDir, ".adhd", "usage.json");

      // Load existing run data if present
      let run: RunUsage = { sessions: [], runTotalCostUsd: 0 };
      try {
        if (existsSync(usagePath)) {
          run = JSON.parse(readFileSync(usagePath, "utf-8")) as RunUsage;
        }
      } catch {
        // Corrupted file — start fresh
      }

      run.sessions.push(session);
      run.runTotalCostUsd = run.sessions.reduce((sum, s) => sum + s.totalCostUsd, 0);

      await writeFile(usagePath, JSON.stringify(run, null, 2), "utf-8");
    },
  };
}
