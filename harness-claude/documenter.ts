import { buildArtifactDigest } from "../shared/artifact-digest.ts";
import { gitDir, harnessDir } from "../shared/files.ts";
import { log } from "../shared/logger.ts";
import { ensureAgentCommit } from "../shared/orchestration/git-ops.ts";
import type { EnsureDocumenterCommitOptions, RunDocumenterOptions } from "../shared/orchestration/types.ts";
import { buildDocumenterPrompt } from "../shared/prompts.ts";
import { buildToolPolicyInput, resolveToolPolicy } from "../shared/tool-policy.ts";
import type { CommitSource } from "../shared/types.ts";
import type { SDKResultFields } from "../shared/usage.ts";
import { resumeAgent, runAgent } from "./run-agent.ts";

export type { RunDocumenterOptions };

export async function runDocumenter(
  opts: RunDocumenterOptions,
): Promise<{ sdkResult?: SDKResultFields; sessionId?: string }> {
  const { config, identity, skills, sprintResults } = opts;
  const { workDir, isGreenfield, sourceDir, testDir } = config;
  const model = config.resolvedModelDocumenter;
  log("DOCUMENTER", "Generating project documentation...");

  const systemPrompt = buildDocumenterPrompt({ workDir, isGreenfield, skills, sourceDir, testDir });
  const hDir = harnessDir(workDir);
  const docTarget = gitDir(workDir, isGreenfield);

  const artifactDigest = buildArtifactDigest({ workDir, sprintResults });

  const prompt = `IMPORTANT: Your working directory is ${workDir}. Documentation files should be written to ${docTarget}. The \`.adhd/\` directory at ${hDir} contains build artifacts for reference (read-only).

## Artifact Digest

The following is a structured summary of the build artifacts from this project's harness run:

${artifactDigest}

## Instructions

Read the codebase in ${isGreenfield ? "the `app/` directory" : "the project root"}, cross-reference with the artifacts above, and produce documentation files (README.md, CHANGELOG.md, and optionally API docs). Commit your work with a \`[docs]\` prefixed message when done.`;

  const toolPolicy = resolveToolPolicy("DOCUMENTER", buildToolPolicyInput(config));

  const result = await runAgent({
    identity,
    role: "DOCUMENTER",
    workDir,
    prompt,
    systemPrompt,
    model,
    tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
    maxTurns: config.resolvedMaxTurnsDocumenter,
    // persistSession: true so ensureDocumenterCommit can resume this session
    // if the documenter leaves uncommitted changes.
    persistSession: true,
    logLevel: config.logLevel,
    additionalDirectories: skills?.additionalDirs,
    toolPolicy,
    callbacks: {
      onResult: () => log("DOCUMENTER", "Documentation generation complete"),
    },
  });

  return { sdkResult: result.sdkResult, sessionId: result.sessionId };
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
  const sprintLabel = sprintResults.length > 0 ? (sprintResults[sprintResults.length - 1]?.sprintNumber ?? 0) : 0;
  const fallbackMessage = `[docs] Sprint ${sprintLabel}: project documentation for ${featureSummary} (documenter did not commit)`;

  const resumePrompt =
    "STOP. Do not write any more documentation. You produced documentation but left uncommitted changes. Run `git add` for the documentation files and `git commit` with a descriptive `[docs]` message summarizing what you documented. Do nothing else.";

  const runResume = sessionId
    ? async () => {
        await resumeAgent({
          workDir,
          sessionId,
          prompt: resumePrompt,
          systemPrompt:
            "You are finishing up a documentation session. Your ONLY job is to commit uncommitted documentation changes with a meaningful [docs] commit message. Do NOT write or modify any files.",
          model,
          tools: ["Bash"],
          maxTurns: 3,
          onToolUse: (name) => log("HARNESS", `  Commit resume tool: ${name}`),
        });
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
