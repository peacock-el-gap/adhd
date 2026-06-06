/**
 * Run-history preservation helpers (Sprint 11 / F11).
 *
 * Pure helpers that snapshot a run's terminal usage.json and progress.json
 * under .adhd/runs/<session-stamp>/. Each run is identified by its session
 * stamp (the same identity that names the per-session log subdirectory).
 *
 * Conventions:
 * - Never throws under any input (missing dir, malformed JSON, partial write).
 * - No console output, no git operations — pure file I/O.
 * - JSON with stable key order for diff-friendly history.
 * - Live .adhd/usage.json and .adhd/progress.json semantics are unchanged.
 */

import { existsSync, readFileSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { HarnessProgress, RunUsage } from "./types.ts";

/** Directory under .adhd/ that holds per-run snapshot subdirectories. */
export const RUNS_DIR = ".adhd/runs";

/**
 * A preserved snapshot for a single run.
 * Both fields are optional to support partial records written by interrupted runs.
 */
export interface RunRecord {
  sessionStamp: string;
  usage: RunUsage | null;
  progress: HarnessProgress | null;
}

// ---------------------------------------------------------------------------
// Internal path helpers
// ---------------------------------------------------------------------------

function runsDir(workDir: string): string {
  return join(workDir, RUNS_DIR);
}

function runDir(workDir: string, sessionStamp: string): string {
  return join(runsDir(workDir), sessionStamp);
}

function usagePath(workDir: string, sessionStamp: string): string {
  return join(runDir(workDir, sessionStamp), "usage.json");
}

function progressPath(workDir: string, sessionStamp: string): string {
  return join(runDir(workDir, sessionStamp), "progress.json");
}

// ---------------------------------------------------------------------------
// Write helper
// ---------------------------------------------------------------------------

/**
 * Persist a run's terminal usage and progress snapshots under
 * .adhd/runs/<sessionStamp>/.
 *
 * Creates the directory if absent. Non-fatal: any error (mkdir failure,
 * write failure) is silently swallowed so a run is never disrupted by
 * history preservation. Does not perform any git operation.
 *
 * @param workDir Project root directory.
 * @param sessionStamp Per-run identity timestamp (YYYY.MM.DD-HH.MM.SS).
 * @param usage The current RunUsage value to snapshot, or null to skip.
 * @param progress The current HarnessProgress value to snapshot, or null to skip.
 */
export async function writeRunRecord(
  workDir: string,
  sessionStamp: string,
  usage: RunUsage | null,
  progress: HarnessProgress | null,
): Promise<void> {
  if (!sessionStamp) return;
  try {
    const dir = runDir(workDir, sessionStamp);
    await mkdir(dir, { recursive: true });

    if (usage !== null) {
      const serialized = serializeUsage(usage);
      await writeFile(usagePath(workDir, sessionStamp), JSON.stringify(serialized, null, 2), "utf-8");
    }

    if (progress !== null) {
      await writeFile(progressPath(workDir, sessionStamp), JSON.stringify(progress, null, 2), "utf-8");
    }
  } catch {
    // Non-fatal: history preservation must never disrupt the run.
  }
}

// ---------------------------------------------------------------------------
// Read helper
// ---------------------------------------------------------------------------

/**
 * Read a preserved run record for the given session stamp.
 *
 * Returns a RunRecord with the snapshot contents. Either field is null when
 * the corresponding file is missing or cannot be parsed (partial record from
 * an interrupted run). Returns null when the session directory does not exist.
 * Never throws.
 *
 * @param workDir Project root directory.
 * @param sessionStamp Per-run identity timestamp (YYYY.MM.DD-HH.MM.SS).
 */
export function readRunRecord(workDir: string, sessionStamp: string): RunRecord | null {
  try {
    const dir = runDir(workDir, sessionStamp);
    if (!existsSync(dir)) return null;

    const usage = tryReadJson<RunUsage>(usagePath(workDir, sessionStamp));
    const progress = tryReadJson<HarnessProgress>(progressPath(workDir, sessionStamp));

    return { sessionStamp, usage, progress };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// List helper
// ---------------------------------------------------------------------------

/**
 * List all available run session stamps under .adhd/runs/, newest first
 * (lexicographic descending — the YYYY.MM.DD-HH.MM.SS format sorts naturally).
 *
 * Returns an empty array when the directory does not exist or cannot be read.
 * Never throws.
 *
 * @param workDir Project root directory.
 */
export async function listRunStamps(workDir: string): Promise<string[]> {
  try {
    const dir = runsDir(workDir);
    if (!existsSync(dir)) return [];
    const entries = await readdir(dir, { withFileTypes: true });
    const stamps = entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort()
      .reverse(); // newest first
    return stamps;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Internal serialization helpers
// ---------------------------------------------------------------------------

/**
 * Serialize a RunUsage with stable key order (sessions → stages → per-field).
 * Mirrors the serialization discipline in shared/usage.ts.
 */
function serializeUsage(usage: RunUsage): Record<string, unknown> {
  return {
    sessions: usage.sessions.map((s) => ({
      startedAt: s.startedAt,
      stages: s.stages.map((st) => ({
        stage: st.stage,
        model: st.model,
        inputTokens: st.inputTokens,
        outputTokens: st.outputTokens,
        cacheReadTokens: st.cacheReadTokens,
        costUsd: st.costUsd,
        durationMs: st.durationMs,
      })),
      totalCostUsd: s.totalCostUsd,
    })),
    runTotalCostUsd: usage.runTotalCostUsd,
  };
}

/**
 * Read the live .adhd/usage.json for a project.
 *
 * Returns the RunUsage on success, or null when the file is absent or
 * malformed. Intended to be called just after `usage.save()` so the
 * fully-accumulated run totals are on disk. Never throws.
 *
 * @param workDir Project root directory.
 */
export function readLiveUsage(workDir: string): RunUsage | null {
  return tryReadJson<RunUsage>(join(workDir, ".adhd", "usage.json"));
}

/**
 * Attempt to read and JSON-parse a file.
 * Returns null on any error (missing file, bad JSON, etc.). Never throws.
 */
function tryReadJson<T>(filePath: string): T | null {
  try {
    if (!existsSync(filePath)) return null;
    const raw = readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
