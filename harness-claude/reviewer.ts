/**
 * Reviewer agent — read-only code-craft review after passing sprints
 * (Sprint 13 / F13).
 *
 * The Reviewer runs once per passing sprint when the --review flag is set.
 * It inspects the codebase for naming, duplication, maintainability,
 * architectural fit, and security patterns — concerns deliberately kept
 * separate from the Evaluator's behavioral pass/fail authority.
 *
 * Key design decisions (mirrors the Scout precedent in harness-claude/scout.ts):
 *   - Read-only tools only (Read, Bash, Glob, Grep — no Write/Edit).
 *   - Non-fatal: any failure is caught and reported at warning severity; the
 *     run continues without a report.
 *   - Report is bounded via shared/review-report.ts (single source of truth
 *     for bounding logic — never duplicated here).
 *   - Cost is recorded as its own stage ("reviewer") separate from other rows.
 *   - Shared scaffolding (agent call, artifact I/O) lives in read-only-agent.ts.
 */

import { join } from "node:path";
import { log, logWarn } from "../shared/logger.ts";
import type { ReviewerResult, RunReviewerOptions } from "../shared/orchestration/types.ts";
import { boundReviewReport, parseReviewReport } from "../shared/review-report.ts";
import type { AgentSkills } from "../shared/skills.ts";
import {
  type ReadOnlyAgentDeps,
  type ReadOnlyAgentFn,
  readJsonStringField,
  runReadOnlyAgentCall,
  writeJsonArtifact,
} from "./read-only-agent.ts";
import { runAgent } from "./run-agent.ts";

/** Read-only tools available to the Reviewer agent. No Write or Edit. */
export const REVIEWER_TOOLS = ["Read", "Bash", "Glob", "Grep"] as const;

/** Stage name used when recording Reviewer cost in usage.json. */
export const REVIEWER_STAGE_NAME = "reviewer";

/**
 * Path builder for the per-sprint Reviewer report artifact.
 * Returns a path relative to the project root.
 * e.g. ".adhd/reviews/sprint-3.json"
 */
export const REVIEWER_REPORT_FILE = (sprint: number): string => `.adhd/reviews/sprint-${sprint}.json`;

/** Base system prompt for the Reviewer agent. */
const REVIEWER_BASE_PROMPT = `You are a read-only code-craft reviewer. Your job is to inspect the project's source code and produce a structured report focused entirely on code quality — not on whether the code behaves correctly (that is the Evaluator's role).

Review the following dimensions:

1. **Naming** — Are identifiers clear, descriptive, and consistent with the project's established conventions?
2. **Duplication** — Are there repeated logic blocks, copy-pasted patterns, or opportunities for extraction?
3. **Maintainability** — Is the code easy to read, understand, and change? Are functions/modules sized appropriately?
4. **Architectural fit** — Does the new code follow the layering rules and dependency direction already established in the codebase?
5. **Security patterns** — Are there obvious security concerns (unvalidated input, unsafe serialisation, missing error handling)?

Be specific and cite concrete file paths and line numbers. Be constructive — describe what to improve and why. Do not make changes to any files.

Output your report as plain text. Be concise: aim for 500–2000 words covering the five areas above.`;

/**
 * Build the full Reviewer system prompt, optionally composing policy skills
 * into it via the existing skill-injection path (same pattern as other agents).
 *
 * @param skills  Optional AgentSkills for the reviewer slot.
 * @returns       System prompt string with skills appended when present.
 */
function buildReviewerSystemPrompt(skills?: AgentSkills): string {
  let prompt = REVIEWER_BASE_PROMPT;
  if (skills?.injected) {
    prompt += `\n\n## Skills\n\n${skills.injected}`;
  }
  if (skills?.referenceManifest) {
    prompt += `\n\n## Reference Materials\n\n${skills.referenceManifest}`;
  }
  return prompt;
}

/**
 * Injected agent function type for testing without a live SDK call.
 * Aliased from the shared ReadOnlyAgentFn for Reviewer tests.
 */
export type ReviewerAgentFn = ReadOnlyAgentFn;

/** Optional dependencies for runReviewer — primarily for test injection. */
export type RunReviewerDeps = ReadOnlyAgentDeps;

/**
 * Run the Reviewer agent to produce a code-craft report for the given sprint.
 *
 * Non-fatal: any error is caught, reported at warning severity, and an empty
 * ReviewerResult (no report, no sdkResult) is returned so the caller can
 * proceed.
 *
 * @param opts  Reviewer options (config, identity, sprint number).
 * @param deps  Optional injected dependencies for tests.
 * @returns     ReviewerResult with report (if successful) and sdkResult for
 *              cost recording.
 */
export async function runReviewer(opts: RunReviewerOptions, deps?: RunReviewerDeps): Promise<ReviewerResult> {
  const { config, identity, sprint, skills } = opts;
  const { workDir } = config;
  const model = config.resolvedModelReviewer;
  const agentFn = deps?.agentFn ?? runAgent;

  log("REVIEWER", `Starting code-craft review for sprint ${sprint}...`);

  try {
    const streamResult = await runReadOnlyAgentCall({
      role: "REVIEWER",
      workDir,
      config,
      identity,
      prompt: `IMPORTANT: Your working directory is ${workDir}. Review the code changes introduced in sprint ${sprint}. Focus on code craft — naming, duplication, maintainability, architectural fit, and security patterns. Do not modify any files.`,
      systemPrompt: buildReviewerSystemPrompt(skills),
      tools: REVIEWER_TOOLS,
      model,
      maxTurns: 20,
      onResult: () => log("REVIEWER", `Code-craft review for sprint ${sprint} complete`),
      agentFn,
    });

    const rawReport = streamResult.response;
    const bounded = boundReviewReport(rawReport);
    const report = parseReviewReport(bounded);

    if (bounded) {
      await writeReviewerReport(workDir, sprint, bounded);
      log("REVIEWER", `Report written for sprint ${sprint} (${bounded.length} chars)`);
    } else {
      logWarn("REVIEWER", `Reviewer produced an empty report for sprint ${sprint} — skipping persist`);
    }

    return { report, sdkResult: streamResult.sdkResult };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logWarn("REVIEWER", `Reviewer failed for sprint ${sprint} — run will continue without report: ${message}`);
    return { report: undefined, sdkResult: undefined };
  }
}

/**
 * Write the Reviewer report artifact to disk.
 * Persists as a JSON object with stable key order for diff-friendly history.
 * Creates the .adhd/reviews/ directory if it does not exist.
 * Never throws — errors from disk writes propagate to the caller (runReviewer
 * catches them).
 */
export async function writeReviewerReport(workDir: string, sprint: number, report: string): Promise<void> {
  const filePath = join(workDir, REVIEWER_REPORT_FILE(sprint));
  await writeJsonArtifact(filePath, { sprint, report, generatedAt: new Date().toISOString() });
}

/**
 * Read a persisted Reviewer report artifact.
 * Returns the report string if present and valid, or null if absent/malformed.
 * Never throws.
 */
export async function readReviewerReport(workDir: string, sprint: number): Promise<string | null> {
  const filePath = join(workDir, REVIEWER_REPORT_FILE(sprint));
  return readJsonStringField(filePath, "report");
}
