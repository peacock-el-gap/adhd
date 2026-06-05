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
 * - one `feedback` entry per contract criterion, so the next Generator attempt
 *   sees why it failed
 * - an `overallSummary` explaining why the Evaluator was skipped
 *
 * `priorRealEval` is the key to not losing real findings. A skip overwrites the
 * loop's `lastEval`, which is what the next Generator attempt receives as
 * feedback. Without the real evaluation merged in, the Generator would only ever
 * see "you missed surface X" and lose the actual defect the Evaluator last
 * reported — exactly how a sprint can ping-pong between surfaces and never fix
 * the underlying problem. When a prior real evaluation is supplied, its
 * per-criterion details and scores are carried forward *in addition to* the skip
 * note; when it is absent (no real eval yet this sprint) the result degrades to
 * the original boilerplate-only shape (`scores: {}`, one identical reason per
 * criterion).
 *
 * Extracting this keeps the two gates from copy-pasting the construction.
 *
 * @param contract - the sprint contract whose criteria seed the feedback rows
 * @param perCriterionDetail - short reason attached to every criterion entry
 * @param overallSummary - human-readable summary of why the Evaluator was skipped
 * @param priorRealEval - the most recent actual Evaluator result for this
 *   sprint, whose findings are merged forward so the next attempt keeps them
 */
export function buildSkippedEvaluatorResult(
  contract: SprintContract,
  perCriterionDetail: string,
  overallSummary: string,
  priorRealEval?: EvalResult,
): EvalResult {
  // No real evaluation yet — original boilerplate-only shape.
  if (!priorRealEval) {
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

  // Merge the last real evaluation's findings so the next Generator attempt
  // still sees the actual defect, with the gate-skip note appended. Preserve the
  // real per-criterion scores rather than blanking them.
  const priorByCriterion = new Map(priorRealEval.feedback.map((entry) => [entry.criterion, entry]));
  return {
    passed: false,
    scores: { ...priorRealEval.scores },
    feedback: contract.criteria.map((c) => {
      const prior = priorByCriterion.get(c.name);
      return prior
        ? { criterion: c.name, score: prior.score, details: `${prior.details}\n\n[Gate skip] ${perCriterionDetail}` }
        : { criterion: c.name, score: 0, details: perCriterionDetail };
    }),
    overallSummary: `${overallSummary}\n\nMost recent Evaluator findings (carried forward):\n${priorRealEval.overallSummary}`,
  };
}
