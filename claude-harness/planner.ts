import { type Options, query } from "@anthropic-ai/claude-agent-sdk";
import { readFile } from "fs/promises";
import { join } from "path";
import { CLAUDE_MAX_TURNS, CLAUDE_MODEL } from "../shared/config.ts";
import { createConversationLog } from "../shared/conversation-logger.ts";
import { harnessDir } from "../shared/files.ts";
import { log, logError, shouldLog } from "../shared/logger.ts";
import { buildPlannerPrompt } from "../shared/prompts.ts";
import type { Span } from "../shared/tracing.ts";
import type { HarnessConfig } from "../shared/types.ts";

export async function runPlanner(config: HarnessConfig, span?: Span): Promise<string> {
  const { userPrompt, workDir } = config;
  const isGreenfield = config.isGreenfield ?? false;
  const interactive = config.interactive ?? true;
  const logLevel = config.logLevel ?? "normal";

  log("PLANNER", `Starting planning for: "${userPrompt.slice(0, 100)}${userPrompt.length > 100 ? "..." : ""}"`);

  const model = config.model ?? CLAUDE_MODEL;
  const greenfield = isGreenfield;
  let systemPrompt = buildPlannerPrompt({ workDir, isGreenfield: greenfield });

  if (!interactive) {
    systemPrompt +=
      "\n\nDo not ask questions. Make your best judgment on any ambiguous points and document your assumptions in the spec.";
  }

  const hDir = harnessDir(workDir);

  const tools: string[] = ["Read", "Write"];
  if (interactive) {
    tools.push("AskUserQuestion");
  }

  const options: Options = {
    cwd: workDir,
    systemPrompt,
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    tools,
    model,
    maxTurns: CLAUDE_MAX_TURNS,
    persistSession: false,
  };

  // HITL: handle AskUserQuestion via canUseTool
  if (interactive) {
    options.canUseTool = async (toolName: string, toolInput: Record<string, unknown>) => {
      if (toolName === "AskUserQuestion") {
        const question = typeof toolInput.question === "string" ? toolInput.question : String(toolInput.question ?? "");
        const BOLD_MAGENTA = "\x1b[1;35m";
        const RST = "\x1b[0m";
        process.stdout.write(`\n${BOLD_MAGENTA}[PLANNER asks]${RST} ${question}\n> `);

        // Read from stdin with 60s timeout
        const answer = await new Promise<string>((resolve) => {
          const timeout = setTimeout(() => {
            process.stdout.write("\n(timeout — proceeding with best judgment)\n");
            resolve("Proceed with your best judgment.");
          }, 60_000);

          const onData = (data: Buffer) => {
            clearTimeout(timeout);
            process.stdin.removeListener("data", onData);
            process.stdin.pause();
            resolve(data.toString().trim());
          };

          process.stdin.resume();
          process.stdin.once("data", onData);
        });

        // Return allow with the user's answer injected as the tool result
        return { behavior: "allow" as const, updatedInput: { ...toolInput, answer } };
      }
      return { behavior: "allow" as const }; // auto-approve all other tools
    };
  }

  const fullPrompt = `IMPORTANT: Your working directory is ${workDir}. Write the spec to ${hDir}/spec.md. Do NOT write files outside of ${workDir}.\n\n${userPrompt}`;

  const startTime = new Date();
  const convLog = createConversationLog(workDir, "Planner", undefined, undefined, { model, startTime });

  span?.logMessage("user", fullPrompt);

  let fullResponse = "";
  let completed = false;

  for await (const msg of query({ prompt: fullPrompt, options })) {
    if (msg.type === "assistant") {
      const message = msg as {
        message: { content: Array<{ type: string; text?: string; name?: string; input?: unknown }> };
      };
      for (const block of message.message.content) {
        if (block.type === "text" && block.text) {
          fullResponse += block.text;
          convLog.logAssistantText(block.text);
          span?.logMessage("assistant", block.text);
          if (shouldLog("verbose", logLevel)) {
            log("PLANNER", block.text.slice(0, 200));
          }
        } else if (block.type === "tool_use" && block.name) {
          convLog.logToolUse(block.name, block.input);
          span?.logToolCall(block.name, block.input);
          if (shouldLog("normal", logLevel)) {
            log("PLANNER", `  Tool: ${block.name}`);
          }
        }
      }
    } else if (msg.type === "tool_use_summary") {
      const summary = msg as { summary?: string };
      convLog.logToolResult(summary.summary ?? "");
    } else if (msg.type === "result") {
      const result = msg as { session_id?: string };
      completed = true;
      log("PLANNER", `Planning complete (session: ${result.session_id?.slice(0, 8)}...)`);
    }
  }

  const duration = Date.now() - startTime.getTime();
  await convLog.finalize(duration);
  span?.end({ result: completed ? "completed" : "incomplete" });

  if (!completed) {
    logError("PLANNER", "Planner query did not complete");
    throw new Error("Planner failed to produce output");
  }

  // The planner may have written spec.md via the Write tool instead of returning text.
  if (!fullResponse) {
    try {
      fullResponse = await readFile(join(hDir, "spec.md"), "utf-8");
      log("PLANNER", "Read spec from file written by planner agent");
    } catch {
      logError("PLANNER", "No text response and no spec.md on disk");
      throw new Error("Planner completed but produced no spec");
    }
  }

  log("PLANNER", "Product specification generated");
  return fullResponse;
}
