import type { LogLevel } from "./types.ts";

export type AgentRole = "HARNESS" | "PLANNER" | "GENERATOR" | "EVALUATOR" | "DOCUMENTER" | "TRACING";

const COLORS: Record<AgentRole, string> = {
  HARNESS: "\x1b[36m", // cyan
  PLANNER: "\x1b[35m", // magenta
  GENERATOR: "\x1b[32m", // green
  EVALUATOR: "\x1b[33m", // yellow
  DOCUMENTER: "\x1b[34m", // blue
  TRACING: "\x1b[90m", // gray
};

const RESET = "\x1b[0m";
const GRAY = "\x1b[90m";
const RED = "\x1b[31m";

let configuredTimezone: string | undefined;
let configuredLogLevel: LogLevel = "normal";

/** Set the timezone used for terminal timestamps. Call once at startup. */
export function setDisplayTimezone(tz?: string): void {
  configuredTimezone = tz;
}

/** Set the global log level. Call once at startup. */
export function setLogLevel(level: LogLevel): void {
  configuredLogLevel = level;
}

function timestamp(): string {
  const now = new Date();
  const tz = configuredTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  try {
    // Format as HH:MM:SS in the configured timezone
    return now.toLocaleString("en-GB", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  } catch {
    // Fallback to UTC if timezone is invalid
    return now.toISOString().slice(11, 19);
  }
}

function formatMessage(role: AgentRole, timestampColor: string, message: string): string {
  return `${timestampColor}${timestamp()}${RESET} ${COLORS[role]}[${role}]${RESET} ${message}`;
}

export function log(role: AgentRole, message: string): void {
  console.log(formatMessage(role, "", message));
}

export function logError(role: AgentRole, message: string): void {
  console.error(formatMessage(role, RED, `${RED}${message}${RESET}`));
}

/** Debug-level log. Only emits when log level is "debug". Gray timestamp and message, colored role tag. */
export function logDebug(role: AgentRole, message: string): void {
  if (!shouldLog("debug", configuredLogLevel)) return;
  console.error(formatMessage(role, GRAY, `${GRAY}${message}${RESET}`));
}

export function logDivider(): void {
  console.log(`\n${GRAY}${"─".repeat(60)}${RESET}\n`);
}

/** Collapse multiline content into a single line, truncated for debug output. */
export function summarize(text: string, maxLen = 200): string {
  return text.replace(/\n/g, "\\n").slice(0, maxLen);
}

/**
 * Check whether a message at the given level should be shown,
 * given the configured log level.
 */
export function shouldLog(messageLevel: LogLevel, configLevel: LogLevel): boolean {
  const order: LogLevel[] = ["quiet", "normal", "verbose", "debug"];
  return order.indexOf(messageLevel) <= order.indexOf(configLevel);
}
