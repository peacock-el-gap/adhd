import { type Options, query } from "@anthropic-ai/claude-agent-sdk";
import { CLAUDE_MAX_TURNS, CLAUDE_MODEL } from "../shared/config.ts";
import { createConversationLog } from "../shared/conversation-logger.ts";
import { harnessDir } from "../shared/files.ts";
import { log, logError, shouldLog } from "../shared/logger.ts";
import { buildGeneratorPrompt } from "../shared/prompts.ts";
import type { Span } from "../shared/tracing.ts";
import type { EvalResult, LogLevel, SprintContract } from "../shared/types.ts";

export async function runGenerator(
  workDir: string,
  spec: string,
  contract: SprintContract,
  previousFeedback: EvalResult | undefined,
  model: string,
  isGreenfield: boolean,
  logLevel?: LogLevel,
  span?: Span,
  attempt: number = 0,
): Promise<{ response: string; sessionId?: string }> {
  const sprint = contract.sprintNumber;
  const level = logLevel ?? "normal";
  log(
    "GENERATOR",
    `Sprint ${sprint} (${previousFeedback ? "retry" : "initial"}) - Building: ${contract.features.join(", ")}`,
  );

  const systemPrompt = buildGeneratorPrompt({ workDir, isGreenfield });
  const hDir = harnessDir(workDir);

  const codeDir = isGreenfield ? `${workDir}/app/` : workDir;
  let prompt = `IMPORTANT: Your working directory is ${workDir}. All code MUST be created inside ${codeDir}. Do NOT create files outside of ${workDir}.\n\nThe product spec is at ${hDir}/spec.md.\n\n## Product Spec\n\n${spec}\n\n## Sprint Contract\n\n${JSON.stringify(contract, null, 2)}`;

  if (previousFeedback) {
    prompt += `\n\n## Evaluation Feedback (MUST ADDRESS)\n\n${JSON.stringify(previousFeedback, null, 2)}`;
    prompt += `\n\nThe previous attempt failed evaluation. Address every issue in the feedback above.`;
  } else {
    prompt += `\n\nImplement the features listed in this sprint contract.`;
    if (isGreenfield) {
      prompt += ` Work in the \`app/\` directory.`;
    }
  }

  const options: Options = {
    cwd: workDir,
    systemPrompt,
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
    model,
    maxTurns: CLAUDE_MAX_TURNS,
    persistSession: true,
  };

  const startTime = new Date();
  const convLog = createConversationLog(workDir, "Generator", sprint, attempt, { model, startTime });

  span?.logMessage("user", prompt);

  let fullResponse = "";
  let sessionId: string | undefined;

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
            log("GENERATOR", block.text.slice(0, 200));
          }
        } else if (block.type === "tool_use" && block.name) {
          convLog.logToolUse(block.name, block.input);
          span?.logToolCall(block.name, block.input);
          if (shouldLog("normal", level)) {
            log("GENERATOR", `  Tool: ${block.name}`);
          }
          if (shouldLog("verbose", level) && block.input) {
            const summary = String(typeof block.input === "object" ? JSON.stringify(block.input) : block.input).slice(
              0,
              120,
            );
            log("GENERATOR", `    ${summary}`);
          }
        }
      }
    } else if (msg.type === "tool_use_summary") {
      const summary = msg as { summary?: string };
      convLog.logToolResult(summary.summary ?? "");
    } else if (msg.type === "result") {
      const result = msg as { session_id?: string };
      sessionId = result.session_id;
      log("GENERATOR", `Sprint ${sprint} build complete (session: ${sessionId?.slice(0, 8)}...)`);
    }
  }

  const duration = Date.now() - startTime.getTime();
  await convLog.finalize(duration);
  span?.end({ result: "completed", sessionId });

  if (!fullResponse) {
    log("GENERATOR", `Sprint ${sprint} completed (agent used tools only, no text output)`);
  }

  return { response: fullResponse, sessionId };
}
