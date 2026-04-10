import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { processAgentStream } from "../shared/agent-stream.ts";
import { CLAUDE_MAX_TURNS } from "../shared/config.ts";
import { createConversationLog } from "../shared/conversation-logger.ts";
import { harnessDir } from "../shared/files.ts";
import { log, logDebug, logError } from "../shared/logger.ts";
import { buildPlannerPrompt } from "../shared/prompts.ts";
import type { AgentSkills } from "../shared/skills.ts";
import type { Options } from "../shared/tracing.ts";
import type { ResolvedConfig } from "../shared/types.ts";
import type { SDKResultFields, UsageTracker } from "../shared/usage.ts";

export async function runPlanner(
  config: ResolvedConfig,
  reviseFeedback?: string,
  usage?: UsageTracker,
  skills?: AgentSkills,
): Promise<string> {
  const { userPrompt, workDir, isGreenfield, interactive, logLevel } = config;

  log("PLANNER", `Starting planning for: "${userPrompt.slice(0, 100)}${userPrompt.length > 100 ? "..." : ""}"`);

  const model = config.modelPlanner ?? config.model;
  let systemPrompt = buildPlannerPrompt({
    workDir,
    isGreenfield,
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

  // Context injection — prepend reference documents to prompt
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

  let completed = false;

  logDebug("PLANNER", `Calling query() with model: ${options.model} tools: ${options.tools}`);
  logDebug("PLANNER", `Prompt: ${fullPrompt.length} chars, systemPrompt: ${systemPrompt.length} chars`);

  const streamResult = await processAgentStream(fullPrompt, options, "PLANNER", logLevel, convLog, {
    onResult(result) {
      completed = true;
      if (usage) {
        usage.recordStage(reviseFeedback ? "planner-revision" : "planner", result as SDKResultFields);
      }
      log("PLANNER", `Planning complete (session: ${result.session_id?.slice(0, 8)}...)`);
    },
  });

  let fullResponse = streamResult.response;

  const duration = Date.now() - startTime.getTime();
  await convLog.finalize(duration);

  if (!completed) {
    logError("PLANNER", "Planner query did not complete");
    throw new Error("Planner failed to produce output");
  }

  // The planner writes spec.md via the Write tool — the file is the canonical output.
  // fullResponse contains narration text ("Let me examine..."), not the spec itself.
  // Always prefer the file on disk; fall back to fullResponse only if no file exists.
  try {
    fullResponse = await readFile(join(hDir, "spec.md"), "utf-8");
    log("PLANNER", "Read spec from file written by planner agent");
  } catch {
    if (!fullResponse) {
      logError("PLANNER", "No text response and no spec.md on disk");
      throw new Error("Planner completed but produced no spec");
    }
    log("PLANNER", "Using text response as spec (no file on disk)");
  }

  log("PLANNER", "Product specification generated");
  return fullResponse;
}
