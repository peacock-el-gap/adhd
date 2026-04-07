import { execSync } from "node:child_process";
import { type Options, query } from "../shared/tracing.ts";
import { CLAUDE_MAX_TURNS } from "../shared/config.ts";
import { createConversationLog } from "../shared/conversation-logger.ts";
import { harnessDir } from "../shared/files.ts";
import { log, logDebug, shouldLog, summarize } from "../shared/logger.ts";
import { buildGeneratorPrompt } from "../shared/prompts.ts";
import type { AgentSkills } from "../shared/skills.ts";
import type { CommitSource, EvalResult, LogLevel, SprintContract } from "../shared/types.ts";
import type { SDKResultFields } from "../shared/usage.ts";

export async function runGenerator(
  workDir: string,
  spec: string,
  contract: SprintContract,
  previousFeedback: EvalResult | undefined,
  model: string,
  isGreenfield: boolean,
  logLevel?: LogLevel,
  attempt: number = 0,
  noTdd?: boolean,
  skills?: AgentSkills,
  sourceDir?: string,
  testDir?: string,
): Promise<{ response: string; sessionId?: string; sdkResult?: SDKResultFields }> {
  const sprint = contract.sprintNumber;
  const level = logLevel ?? "normal";
  log(
    "GENERATOR",
    `Sprint ${sprint} (${previousFeedback ? "retry" : "initial"}) - Building: ${contract.features.join(", ")}`,
  );

  const systemPrompt = buildGeneratorPrompt({ workDir, isGreenfield, noTdd, skills, sourceDir, testDir });
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
    ...(skills?.additionalDirs.length ? { additionalDirectories: skills.additionalDirs } : {}),
  };

  const startTime = new Date();
  const convLog = createConversationLog(workDir, "Generator", sprint, attempt, { model, startTime });


  let fullResponse = "";
  let sessionId: string | undefined;
  let sdkResult: SDKResultFields | undefined;

  for await (const msg of query({ prompt, options })) {
    if (msg.type === "assistant") {
      const message = msg as {
        message: { content: Array<{ type: string; text?: string; name?: string; input?: unknown }> };
      };
      for (const block of message.message.content) {
        if (block.type === "text" && block.text) {
          fullResponse += block.text;
          convLog.logAssistantText(block.text);
          if (shouldLog("verbose", level)) {
            log("GENERATOR", block.text.slice(0, 200));
          }
        } else if (block.type === "tool_use" && block.name) {
          convLog.logToolUse(block.name, block.input);
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
    } else if (msg.type === "system") {
      const sysMsg = msg as { message?: string; session_id?: string };
      logDebug("GENERATOR", `System: ${sysMsg.message ?? sysMsg.session_id ?? "(no content)"}`);
    } else if (msg.type === "user") {
      const userMsg = msg as {
        message: { content: Array<{ type: string; tool_use_id?: string; content?: string }> };
      };
      for (const block of userMsg.message.content) {
        if (block.type === "tool_result" && block.tool_use_id) {
          logDebug("GENERATOR", `Tool result for ${block.tool_use_id}: ${summarize(block.content ?? "")}`);
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
      sessionId = result.session_id;
      sdkResult = result;
      log("GENERATOR", `Sprint ${sprint} build complete (session: ${sessionId?.slice(0, 8)}...)`);
    }
  }

  const duration = Date.now() - startTime.getTime();
  await convLog.finalize(duration);

  if (!fullResponse) {
    log("GENERATOR", `Sprint ${sprint} completed (agent used tools only, no text output)`);
  }

  return { response: fullResponse, sessionId, sdkResult };
}

/**
 * Ensure the generator committed its work. If uncommitted changes remain,
 * resume the generator session to request a meaningful commit, then fall back
 * to a harness-level auto-commit if the agent still doesn't comply.
 */
export async function ensureGeneratorCommit(
  workDir: string,
  gitDir: string,
  beforeSha: string,
  sessionId: string | undefined,
  contract: SprintContract,
  isRetry: boolean,
  model: string,
): Promise<CommitSource> {
  const currentSha = execSync("git rev-parse HEAD", { cwd: gitDir, encoding: "utf-8" }).trim();
  const dirty = execSync("git status --porcelain", { cwd: gitDir, encoding: "utf-8" }).trim();

  // Case A: Agent committed and tree is clean
  if (currentSha !== beforeSha && !dirty) {
    return "agent";
  }

  // Case B: Agent committed some work but left uncommitted changes
  // Case C: Agent didn't commit at all but has changes
  if (!dirty) {
    // HEAD same, tree clean — generator produced no file changes (unusual)
    log("HARNESS", "WARNING: Generator produced no file changes and no commits");
    return "none";
  }

  // Resume the generator session to request a commit
  log("HARNESS", "Generator left uncommitted changes — requesting commit via session resume...");

  const resumePrompt = isRetry
    ? "STOP. Do not write any more code. You addressed evaluation feedback but left uncommitted changes. Run `git add` for the relevant files and `git commit` with a descriptive message summarizing what you fixed. Do nothing else."
    : "STOP. Do not write any more code. You built features but left uncommitted changes. Run `git add` for the relevant files and `git commit` with a descriptive message summarizing what you implemented. Do nothing else.";

  const resumeOptions: Options = {
    cwd: workDir,
    systemPrompt:
      "You are finishing up a coding session. Your ONLY job is to commit uncommitted changes with a meaningful git commit message. Do NOT write or modify any code.",
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    tools: ["Bash"],
    model,
    maxTurns: 3,
    persistSession: false,
    ...(sessionId ? { sessionId } : {}),
  };

  try {
    for await (const msg of query({ prompt: resumePrompt, options: resumeOptions })) {
      if (msg.type === "assistant") {
        const message = msg as {
          message: { content: Array<{ type: string; text?: string; name?: string }> };
        };
        for (const block of message.message.content) {
          if (block.type === "tool_use" && block.name) {
            log("HARNESS", `  Commit resume tool: ${block.name}`);
          }
        }
      }
    }
  } catch (err) {
    log("HARNESS", `WARNING: Resume session for commit failed: ${err}`);
  }

  // Check if the resume succeeded
  const postResumeDirty = execSync("git status --porcelain", { cwd: gitDir, encoding: "utf-8" }).trim();
  if (!postResumeDirty) {
    log("HARNESS", "Generator committed via session resume");
    return "resume";
  }

  // Final fallback: harness auto-commit with as much context as possible
  const features = contract.features.join(", ");
  const sprint = contract.sprintNumber;
  const prefix = isRetry ? "fixes for" : "work on";
  const message = `[auto-commit] Sprint ${sprint}: uncommitted ${prefix}: ${features} (generator did not commit)`;

  log("HARNESS", `WARNING: Generator still did not commit — harness fallback auto-commit`);
  execSync(`git add -A && git commit -m ${JSON.stringify(message)}`, { cwd: gitDir, stdio: "pipe" });

  return "fallback";
}
