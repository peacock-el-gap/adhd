import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { type Options, query } from "../shared/tracing.ts";
import { CLAUDE_MAX_TURNS, CLAUDE_MODEL } from "../shared/config.ts";
import { createConversationLog } from "../shared/conversation-logger.ts";
import { harnessDir } from "../shared/files.ts";
import { log, logDebug, logError, shouldLog, summarize } from "../shared/logger.ts";
import { buildPlannerPrompt } from "../shared/prompts.ts";
import type { AgentSkills } from "../shared/skills.ts";
import type { HarnessConfig } from "../shared/types.ts";
import type { SDKResultFields, UsageTracker } from "../shared/usage.ts";

export async function runPlanner(
  config: HarnessConfig,
  reviseFeedback?: string,
  usage?: UsageTracker,
  skills?: AgentSkills,
): Promise<string> {
  const { userPrompt, workDir } = config;
  const isGreenfield = config.isGreenfield ?? false;
  const interactive = config.interactive ?? true;
  const logLevel = config.logLevel ?? "normal";

  log("PLANNER", `Starting planning for: "${userPrompt.slice(0, 100)}${userPrompt.length > 100 ? "..." : ""}"`);

  const model = config.modelPlanner ?? config.model ?? CLAUDE_MODEL;
  const greenfield = isGreenfield;
  let systemPrompt = buildPlannerPrompt({
    workDir,
    isGreenfield: greenfield,
    sourceDir: config.sourceDir,
    testDir: config.testDir,
    noBdd: config.noBdd,
    skills,
  });

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
    ...(skills?.additionalDirs.length ? { additionalDirectories: skills.additionalDirs } : {}),
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

  // B2: Context injection — prepend reference documents to prompt
  let promptBody = userPrompt;
  if (config.contextFiles?.length) {
    const docs = config.contextFiles.map((f) => {
      const content = readFileSync(resolve(workDir, f), "utf-8");
      return `### ${basename(f)}\n\n\`\`\`\n${content}\n\`\`\``;
    });
    promptBody = `## Reference Documents\n\n${docs.join("\n\n")}\n\n## Task\n\n${userPrompt}`;
    log("PLANNER", `Injected ${config.contextFiles.length} context file(s) into prompt`);
  }

  let fullPrompt = `IMPORTANT: Your working directory is ${workDir}. Write the spec to ${hDir}/spec.md. Do NOT write files outside of ${workDir}.\n\n${promptBody}`;

  if (reviseFeedback) {
    fullPrompt += `\n\n## Revision Feedback\n\nThe user reviewed your spec and requests changes:\n\n${reviseFeedback}\n\nRewrite the spec incorporating this feedback.`;
  }

  const startTime = new Date();
  const convLog = createConversationLog(workDir, "Planner", undefined, undefined, { model, startTime });


  let fullResponse = "";
  let completed = false;

  logDebug("PLANNER", `Calling query() with model: ${options.model} tools: ${options.tools}`);
  logDebug("PLANNER", `Prompt: ${fullPrompt.length} chars, systemPrompt: ${systemPrompt.length} chars`);

  for await (const msg of query({ prompt: fullPrompt, options })) {
    logDebug("PLANNER", `Received message type: ${msg.type}`);
    if (msg.type === "assistant") {
      const message = msg as {
        message: { content: Array<{ type: string; text?: string; name?: string; input?: unknown }> };
      };
      for (const block of message.message.content) {
        if (block.type === "text" && block.text) {
          fullResponse += block.text;
          convLog.logAssistantText(block.text);
          if (shouldLog("verbose", logLevel)) {
            log("PLANNER", block.text.slice(0, 200));
          }
        } else if (block.type === "tool_use" && block.name) {
          convLog.logToolUse(block.name, block.input);
          if (shouldLog("normal", logLevel)) {
            log("PLANNER", `  Tool: ${block.name}`);
          }
        }
      }
    } else if (msg.type === "system") {
      const sysMsg = msg as { message?: string; session_id?: string };
      logDebug("PLANNER", `System: ${sysMsg.message ?? sysMsg.session_id ?? "(no content)"}`);
    } else if (msg.type === "user") {
      const userMsg = msg as {
        message: { content: Array<{ type: string; tool_use_id?: string; content?: string }> };
      };
      for (const block of userMsg.message.content) {
        if (block.type === "tool_result" && block.tool_use_id) {
          logDebug("PLANNER", `Tool result for ${block.tool_use_id}: ${summarize(block.content ?? "")}`);
          convLog.logToolResult(block.content ?? "");
        }
      }
    } else if (msg.type === "tool_use_summary") {
      const summary = msg as { summary?: string };
      convLog.logToolResult(summary.summary ?? "");
    } else if (msg.type === "result") {
      const result = msg as {
        session_id?: string;
        total_cost_usd?: number;
        duration_ms?: number;
        usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number };
      };
      completed = true;
      if (usage) {
        usage.recordStage(reviseFeedback ? "planner-revision" : "planner", result as SDKResultFields);
      }
      log("PLANNER", `Planning complete (session: ${result.session_id?.slice(0, 8)}...)`);
    }
  }

  const duration = Date.now() - startTime.getTime();
  await convLog.finalize(duration);

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
