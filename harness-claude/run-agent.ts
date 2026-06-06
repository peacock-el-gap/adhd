import type { AgentIdentity } from "../shared/agent-identity.ts";
import type { ConversationLogger } from "../shared/conversation-logger.ts";
import { createConversationLog } from "../shared/conversation-logger.ts";
import type { AgentRole } from "../shared/logger.ts";
import type { LogLevel } from "../shared/types.ts";
import type { SDKResultFields } from "../shared/usage.ts";
import { processAgentStream, type QueryFn, type StreamCallbacks, type StreamResult } from "./agent-stream.ts";
import type { Options } from "./tracing-claude.ts";
import { query } from "./tracing-claude.ts";

export type { StreamCallbacks, StreamResult };

/**
 * One SDK call.
 *
 * Identity drives naming (cost row, conversation log filename, span name —
 * the orchestrator computes the matching span name elsewhere). The helper
 * owns conversation log lifecycle and permission-mode invariants. Callers own
 * prompt construction, tool selection, post-processing, and cost recording
 * (recording happens at the call site after `runAgent` returns).
 *
 * Invariants the helper enforces:
 *   - permissionMode = "bypassPermissions"
 *   - allowDangerouslySkipPermissions = true
 *   - additionalDirectories is wired from `additionalDirectories` if set
 *   - the conversation log is finalized in a `finally` block — flushed even
 *     when the SDK throws
 *
 * If `inheritConvLog` is provided, the helper writes into the caller-owned
 * log and does NOT finalize it. Used by `negotiateContract` so the proposal
 * and review calls share one log file.
 */
/**
 * Resolved tool/MCP policy for one agent run. Populated by the caller
 * from `shared/tool-policy.ts` and mapped onto SDK Options here.
 * Fields mirror `Options.settingSources` and `Options.mcpServers`; see the
 * SDK type definitions for their semantics. Absent fields are not forwarded
 * (SDK defaults apply).
 */
export interface AgentToolPolicy {
  /** Settings layers to load (controls which filesystem settings apply). */
  settingSources?: Array<"user" | "project" | "local">;
  /**
   * MCP server map. An empty object (`{}`) means "no MCP servers".
   * When absent, the SDK default applies (which today is also no MCP,
   * since settingSources is otherwise unset).
   */
  mcpServers?: Record<string, Record<string, unknown>>;
}

export interface RunAgentRequest {
  identity: AgentIdentity;
  role: AgentRole;
  workDir: string;
  prompt: string;
  systemPrompt: string;
  model: string;
  tools: readonly string[];
  maxTurns: number;
  persistSession: boolean;
  logLevel: LogLevel;

  additionalDirectories?: readonly string[];
  canUseTool?: Options["canUseTool"];
  callbacks?: StreamCallbacks;
  inheritConvLog?: ConversationLogger;
  /**
   * Per-agent tool and MCP policy (F11). When present, controls which
   * settings layers and MCP servers the SDK Options receive. When absent,
   * no settingSources or mcpServers override is applied.
   */
  toolPolicy?: AgentToolPolicy;
}

export interface RunAgentResult extends StreamResult {
  /** Wall-clock duration of the SDK call in milliseconds. */
  durationMs: number;
}

export async function runAgent(req: RunAgentRequest): Promise<RunAgentResult> {
  const options: Options = {
    cwd: req.workDir,
    systemPrompt: req.systemPrompt,
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    tools: [...req.tools],
    model: req.model,
    maxTurns: req.maxTurns,
    persistSession: req.persistSession,
    ...(req.additionalDirectories?.length ? { additionalDirectories: [...req.additionalDirectories] } : {}),
    ...(req.canUseTool ? { canUseTool: req.canUseTool } : {}),
    // Tool/MCP policy (F11): forward settingSources and mcpServers from the
    // resolved per-agent policy when they are explicitly set. Absent fields
    // are not forwarded so the SDK default (isolation mode) applies.
    ...(req.toolPolicy?.settingSources ? { settingSources: req.toolPolicy.settingSources } : {}),
    ...(req.toolPolicy?.mcpServers !== undefined
      ? { mcpServers: req.toolPolicy.mcpServers as Options["mcpServers"] }
      : {}),
  };

  const startTime = new Date();
  const ownsLog = !req.inheritConvLog;
  const convLog =
    req.inheritConvLog ?? createConversationLog(req.workDir, req.identity, { model: req.model, startTime });

  try {
    const stream = await processAgentStream(req.prompt, options, req.role, req.logLevel, convLog, req.callbacks);
    return { ...stream, durationMs: Date.now() - startTime.getTime() };
  } finally {
    if (ownsLog) await convLog.finalize(Date.now() - startTime.getTime());
  }
}

/**
 * Continue an existing session for one short follow-up turn. The session
 * must have been started with `persistSession: true`.
 *
 * Per sdk.d.ts:1159-1167 we use `resume` (loads conversation history) NOT
 * `sessionId` (would assign a new UUID, colliding with the existing session).
 * Encoding this in a separate function means the gotcha lives in one place
 * instead of being re-commented at every resume site.
 *
 * Tools default to [] and maxTurns defaults to 3 — resumes are short
 * follow-up turns. No conversation log is opened: the resume is appended
 * to the original session, not a new file.
 */
export interface ResumeAgentRequest {
  workDir: string;
  sessionId: string;
  prompt: string;
  systemPrompt: string;
  model: string;
  tools?: readonly string[];
  maxTurns?: number;
  /** Fires for each tool_use block during the resumed turn. */
  onToolUse?: (toolName: string) => void;
  /** Injected SDK query. Defaults to the real `query`; tests inject a fake. */
  queryFn?: QueryFn;
}

export async function resumeAgent(req: ResumeAgentRequest): Promise<RunAgentResult> {
  const options: Options = {
    cwd: req.workDir,
    systemPrompt: req.systemPrompt,
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    tools: req.tools ? [...req.tools] : [],
    model: req.model,
    maxTurns: req.maxTurns ?? 3,
    resume: req.sessionId,
  };

  const queryFn = req.queryFn ?? query;
  const startTime = new Date();
  let response = "";
  let sessionId: string | undefined;
  let sdkResult: SDKResultFields | undefined;

  for await (const msg of queryFn({ prompt: req.prompt, options })) {
    if (msg.type === "assistant") {
      for (const block of msg.message.content) {
        if (block.type === "text") response += block.text;
        else if (block.type === "tool_use") req.onToolUse?.(block.name);
      }
    } else if (msg.type === "result") {
      sessionId = msg.session_id;
      sdkResult = msg;
    }
  }

  return { response, sessionId, sdkResult, durationMs: Date.now() - startTime.getTime() };
}
