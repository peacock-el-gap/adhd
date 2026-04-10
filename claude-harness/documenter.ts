import { processAgentStream } from "../shared/agent-stream.ts";
import { buildArtifactDigest } from "../shared/artifact-digest.ts";
import { CLAUDE_MAX_TURNS } from "../shared/config.ts";
import { createConversationLog } from "../shared/conversation-logger.ts";
import { gitDir, harnessDir } from "../shared/files.ts";
import { log } from "../shared/logger.ts";
import { buildDocumenterPrompt } from "../shared/prompts.ts";
import type { AgentSkills } from "../shared/skills.ts";
import type { Options } from "../shared/tracing.ts";
import type { ResolvedConfig, SprintResult } from "../shared/types.ts";
import type { SDKResultFields } from "../shared/usage.ts";

export interface RunDocumenterOptions {
  config: ResolvedConfig;
  skills?: AgentSkills;
  sprintResults?: SprintResult[];
}

export async function runDocumenter(opts: RunDocumenterOptions): Promise<{ sdkResult?: SDKResultFields }> {
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
    persistSession: false,
    ...(skills?.additionalDirs.length ? { additionalDirectories: skills.additionalDirs } : {}),
  };

  const startTime = new Date();
  const convLog = createConversationLog(workDir, "Documenter", undefined, undefined, { model, startTime });

  const streamResult = await processAgentStream(prompt, options, "DOCUMENTER", level, convLog, {
    onResult() {
      log("DOCUMENTER", "Documentation generation complete");
    },
  });

  const duration = Date.now() - startTime.getTime();
  await convLog.finalize(duration);

  return { sdkResult: streamResult.sdkResult };
}
