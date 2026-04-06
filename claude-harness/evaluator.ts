import { type Options, query } from "@anthropic-ai/claude-agent-sdk";
import { CLAUDE_MAX_TURNS } from "../shared/config.ts";
import { createConversationLog } from "../shared/conversation-logger.ts";
import { log, logError, shouldLog } from "../shared/logger.ts";
import { buildEvaluatorPrompt } from "../shared/prompts.ts";
import type { Span } from "../shared/tracing.ts";
import type { EvalResult, LogLevel, SprintContract } from "../shared/types.ts";
import { extractBalancedJson } from "./harness.ts";

export async function runEvaluator(
  workDir: string,
  contract: SprintContract,
  passThreshold: number,
  model: string,
  isGreenfield: boolean,
  logLevel?: LogLevel,
  attempt?: number,
  span?: Span,
): Promise<EvalResult> {
  const sprint = contract.sprintNumber;
  const level = logLevel ?? "normal";
  log("EVALUATOR", `Evaluating sprint ${sprint} against ${contract.criteria.length} criteria`);

  const systemPrompt = buildEvaluatorPrompt({ workDir, isGreenfield });
  const appLocation = isGreenfield ? `${workDir}/app/` : workDir;

  const prompt = `IMPORTANT: Your working directory is ${workDir}. The application code is in ${appLocation}. All file operations must be within ${workDir}.

## Sprint Contract to Evaluate Against

${JSON.stringify(contract, null, 2)}

## Pass Threshold

Each criterion must score at least ${passThreshold}/10 to pass.

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
  };

  const startTime = new Date();
  const convLog = createConversationLog(workDir, "Evaluator", sprint, attempt ?? 0, { model, startTime });

  span?.logMessage("user", prompt);

  let fullResponse = "";

  for await (const msg of query({ prompt, options })) {
    if (msg.type === "assistant") {
      const message = msg as {
        message: { content: Array<{ type: string; text?: string; name?: string; input?: unknown }> };
      };
      for (const block of message.message.content) {
        if (block.type === "text" && block.text) {
          fullResponse += block.text;
          convLog.logAssistantText(block.text);
          span?.logMessage("assistant", block.text);
          if (shouldLog("verbose", level)) {
            log("EVALUATOR", block.text.slice(0, 200));
          }
        } else if (block.type === "tool_use" && block.name) {
          convLog.logToolUse(block.name, block.input);
          span?.logToolCall(block.name, block.input);
          if (shouldLog("normal", level)) {
            log("EVALUATOR", `  Tool: ${block.name}`);
          }
        }
      }
    } else if (msg.type === "tool_use_summary") {
      const summary = msg as { summary?: string };
      convLog.logToolResult(summary.summary ?? "");
    } else if (msg.type === "result") {
      log("EVALUATOR", `Evaluation complete for sprint ${sprint}`);
    }
  }

  const duration = Date.now() - startTime.getTime();
  await convLog.finalize(duration);

  const evalResult = parseEvalResult(fullResponse, contract, passThreshold);

  span?.end({ result: evalResult.passed ? "passed" : "failed", scores: evalResult.scores });

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
