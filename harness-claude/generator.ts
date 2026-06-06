import { gitDir, harnessDir } from "../shared/files.ts";
import { composeGeneratorContext } from "../shared/generator-context.ts";
import { log, shouldLog } from "../shared/logger.ts";
import { type ExecLike, ensureAgentCommit } from "../shared/orchestration/git-ops.ts";
import type { EnsureCommitOptions, GeneratorResult, RunGeneratorOptions } from "../shared/orchestration/types.ts";
import { buildGeneratorPrompt } from "../shared/prompts.ts";
import { buildToolPolicyInput, resolveToolPolicy } from "../shared/tool-policy.ts";
import type { CommitSource } from "../shared/types.ts";
import type { QueryFn } from "./agent-stream.ts";
import { type RunAgentRequest, type RunAgentResult, resumeAgent, runAgent } from "./run-agent.ts";
import { readScoutDigest } from "./scout.ts";

export type { EnsureCommitOptions, GeneratorResult, RunGeneratorOptions };

/** Optional test-only seam. Pass `runAgentFn` to capture RunAgentRequest values
 *  without mock.module(). Mirrors the `deps` pattern in ensureGeneratorCommit.
 *  `readScoutDigestFn` overrides the real readScoutDigest so tests can exercise
 *  the injection path without writing to disk. */
export interface RunGeneratorDeps {
  runAgentFn?: (req: RunAgentRequest) => Promise<RunAgentResult>;
  readScoutDigestFn?: (workDir: string) => Promise<string | null>;
}

export async function runGenerator(opts: RunGeneratorOptions, _deps?: RunGeneratorDeps): Promise<GeneratorResult> {
  const { config, identity, spec, contract, previousFeedback, skills, supplementaryContext } = opts;
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

  // Inject supplementary context (codebase map, verification baseline, Scout digest)
  // after the main prompt sections. readScoutDigest never throws — it returns null
  // on any failure, so we rely on that contract rather than a redundant try/catch.
  const _readScoutDigest = _deps?.readScoutDigestFn ?? readScoutDigest;
  const scoutDigest = await _readScoutDigest(workDir);
  const composedContext = composeGeneratorContext(supplementaryContext, scoutDigest);
  if (composedContext) {
    prompt += `\n\n${composedContext}`;
  }

  const toolPolicy = resolveToolPolicy("GENERATOR", buildToolPolicyInput(config));

  const _runAgent = _deps?.runAgentFn ?? runAgent;
  const result = await _runAgent({
    identity,
    role: "GENERATOR",
    workDir,
    prompt,
    systemPrompt,
    model,
    tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
    maxTurns: config.resolvedMaxTurnsGenerator,
    persistSession: true,
    logLevel: level,
    additionalDirectories: skills?.additionalDirs,
    toolPolicy,
    sessionDir: config.sessionDir,
    callbacks: {
      onToolUse(_name, input) {
        if (shouldLog("verbose", level) && input) {
          const summary = String(typeof input === "object" ? JSON.stringify(input) : input).slice(0, 120);
          log("GENERATOR", `    ${summary}`);
        }
      },
      onResult(r) {
        log("GENERATOR", `Sprint ${sprint} build complete (session: ${r.session_id?.slice(0, 8)}...)`);
      },
    },
  });

  if (!result.response) {
    log("GENERATOR", `Sprint ${sprint} completed (agent used tools only, no text output)`);
  }

  return result;
}

/**
 * Ensure the generator committed its work. Delegates to the shared
 * ensureAgentCommit primitive; this function only constructs the
 * SDK-specific resume runner and the generator's fallback message.
 *
 * `deps` is a test-only seam (defaulted, so the orchestration-facing `opts`
 * and the `AgentRunners` signature stay untouched): it injects fakes for the
 * subprocess runner and the SDK query so the unit test needs no `mock.module`.
 */
export async function ensureGeneratorCommit(
  opts: EnsureCommitOptions,
  deps?: { exec?: ExecLike; queryFn?: QueryFn },
): Promise<CommitSource> {
  const { workDir, gitDir: gDir, beforeSha, sessionId, contract, isRetry, model } = opts;

  const resumePrompt = isRetry
    ? "STOP. Do not write any more code. You addressed evaluation feedback but left uncommitted changes. Run `git add` for the relevant files and `git commit` with a descriptive message summarizing what you fixed. Do nothing else."
    : "STOP. Do not write any more code. You built features but left uncommitted changes. Run `git add` for the relevant files and `git commit` with a descriptive message summarizing what you implemented. Do nothing else.";

  const features = contract.features.join(", ");
  const sprint = contract.sprintNumber;
  const prefix = isRetry ? "fixes for" : "work on";
  const fallbackMessage = `[auto-commit] Sprint ${sprint}: uncommitted ${prefix}: ${features} (generator did not commit)`;

  const runResume = sessionId
    ? async () => {
        await resumeAgent({
          workDir,
          sessionId,
          prompt: resumePrompt,
          systemPrompt:
            "You are finishing up a coding session. Your ONLY job is to commit uncommitted changes with a meaningful git commit message. Do NOT write or modify any code.",
          model,
          tools: ["Bash"],
          maxTurns: 3,
          onToolUse: (name) => log("HARNESS", `  Commit resume tool: ${name}`),
          queryFn: deps?.queryFn,
        });
      }
    : undefined;

  return ensureAgentCommit({
    workDir,
    gitDir: gDir,
    agentLabel: "generator",
    beforeSha,
    fallbackMessage,
    runResume,
    exec: deps?.exec,
  });
}
