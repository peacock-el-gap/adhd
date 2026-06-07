/**
 * Tests for F2 — Empty-spec refinement must not leave a blank spec on disk.
 *
 * These tests are written BEFORE the fix. The empty-spec test (and the
 * "all exit paths agree" test for the empty path) should fail against the
 * current code, then pass once the disk-write is added to the empty path.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { performSpecRefinement } from "../shared/orchestration/spec-refinement.ts";
import { noopSpan } from "../shared/tracing.ts";
import type { UsageTracker } from "../shared/usage.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** No-op usage tracker for test isolation. */
const mockUsage: UsageTracker = {
  recordStage: () => {},
  printSummary: () => {},
  save: async () => {},
  getStages: () => [],
};

/**
 * Minimal ResolvedConfig subset. We cast to `any` because ResolvedConfig is
 * large and the fields below are the only ones performSpecRefinement reads.
 * If the function starts reading new fields, the tests will throw with a clear
 * property-access error — that's intentional.
 */
function makeConfig(workDir: string) {
  return {
    workDir,
    resolvedModelPlanner: "test-model",
    isGreenfield: false,
    // non-interactive so we skip the promptGate entirely
    interactive: false,
    gateTimeout: undefined,
    logLevel: "quiet",
  } as Parameters<typeof performSpecRefinement>[0];
}

/** Read the spec from disk (the file performSpecRefinement reads/writes). */
function readSpecFromDisk(workDir: string): string {
  return readFileSync(join(workDir, ".adhd", "spec.md"), "utf-8");
}

/** Write a file to disk (used to simulate the planner writing an empty spec). */
function writeSpecToDisk(workDir: string, content: string): void {
  writeFileSync(join(workDir, ".adhd", "spec.md"), content, "utf-8");
}

// ---------------------------------------------------------------------------
// Test setup / teardown
// ---------------------------------------------------------------------------

const TEST_DIR_PREFIX = join(import.meta.dir, "__spec_refinement_disk_tmp");
let tmpDir: string;
let tmpIdx = 0;

beforeEach(() => {
  tmpDir = `${TEST_DIR_PREFIX}_${tmpIdx++}`;
  mkdirSync(join(tmpDir, ".adhd"), { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// A simple multi-sprint spec for use across tests.
// Must use ## Sprint N headings — that is the pattern spliceRefinementSections
// and extractCompletedSprintSections recognise.
// ---------------------------------------------------------------------------

const ORIGINAL_SPEC = "## Sprint 1\n\nDo thing A.\n\n## Sprint 2\n\nDo thing B.\n";

// ---------------------------------------------------------------------------
// F2: empty-spec path — BUG: disk currently stays blank after this path
// ---------------------------------------------------------------------------

describe("performSpecRefinement — empty spec from planner", () => {
  test("leaves the original spec on disk (not blank)", async () => {
    // Write the original spec to disk (as it would be before refinement runs)
    writeSpecToDisk(tmpDir, ORIGINAL_SPEC);

    /**
     * Simulate what the real planner does: it writes spec.md (via Write tool)
     * and then returns its content. A malfunctioning planner writes nothing
     * useful and the harness reads an empty string from disk.
     * We model this by having the mock plannerFn write "" to disk and return "".
     */
    const mockPlanner = async () => {
      writeSpecToDisk(tmpDir, ""); // planner writes empty spec
      return { spec: "" };
    };

    const result = await performSpecRefinement(
      makeConfig(tmpDir),
      ORIGINAL_SPEC,
      1, // completedSprint
      2, // currentTotalSprints
      noopSpan,
      mockUsage,
      mockPlanner,
    );

    // In-memory return value must be the original
    expect(result.spec).toBe(ORIGINAL_SPEC);
    expect(result.specChanged).toBe(false);

    // Disk must also be the original — this is the key assertion for the bug
    const onDisk = readSpecFromDisk(tmpDir);
    expect(onDisk).toBe(ORIGINAL_SPEC);
    expect(onDisk).not.toBe(""); // confirm the disk was actually restored
  });

  test("returned spec and disk spec are identical", async () => {
    writeSpecToDisk(tmpDir, ORIGINAL_SPEC);

    const mockPlanner = async () => {
      writeSpecToDisk(tmpDir, "");
      return { spec: "" };
    };

    const result = await performSpecRefinement(
      makeConfig(tmpDir),
      ORIGINAL_SPEC,
      1,
      2,
      noopSpan,
      mockUsage,
      mockPlanner,
    );

    const onDisk = readSpecFromDisk(tmpDir);
    expect(onDisk).toBe(result.spec);
  });
});

// ---------------------------------------------------------------------------
// F2: other exit paths — these should already agree (regression guard)
// ---------------------------------------------------------------------------

describe("performSpecRefinement — catch/failed path (disk restore)", () => {
  test("leaves the original spec on disk when planner throws", async () => {
    writeSpecToDisk(tmpDir, ORIGINAL_SPEC);

    const mockPlanner = async () => {
      // Simulate planner corrupting disk before throwing
      writeSpecToDisk(tmpDir, "CORRUPTED");
      throw new Error("planner network error");
    };

    const result = await performSpecRefinement(
      makeConfig(tmpDir),
      ORIGINAL_SPEC,
      1,
      2,
      noopSpan,
      mockUsage,
      mockPlanner,
    );

    expect(result.spec).toBe(ORIGINAL_SPEC);
    expect(result.specChanged).toBe(false);
    const onDisk = readSpecFromDisk(tmpDir);
    expect(onDisk).toBe(ORIGINAL_SPEC);
  });

  test("returned spec and disk spec are identical on throw path", async () => {
    writeSpecToDisk(tmpDir, ORIGINAL_SPEC);

    const mockPlanner = async () => {
      throw new Error("simulated failure");
    };

    const result = await performSpecRefinement(
      makeConfig(tmpDir),
      ORIGINAL_SPEC,
      1,
      2,
      noopSpan,
      mockUsage,
      mockPlanner,
    );

    const onDisk = readSpecFromDisk(tmpDir);
    expect(onDisk).toBe(result.spec);
  });
});

describe("performSpecRefinement — no-diff path (no changes)", () => {
  test("leaves the original spec on disk when planner produces no parseable diff", async () => {
    writeSpecToDisk(tmpDir, ORIGINAL_SPEC);

    // Return content with no valid "## Sprint N" heading so spliceRefinementSections
    // falls back to originalSpec. computeSpecDiff(originalSpec, originalSpec) → null
    // → the "no changes" path is taken.
    const mockPlanner = async () => {
      writeSpecToDisk(tmpDir, "No parseable sprint headings here.");
      return { spec: "No parseable sprint headings here." };
    };

    const result = await performSpecRefinement(
      makeConfig(tmpDir),
      ORIGINAL_SPEC,
      1,
      2,
      noopSpan,
      mockUsage,
      mockPlanner,
    );

    expect(result.specChanged).toBe(false);
    expect(result.spec).toBe(ORIGINAL_SPEC);
    const onDisk = readSpecFromDisk(tmpDir);
    expect(onDisk).toBe(ORIGINAL_SPEC);
  });
});

describe("performSpecRefinement — accepted path (non-interactive auto-accept)", () => {
  test("writes the proposed spec to disk and returns it", async () => {
    writeSpecToDisk(tmpDir, ORIGINAL_SPEC);

    // The planner returns only the remaining-sprint sections in the refinement
    // flow. Sprint 2 is the remaining sprint (completedSprint = 1).
    const PROPOSED_SPEC = "## Sprint 2\n\nDo thing B REVISED.\n";

    const mockPlanner = async () => {
      writeSpecToDisk(tmpDir, PROPOSED_SPEC);
      return { spec: PROPOSED_SPEC };
    };

    const result = await performSpecRefinement(
      makeConfig(tmpDir),
      ORIGINAL_SPEC,
      1,
      2,
      noopSpan,
      mockUsage,
      mockPlanner,
    );

    // In non-interactive mode, a non-empty diff is auto-accepted.
    // After splicing: completed Sprint 1 + revised Sprint 2 → differs from original.
    expect(result.specChanged).toBe(true);
    // Disk and memory must agree
    const onDisk = readSpecFromDisk(tmpDir);
    expect(onDisk).toBe(result.spec);
    // The accepted spec contains the revised Sprint 2 content
    expect(result.spec).toContain("REVISED");
  });
});
