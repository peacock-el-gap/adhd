/**
 * Shared utilities for read-only agents (Scout, Reviewer).
 *
 * Extracts the injectable agent function type, optional-deps interface,
 * tool-policy resolution, and JSON artifact I/O so that scout.ts and
 * reviewer.ts contain only their own concerns: constants, system prompts,
 * and domain-specific bounding.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { AgentIdentity } from "../shared/agent-identity.ts";
import type { AgentRole } from "../shared/logger.ts";
import { buildToolPolicyInput, resolveToolPolicy } from "../shared/tool-policy.ts";
import type { LogLevel } from "../shared/types.ts";
import type { RunAgentResult, runAgent } from "./run-agent.ts";

/** Shared injectable agent function type for read-only agents (Scout, Reviewer). */
export type ReadOnlyAgentFn = (opts: Parameters<typeof runAgent>[0]) => Promise<RunAgentResult>;

/** Shared optional deps for read-only agents — primarily for test injection. */
export interface ReadOnlyAgentDeps {
  /** Injected agent runner (defaults to the real runAgent). */
  agentFn?: ReadOnlyAgentFn;
}

/** Minimal config shape required by the shared execution scaffolding. */
export interface ReadOnlyAgentConfig {
  disableMcp?: boolean;
  addMcpServers?: Record<string, Record<string, unknown>>;
  logLevel: LogLevel;
  sessionDir?: string | undefined;
}

/** Options for a single read-only agent execution. */
export interface ReadOnlyAgentCallOptions {
  role: AgentRole;
  workDir: string;
  config: ReadOnlyAgentConfig;
  identity: AgentIdentity;
  prompt: string;
  systemPrompt: string;
  tools: readonly string[];
  model: string;
  maxTurns?: number;
  /** Called when the agent produces its final result. */
  onResult?: () => void;
  agentFn: ReadOnlyAgentFn;
}

/**
 * Execute a read-only agent call with standard tool-policy resolution.
 *
 * Returns the `RunAgentResult` on success. Any error is the caller's
 * responsibility to catch — the non-fatal wrapping (logWarn + empty result)
 * belongs in the individual agent modules (scout.ts, reviewer.ts).
 */
export async function runReadOnlyAgentCall(opts: ReadOnlyAgentCallOptions): Promise<RunAgentResult> {
  const {
    role,
    workDir,
    config,
    identity,
    prompt,
    systemPrompt,
    tools,
    model,
    maxTurns = 20,
    onResult,
    agentFn,
  } = opts;

  const toolPolicy = resolveToolPolicy(role, buildToolPolicyInput(config));

  return agentFn({
    identity,
    role,
    workDir,
    prompt,
    systemPrompt,
    model,
    tools: [...tools],
    maxTurns,
    persistSession: false,
    logLevel: config.logLevel,
    sessionDir: config.sessionDir,
    callbacks: onResult ? { onResult } : undefined,
    toolPolicy,
  });
}

/**
 * Write a JSON artifact file, creating the parent directory as needed.
 *
 * Errors propagate to the caller — the non-fatal wrapper in the individual
 * agent module (scout.ts / reviewer.ts) handles them.
 */
export async function writeJsonArtifact(filePath: string, payload: Record<string, unknown>): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(payload, null, 2), "utf-8");
}

/**
 * Read a named string field from a persisted JSON artifact.
 *
 * Returns `null` when the file is absent, malformed, or the field is not a
 * non-empty string. Never throws.
 */
export async function readJsonStringField(filePath: string, field: string): Promise<string | null> {
  try {
    const raw = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed[field] === "string" && (parsed[field] as string).length > 0) {
      return parsed[field] as string;
    }
    return null;
  } catch {
    return null;
  }
}
