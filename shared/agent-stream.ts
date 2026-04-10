import type { ConversationLogger } from "./conversation-logger.ts";
import { type AgentRole, log, logDebug, shouldLog, summarize } from "./logger.ts";
import type { Options } from "./tracing.ts";
import { query } from "./tracing.ts";
import type { LogLevel } from "./types.ts";
import type { SDKResultFields } from "./usage.ts";

/** Content block from an assistant message (BetaMessage.content). */
interface ContentBlock {
  type: string;
  text?: string;
  name?: string;
  input?: unknown;
}

/** Content block from a user/tool-result message. */
interface ToolResultBlock {
  type: string;
  tool_use_id?: string;
  content?: string;
}

/** Callbacks for agent-specific handling of streaming events. */
export interface StreamCallbacks {
  /** Called for each text block in an assistant message. */
  onText?: (text: string) => void;
  /** Called for each tool_use block in an assistant message. */
  onToolUse?: (name: string, input?: unknown) => void;
  /** Called when a result message is received. */
  onResult?: (result: SDKResultFields & { session_id?: string }) => void;
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
      const content = (msg as { message: { content: ContentBlock[] } }).message.content;
      for (const block of content) {
        if (block.type === "text" && block.text) {
          fullResponse += block.text;
          convLog.logAssistantText(block.text);
          callbacks?.onText?.(block.text);
          if (shouldLog("verbose", logLevel)) {
            log(label, block.text.slice(0, 200));
          }
        } else if (block.type === "tool_use" && block.name) {
          convLog.logToolUse(block.name, block.input);
          callbacks?.onToolUse?.(block.name, block.input);
          if (shouldLog("normal", logLevel)) {
            log(label, `  Tool: ${block.name}`);
          }
        }
      }
    } else if (msg.type === "system") {
      const sysMsg = msg as { message?: string; session_id?: string };
      logDebug(label, `System: ${sysMsg.message ?? sysMsg.session_id ?? "(no content)"}`);
    } else if (msg.type === "user") {
      const content = (msg as { message: { content: ToolResultBlock[] } }).message.content;
      for (const block of content) {
        if (block.type === "tool_result" && block.tool_use_id) {
          logDebug(label, `Tool result for ${block.tool_use_id}: ${summarize(block.content ?? "")}`);
          convLog.logToolResult(block.content ?? "");
        }
      }
    } else if (msg.type === "tool_use_summary") {
      const summary = (msg as { summary?: string }).summary;
      convLog.logToolResult(summary ?? "");
    } else if (msg.type === "result") {
      const result = msg as SDKResultFields & { session_id?: string };
      sessionId = result.session_id;
      sdkResult = result;
      callbacks?.onResult?.(result);
    }
  }

  return { response: fullResponse, sessionId, sdkResult };
}
