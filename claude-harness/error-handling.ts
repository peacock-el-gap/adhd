import { writeProgress } from "../shared/files.ts";
import { log, logError } from "../shared/logger.ts";
import type { HarnessConfig, HarnessProgress, SprintResult } from "../shared/types.ts";

const TRANSIENT_RETRY_DELAYS = [30_000, 60_000, 120_000]; // 30s, 60s, 120s

/** Thrown when the user aborts via a gate (spec review, contract preview, mid-run steering, dirty tree). */
export class UserAbortError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserAbortError";
  }
}

export class HarnessFatalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HarnessFatalError";
  }
}

export function isTransientError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  // HTTP 429 with short reset, 5xx, network errors
  if (lower.includes("429") && !lower.includes("quota") && !lower.includes("daily")) return true;
  if (/\b5\d{2}\b/.test(msg)) return true;
  if (lower.includes("timeout") || lower.includes("econnreset") || lower.includes("econnrefused")) return true;
  if (lower.includes("network") || lower.includes("socket hang up")) return true;
  return false;
}

export async function withTransientRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  for (let attempt = 0; attempt <= TRANSIENT_RETRY_DELAYS.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt < TRANSIENT_RETRY_DELAYS.length && isTransientError(err)) {
        const delay = TRANSIENT_RETRY_DELAYS[attempt] ?? 1000;
        log("HARNESS", `Transient error during ${label}, retrying in ${delay / 1000}s... (${err})`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw err; // Non-transient or exhausted retries
    }
  }
  throw new Error("Unreachable");
}

export async function handleFatalError(
  err: unknown,
  config: HarnessConfig,
  progress: HarnessProgress,
  results: SprintResult[],
): Promise<never> {
  const msg = err instanceof Error ? err.message : String(err);
  logError("HARNESS", msg);

  // Save checkpoint before throwing
  progress.sprintResults = results.map(({ sprintNumber, passed, attempts, evalResult }) => ({
    sprintNumber,
    passed,
    attempts,
    evalResult,
  }));
  try {
    await writeProgress(config.workDir, progress);
    log("HARNESS", "Progress saved. Resume with: bun run claude-harness/index.ts --resume");
  } catch {
    logError("HARNESS", "Failed to save progress checkpoint");
  }

  throw new HarnessFatalError(msg);
}
