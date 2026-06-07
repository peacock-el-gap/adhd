import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { CLAUDE_MAX_TURNS } from "../shared/config.ts";
import type { ConversationLogger } from "../shared/conversation-logger.ts";
import { type AgentRole, log, logDebug, shouldLog, summarize } from "../shared/logger.ts";
import type { LogLevel } from "../shared/types.ts";
import type { SDKResultFields } from "../shared/usage.ts";
import type { Options } from "./tracing-claude.ts";
import { query } from "./tracing-claude.ts";

/**
 * The SDK `query` function as a structural type, declared here (leaf-ward) so
 * `run-agent.ts` can import it without creating an import cycle. Tests inject a
 * bare async generator over `SDKMessage` in place of the real, traced `query`.
 */
export type QueryFn = (params: { prompt: string; options: Options }) => AsyncIterable<SDKMessage>;

/** Callbacks for agent-specific handling of streaming events. */
export interface StreamCallbacks {
  /** Called for each text block in an assistant message. */
  onText?: (text: string) => void;
  /** Called for each tool_use block in an assistant message. */
  onToolUse?: (name: string, input?: unknown) => void;
  /** Called when a result message is received. */
  onResult?: (result: SDKResultFields & { session_id: string }) => void;
}

/** Return value from processAgentStream. */
export interface StreamResult {
  response: string;
  sessionId?: string;
  sdkResult?: SDKResultFields;
}

/**
 * Process an SDK agent query stream, dispatching messages to callbacks
 * and a conversation log. Eliminates the duplicated `for await` / `msg.type`
 * switch blocks across agent functions.
 */
export async function processAgentStream(
  prompt: string,
  options: Options,
  label: AgentRole,
  logLevel: LogLevel,
  convLog: ConversationLogger,
  callbacks?: StreamCallbacks,
  queryFn: QueryFn = query,
): Promise<StreamResult> {
  let fullResponse = "";
  let sessionId: string | undefined;
  let sdkResult: SDKResultFields | undefined;

  for await (const msg of queryFn({ prompt, options })) {
    if (msg.type === "assistant") {
      for (const block of msg.message.content) {
        if (block.type === "text") {
          fullResponse += block.text;
          convLog.logAssistantText(block.text);
          callbacks?.onText?.(block.text);
          if (shouldLog("verbose", logLevel)) {
            log(label, block.text.slice(0, 200));
          }
        } else if (block.type === "tool_use") {
          convLog.logToolUse(block.name, block.input);
          callbacks?.onToolUse?.(block.name, block.input);
          if (shouldLog("normal", logLevel)) {
            log(label, `  Tool: ${block.name}`);
          }
        }
      }
    } else if (msg.type === "system") {
      const sessionInfo = "session_id" in msg ? msg.session_id : "(no session)";
      logDebug(label, `System: ${sessionInfo}`);
    } else if (msg.type === "user") {
      const content = msg.message.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (typeof block === "object" && block.type === "tool_result" && "tool_use_id" in block) {
            const text = typeof block.content === "string" ? block.content : "";
            logDebug(label, `Tool result for ${block.tool_use_id}: ${summarize(text)}`);
            convLog.logToolResult(text);
          }
        }
      }
    } else if (msg.type === "tool_use_summary") {
      convLog.logToolResult(msg.summary);
    } else if (msg.type === "result") {
      sessionId = msg.session_id;
      sdkResult = msg;
      const stopReason = msg.stop_reason ?? null;
      const numTurns = msg.num_turns ?? 0;
      const isError = msg.is_error === true;
      // F7: use the agent's own configured cap (options.maxTurns) rather than the
      // deprecated global CLAUDE_MAX_TURNS sentinel so the warning fires at the
      // right threshold for each agent. Single-turn calls (maxTurns ≤ 1) are
      // exempt from the near-limit warning — reaching turn 1 of 1 is expected
      // behavior, not a capacity concern.
      const agentMaxTurns = options.maxTurns ?? CLAUDE_MAX_TURNS;
      const summary = `SDK result: stop_reason=${stopReason} num_turns=${numTurns}/${agentMaxTurns} is_error=${isError}`;
      const nearTurnLimit = agentMaxTurns > 1 && numTurns >= agentMaxTurns - 2;
      if (stopReason === "max_tokens" || nearTurnLimit || isError) {
        log(label, `WARNING: ${summary}`);
      } else {
        logDebug(label, summary);
      }
      callbacks?.onResult?.(msg);
    }
  }

  return { response: fullResponse, sessionId, sdkResult };
}
