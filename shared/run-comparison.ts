/**
 * Run-comparison helpers (Sprint 12 / F12).
 *
 * Two pure, side-effect-free functions:
 *   - compareRuns   — structural comparison of two RunRecords (data only, no rendering)
 *   - formatComparison — rendering a RunComparison into [HARNESS]-voice text
 *
 * Conventions:
 * - Never throw for any input combination (null, partial, malformed).
 * - No console output, no git operations, no LLM SDK imports.
 * - JSON-friendly typed structures for the comparison result.
 */

import type { RunRecord } from "./run-history.ts";
import type { StageUsage } from "./types.ts";

// ---------------------------------------------------------------------------
// Comparison result types
// ---------------------------------------------------------------------------

/** Per-stage cost row extracted from a run's flattened usage data. */
export interface StageCostRow {
  stage: string;
  model: string;
  costUsd: number;
}

/** Per-model aggregated cost total for a run. */
export interface ModelCostRow {
  model: string;
  totalCostUsd: number;
}

/** Pass/fail comparison for a single sprint across two runs. */
export interface SprintPassFail {
  sprintNumber: number;
  /** null when the sprint was not recorded in this run. */
  passedA: boolean | null;
  /** null when the sprint was not recorded in this run. */
  passedB: boolean | null;
}

/** Last-seen score for a criterion across two runs. */
export interface ScoreTrend {
  criterion: string;
  /** null when the criterion was not scored in this run. */
  scoreA: number | null;
  /** null when the criterion was not scored in this run. */
  scoreB: number | null;
}

/** Cost comparison between two runs broken down by stage and by model. */
export interface CostDelta {
  /** null when no usage data is available for this run. */
  totalA: number | null;
  /** null when no usage data is available for this run. */
  totalB: number | null;
  /** B − A. null when either total is null. */
  delta: number | null;
  byStageA: StageCostRow[];
  byStageB: StageCostRow[];
  byModelA: ModelCostRow[];
  byModelB: ModelCostRow[];
}

/** Structured comparison between two preserved runs. */
export interface RunComparison {
  stampA: string;
  stampB: string;
  sprintPassFail: SprintPassFail[];
  costDelta: CostDelta;
  scoreTrends: ScoreTrend[];
}

// ---------------------------------------------------------------------------
// compareRuns — pure comparison, no string rendering
// ---------------------------------------------------------------------------

/**
 * Compare two preserved run records and return a structured RunComparison.
 *
 * Pure: never throws for any input. Handles null records, null usage/progress,
 * missing sprint results, and structurally unexpected shapes by degrading each
 * sub-section to "absent" rather than failing.
 *
 * @param stampA Session stamp for run A (used even when recordA is null).
 * @param stampB Session stamp for run B (used even when recordB is null).
 * @param recordA Preserved RunRecord for run A, or null if missing/malformed.
 * @param recordB Preserved RunRecord for run B, or null if missing/malformed.
 */
export function compareRuns(
  stampA: string,
  stampB: string,
  recordA: RunRecord | null,
  recordB: RunRecord | null,
): RunComparison {
  try {
    // -- Cost delta --------------------------------------------------------
    const stagesA = flattenStages(safeGet(() => recordA?.usage ?? null));
    const stagesB = flattenStages(safeGet(() => recordB?.usage ?? null));

    const totalA = safeGet(() => recordA?.usage?.runTotalCostUsd ?? null);
    const totalB = safeGet(() => recordB?.usage?.runTotalCostUsd ?? null);
    const delta = totalA !== null && totalB !== null ? totalB - totalA : null;

    const costDelta: CostDelta = {
      totalA,
      totalB,
      delta,
      byStageA: toStageCostRows(stagesA),
      byStageB: toStageCostRows(stagesB),
      byModelA: aggregateByModel(stagesA),
      byModelB: aggregateByModel(stagesB),
    };

    // -- Sprint pass/fail delta --------------------------------------------
    const resultsA = safeGet(() => recordA?.progress?.sprintResults ?? []) ?? [];
    const resultsB = safeGet(() => recordB?.progress?.sprintResults ?? []) ?? [];

    const sprintMap = new Map<number, { passedA: boolean | null; passedB: boolean | null }>();

    for (const r of resultsA) {
      try {
        sprintMap.set(r.sprintNumber, { passedA: r.passed, passedB: null });
      } catch {
        /* skip malformed entry */
      }
    }
    for (const r of resultsB) {
      try {
        const existing = sprintMap.get(r.sprintNumber);
        if (existing) {
          existing.passedB = r.passed;
        } else {
          sprintMap.set(r.sprintNumber, { passedA: null, passedB: r.passed });
        }
      } catch {
        /* skip malformed entry */
      }
    }

    const sprintPassFail: SprintPassFail[] = [...sprintMap.entries()]
      .sort(([a], [b]) => a - b)
      .map(([sprintNumber, { passedA, passedB }]) => ({ sprintNumber, passedA, passedB }));

    // -- Score trends ------------------------------------------------------
    const scoresA = lastScoresByCriterion(safeGet(() => recordA?.progress?.sprintResults));
    const scoresB = lastScoresByCriterion(safeGet(() => recordB?.progress?.sprintResults));

    const allCriteria = new Set([...scoresA.keys(), ...scoresB.keys()]);
    const scoreTrends: ScoreTrend[] = [...allCriteria].sort().map((criterion) => ({
      criterion,
      scoreA: scoresA.get(criterion) ?? null,
      scoreB: scoresB.get(criterion) ?? null,
    }));

    return { stampA, stampB, sprintPassFail, costDelta, scoreTrends };
  } catch {
    // Absolute fallback — minimal safe structure, never throws
    return {
      stampA: stampA ?? "",
      stampB: stampB ?? "",
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
  }
}

// ---------------------------------------------------------------------------
// formatComparison — pure rendering, no comparison logic
// ---------------------------------------------------------------------------

/**
 * Render a RunComparison into a multi-line string in the [HARNESS] voice.
 *
 * Pure: never throws for any input. Absent or null comparison degrades to a
 * minimal informative message. The returned string has no ANSI codes; the
 * caller is responsible for printing it (e.g. split on "\n", log each line).
 *
 * @param comparison The structured RunComparison to render.
 */
export function formatComparison(comparison: RunComparison | null | undefined): string {
  try {
    if (comparison == null) return "No comparison data available.";

    const lines: string[] = [];

    // Header
    lines.push(`Comparing runs:`);
    lines.push(`  A: ${comparison.stampA || "(unknown)"}`);
    lines.push(`  B: ${comparison.stampB || "(unknown)"}`);

    // Sprint pass/fail delta
    lines.push("");
    if (!comparison.sprintPassFail || comparison.sprintPassFail.length === 0) {
      lines.push("Sprint results: no sprint data in either run.");
    } else {
      lines.push("Sprint results:");
      for (const sprint of comparison.sprintPassFail) {
        try {
          const a = sprint.passedA === null ? "—" : sprint.passedA ? "PASS" : "FAIL";
          const b = sprint.passedB === null ? "—" : sprint.passedB ? "PASS" : "FAIL";
          let note = "";
          if (sprint.passedA !== null && sprint.passedB !== null) {
            if (!sprint.passedA && sprint.passedB) note = " (improved)";
            else if (sprint.passedA && !sprint.passedB) note = " (regressed)";
          }
          lines.push(`  Sprint ${sprint.sprintNumber}: A=${a}  B=${b}${note}`);
        } catch {
          /* skip malformed sprint entry */
        }
      }
    }

    // Cost delta
    lines.push("");
    lines.push("Cost:");
    const cost = comparison.costDelta;
    if (!cost) {
      lines.push("  (no cost data)");
    } else {
      const totalA = cost.totalA !== null ? `$${cost.totalA.toFixed(4)}` : "(no data)";
      const totalB = cost.totalB !== null ? `$${cost.totalB.toFixed(4)}` : "(no data)";

      let deltaStr = "(not comparable)";
      if (cost.delta !== null) {
        const sign = cost.delta >= 0 ? "+" : "";
        const pctStr =
          cost.totalA !== null && cost.totalA !== 0 ? ` (${((cost.delta / cost.totalA) * 100).toFixed(1)}%)` : "";
        deltaStr = `${sign}$${cost.delta.toFixed(4)}${pctStr}`;
      }

      lines.push(`  Total: A=${totalA}  B=${totalB}  delta=${deltaStr}`);

      // By stage
      const stageNames = buildUnionSet(
        (cost.byStageA ?? []).map((s) => s.stage),
        (cost.byStageB ?? []).map((s) => s.stage),
      );

      if (stageNames.length > 0) {
        lines.push("  By stage:");
        for (const stage of stageNames) {
          try {
            const a = (cost.byStageA ?? []).find((s) => s.stage === stage);
            const b = (cost.byStageB ?? []).find((s) => s.stage === stage);
            const aStr = a ? `$${a.costUsd.toFixed(4)} (${a.model})` : "—";
            const bStr = b ? `$${b.costUsd.toFixed(4)} (${b.model})` : "—";
            lines.push(`    ${stage}: A=${aStr}  B=${bStr}`);
          } catch {
            /* skip malformed stage entry */
          }
        }
      }

      // By model
      const modelNames = buildUnionSet(
        (cost.byModelA ?? []).map((m) => m.model),
        (cost.byModelB ?? []).map((m) => m.model),
      );

      if (modelNames.length > 0) {
        lines.push("  By model:");
        for (const model of modelNames) {
          try {
            const a = (cost.byModelA ?? []).find((m) => m.model === model);
            const b = (cost.byModelB ?? []).find((m) => m.model === model);
            const aStr = a ? `$${a.totalCostUsd.toFixed(4)}` : "—";
            const bStr = b ? `$${b.totalCostUsd.toFixed(4)}` : "—";
            lines.push(`    ${model}: A=${aStr}  B=${bStr}`);
          } catch {
            /* skip malformed model entry */
          }
        }
      }
    }

    // Score trends
    lines.push("");
    if (!comparison.scoreTrends || comparison.scoreTrends.length === 0) {
      lines.push("Criteria scores: no scored criteria in either run.");
    } else {
      lines.push("Criteria scores (A → B):");
      for (const trend of comparison.scoreTrends) {
        try {
          const aStr = trend.scoreA !== null ? String(trend.scoreA) : "—";
          const bStr = trend.scoreB !== null ? String(trend.scoreB) : "—";
          let note = "";
          if (trend.scoreA !== null && trend.scoreB !== null) {
            const diff = trend.scoreB - trend.scoreA;
            if (diff > 0) note = ` (+${diff})`;
            else if (diff < 0) note = ` (${diff})`;
          }
          lines.push(`  ${trend.criterion}: ${aStr} → ${bStr}${note}`);
        } catch {
          /* skip malformed trend entry */
        }
      }
    }

    return lines.join("\n");
  } catch {
    return "Could not format comparison — unexpected error.";
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Safely execute a getter, returning null on any error. Never throws.
 */
function safeGet<T>(fn: () => T | null | undefined): T | null {
  try {
    const result = fn();
    return result ?? null;
  } catch {
    return null;
  }
}

/**
 * Flatten all stage rows from a RunUsage across all sessions.
 * Returns empty array for null input or any error.
 */
function flattenStages(usage: { sessions: Array<{ stages?: StageUsage[] }> } | null): StageUsage[] {
  if (!usage) return [];
  try {
    return (usage.sessions ?? []).flatMap((s) => s.stages ?? []);
  } catch {
    return [];
  }
}

/**
 * Convert StageUsage array to StageCostRow array.
 */
function toStageCostRows(stages: StageUsage[]): StageCostRow[] {
  try {
    return stages.map((s) => ({ stage: s.stage, model: s.model, costUsd: s.costUsd }));
  } catch {
    return [];
  }
}

/**
 * Aggregate stages by model name, summing total cost.
 * Returns rows sorted by total cost descending (highest first).
 */
function aggregateByModel(stages: StageUsage[]): ModelCostRow[] {
  try {
    const map = new Map<string, number>();
    for (const s of stages) {
      map.set(s.model, (map.get(s.model) ?? 0) + s.costUsd);
    }
    return [...map.entries()]
      .map(([model, totalCostUsd]) => ({ model, totalCostUsd }))
      .sort((a, b) => b.totalCostUsd - a.totalCostUsd);
  } catch {
    return [];
  }
}

/**
 * Collect the last (most recent) score for each criterion across all sprints.
 * Later sprints overwrite earlier ones, so the last value wins.
 * Returns empty Map for null/undefined input or any error.
 */
function lastScoresByCriterion(
  sprintResults: Array<{ evalResult?: { scores?: Record<string, number> } }> | null | undefined,
): Map<string, number> {
  const scores = new Map<string, number>();
  if (!sprintResults) return scores;
  try {
    for (const result of sprintResults) {
      const evalScores = result?.evalResult?.scores;
      if (evalScores && typeof evalScores === "object") {
        for (const [criterion, score] of Object.entries(evalScores)) {
          if (typeof score === "number") {
            scores.set(criterion, score);
          }
        }
      }
    }
  } catch {
    /* degrade to what was collected */
  }
  return scores;
}

/**
 * Build a stable union of two arrays of strings (order: first array first,
 * then second-array items not already present). Returns unique items only.
 */
function buildUnionSet(a: string[], b: string[]): string[] {
  try {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const item of [...a, ...b]) {
      if (!seen.has(item)) {
        seen.add(item);
        result.push(item);
      }
    }
    return result;
  } catch {
    return [];
  }
}
