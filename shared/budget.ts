/**
 * Per-sprint token budget tracking (F12).
 *
 * Pure shared module — zero SDK imports. Provides the summation and threshold
 * logic for the optional per-sprint token budget (`--sprint-token-budget` /
 * `SPRINT_TOKEN_BUDGET`). The orchestration layer in `harness-claude/` calls
 * these functions after recording each stage and handles the promptGate call
 * and logging.
 *
 * Key design invariants:
 *   - Never throws; malformed / missing `StageUsage` fields are treated as
 *     zero spend with no threshold event.
 *   - The 80% warning is idempotent: callers track whether it has fired
 *     and pass `alreadyWarned80 = true` on subsequent calls so only one
 *     warning is emitted per sprint.
 *   - Inert when no budget is set (callers check `budget > 0` before calling).
 */

import type { StageUsage } from "./types.ts";

/** Threshold event returned by `checkSprintBudget`. */
export type BudgetThreshold = "none" | "warn-at-80" | "gate-at-100";

/** Result of a single budget check. */
export interface BudgetCheckResult {
  /** Which threshold was crossed, or "none" if still under 80%. */
  threshold: BudgetThreshold;
  /** Total input + output tokens summed across the sprint's stages. */
  tokensUsed: number;
  /** The budget ceiling that was checked against. */
  budget: number;
  /** Percentage consumed, rounded to one decimal place (e.g. 83.7). */
  percentUsed: number;
}

/**
 * Sum the input + output tokens for all stages belonging to the given sprint.
 *
 * Stage names follow the `bareName` convention from `shared/agent-identity.ts`:
 *   - `sprint-N-attempt-M-generator`
 *   - `sprint-N-attempt-M-evaluator`
 *   - `sprint-N-contract-proposal`
 *   - `sprint-N-contract-review`
 *
 * Any stage whose name contains `sprint-${sprintNumber}-` is counted.
 * Missing or non-numeric token values in a `StageUsage` record are treated
 * as zero (never throws).
 *
 * @param stages       All recorded `StageUsage` entries for the current session.
 * @param sprintNumber The sprint whose stages should be summed.
 */
export function computeSprintTokenUsage(stages: readonly StageUsage[], sprintNumber: number): number {
  if (!Array.isArray(stages) || !Number.isInteger(sprintNumber) || sprintNumber < 1) {
    return 0;
  }
  const prefix = `sprint-${sprintNumber}-`;
  let total = 0;
  for (const stage of stages) {
    try {
      if (typeof stage?.stage !== "string" || !stage.stage.includes(prefix)) continue;
      const input = typeof stage.inputTokens === "number" && Number.isFinite(stage.inputTokens) ? stage.inputTokens : 0;
      const output =
        typeof stage.outputTokens === "number" && Number.isFinite(stage.outputTokens) ? stage.outputTokens : 0;
      total += input + output;
    } catch {
      // Skip malformed entries
    }
  }
  return total;
}

/**
 * Determine which budget threshold has been crossed, if any.
 *
 * - Returns `"none"` when `tokensUsed < 80% of budget` or when `budget <= 0`.
 * - Returns `"warn-at-80"` when `tokensUsed >= 80% of budget` and the caller
 *   has not already recorded this warning for the current sprint
 *   (`alreadyWarned80 === false`).
 * - Returns `"gate-at-100"` when `tokensUsed >= 100% of budget`. The 100%
 *   gate takes priority: it is returned instead of `"warn-at-80"` when both
 *   conditions are simultaneously true on the first check (so the caller
 *   handles the gate, not the warning).
 * - After `alreadyWarned80 === true`, the 80% threshold is suppressed so
 *   a second call does not re-emit the warning; only the 100% gate can fire.
 *
 * Never throws; returns `{ threshold: "none", tokensUsed: 0, budget: 0, percentUsed: 0 }`
 * for any invalid inputs.
 *
 * @param tokensUsed     Current sprint token count (from `computeSprintTokenUsage`).
 * @param budget         The configured sprint token budget ceiling (must be > 0).
 * @param alreadyWarned80 Whether the 80% soft warning has already been emitted
 *                        for this sprint. Pass `false` until the warning fires,
 *                        then `true` on every subsequent call.
 */
export function checkSprintBudget(tokensUsed: number, budget: number, alreadyWarned80: boolean): BudgetCheckResult {
  const safeUsed = typeof tokensUsed === "number" && Number.isFinite(tokensUsed) && tokensUsed >= 0 ? tokensUsed : 0;
  const safeBudget = typeof budget === "number" && Number.isFinite(budget) && budget > 0 ? budget : 0;

  if (safeBudget === 0) {
    return { threshold: "none", tokensUsed: safeUsed, budget: safeBudget, percentUsed: 0 };
  }

  const percentUsed = Math.round((safeUsed / safeBudget) * 1000) / 10; // one decimal

  if (safeUsed >= safeBudget) {
    return { threshold: "gate-at-100", tokensUsed: safeUsed, budget: safeBudget, percentUsed };
  }

  if (!alreadyWarned80 && safeUsed >= safeBudget * 0.8) {
    return { threshold: "warn-at-80", tokensUsed: safeUsed, budget: safeBudget, percentUsed };
  }

  return { threshold: "none", tokensUsed: safeUsed, budget: safeBudget, percentUsed };
}

/**
 * Format a human-readable budget status message for the HARNESS log.
 * Returns a single sentence stating what happened and the cost consequence.
 *
 * @param result   The `BudgetCheckResult` to describe.
 * @param sprintN  The sprint number, for context in the message.
 */
export function formatBudgetMessage(result: BudgetCheckResult, sprintN: number): string {
  const { threshold, tokensUsed, budget, percentUsed } = result;
  const used = tokensUsed.toLocaleString();
  const cap = budget.toLocaleString();
  const remaining = Math.max(0, budget - tokensUsed).toLocaleString();

  if (threshold === "warn-at-80") {
    return `Sprint ${sprintN} token spend at ${percentUsed}% of budget — ${used} of ${cap} tokens used, ${remaining} remaining.`;
  }
  if (threshold === "gate-at-100") {
    return `Sprint ${sprintN} token budget reached — ${used} tokens used against a ${cap}-token ceiling.`;
  }
  return `Sprint ${sprintN} token spend: ${used} of ${cap} tokens (${percentUsed}%).`;
}
