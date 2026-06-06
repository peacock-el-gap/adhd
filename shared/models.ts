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

/**
 * Advisory warning when a uniform `--model`/`CLAUDE_MODEL` override puts any
 * agent above its cost-optimised default matrix tier (i.e. spend is higher
 * than the recommended configuration). Returns null when everything is within
 * budget, when the uniform model matches a known tier ≤ the relevant defaults,
 * or when the uniform model is unrecognised. Never throws.
 *
 * Only triggered by an explicit uniform override, NOT by individual per-agent
 * overrides (which are deliberate per-agent choices, not a global override).
 *
 * @param uniformModel  The uniform model string passed via `--model`/`CLAUDE_MODEL`,
 *                      or undefined when no uniform override was set.
 */
export function modelOverspendWarning(uniformModel: string | undefined): string | null {
  if (!uniformModel) return null;
  const uniformT = modelTier(uniformModel);
  if (uniformT === "unknown") return null; // can't rank custom IDs

  const defaultMatrix: Array<{ role: string; defaultModel: string }> = [
    { role: "Planner", defaultModel: DEFAULT_MODEL_PLANNER },
    { role: "Generator", defaultModel: DEFAULT_MODEL_GENERATOR },
    { role: "Evaluator", defaultModel: DEFAULT_MODEL_EVALUATOR },
    { role: "Documenter", defaultModel: DEFAULT_MODEL_DOCUMENTER },
  ];

  const overspending: string[] = [];
  for (const { role, defaultModel } of defaultMatrix) {
    const defaultT = modelTier(defaultModel);
    if (defaultT === "unknown") continue;
    if (TIER_RANK[uniformT] > TIER_RANK[defaultT]) {
      overspending.push(`${role} (default: ${defaultT}, override: ${uniformT})`);
    }
  }

  if (overspending.length === 0) return null;
  return (
    `Uniform model override "${uniformModel}" (${uniformT} tier) exceeds the cost-optimised default for: ` +
    `${overspending.join("; ")}. Run cost will be higher than the recommended matrix. Continuing anyway.`
  );
}

/** The four resolved per-agent turn caps. */
export interface ResolvedAgentCaps {
  resolvedMaxTurnsPlanner: number;
  resolvedMaxTurnsGenerator: number;
  resolvedMaxTurnsEvaluator: number;
  resolvedMaxTurnsDocumenter: number;
}

/**
 * Build per-agent startup log lines for any cap that differs from its default.
 * Returns an empty array when all caps are at their defaults (nothing unusual to report).
 * Mirrors the shape of `describeAgentModels` — one line per changed agent.
 */
export function describeAgentCaps(caps: ResolvedAgentCaps, defaults: ResolvedAgentCaps): string[] {
  const lines: string[] = [];
  if (caps.resolvedMaxTurnsPlanner !== defaults.resolvedMaxTurnsPlanner) {
    lines.push(`Planner max-turns: ${caps.resolvedMaxTurnsPlanner}`);
  }
  if (caps.resolvedMaxTurnsGenerator !== defaults.resolvedMaxTurnsGenerator) {
    lines.push(`Generator max-turns: ${caps.resolvedMaxTurnsGenerator}`);
  }
  if (caps.resolvedMaxTurnsEvaluator !== defaults.resolvedMaxTurnsEvaluator) {
    lines.push(`Evaluator max-turns: ${caps.resolvedMaxTurnsEvaluator}`);
  }
  if (caps.resolvedMaxTurnsDocumenter !== defaults.resolvedMaxTurnsDocumenter) {
    lines.push(`Documenter max-turns: ${caps.resolvedMaxTurnsDocumenter}`);
  }
  return lines;
}
