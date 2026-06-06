/**
 * Scout agent — read-only pre-Generator codebase analysis (Sprint 9 / F9).
 *
 * The Scout runs once before the sprint loop on an existing project when the
 * --scout flag is set. It reads the codebase and produces a bounded semantic
 * digest of conventions, idioms, and patterns that the Generator can use to
 * write more idiomatic code from the start.
 *
 * Key design decisions:
 *   - Read-only tools only (Read, Bash, Glob, Grep — no Write/Edit).
 *   - Non-fatal: any failure is caught and reported at warning severity; the
 *     run continues without a digest.
 *   - Digest is bounded via shared/scout-digest.ts (single source of truth for
 *     bounding logic — never duplicated here).
 *   - Cost is recorded as its own stage ("scout") separate from planner /
 *     generator / evaluator / documenter rows.
 *   - Shared scaffolding (agent call, artifact I/O) lives in read-only-agent.ts.
 */

import { join } from "node:path";
import { log, logWarn } from "../shared/logger.ts";
import type { RunScoutOptions, ScoutResult } from "../shared/orchestration/types.ts";
import { boundScoutDigest } from "../shared/scout-digest.ts";
import {
  type ReadOnlyAgentDeps,
  type ReadOnlyAgentFn,
  readJsonStringField,
  runReadOnlyAgentCall,
  writeJsonArtifact,
} from "./read-only-agent.ts";
import { runAgent } from "./run-agent.ts";

/** Read-only tools available to the Scout agent. No Write or Edit. */
export const SCOUT_TOOLS = ["Read", "Bash", "Glob", "Grep"] as const;

/** Stage name used when recording Scout cost in usage.json. */
export const SCOUT_STAGE_NAME = "scout";

/** Relative path (from project root) of the persisted Scout digest artifact. */
export const SCOUT_DIGEST_FILE = ".adhd/scout-digest.json";

/** System prompt for the Scout agent. */
const SCOUT_SYSTEM_PROMPT = `You are a read-only codebase analyst. Your job is to study the project's source code and produce a concise semantic digest describing:

1. **Naming conventions** — variable, function, class, file naming style (camelCase, PascalCase, kebab-case, etc.)
2. **Error-handling patterns** — how errors are caught and reported (try/catch, Result types, error propagation)
3. **Testing patterns** — test framework, test file structure, assertion style
4. **Architectural conventions** — module organisation, dependency direction, layering rules
5. **Code style** — import ordering, function length norms, comments and documentation style

Be specific and cite concrete examples from the code. Keep the digest focused and actionable — it will be used to guide a code generator. Do not describe what you cannot find. Do not make changes to any files.

Output your digest as plain text (not JSON). Be concise: aim for 1000–3000 words covering the five areas above.`;

/**
 * Injected agent function type for testing without a live SDK call.
 * Aliased from the shared ReadOnlyAgentFn for Scout tests.
 */
export type ScoutAgentFn = ReadOnlyAgentFn;

/** Optional dependencies for runScout — primarily for test injection. */
export type RunScoutDeps = ReadOnlyAgentDeps;

/**
 * Run the Scout agent to produce a semantic digest of the project's codebase
 * conventions.
 *
 * Non-fatal: any error is caught, reported at warning severity, and an empty
 * ScoutResult (no digest, no sdkResult) is returned so the caller can proceed.
 *
 * @param opts  Scout options (config, identity).
 * @param deps  Optional injected dependencies for tests.
 * @returns     ScoutResult with digest (if successful) and sdkResult for cost
 *              recording.
 */
export async function runScout(opts: RunScoutOptions, deps?: RunScoutDeps): Promise<ScoutResult> {
  const { config, identity } = opts;
  const { workDir } = config;
  const model = config.resolvedModelEvaluator; // Scout uses the evaluator-tier model
  const agentFn = deps?.agentFn ?? runAgent;

  log("SCOUT", "Starting codebase analysis...");

  try {
    const streamResult = await runReadOnlyAgentCall({
      role: "SCOUT",
      workDir,
      config,
      identity,
      prompt: `IMPORTANT: Your working directory is ${workDir}. Read the codebase and produce a semantic digest describing the conventions, idioms, and patterns used in this project. Focus on the five areas in your instructions. Do not modify any files.`,
      systemPrompt: SCOUT_SYSTEM_PROMPT,
      tools: SCOUT_TOOLS,
      model,
      maxTurns: 20,
      onResult: () => log("SCOUT", "Codebase analysis complete"),
      agentFn,
    });

    const rawDigest = streamResult.response;
    const digest = boundScoutDigest(rawDigest);

    if (digest) {
      await writeScoutDigest(workDir, digest);
      log("SCOUT", `Digest written (${digest.length} chars)`);
    } else {
      logWarn("SCOUT", "Scout produced an empty digest — skipping persist");
    }

    return { digest: digest || undefined, sdkResult: streamResult.sdkResult };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logWarn("SCOUT", `Scout analysis failed — run will continue without digest: ${message}`);
    return { digest: undefined, sdkResult: undefined };
  }
}

/**
 * Write the Scout digest artifact to disk.
 * Persists as a JSON object with stable key order for diff-friendly history.
 * Never throws — errors from disk writes propagate to the caller (runScout
 * catches them).
 */
export async function writeScoutDigest(workDir: string, digest: string): Promise<void> {
  const filePath = join(workDir, SCOUT_DIGEST_FILE);
  await writeJsonArtifact(filePath, { digest, generatedAt: new Date().toISOString() });
}

/**
 * Read the persisted Scout digest artifact.
 * Returns the digest string if present and valid, or null if absent/malformed.
 * Never throws.
 */
export async function readScoutDigest(workDir: string): Promise<string | null> {
  const filePath = join(workDir, SCOUT_DIGEST_FILE);
  return readJsonStringField(filePath, "digest");
}
