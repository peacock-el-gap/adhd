import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseCli, resolveConfig } from "../shared/config.ts";
import type { HarnessConfig, HarnessProgress, SprintContract } from "../shared/types.ts";

// ── Helpers ─────────────────────────────────────────────────────────

let tmpBase: string;

function makeTmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "adhd-sprint-sel-"));
  mkdirSync(dir, { recursive: true });
  return dir;
}

beforeEach(() => {
  tmpBase = makeTmp();
});

afterEach(() => {
  rmSync(tmpBase, { recursive: true, force: true });
});

const baseCli = {
  greenfield: false,
  resume: false,
  verbose: false,
  quiet: false,
  noInteractive: false,
  debug: false,
  dryRun: false,
  noBdd: false,
  noTdd: false,
  noDocs: false,
};

// =====================================================
// CLI Parsing: --sprint flag
// =====================================================

describe("parseCli --sprint flag", () => {
  test("parses --sprint 3 correctly", () => {
    const cli = parseCli(["--sprint", "3"]);
    expect(cli.sprint).toBe(3);
  });

  test("--sprint defaults to undefined when omitted", () => {
    const cli = parseCli(["test prompt"]);
    expect(cli.sprint).toBeUndefined();
  });

  test("parses --sprint 1 correctly", () => {
    const cli = parseCli(["--sprint", "1"]);
    expect(cli.sprint).toBe(1);
  });

  test("parses --sprint with large value", () => {
    const cli = parseCli(["--sprint", "99"]);
    expect(cli.sprint).toBe(99);
  });
});

// =====================================================
// Config: sprint field on HarnessConfig
// =====================================================

describe("resolveConfig sprint field", () => {
  test("maps parsed CLI sprint to config.sprint", () => {
    const config = resolveConfig({ ...baseCli, sprint: 3 });
    expect(config.sprint).toBe(3);
  });

  test("sprint is undefined when not provided", () => {
    const config = resolveConfig({ ...baseCli, prompt: "test" });
    expect(config.sprint).toBeUndefined();
  });
});

// =====================================================
// Mutual Exclusion: --sprint and --resume
// =====================================================

describe("sprint and resume mutual exclusion", () => {
  test("throws when both --sprint and --resume are set", () => {
    expect(() =>
      resolveConfig({ ...baseCli, sprint: 3, resume: true })
    ).toThrow("Cannot use --sprint and --resume together");
  });

  test("--sprint alone works without error", () => {
    const config = resolveConfig({ ...baseCli, sprint: 3 });
    expect(config.sprint).toBe(3);
  });

  test("--resume alone works without error", () => {
    const config = resolveConfig({ ...baseCli, resume: true });
    expect(config.isResume).toBe(true);
  });
});

// =====================================================
// Sprint flag validation
// =====================================================

describe("sprint flag validation", () => {
  test("rejects --sprint 0", () => {
    expect(() =>
      resolveConfig({ ...baseCli, sprint: 0 })
    ).toThrow("Invalid --sprint value");
  });

  test("rejects --sprint -1", () => {
    expect(() =>
      resolveConfig({ ...baseCli, sprint: -1 })
    ).toThrow("Invalid --sprint value");
  });

  test("rejects non-integer sprint (NaN from non-numeric)", () => {
    // parseCli would produce NaN for non-numeric
    expect(() =>
      resolveConfig({ ...baseCli, sprint: NaN })
    ).toThrow("Invalid --sprint value");
  });

  test("accepts --sprint 1 (minimum valid)", () => {
    const config = resolveConfig({ ...baseCli, sprint: 1 });
    expect(config.sprint).toBe(1);
  });
});

// =====================================================
// No prompt required in sprint mode
// =====================================================

describe("no prompt required for sprint mode", () => {
  test("--sprint N without a prompt does not throw", () => {
    const config = resolveConfig({ ...baseCli, sprint: 3 });
    expect(config.sprint).toBe(3);
    expect(config.userPrompt).toBe("");
  });

  test("without --sprint or --resume, missing prompt throws", () => {
    expect(() =>
      resolveConfig({ ...baseCli })
    ).toThrow("A prompt is required");
  });
});

// =====================================================
// Sprint selection: spec requirement
// =====================================================

describe("sprint selection requires existing spec", () => {
  test("harness.ts checks for spec.md existence in sprint mode", () => {
    const content = readFileSync("claude-harness/harness.ts", "utf-8");
    expect(content).toContain("No spec found. Run the planner first or provide a spec.");
  });
});

// =====================================================
// Sprint selection: skips planning
// =====================================================

describe("sprint selection skips planning phase", () => {
  test("sprintSelectionHarness does NOT call runPlanner", () => {
    const content = readFileSync("claude-harness/harness.ts", "utf-8");
    // Find the sprintSelectionHarness function and verify it doesn't call runPlanner
    const fnStart = content.indexOf("async function sprintSelectionHarness(");
    const fnEnd = content.indexOf("\nasync function revertToCheckpoint(");
    expect(fnStart).toBeGreaterThan(-1);
    expect(fnEnd).toBeGreaterThan(fnStart);
    const fnBody = content.slice(fnStart, fnEnd);
    expect(fnBody).not.toContain("runPlanner(");
    // But it does load spec from disk
    expect(fnBody).toContain("readSpec(");
  });
});

// =====================================================
// Sprint selection: sprint range enforcement
// =====================================================

describe("sprint selection runs only target sprint", () => {
  test("runSprintLoop called with startSprint=N, endSprint=N", () => {
    const content = readFileSync("claude-harness/harness.ts", "utf-8");
    const fnStart = content.indexOf("async function sprintSelectionHarness(");
    const fnEnd = content.indexOf("\nasync function revertToCheckpoint(");
    const fnBody = content.slice(fnStart, fnEnd);
    // The sprint loop is called with sprintN as both start and end
    expect(fnBody).toContain("sprintN,\n      sprintN,");
  });
});

// =====================================================
// Contract reuse vs negotiation
// =====================================================

describe("contract reuse vs fresh negotiation", () => {
  test("sprint loop checks for existing contract when config.sprint is set", () => {
    const content = readFileSync("claude-harness/harness.ts", "utf-8");
    expect(content).toContain("readContract(config.workDir, sprint)");
    expect(content).toContain("Loaded existing contract for sprint");
  });

  test("falls back to negotiation when no contract exists", () => {
    const content = readFileSync("claude-harness/harness.ts", "utf-8");
    expect(content).toContain("if (!contract)");
    expect(content).toContain("Negotiating sprint contract...");
  });
});

// =====================================================
// Missing checkpoint warning
// =====================================================

describe("missing checkpoint warning", () => {
  test("sprintSelectionHarness warns about missing prior checkpoint", () => {
    const content = readFileSync("claude-harness/harness.ts", "utf-8");
    expect(content).toContain("No checkpoint for sprint");
    expect(content).toContain("Ensure the codebase is in the expected state");
  });
});

// =====================================================
// Workspace not cleaned in sprint mode
// =====================================================

describe("workspace not cleaned in sprint mode", () => {
  test("sprintSelectionHarness calls initWorkspace with resume: true", () => {
    const content = readFileSync("claude-harness/harness.ts", "utf-8");
    const fnStart = content.indexOf("async function sprintSelectionHarness(");
    const fnEnd = content.indexOf("\nasync function revertToCheckpoint(");
    const fnBody = content.slice(fnStart, fnEnd);
    expect(fnBody).toContain("resume: true");
  });
});

// =====================================================
// Regression criteria loaded in sprint mode
// =====================================================

describe("regression criteria loaded in sprint mode", () => {
  test("sprint loop injects regression criteria for sprint > 1", () => {
    const content = readFileSync("claude-harness/harness.ts", "utf-8");
    // The existing evaluator block injects regression criteria for sprint > 1
    expect(content).toContain("readRegressionCriteria(config.workDir)");
    expect(content).toContain("buildRegressionSection(regressionCriteria)");
  });
});

// =====================================================
// Type safety: HarnessConfig.sprint
// =====================================================

describe("clean type safety", () => {
  test("sprint field is optional on HarnessConfig", () => {
    const config: HarnessConfig = {
      userPrompt: "test",
      workDir: "/tmp",
      maxSprints: 5,
      maxRetriesPerSprint: 3,
      passThreshold: 7,
    };
    expect(config.sprint).toBeUndefined();
  });

  test("sprint field can be set on HarnessConfig", () => {
    const config: HarnessConfig = {
      userPrompt: "test",
      workDir: "/tmp",
      maxSprints: 5,
      maxRetriesPerSprint: 3,
      passThreshold: 7,
      sprint: 3,
    };
    expect(config.sprint).toBe(3);
  });
});

// =====================================================
// Sprint exceeds total warning
// =====================================================

describe("sprint exceeds total sprints warning", () => {
  test("sprintSelectionHarness warns when sprint exceeds detected count", () => {
    const content = readFileSync("claude-harness/harness.ts", "utf-8");
    expect(content).toContain("exceeds detected sprint count");
  });
});

// =====================================================
// Integration: sprint selection dispatching
// =====================================================

describe("sprint selection dispatch in runHarness", () => {
  test("runHarness checks config.sprint and dispatches to sprintSelectionHarness", () => {
    const content = readFileSync("claude-harness/harness.ts", "utf-8");
    expect(content).toContain("if (config.sprint !== undefined)");
    expect(content).toContain("sprintSelectionHarness(config, model, isGreenfield, startTime, tracer, usage)");
  });

  test("sprint selection path is before fresh run path", () => {
    const content = readFileSync("claude-harness/harness.ts", "utf-8");
    const sprintIdx = content.indexOf("Sprint selection path");
    const freshIdx = content.indexOf("Fresh run path");
    expect(sprintIdx).toBeGreaterThan(-1);
    expect(freshIdx).toBeGreaterThan(sprintIdx);
  });
});
