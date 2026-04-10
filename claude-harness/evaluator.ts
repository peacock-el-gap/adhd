import { processAgentStream } from "../shared/agent-stream.ts";
import { CLAUDE_MAX_TURNS } from "../shared/config.ts";
import { createConversationLog } from "../shared/conversation-logger.ts";
import { gitDir } from "../shared/files.ts";
import { log, logError, shouldLog } from "../shared/logger.ts";
import { buildEvaluatorPrompt } from "../shared/prompts.ts";
import type { AgentSkills } from "../shared/skills.ts";
import type { Options } from "../shared/tracing.ts";
import type { EvalResult, ResolvedConfig, SprintContract } from "../shared/types.ts";
import type { SDKResultFields } from "../shared/usage.ts";
import { extractBalancedJson } from "./contract.ts";

export interface RunEvaluatorOptions {
  config: ResolvedConfig;
  contract: SprintContract;
  attempt?: number;
  skills?: AgentSkills;
  supplementaryContext?: string;
}

export async function runEvaluator(opts: RunEvaluatorOptions): Promise<EvalResult & { sdkResult?: SDKResultFields }> {
  const { config, contract, skills, supplementaryContext } = opts;
  const attempt = opts.attempt ?? 0;
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

  const options: Options = {
    cwd: workDir,
    systemPrompt,
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    tools: ["Read", "Bash", "Glob", "Grep"],
    model,
    maxTurns: CLAUDE_MAX_TURNS,
    persistSession: false,
    ...(skills?.additionalDirs.length ? { additionalDirectories: skills.additionalDirs } : {}),
  };

  const startTime = new Date();
  const convLog = createConversationLog(workDir, "Evaluator", sprint, attempt, { model, startTime });

  const streamResult = await processAgentStream(prompt, options, "EVALUATOR", level, convLog, {
    onResult() {
      log("EVALUATOR", `Evaluation complete for sprint ${sprint}`);
    },
  });

  const duration = Date.now() - startTime.getTime();
  await convLog.finalize(duration);

  const evalResult: EvalResult & { sdkResult?: SDKResultFields } = parseEvalResult(
    streamResult.response,
    contract,
    passThreshold,
  );
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

export function parseEvalResult(response: string, contract: SprintContract, passThreshold: number): EvalResult {
  const candidates: string[] = [];

  // Strategy 1: Look for the LAST JSON code block
  const codeBlocks = [...response.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)];
  for (const match of codeBlocks.reverse()) {
    if (match[1]) candidates.push(match[1].trim());
  }

  // Strategy 2: Find balanced {...} block containing "feedback"
  const balanced = extractBalancedJson(response, "feedback");
  if (balanced) candidates.push(balanced);

  // Strategy 3: Raw response as-is
  candidates.push(response.trim());

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as EvalResult;
      if (parsed.feedback && Array.isArray(parsed.feedback)) {
        parsed.passed = parsed.feedback.every((f) => f.score >= passThreshold);
        return parsed;
      }
    } catch {
      // Try next candidate
    }
  }

  logError("EVALUATOR", "Failed to parse evaluation JSON from any extraction strategy");
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
