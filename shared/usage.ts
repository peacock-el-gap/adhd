import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { USAGE_FILE } from "./files.ts";
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

/** Per-model aggregated totals for the rollup section. */
export interface ModelRollupRow {
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface UsageTracker {
  recordStage(stage: string, model: string, result: SDKResultFields): void;
  printSummary(): void;
  save(): Promise<void>;
  /**
   * Returns a snapshot of the current session's recorded stages.
   * Used by the per-sprint budget check (F12) to sum sprint-specific token usage.
   * The returned array is a copy — safe to read but not mutate.
   */
  getStages(): readonly StageUsage[];
}

// ---------------------------------------------------------------------------
// Pure formatting helpers (exported for direct unit-test assertions)
// ---------------------------------------------------------------------------

/**
 * Format the per-stage breakdown table into an array of printable lines.
 * Each row: stage name, model, cost, token counts, duration.
 * Numeric columns are right-aligned; text columns (stage, model) are left-aligned.
 */
export function formatStageTable(stages: StageUsage[]): string[] {
  if (stages.length === 0) return [];

  const stageWidth = Math.max(...stages.map((s) => s.stage.length), "Stage".length);
  const modelWidth = Math.max(...stages.map((s) => s.model.length), "Model".length);

  const lines: string[] = [];
  for (const s of stages) {
    const stageCol = s.stage.padEnd(stageWidth);
    const modelCol = s.model.padEnd(modelWidth);
    const cost = `$${s.costUsd.toFixed(4)}`.padStart(10);
    const inK = `${(s.inputTokens / 1000).toFixed(1)}K in`.padStart(9);
    const outK = `${(s.outputTokens / 1000).toFixed(1)}K out`.padStart(10);
    const dur = `${(s.durationMs / 1000).toFixed(1)}s`.padStart(7);
    lines.push(`  ${stageCol}  ${modelCol}  ${cost}  ${inK} / ${outK}  ${dur}`);
  }

  // Totals separator + row
  const totalCost = stages.reduce((sum, s) => sum + s.costUsd, 0);
  const separatorLen = stageWidth + modelWidth + 55;
  lines.push(`  ${"─".repeat(separatorLen)}`);
  lines.push(
    `  ${"Session total".padEnd(stageWidth)}  ${"".padEnd(modelWidth)}  ${`$${totalCost.toFixed(4).padStart(9)}`}`,
  );

  return lines;
}

/**
 * Aggregate StageUsage entries by model, summing tokens and cost.
 * Returns rows sorted by total USD descending (most expensive model first).
 */
export function aggregateByModel(stages: StageUsage[]): ModelRollupRow[] {
  const byModel = new Map<string, ModelRollupRow>();

  for (const s of stages) {
    const existing = byModel.get(s.model);
    if (existing) {
      existing.inputTokens += s.inputTokens;
      existing.outputTokens += s.outputTokens;
      existing.costUsd += s.costUsd;
    } else {
      byModel.set(s.model, {
        model: s.model,
        inputTokens: s.inputTokens,
        outputTokens: s.outputTokens,
        costUsd: s.costUsd,
      });
    }
  }

  return [...byModel.values()].sort((a, b) => b.costUsd - a.costUsd);
}

/**
 * Format the per-model rollup section into an array of printable lines.
 * Rows are already sorted by costUsd descending (caller's responsibility).
 */
export function formatModelRollup(rows: ModelRollupRow[]): string[] {
  if (rows.length === 0) return [];

  const modelWidth = Math.max(...rows.map((r) => r.model.length), "Model".length);

  const lines: string[] = ["", "  Per-model cost breakdown:"];
  for (const r of rows) {
    const modelCol = r.model.padEnd(modelWidth);
    const cost = `$${r.costUsd.toFixed(4)}`.padStart(10);
    const inK = `${(r.inputTokens / 1000).toFixed(1)}K in`.padStart(9);
    const outK = `${(r.outputTokens / 1000).toFixed(1)}K out`.padStart(10);
    lines.push(`  ${modelCol}  ${cost}  ${inK} / ${outK}`);
  }

  return lines;
}

// ---------------------------------------------------------------------------
// Legacy JSON deserializer — handles entries written before model was tracked
// ---------------------------------------------------------------------------

/**
 * Deserialize a raw stage entry from JSON, defaulting `model` to `"unknown"`
 * for legacy entries that predate per-model tracking.
 * This is the single authoritative place that introduces the "unknown" sentinel.
 */
function deserializeStage(raw: Record<string, unknown>): StageUsage {
  return {
    stage: typeof raw.stage === "string" ? raw.stage : String(raw.stage ?? ""),
    model: typeof raw.model === "string" ? raw.model : "unknown",
    inputTokens: typeof raw.inputTokens === "number" ? raw.inputTokens : 0,
    outputTokens: typeof raw.outputTokens === "number" ? raw.outputTokens : 0,
    cacheReadTokens: typeof raw.cacheReadTokens === "number" ? raw.cacheReadTokens : 0,
    costUsd: typeof raw.costUsd === "number" ? raw.costUsd : 0,
    durationMs: typeof raw.durationMs === "number" ? raw.durationMs : 0,
  };
}

/**
 * Serialize a StageUsage entry with a stable key order for diff-friendly JSON.
 * Key order: stage, model, inputTokens, outputTokens, cacheReadTokens, costUsd, durationMs.
 */
function serializeStage(s: StageUsage): Record<string, unknown> {
  return {
    stage: s.stage,
    model: s.model,
    inputTokens: s.inputTokens,
    outputTokens: s.outputTokens,
    cacheReadTokens: s.cacheReadTokens,
    costUsd: s.costUsd,
    durationMs: s.durationMs,
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createUsageTracker(workDir: string): UsageTracker {
  const session: SessionUsage = {
    startedAt: new Date().toISOString(),
    stages: [],
    totalCostUsd: 0,
  };

  return {
    recordStage(stage: string, model: string, result: SDKResultFields): void {
      const entry: StageUsage = {
        stage,
        model,
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
      for (const line of formatStageTable(session.stages)) {
        log("HARNESS", line);
      }

      const rollupRows = aggregateByModel(session.stages);
      for (const line of formatModelRollup(rollupRows)) {
        log("HARNESS", line);
      }
    },

    getStages(): readonly StageUsage[] {
      return [...session.stages];
    },

    async save(): Promise<void> {
      const usagePath = join(workDir, USAGE_FILE);

      // Load existing run data if present, deserializing legacy entries
      let run: RunUsage = { sessions: [], runTotalCostUsd: 0 };
      try {
        if (existsSync(usagePath)) {
          const raw = JSON.parse(readFileSync(usagePath, "utf-8")) as {
            sessions?: Array<{ startedAt?: string; stages?: Array<Record<string, unknown>>; totalCostUsd?: number }>;
            runTotalCostUsd?: number;
          };
          run = {
            sessions: (raw.sessions ?? []).map((rawSession) => ({
              startedAt: typeof rawSession.startedAt === "string" ? rawSession.startedAt : new Date().toISOString(),
              stages: (rawSession.stages ?? []).map(deserializeStage),
              totalCostUsd: typeof rawSession.totalCostUsd === "number" ? rawSession.totalCostUsd : 0,
            })),
            runTotalCostUsd: typeof raw.runTotalCostUsd === "number" ? raw.runTotalCostUsd : 0,
          };
        }
      } catch (err) {
        // Corrupted file — start fresh; log for visibility
        log(
          "HARNESS",
          `Warning: usage.json could not be parsed (${err instanceof Error ? err.message : String(err)}). Starting fresh.`,
        );
        run = { sessions: [], runTotalCostUsd: 0 };
      }

      run.sessions.push(session);
      run.runTotalCostUsd = run.sessions.reduce((sum, s) => sum + s.totalCostUsd, 0);

      // Serialize with stable key order for all stage entries
      const serializable = {
        sessions: run.sessions.map((s) => ({
          startedAt: s.startedAt,
          stages: s.stages.map(serializeStage),
          totalCostUsd: s.totalCostUsd,
        })),
        runTotalCostUsd: run.runTotalCostUsd,
      };

      await writeFile(usagePath, JSON.stringify(serializable, null, 2), "utf-8");
    },
  };
}
