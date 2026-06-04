/**
 * Model tier constants and pure per-agent model resolution (F6).
 *
 * This is the single home for model IDs. The harness used to ship one stale
 * uniform default (`claude-opus-4-6`) applied to every agent, which paid the
 * top tier even where it changed nothing. Here we name the three current
 * generally-available tiers once and reference them by name everywhere, then
 * expose a reasoned per-agent default matrix plus the helpers that enforce the
 * invariant "the Evaluator (the judge) is never a weaker tier than the
 * Generator (the producer)".
 *
 * Everything in this module is pure: no Claude SDK imports, no I/O, no throwing.
 * SDK/CLI wiring lives in `harness-claude/`; orchestration stays SDK-independent.
 */

/** Highest-capability tier. Drives planning and the pass/fail gate. */
export const MODEL_OPUS = "claude-opus-4-8";
/** Balanced cost/quality tier. Carries the cost-dominant Generator workload. */
export const MODEL_SONNET = "claude-sonnet-4-6";
/** Lowest-cost tier. Reserved for the advisory-only Documenter. */
export const MODEL_HAIKU = "claude-haiku-4-5-20251001";

/**
 * Base uniform fallback used for the resolved `model` field when the user set
 * no `--model`/`CLAUDE_MODEL`. The per-agent matrix below supersedes this for
 * each individual agent; `model` itself is only used for run-level metadata.
 */
export const DEFAULT_MODEL = MODEL_OPUS;

/**
 * Recommended per-agent default matrix.
 * - Planner   → Opus   (runs once; its spec drives every downstream agent).
 * - Generator → Sonnet (cost-dominant; mistakes are recoverable via feedback).
 * - Evaluator → Opus   (the sole gate; must out-judge the Generator).
 * - Documenter→ Haiku  (lowest stakes; advisory-only output).
 */
export const DEFAULT_MODEL_PLANNER = MODEL_OPUS;
export const DEFAULT_MODEL_GENERATOR = MODEL_SONNET;
export const DEFAULT_MODEL_EVALUATOR = MODEL_OPUS;
export const DEFAULT_MODEL_DOCUMENTER = MODEL_HAIKU;

/** Known model tiers, plus `unknown` for IDs we cannot rank (custom overrides). */
export type ModelTier = "opus" | "sonnet" | "haiku" | "unknown";

/** Relative capability/cost rank; higher means a more capable (pricier) tier. */
const TIER_RANK: Record<Exclude<ModelTier, "unknown">, number> = {
  haiku: 1,
  sonnet: 2,
  opus: 3,
};

/**
 * Map a model ID string to its tier by name, best-effort. Unknown or custom
 * IDs (and missing/blank input) map to `"unknown"` so callers can choose to
 * stay quiet rather than guess. Never throws.
 */
export function modelTier(model: string | undefined): ModelTier {
  const m = (model ?? "").toLowerCase();
  if (m.includes("opus")) return "opus";
  if (m.includes("sonnet")) return "sonnet";
  if (m.includes("haiku")) return "haiku";
  return "unknown";
}

/**
 * True when the Evaluator's tier is strictly weaker than the Generator's tier.
 * When either side is an unrecognized model we cannot compare reliably, so we
 * return false (no false-alarm warning). Never throws.
 */
export function evaluatorWeakerThanGenerator(evaluatorModel: string, generatorModel: string): boolean {
  const e = modelTier(evaluatorModel);
  const g = modelTier(generatorModel);
  if (e === "unknown" || g === "unknown") return false;
  return TIER_RANK[e] < TIER_RANK[g];
}

/** Trim a string, returning undefined for missing/blank values. Never throws. */
export function blankToUndefined(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * Resolve one agent's model with the documented precedence:
 *   explicit per-agent override > explicit uniform model > per-agent tier default.
 * The matrix default only applies when the user supplied neither an override nor
 * a uniform model. Always returns a concrete, non-empty string.
 */
export function resolveAgentModel(
  agentOverride: string | undefined,
  uniformModel: string | undefined,
  tierDefault: string,
): string {
  return blankToUndefined(agentOverride) ?? blankToUndefined(uniformModel) ?? tierDefault;
}

/** The four resolved per-agent models the startup log and invariant check read. */
export interface ResolvedAgentModels {
  resolvedModelPlanner: string;
  resolvedModelGenerator: string;
  resolvedModelEvaluator: string;
  resolvedModelDocumenter: string;
}

/**
 * Build the per-agent startup log lines — one per agent, each standing alone so
 * it is readable without the others. The Documenter is included (it used to be
 * silently omitted), so the printed configuration is honest now that the matrix
 * makes the agents differ by default.
 */
export function describeAgentModels(models: ResolvedAgentModels): string[] {
  return [
    `Planner model: ${models.resolvedModelPlanner}`,
    `Generator model: ${models.resolvedModelGenerator}`,
    `Evaluator model: ${models.resolvedModelEvaluator}`,
    `Documenter model: ${models.resolvedModelDocumenter}`,
  ];
}

/**
 * Advisory warning text when the Evaluator tier is weaker than the Generator
 * tier (the judge must never be weaker than the producer). Returns null when the
 * invariant holds. The caller logs this once; it never hard-fails a run.
 */
export function evaluatorInvariantWarning(evaluatorModel: string, generatorModel: string): string | null {
  if (!evaluatorWeakerThanGenerator(evaluatorModel, generatorModel)) return null;
  return `Evaluator model (${evaluatorModel}) is a weaker tier than the Generator model (${generatorModel}). The judge should never be weaker than the producer — keep the Evaluator tier at or above the Generator tier. Continuing anyway.`;
}
