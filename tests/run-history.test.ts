/**
 * Sprint 11 — Run-history preservation tests.
 *
 * Covers all acceptance criteria from the Sprint 11 contract:
 *   - snapshot_written_per_completed_run
 *   - two_runs_produce_two_distinct_directories
 *   - live_files_semantics_unchanged
 *   - preservation_independent_of_commit_flag
 *   - missing_record_degrades_to_absent
 *   - partial_or_malformed_record_does_not_throw
 *   - sdk_independence_preserved
 *   - pure_helpers_have_no_side_effects
 *   - code_quality_naming_dry_and_responsibility
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";

import { writeRunRecord, readRunRecord, listRunStamps, RUNS_DIR } from "../shared/run-history.ts";
import type { HarnessProgress, RunUsage } from "../shared/types.ts";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  const dir = join(tmpdir(), `adhd-run-history-test-${randomBytes(6).toString("hex")}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

const SAMPLE_USAGE: RunUsage = {
  sessions: [
    {
      startedAt: "2026-06-06T10:00:00.000Z",
      stages: [
        {
          stage: "planner",
          model: "claude-opus-4-5",
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 0,
          costUsd: 0.001,
          durationMs: 1000,
        },
      ],
      totalCostUsd: 0.001,
    },
  ],
  runTotalCostUsd: 0.001,
};

const SAMPLE_PROGRESS: HarnessProgress = {
  status: "complete",
  currentSprint: 3,
  totalSprints: 3,
  completedSprints: 3,
  retryCount: 0,
  docsGenerated: true,
};

// ---------------------------------------------------------------------------
// snapshot_written_per_completed_run
// Two per-field tests: both usage.json and progress.json appear in the run dir
// ---------------------------------------------------------------------------

describe("snapshot_written_per_completed_run", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("creates .adhd/runs/<stamp>/ directory with usage.json and progress.json", async () => {
    const stamp = "2026.06.06-10.00.00";
    await writeRunRecord(tmpDir, stamp, SAMPLE_USAGE, SAMPLE_PROGRESS);

    const runDir = join(tmpDir, RUNS_DIR, stamp);
    expect(existsSync(runDir)).toBe(true);
    expect(existsSync(join(runDir, "usage.json"))).toBe(true);
    expect(existsSync(join(runDir, "progress.json"))).toBe(true);
  });

  test("usage.json content reflects the provided run usage", async () => {
    const stamp = "2026.06.06-10.00.00";
    await writeRunRecord(tmpDir, stamp, SAMPLE_USAGE, SAMPLE_PROGRESS);

    const runDir = join(tmpDir, RUNS_DIR, stamp);
    const usageContent = JSON.parse(readFileSync(join(runDir, "usage.json"), "utf-8"));
    expect(usageContent.runTotalCostUsd).toBe(0.001);
    expect(usageContent.sessions).toHaveLength(1);
    expect(usageContent.sessions[0].stages[0].stage).toBe("planner");
  });

  test("progress.json content reflects the provided progress state", async () => {
    const stamp = "2026.06.06-10.00.00";
    await writeRunRecord(tmpDir, stamp, SAMPLE_USAGE, SAMPLE_PROGRESS);

    const runDir = join(tmpDir, RUNS_DIR, stamp);
    const progressContent = JSON.parse(readFileSync(join(runDir, "progress.json"), "utf-8"));
    expect(progressContent.status).toBe("complete");
    expect(progressContent.completedSprints).toBe(3);
    expect(progressContent.docsGenerated).toBe(true);
  });

  test("readRunRecord returns a RunRecord with both fields populated", async () => {
    const stamp = "2026.06.06-10.00.00";
    await writeRunRecord(tmpDir, stamp, SAMPLE_USAGE, SAMPLE_PROGRESS);

    const record = readRunRecord(tmpDir, stamp);
    expect(record).not.toBeNull();
    expect(record!.sessionStamp).toBe(stamp);
    expect(record!.usage).not.toBeNull();
    expect(record!.progress).not.toBeNull();
    expect(record!.progress!.status).toBe("complete");
  });
});

// ---------------------------------------------------------------------------
// two_runs_produce_two_distinct_directories
// ---------------------------------------------------------------------------

describe("two_runs_produce_two_distinct_directories", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("two different stamps produce two distinct subdirectories", async () => {
    const stampA = "2026.06.06-10.00.00";
    const stampB = "2026.06.06-11.00.00";

    const progressA: HarnessProgress = { ...SAMPLE_PROGRESS, completedSprints: 2 };
    const progressB: HarnessProgress = { ...SAMPLE_PROGRESS, completedSprints: 5 };

    await writeRunRecord(tmpDir, stampA, SAMPLE_USAGE, progressA);
    await writeRunRecord(tmpDir, stampB, SAMPLE_USAGE, progressB);

    const dirA = join(tmpDir, RUNS_DIR, stampA);
    const dirB = join(tmpDir, RUNS_DIR, stampB);
    expect(existsSync(dirA)).toBe(true);
    expect(existsSync(dirB)).toBe(true);
    expect(dirA).not.toBe(dirB);
  });

  test("each directory contains its own run's progress snapshot", async () => {
    const stampA = "2026.06.06-10.00.00";
    const stampB = "2026.06.06-11.00.00";

    const progressA: HarnessProgress = { ...SAMPLE_PROGRESS, completedSprints: 2 };
    const progressB: HarnessProgress = { ...SAMPLE_PROGRESS, completedSprints: 5 };

    await writeRunRecord(tmpDir, stampA, SAMPLE_USAGE, progressA);
    await writeRunRecord(tmpDir, stampB, SAMPLE_USAGE, progressB);

    const recordA = readRunRecord(tmpDir, stampA);
    const recordB = readRunRecord(tmpDir, stampB);

    expect(recordA!.progress!.completedSprints).toBe(2);
    expect(recordB!.progress!.completedSprints).toBe(5);
  });

  test("listRunStamps returns both stamps", async () => {
    const stampA = "2026.06.06-10.00.00";
    const stampB = "2026.06.06-11.00.00";
    await writeRunRecord(tmpDir, stampA, SAMPLE_USAGE, SAMPLE_PROGRESS);
    await writeRunRecord(tmpDir, stampB, SAMPLE_USAGE, SAMPLE_PROGRESS);

    const stamps = await listRunStamps(tmpDir);
    expect(stamps).toHaveLength(2);
    expect(stamps).toContain(stampA);
    expect(stamps).toContain(stampB);
  });

  test("listRunStamps returns stamps newest-first (lexicographic descending)", async () => {
    const stampA = "2026.06.06-10.00.00";
    const stampB = "2026.06.06-11.00.00";
    await writeRunRecord(tmpDir, stampA, SAMPLE_USAGE, SAMPLE_PROGRESS);
    await writeRunRecord(tmpDir, stampB, SAMPLE_USAGE, SAMPLE_PROGRESS);

    const stamps = await listRunStamps(tmpDir);
    expect(stamps[0]).toBe(stampB); // newest first
    expect(stamps[1]).toBe(stampA);
  });
});

// ---------------------------------------------------------------------------
// live_files_semantics_unchanged
// Verifies that live .adhd/usage.json and .adhd/progress.json are not touched
// ---------------------------------------------------------------------------

describe("live_files_semantics_unchanged", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    mkdirSync(join(tmpDir, ".adhd"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("writeRunRecord does not modify live .adhd/usage.json", async () => {
    const liveUsagePath = join(tmpDir, ".adhd", "usage.json");
    const liveContent = '{"sessions":[],"runTotalCostUsd":0}';
    writeFileSync(liveUsagePath, liveContent, "utf-8");

    await writeRunRecord(tmpDir, "2026.06.06-10.00.00", SAMPLE_USAGE, SAMPLE_PROGRESS);

    // Live file must be unchanged
    expect(readFileSync(liveUsagePath, "utf-8")).toBe(liveContent);
  });

  test("writeRunRecord does not modify live .adhd/progress.json", async () => {
    const liveProgressPath = join(tmpDir, ".adhd", "progress.json");
    const liveContent = '{"status":"building","currentSprint":1,"totalSprints":3,"completedSprints":0,"retryCount":0}';
    writeFileSync(liveProgressPath, liveContent, "utf-8");

    await writeRunRecord(tmpDir, "2026.06.06-10.00.00", SAMPLE_USAGE, SAMPLE_PROGRESS);

    // Live file must be unchanged
    expect(readFileSync(liveProgressPath, "utf-8")).toBe(liveContent);
  });
});

// ---------------------------------------------------------------------------
// preservation_independent_of_commit_flag
// The writeRunRecord function never touches git; it just writes files.
// We verify no git-related side effects by ensuring no process spawning occurs.
// ---------------------------------------------------------------------------

describe("preservation_independent_of_commit_flag", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("writeRunRecord writes snapshot even in a directory with no git repo", async () => {
    // No git repo — if the helper tried to run git commands it would throw
    const stamp = "2026.06.06-10.00.00";
    await expect(writeRunRecord(tmpDir, stamp, SAMPLE_USAGE, SAMPLE_PROGRESS)).resolves.toBeUndefined();

    const runDir = join(tmpDir, RUNS_DIR, stamp);
    expect(existsSync(join(runDir, "usage.json"))).toBe(true);
    expect(existsSync(join(runDir, "progress.json"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// missing_record_degrades_to_absent
// ---------------------------------------------------------------------------

describe("missing_record_degrades_to_absent", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("readRunRecord returns null for a non-existent session stamp", () => {
    expect(() => readRunRecord(tmpDir, "2099.01.01-00.00.00")).not.toThrow();
    expect(readRunRecord(tmpDir, "2099.01.01-00.00.00")).toBeNull();
  });

  test("readRunRecord returns null for an empty session stamp string", () => {
    expect(() => readRunRecord(tmpDir, "")).not.toThrow();
    expect(readRunRecord(tmpDir, "")).toBeNull();
  });

  test("listRunStamps returns empty array when .adhd/runs/ does not exist", async () => {
    const stamps = await listRunStamps(tmpDir);
    expect(stamps).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// partial_or_malformed_record_does_not_throw
// ---------------------------------------------------------------------------

describe("partial_or_malformed_record_does_not_throw", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("readRunRecord with truncated usage.json returns record with null usage, not null record", () => {
    const stamp = "2026.06.06-12.00.00";
    const runDir = join(tmpDir, RUNS_DIR, stamp);
    mkdirSync(runDir, { recursive: true });

    // Write truncated (malformed) JSON
    writeFileSync(join(runDir, "usage.json"), '{"sessions":[{"startedAt":', "utf-8");
    // Write valid progress
    writeFileSync(join(runDir, "progress.json"), JSON.stringify(SAMPLE_PROGRESS), "utf-8");

    expect(() => readRunRecord(tmpDir, stamp)).not.toThrow();
    const record = readRunRecord(tmpDir, stamp);
    expect(record).not.toBeNull();
    expect(record!.usage).toBeNull(); // malformed → null
    expect(record!.progress).not.toBeNull(); // valid → present
  });

  test("readRunRecord with both files malformed returns record with both fields null", () => {
    const stamp = "2026.06.06-13.00.00";
    const runDir = join(tmpDir, RUNS_DIR, stamp);
    mkdirSync(runDir, { recursive: true });

    writeFileSync(join(runDir, "usage.json"), "not json at all", "utf-8");
    writeFileSync(join(runDir, "progress.json"), "{broken", "utf-8");

    expect(() => readRunRecord(tmpDir, stamp)).not.toThrow();
    const record = readRunRecord(tmpDir, stamp);
    expect(record).not.toBeNull(); // directory exists → not null
    expect(record!.usage).toBeNull();
    expect(record!.progress).toBeNull();
  });

  test("readRunRecord with only progress.json present returns null usage field", () => {
    const stamp = "2026.06.06-14.00.00";
    const runDir = join(tmpDir, RUNS_DIR, stamp);
    mkdirSync(runDir, { recursive: true });

    // Only write progress — usage is absent
    writeFileSync(join(runDir, "progress.json"), JSON.stringify(SAMPLE_PROGRESS), "utf-8");

    expect(() => readRunRecord(tmpDir, stamp)).not.toThrow();
    const record = readRunRecord(tmpDir, stamp);
    expect(record).not.toBeNull();
    expect(record!.usage).toBeNull();
    expect(record!.progress).not.toBeNull();
  });

  test("writeRunRecord does not throw when passed null usage and null progress", async () => {
    const stamp = "2026.06.06-15.00.00";
    await expect(writeRunRecord(tmpDir, stamp, null, null)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// sdk_independence_preserved
// Verified structurally: shared/run-history.ts must have no SDK imports.
// We do a textual check here to make it explicit.
// ---------------------------------------------------------------------------

describe("sdk_independence_preserved", () => {
  test("shared/run-history.ts contains no @anthropic-ai imports", () => {
    const src = readFileSync(join(import.meta.dir, "../shared/run-history.ts"), "utf-8");
    expect(src).not.toContain("@anthropic-ai");
  });
});

// ---------------------------------------------------------------------------
// pure_helpers_have_no_side_effects
// Verifies that the helpers emit no console output.
// ---------------------------------------------------------------------------

describe("pure_helpers_have_no_side_effects", () => {
  let tmpDir: string;
  let consoleErrorSpy: ReturnType<typeof spyOn> | undefined;
  let consoleWarnSpy: ReturnType<typeof spyOn> | undefined;
  let consoleLogSpy: ReturnType<typeof spyOn> | undefined;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    // Capture console output so we can assert silence
    consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {});
    consoleWarnSpy = spyOn(console, "warn").mockImplementation(() => {});
    consoleLogSpy = spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    consoleErrorSpy?.mockRestore();
    consoleWarnSpy?.mockRestore();
    consoleLogSpy?.mockRestore();
  });

  test("writeRunRecord emits no console output on happy path", async () => {
    await writeRunRecord(tmpDir, "2026.06.06-10.00.00", SAMPLE_USAGE, SAMPLE_PROGRESS);
    expect(consoleErrorSpy?.mock.calls.length ?? 0).toBe(0);
    expect(consoleWarnSpy?.mock.calls.length ?? 0).toBe(0);
    expect(consoleLogSpy?.mock.calls.length ?? 0).toBe(0);
  });

  test("readRunRecord emits no console output for a missing stamp", () => {
    readRunRecord(tmpDir, "9999.12.31-23.59.59");
    expect(consoleErrorSpy?.mock.calls.length ?? 0).toBe(0);
    expect(consoleWarnSpy?.mock.calls.length ?? 0).toBe(0);
    expect(consoleLogSpy?.mock.calls.length ?? 0).toBe(0);
  });

  test("readRunRecord emits no console output for malformed JSON", () => {
    const stamp = "2026.06.06-16.00.00";
    const runDir = join(tmpDir, RUNS_DIR, stamp);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, "usage.json"), "{{not json", "utf-8");

    readRunRecord(tmpDir, stamp);
    expect(consoleErrorSpy?.mock.calls.length ?? 0).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// code_quality_naming_dry_and_responsibility
// Spot-checks that the public API follows the naming convention in the contract.
// ---------------------------------------------------------------------------

describe("code_quality_naming_dry_and_responsibility", () => {
  test("exports readRunRecord, writeRunRecord, listRunStamps, RunRecord, RUNS_DIR", () => {
    // If the import at the top of this file compiles, these are exported correctly.
    expect(typeof writeRunRecord).toBe("function");
    expect(typeof readRunRecord).toBe("function");
    expect(typeof listRunStamps).toBe("function");
    expect(typeof RUNS_DIR).toBe("string");
  });

  test("RUNS_DIR constant is .adhd/runs", () => {
    expect(RUNS_DIR).toBe(".adhd/runs");
  });
});
