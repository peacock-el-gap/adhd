import type { LogLevel } from "./types.ts";

type AgentRole = "HARNESS" | "PLANNER" | "GENERATOR" | "EVALUATOR";

const COLORS: Record<AgentRole, string> = {
  HARNESS: "\x1b[36m", // cyan
  PLANNER: "\x1b[35m", // magenta
  GENERATOR: "\x1b[32m", // green
  EVALUATOR: "\x1b[33m", // yellow
};

const RESET = "\x1b[0m";
const DIM = "\x1b[2m";

let configuredTimezone: string | undefined;

/** Set the timezone used for terminal timestamps. Call once at startup. */
export function setDisplayTimezone(tz?: string): void {
  configuredTimezone = tz;
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

function formatMessage(role: AgentRole, message: string): string {
  return `${DIM}${timestamp()}${RESET} ${COLORS[role]}[${role}]${RESET} ${message}`;
}

export function log(role: AgentRole, message: string): void {
  console.log(formatMessage(role, message));
}

export function logError(role: AgentRole, message: string): void {
  console.error(formatMessage(role, `\x1b[31m${message}${RESET}`));
}

export function logDivider(): void {
  console.log(`\n${DIM}${"─".repeat(60)}${RESET}\n`);
}

/**
 * Check whether a message at the given level should be shown,
 * given the configured log level.
 */
export function shouldLog(messageLevel: LogLevel, configLevel: LogLevel): boolean {
  const order: LogLevel[] = ["quiet", "normal", "verbose"];
  return order.indexOf(messageLevel) <= order.indexOf(configLevel);
}
