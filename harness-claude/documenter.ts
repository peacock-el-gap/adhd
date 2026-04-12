import { buildArtifactDigest } from "../shared/artifact-digest.ts";
import { CLAUDE_MAX_TURNS } from "../shared/config.ts";
import { createConversationLog } from "../shared/conversation-logger.ts";
import { gitDir, harnessDir } from "../shared/files.ts";
import { log } from "../shared/logger.ts";
import { ensureAgentCommit } from "../shared/orchestration/git-ops.ts";
import type { EnsureDocumenterCommitOptions, RunDocumenterOptions } from "../shared/orchestration/types.ts";
import { buildDocumenterPrompt } from "../shared/prompts.ts";
import type { CommitSource } from "../shared/types.ts";
import type { SDKResultFields } from "../shared/usage.ts";
import { processAgentStream } from "./agent-stream.ts";
import type { Options } from "./tracing-claude.ts";
import { query } from "./tracing-claude.ts";

export type { RunDocumenterOptions };

export async function runDocumenter(
  opts: RunDocumenterOptions,
): Promise<{ sdkResult?: SDKResultFields; sessionId?: string }> {
  const { config, skills, sprintResults } = opts;
  const { workDir, isGreenfield, sourceDir, testDir } = config;
  const model = config.resolvedModelDocumenter;
  const level = config.logLevel;
  log("DOCUMENTER", "Generating project documentation...");

  const systemPrompt = buildDocumenterPrompt({ workDir, isGreenfield, skills, sourceDir, testDir });
  const hDir = harnessDir(workDir);
  const docTarget = gitDir(workDir, isGreenfield);

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
    // persistSession: true so ensureDocumenterCommit can resume this session
    // if the documenter leaves uncommitted changes.
    persistSession: true,
    ...(skills?.additionalDirs.length ? { additionalDirectories: skills.additionalDirs } : {}),
  };

  const startTime = new Date();
  const convLog = createConversationLog(
    workDir,
    "Documenter",
    undefined,
    undefined,
    { model, startTime },
    opts.logTimestamp,
  );

  const streamResult = await processAgentStream(prompt, options, "DOCUMENTER", level, convLog, {
    onResult() {
      log("DOCUMENTER", "Documentation generation complete");
    },
  });

  const duration = Date.now() - startTime.getTime();
  await convLog.finalize(duration);

  return { sdkResult: streamResult.sdkResult, sessionId: streamResult.sessionId };
}

/**
 * Ensure the documenter committed its work. Mirrors ensureGeneratorCommit:
 * delegates to the shared ensureAgentCommit primitive with a documenter-specific
 * resume runner and contextual fallback message.
 */
export async function ensureDocumenterCommit(opts: EnsureDocumenterCommitOptions): Promise<CommitSource> {
  const { workDir, gitDir: gDir, beforeSha, sessionId, sprintResults, model } = opts;

  const featureSummary =
    sprintResults.length > 0 ? `sprints ${sprintResults.map((s) => s.sprintNumber).join(", ")}` : "completed work";
  const sprintLabel = sprintResults.length > 0 ? sprintResults[sprintResults.length - 1]!.sprintNumber : 0;
  const fallbackMessage = `[docs] Sprint ${sprintLabel}: project documentation for ${featureSummary} (documenter did not commit)`;

  const resumePrompt =
    "STOP. Do not write any more documentation. You produced documentation but left uncommitted changes. Run `git add` for the documentation files and `git commit` with a descriptive `[docs]` message summarizing what you documented. Do nothing else.";

  const runResume = sessionId
    ? async () => {
        // Per sdk.d.ts:1159-1167: use `resume` (loads history) not `sessionId` (new session).
        const resumeOptions: Options = {
          cwd: workDir,
          systemPrompt:
            "You are finishing up a documentation session. Your ONLY job is to commit uncommitted documentation changes with a meaningful [docs] commit message. Do NOT write or modify any files.",
          permissionMode: "bypassPermissions",
          allowDangerouslySkipPermissions: true,
          tools: ["Bash"],
          model,
          maxTurns: 3,
          resume: sessionId,
        };
        for await (const msg of query({ prompt: resumePrompt, options: resumeOptions })) {
          if (msg.type === "assistant") {
            for (const block of msg.message.content) {
              if (block.type === "tool_use") {
                log("HARNESS", `  Commit resume tool: ${block.name}`);
              }
            }
          }
        }
      }
    : undefined;

  return ensureAgentCommit({
    workDir,
    gitDir: gDir,
    agentLabel: "documenter",
    beforeSha,
    fallbackMessage,
    runResume,
  });
}
