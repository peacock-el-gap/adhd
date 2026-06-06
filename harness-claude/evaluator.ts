import { gitDir } from "../shared/files.ts";
import { log, logError, shouldLog } from "../shared/logger.ts";
import type { RunEvaluatorOptions } from "../shared/orchestration/types.ts";
import { buildEvaluatorPrompt } from "../shared/prompts.ts";
import { buildToolPolicyInput, resolveToolPolicy } from "../shared/tool-policy.ts";
import type { EvalResult, SprintContract } from "../shared/types.ts";
import type { SDKResultFields } from "../shared/usage.ts";
import { extractBalancedJson, extractUnclosedFence } from "./contract.ts";
import { resumeAgent, runAgent } from "./run-agent.ts";

export type { RunEvaluatorOptions };

export async function runEvaluator(opts: RunEvaluatorOptions): Promise<EvalResult & { sdkResult?: SDKResultFields }> {
  const { config, identity, contract, skills, supplementaryContext } = opts;
  const { workDir, isGreenfield, noBdd, sourceDir, testDir, passThreshold } = config;
  const model = config.resolvedModelEvaluator;
  const level = config.logLevel;
  const sprint = contract.sprintNumber;
  log("EVALUATOR", `Evaluating sprint ${sprint} against ${contract.criteria.length} criteria`);

  const systemPrompt = buildEvaluatorPrompt({ workDir, isGreenfield, noBdd, skills, sourceDir, testDir });
  const appLocation = gitDir(workDir, isGreenfield);

  const prompt = `IMPORTANT: Your working directory is ${workDir}. The application code is in ${appLocation}. All file operations must be within ${workDir}.

## Sprint Contract to Evaluate Against

${JSON.stringify(contract, null, 2)}

## Pass Threshold

Each criterion must score at least ${passThreshold}/10 to pass.
${supplementaryContext ?? ""}

## Instructions

Examine the application in ${isGreenfield ? "the `app/` directory" : "the project root"}. Read the code, run it if possible, and score each criterion. Output ONLY the JSON evaluation object.`;

  const toolPolicy = resolveToolPolicy("EVALUATOR", buildToolPolicyInput(config));

  const streamResult = await runAgent({
    identity,
    role: "EVALUATOR",
    workDir,
    prompt,
    systemPrompt,
    model,
    tools: ["Read", "Bash", "Glob", "Grep"],
    maxTurns: config.resolvedMaxTurnsEvaluator,
    persistSession: false,
    logLevel: level,
    additionalDirectories: skills?.additionalDirs,
    toolPolicy,
    sessionDir: config.sessionDir,
    callbacks: {
      onResult: () => log("EVALUATOR", `Evaluation complete for sprint ${sprint}`),
    },
  });

  let parsed = tryParseEvalResult(streamResult.response, contract, passThreshold);

  // Retry gate: if parsing failed AND the SDK stopped at max_tokens, the JSON
  // was almost certainly truncated mid-output. One short follow-up asking for
  // just the JSON object usually recovers a real verdict. Guarded by stop_reason
  // so genuinely-malformed output never loops.
  if (!parsed && streamResult.sdkResult?.stop_reason === "max_tokens" && streamResult.sessionId) {
    log("EVALUATOR", "Parse failed with stop_reason=max_tokens — retrying with JSON-only follow-up");
    try {
      const retry = await resumeAgent({
        workDir,
        sessionId: streamResult.sessionId,
        prompt: "Re-emit ONLY the JSON object with your evaluation. No preamble, no fences, no prose.",
        systemPrompt:
          "You are re-emitting structured output from a prior evaluation. Output ONLY the JSON object. No preamble, no markdown fences, no prose.",
        model,
        tools: ["Read"],
        maxTurns: 2,
      });
      parsed = tryParseEvalResult(retry.response, contract, passThreshold);
      if (parsed) {
        log("EVALUATOR", "Retry recovered valid JSON verdict");
      }
    } catch (err) {
      log("EVALUATOR", `WARNING: Evaluator retry failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const evalResult: EvalResult & { sdkResult?: SDKResultFields } =
    parsed ?? buildZeroedFallback(streamResult.response, contract);
  evalResult.sdkResult = streamResult.sdkResult;

  if (shouldLog("normal", level)) {
    const passedCount = evalResult.feedback.filter((f) => f.score >= passThreshold).length;
    const totalCount = evalResult.feedback.length;
    const verdict = evalResult.passed ? "PASSED" : "FAILED";
    log("EVALUATOR", `Sprint ${sprint}: ${verdict} (${passedCount}/${totalCount} criteria passed)`);

    for (const item of evalResult.feedback) {
      const status = item.score >= passThreshold ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m";
      log("EVALUATOR", `  [${status}] ${item.criterion}: ${item.score}/10 - ${item.details.slice(0, 100)}`);
    }
  } else {
    // quiet mode: just show pass/fail
    const verdict = evalResult.passed ? "PASSED" : "FAILED";
    log("EVALUATOR", `Sprint ${sprint}: ${verdict}`);
  }

  return evalResult;
}

/**
 * Attempt to parse an evaluator response into an EvalResult. Returns null on
 * failure (caller decides whether to retry or return a zeroed fallback).
 */
export function tryParseEvalResult(
  response: string,
  _contract: SprintContract,
  passThreshold: number,
): EvalResult | null {
  const candidates: string[] = [];

  // Strategy 1: LAST JSON code block
  const codeBlocks = [...response.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)];
  for (const match of codeBlocks.reverse()) {
    if (match[1]) candidates.push(match[1].trim());
  }

  // Strategy 2: balanced {...} block scanning from end (picks the trailing
  // verdict JSON, not earlier JSX/Python braces emitted via Read tool output)
  const balancedFromEnd = extractBalancedJson(response, "feedback", { fromEnd: true });
  if (balancedFromEnd) candidates.push(balancedFromEnd);

  // Strategy 3: balanced {...} forward scan (backstop for unusual shapes)
  const balanced = extractBalancedJson(response, "feedback");
  if (balanced && balanced !== balancedFromEnd) candidates.push(balanced);

  // Strategy 4: unclosed ```json fence → truncated output recovery
  const unclosed = extractUnclosedFence(response);
  if (unclosed) candidates.push(unclosed);

  // Strategy 5: raw response as-is
  candidates.push(response.trim());

  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (
        parsed &&
        typeof parsed === "object" &&
        "feedback" in parsed &&
        Array.isArray((parsed as { feedback: unknown }).feedback)
      ) {
        const result = parsed as EvalResult;
        result.passed = result.feedback.every((f) => f.score >= passThreshold);
        return result;
      }
    } catch {
      // Try next candidate
    }
  }

  return null;
}

export function buildZeroedFallback(response: string, contract: SprintContract): EvalResult {
  return {
    passed: false,
    scores: {},
    feedback: contract.criteria.map((c) => ({
      criterion: c.name,
      score: 0,
      details: "Evaluator failed to produce parseable output",
    })),
    overallSummary: `Evaluation parsing failed. Raw response: ${response.slice(0, 500)}`,
  };
}

/** Back-compat wrapper used by tests. Prefer tryParseEvalResult + buildZeroedFallback. */
export function parseEvalResult(response: string, contract: SprintContract, passThreshold: number): EvalResult {
  const parsed = tryParseEvalResult(response, contract, passThreshold);
  if (parsed) return parsed;
  logError("EVALUATOR", "Failed to parse evaluation JSON from any extraction strategy");
  return buildZeroedFallback(response, contract);
}
