/**
 * Helpers for constructing {@link EvalResult} objects without invoking the
 * Evaluator. Pure and SDK-independent — lives in shared/ alongside the other
 * domain logic.
 */
import type { EvalResult, SprintContract } from "./types.ts";

/**
 * Build the failure result used when a cheap pre-evaluation gate (the
 * `--lint-gate` static-analysis gate, or the surface coverage gate) short
 * -circuits an attempt *before* the Evaluator runs — so no AI tokens are spent.
 *
 * The shape mirrors what the Evaluator itself produces, so downstream consumers
 * (progress, resume, regression, retry feedback) are unaffected:
 * - `passed: false`
 * - `scores: {}` (no per-criterion scores were computed)
 * - one zero-scored `feedback` entry per contract criterion, all carrying the
 *   same short reason, so the next Generator attempt sees why it failed
 * - an `overallSummary` explaining why the Evaluator was skipped
 *
 * Extracting this keeps the two gates from copy-pasting the construction.
 *
 * @param contract - the sprint contract whose criteria seed the feedback rows
 * @param perCriterionDetail - short reason attached to every criterion entry
 * @param overallSummary - human-readable summary of why the Evaluator was skipped
 */
export function buildSkippedEvaluatorResult(
  contract: SprintContract,
  perCriterionDetail: string,
  overallSummary: string,
): EvalResult {
  return {
    passed: false,
    scores: {},
    feedback: contract.criteria.map((c) => ({
      criterion: c.name,
      score: 0,
      details: perCriterionDetail,
    })),
    overallSummary,
  };
}
