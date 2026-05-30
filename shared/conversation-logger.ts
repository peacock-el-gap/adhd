import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type AgentIdentity, bareName, displayTitle, timedName } from "./agent-identity.ts";

export interface ConversationLogger {
  logAssistantText(text: string): void;
  logToolUse(name: string, input: unknown): void;
  logToolResult(output: string): void;
  finalize(duration: number): Promise<void>;
  /** The timestamped identifier used in the log filename and matching span names. */
  readonly timestampedName: string;
  /** The bare identifier (no timestamp) — useful when a caller wants to record cost rows that pair with this log. */
  readonly bareIdentifier: string;
}

interface LogEntry {
  type: "text" | "tool_use" | "tool_result";
  content: string;
  toolName?: string;
}

/**
 * Open a new conversation log keyed by an agent identity.
 *
 * The filename is `<timestamp>-<bareName>.md`, derived from the identity.
 * The markdown body's title comes from the identity's display form.
 */
export function createConversationLog(
  workDir: string,
  identity: AgentIdentity,
  metadata?: { model: string; startTime: Date },
): ConversationLogger {
  const entries: LogEntry[] = [];
  const timestampedNameValue = timedName(identity);
  const bareIdentifierValue = bareName(identity);
  const titleValue = displayTitle(identity);

  return {
    get timestampedName(): string {
      return timestampedNameValue;
    },
    get bareIdentifier(): string {
      return bareIdentifierValue;
    },

    logAssistantText(text: string): void {
      if (text.trim()) {
        entries.push({ type: "text", content: text });
      }
    },

    logToolUse(name: string, input: unknown): void {
      let content: string;
      if (typeof input === "string") {
        content = input;
      } else if (input && typeof input === "object") {
        // For common tools, format nicely
        const obj = input as Record<string, unknown>;
        if (name === "Bash" && typeof obj.command === "string") {
          content = obj.command;
        } else if (name === "Write" && typeof obj.file_path === "string") {
          const lines = typeof obj.content === "string" ? obj.content.split("\n").length : 0;
          content = `\`${obj.file_path}\`\n${lines} lines`;
        } else if (name === "Edit" && typeof obj.file_path === "string") {
          content = `\`${obj.file_path}\``;
        } else if (name === "Read" && typeof obj.file_path === "string") {
          content = `\`${obj.file_path}\``;
        } else if ((name === "Glob" || name === "Grep") && typeof obj.pattern === "string") {
          content = obj.pattern;
        } else {
          content = JSON.stringify(input, null, 2);
        }
      } else {
        content = String(input);
      }
      entries.push({ type: "tool_use", content, toolName: name });
    },

    logToolResult(output: string): void {
      entries.push({ type: "tool_result", content: output });
    },

    async finalize(duration: number): Promise<void> {
      const lines: string[] = [];

      // Header
      lines.push(`# ${titleValue}`);
      lines.push("");

      if (metadata) {
        const startUtc = `${metadata.startTime.toISOString().replace("T", " ").slice(0, 16)} UTC`;
        const durMin = Math.floor(duration / 60000);
        const durSec = Math.floor((duration % 60000) / 1000);
        const durStr = durMin > 0 ? `${durMin}m ${durSec}s` : `${durSec}s`;
        lines.push(`Model: ${metadata.model} | Started: ${startUtc} | Duration: ${durStr}`);
        lines.push("");
      }

      for (const entry of entries) {
        if (entry.type === "text") {
          lines.push("---");
          lines.push("");
          lines.push(entry.content);
          lines.push("");
        } else if (entry.type === "tool_use") {
          lines.push("---");
          lines.push("");
          if (entry.toolName === "Bash") {
            lines.push(`> **Bash**`);
            lines.push(`> \`\`\``);
            for (const line of entry.content.split("\n")) {
              lines.push(`> ${line}`);
            }
            lines.push(`> \`\`\``);
          } else if (
            entry.toolName === "Write" ||
            entry.toolName === "Read" ||
            entry.toolName === "Edit" ||
            entry.toolName === "Glob" ||
            entry.toolName === "Grep"
          ) {
            lines.push(`> **${entry.toolName}** ${entry.content}`);
          } else {
            lines.push(`> **${entry.toolName}**`);
            if (entry.content) {
              lines.push(`> \`\`\``);
              for (const line of entry.content.split("\n")) {
                lines.push(`> ${line}`);
              }
              lines.push(`> \`\`\``);
            }
          }
          lines.push("");
        } else if (entry.type === "tool_result") {
          const output = entry.content.trim();
          if (!output) {
            lines.push("(no output)");
            lines.push("");
          } else {
            const outputLines = output.split("\n");
            if (outputLines.length <= 20) {
              lines.push("```");
              lines.push(output);
              lines.push("```");
              lines.push("");
            } else {
              lines.push("<details>");
              lines.push(`<summary>Output (${outputLines.length} lines)</summary>`);
              lines.push("");
              lines.push("```");
              lines.push(output);
              lines.push("```");
              lines.push("");
              lines.push("</details>");
              lines.push("");
            }
          }
        }
      }

      const filename = `${timestampedNameValue}.md`;
      const logPath = join(workDir, ".adhd", "logs", filename);
      await writeFile(logPath, lines.join("\n"), "utf-8");
    },
  };
}
