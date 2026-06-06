import type { LogLevel } from "./types.ts";

export type AgentRole =
  | "HARNESS"
  | "PLANNER"
  | "GENERATOR"
  | "EVALUATOR"
  | "DOCUMENTER"
  | "TRACING"
  | "SCOUT"
  | "REVIEWER";

const COLORS: Record<AgentRole, string> = {
  HARNESS: "\x1b[36m", // cyan
  PLANNER: "\x1b[35m", // magenta
  GENERATOR: "\x1b[32m", // green
  EVALUATOR: "\x1b[33m", // yellow
  DOCUMENTER: "\x1b[34m", // blue
  TRACING: "\x1b[90m", // gray
  SCOUT: "\x1b[96m", // bright cyan
  REVIEWER: "\x1b[94m", // bright blue
};

const RESET = "\x1b[0m";
const GRAY = "\x1b[90m";
const RED = "\x1b[31m";
const AMBER = "\x1b[33m";

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

function getResolvedTimezone(): string {
  return configuredTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function timestamp(): string {
  const now = new Date();
  const tz = getResolvedTimezone();
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

/**
 * Generate a timestamp prefix for log filenames in YYYY.MM.DD-HH.MM.SS format.
 * Uses the configured display timezone (same as terminal output timestamps).
 * Falls back gracefully to UTC if the configured timezone is invalid.
 */
export function fileTimestamp(date?: Date): string {
  const now = date ?? new Date();
  const tz = getResolvedTimezone();
  try {
    const parts = now.toLocaleString("en-GB", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    // en-GB format: "DD/MM/YYYY, HH:MM:SS"
    const match = parts.match(/(\d{2})\/(\d{2})\/(\d{4}),?\s*(\d{2}):(\d{2}):(\d{2})/);
    if (match) {
      const [, dd, mm, yyyy, hh, min, ss] = match;
      return `${yyyy}.${mm}.${dd}-${hh}.${min}.${ss}`;
    }
    // Fallback: use ISO string
    return formatIsoAsFileTimestamp(now);
  } catch (_err) {
    logDebug("HARNESS", `Invalid timezone "${tz}", falling back to UTC for file timestamp`);
    return formatIsoAsFileTimestamp(now);
  }
}

function formatIsoAsFileTimestamp(date: Date): string {
  const iso = date.toISOString();
  // ISO: "2026-04-12T14:30:00.000Z"
  return `${iso.slice(0, 10).replace(/-/g, ".")}-${iso.slice(11, 19).replace(/:/g, ".")}`;
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

/**
 * Warning-severity log (amber). Use for handled degradations the operator
 * should know about — a fallback that works, but is worth noticing.
 * Never use for genuine failures; use {@link logError} for those.
 */
export function logWarn(role: AgentRole, message: string): void {
  console.warn(formatMessage(role, AMBER, `${AMBER}${message}${RESET}`));
}

/** Verbose-level log. Only emits when log level is "verbose" or "debug". Gray timestamp and message, colored role tag. */
export function logVerbose(role: AgentRole, message: string): void {
  if (!shouldLog("verbose", configuredLogLevel)) return;
  console.error(formatMessage(role, GRAY, `${GRAY}${message}${RESET}`));
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
