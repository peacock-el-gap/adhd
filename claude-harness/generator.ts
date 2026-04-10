import { execSync } from "node:child_process";
import { processAgentStream } from "../shared/agent-stream.ts";
import { CLAUDE_MAX_TURNS } from "../shared/config.ts";
import { createConversationLog } from "../shared/conversation-logger.ts";
import { gitDir, harnessDir } from "../shared/files.ts";
import { log, shouldLog } from "../shared/logger.ts";
import { buildGeneratorPrompt } from "../shared/prompts.ts";
import type { AgentSkills } from "../shared/skills.ts";
import type { Options } from "../shared/tracing.ts";
import { query } from "../shared/tracing.ts";
import type { CommitSource, EvalResult, ResolvedConfig, SprintContract } from "../shared/types.ts";
import type { SDKResultFields } from "../shared/usage.ts";

export interface RunGeneratorOptions {
  config: ResolvedConfig;
  spec: string;
  contract: SprintContract;
  previousFeedback?: EvalResult;
  attempt?: number;
  skills?: AgentSkills;
}

export async function runGenerator(
  opts: RunGeneratorOptions,
): Promise<{ response: string; sessionId?: string; sdkResult?: SDKResultFields }> {
  const { config, spec, contract, previousFeedback, skills } = opts;
  const attempt = opts.attempt ?? 0;
  const { workDir, isGreenfield, noTdd, sourceDir, testDir } = config;
  const model = config.resolvedModelGenerator;
  const level = config.logLevel;
  const sprint = contract.sprintNumber;
  log(
    "GENERATOR",
    `Sprint ${sprint} (${previousFeedback ? "retry" : "initial"}) - Building: ${contract.features.join(", ")}`,
  );

  const systemPrompt = buildGeneratorPrompt({ workDir, isGreenfield, noTdd, skills, sourceDir, testDir });
  const hDir = harnessDir(workDir);

  const codeDir = gitDir(workDir, isGreenfield);
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

  const result = await processAgentStream(prompt, options, "GENERATOR", level, convLog, {
    onToolUse(_name, input) {
      if (shouldLog("verbose", level) && input) {
        const summary = String(typeof input === "object" ? JSON.stringify(input) : input).slice(0, 120);
        log("GENERATOR", `    ${summary}`);
      }
    },
    onResult(r) {
      log("GENERATOR", `Sprint ${sprint} build complete (session: ${r.session_id?.slice(0, 8)}...)`);
    },
  });

  const duration = Date.now() - startTime.getTime();
  await convLog.finalize(duration);

  if (!result.response) {
    log("GENERATOR", `Sprint ${sprint} completed (agent used tools only, no text output)`);
  }

  return result;
}

export interface EnsureCommitOptions {
  workDir: string;
  gitDir: string;
  beforeSha: string;
  sessionId: string | undefined;
  contract: SprintContract;
  isRetry: boolean;
  model: string;
}

/**
 * Ensure the generator committed its work. If uncommitted changes remain,
 * resume the generator session to request a meaningful commit, then fall back
 * to a harness-level auto-commit if the agent still doesn't comply.
 */
export async function ensureGeneratorCommit(opts: EnsureCommitOptions): Promise<CommitSource> {
  const { workDir, gitDir: gDir, beforeSha, sessionId, contract, isRetry, model } = opts;
  const currentSha = execSync("git rev-parse HEAD", { cwd: gDir, encoding: "utf-8" }).trim();
  const dirty = execSync("git status --porcelain", { cwd: gDir, encoding: "utf-8" }).trim();

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
        for (const block of msg.message.content) {
          if (block.type === "tool_use") {
            log("HARNESS", `  Commit resume tool: ${block.name}`);
          }
        }
      }
    }
  } catch (err) {
    log("HARNESS", `WARNING: Resume session for commit failed: ${err}`);
  }

  // Check if the resume succeeded
  const postResumeDirty = execSync("git status --porcelain", { cwd: gDir, encoding: "utf-8" }).trim();
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
  execSync(`git add -A && git commit -m ${JSON.stringify(message)}`, { cwd: gDir, stdio: "pipe" });

  return "fallback";
}
