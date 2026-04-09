import { type Options, query } from "../shared/tracing.ts";
import { CLAUDE_MAX_TURNS } from "../shared/config.ts";
import { createConversationLog } from "../shared/conversation-logger.ts";
import { harnessDir } from "../shared/files.ts";
import { log, logDebug, shouldLog, summarize } from "../shared/logger.ts";
import { buildDocumenterPrompt } from "../shared/prompts.ts";
import { buildArtifactDigest } from "../shared/artifact-digest.ts";
import type { AgentSkills } from "../shared/skills.ts";
import type { LogLevel, SprintResult } from "../shared/types.ts";
import type { SDKResultFields } from "../shared/usage.ts";

export async function runDocumenter(
  workDir: string,
  model: string,
  isGreenfield: boolean,
  logLevel?: LogLevel,
  skills?: AgentSkills,
  sourceDir?: string,
  testDir?: string,
  sprintResults?: SprintResult[],
): Promise<{ sdkResult?: SDKResultFields }> {
  const level = logLevel ?? "normal";
  log("DOCUMENTER", "Generating project documentation...");

  const systemPrompt = buildDocumenterPrompt({ workDir, isGreenfield, skills, sourceDir, testDir });
  const hDir = harnessDir(workDir);
  const docTarget = isGreenfield ? `${workDir}/app/` : workDir;

  // Build the artifact digest for context
  const artifactDigest = buildArtifactDigest({ workDir, sprintResults });

  const prompt = `IMPORTANT: Your working directory is ${workDir}. Documentation files should be written to ${docTarget}. The \`.adhd/\` directory at ${hDir} contains build artifacts for reference (read-only).

## Artifact Digest

The following is a structured summary of the build artifacts from this project's harness run:

${artifactDigest}

## Instructions

Read the codebase in ${isGreenfield ? "the `app/` directory" : "the project root"}, cross-reference with the artifacts above, and produce documentation files (README.md, CHANGELOG.md, and optionally API docs). Commit your work with a \`[docs]\` prefixed message when done.`;

  const options: Options = {
    cwd: workDir,
    systemPrompt,
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
    model,
    maxTurns: CLAUDE_MAX_TURNS,
    persistSession: false,
    ...(skills?.additionalDirs.length ? { additionalDirectories: skills.additionalDirs } : {}),
  };

  const startTime = new Date();
  const convLog = createConversationLog(workDir, "Documenter", undefined, undefined, { model, startTime });

  let sdkResult: SDKResultFields | undefined;

  for await (const msg of query({ prompt, options })) {
    if (msg.type === "assistant") {
      const message = msg as {
        message: { content: Array<{ type: string; text?: string; name?: string; input?: unknown }> };
      };
      for (const block of message.message.content) {
        if (block.type === "text" && block.text) {
          convLog.logAssistantText(block.text);
          if (shouldLog("verbose", level)) {
            log("DOCUMENTER", block.text.slice(0, 200));
          }
        } else if (block.type === "tool_use" && block.name) {
          convLog.logToolUse(block.name, block.input);
          if (shouldLog("normal", level)) {
            log("DOCUMENTER", `  Tool: ${block.name}`);
          }
        }
      }
    } else if (msg.type === "system") {
      const sysMsg = msg as { message?: string; session_id?: string };
      logDebug("DOCUMENTER", `System: ${sysMsg.message ?? sysMsg.session_id ?? "(no content)"}`);
    } else if (msg.type === "user") {
      const userMsg = msg as {
        message: { content: Array<{ type: string; tool_use_id?: string; content?: string }> };
      };
      for (const block of userMsg.message.content) {
        if (block.type === "tool_result" && block.tool_use_id) {
          logDebug("DOCUMENTER", `Tool result for ${block.tool_use_id}: ${summarize(block.content ?? "")}`);
          convLog.logToolResult(block.content ?? "");
        }
      }
    } else if (msg.type === "tool_use_summary") {
      const summary = msg as { summary?: string };
      convLog.logToolResult(summary.summary ?? "");
    } else if (msg.type === "result") {
      const result = msg as {
        total_cost_usd?: number;
        duration_ms?: number;
        usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number };
      };
      sdkResult = result;
      log("DOCUMENTER", "Documentation generation complete");
    }
  }

  const duration = Date.now() - startTime.getTime();
  await convLog.finalize(duration);

  return { sdkResult };
}
