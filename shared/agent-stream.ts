import type { ConversationLogger } from "./conversation-logger.ts";
import { type AgentRole, log, logDebug, shouldLog, summarize } from "./logger.ts";
import type { Options } from "./tracing.ts";
import { query } from "./tracing.ts";
import type { LogLevel } from "./types.ts";
import type { SDKResultFields } from "./usage.ts";

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
): Promise<StreamResult> {
  let fullResponse = "";
  let sessionId: string | undefined;
  let sdkResult: SDKResultFields | undefined;

  for await (const msg of query({ prompt, options })) {
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
      callbacks?.onResult?.(msg);
    }
  }

  return { response: fullResponse, sessionId, sdkResult };
}
