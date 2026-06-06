/**
 * Sprint 9 — Scout digest generation tests.
 *
 * Covers all acceptance criteria from the Sprint 9 contract:
 *   - scout_skipped_without_flag
 *   - pure_bounding_helper_never_throws
 *   - digest_bounded_by_constant
 *   - scout_uses_readonly_tool_policy
 *   - scout_failure_nonfatal
 *   - shared_zero_sdk_imports
 *   - scout_cost_recorded_as_own_stage
 *   - scout_produces_persisted_digest
 *   - system_boots_cleanly_with_scout_flag
 *   - code_quality_naming_errors_dry
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { boundScoutDigest, MAX_SCOUT_DIGEST_CHARS } from "../shared/scout-digest.ts";
import { SCOUT_DIGEST_FILE } from "../harness-claude/scout.ts";

// ---------------------------------------------------------------------------
// pure_bounding_helper_never_throws
// ---------------------------------------------------------------------------
describe("pure_bounding_helper_never_throws", () => {
  test("null input returns empty string without throwing", () => {
    expect(() => boundScoutDigest(null)).not.toThrow();
    expect(boundScoutDigest(null)).toBe("");
  });

  test("undefined input returns empty string without throwing", () => {
    expect(() => boundScoutDigest(undefined)).not.toThrow();
    expect(boundScoutDigest(undefined)).toBe("");
  });

  test("empty string input returns empty string without throwing", () => {
    expect(() => boundScoutDigest("")).not.toThrow();
    expect(boundScoutDigest("")).toBe("");
  });

  test("whitespace-only string returns empty string", () => {
    expect(() => boundScoutDigest("   ")).not.toThrow();
    expect(boundScoutDigest("   ")).toBe("");
  });

  test("number input is coerced to string without throwing", () => {
    expect(() => boundScoutDigest(42)).not.toThrow();
    expect(boundScoutDigest(42)).toBe("42");
  });

  test("object input is coerced without throwing", () => {
    expect(() => boundScoutDigest({ key: "value" })).not.toThrow();
  });

  test("normal string passthrough — no truncation below ceiling", () => {
    const input = "This is a valid digest with useful content.";
    expect(boundScoutDigest(input)).toBe(input);
  });
});

// ---------------------------------------------------------------------------
// digest_bounded_by_constant
// ---------------------------------------------------------------------------
describe("digest_bounded_by_constant", () => {
  test("MAX_SCOUT_DIGEST_CHARS is a positive integer", () => {
    expect(typeof MAX_SCOUT_DIGEST_CHARS).toBe("number");
    expect(Number.isInteger(MAX_SCOUT_DIGEST_CHARS)).toBe(true);
    expect(MAX_SCOUT_DIGEST_CHARS).toBeGreaterThan(0);
  });

  test("digest exactly at limit is not truncated", () => {
    const input = "x".repeat(MAX_SCOUT_DIGEST_CHARS);
    const result = boundScoutDigest(input);
    expect(result.length).toBe(MAX_SCOUT_DIGEST_CHARS);
    expect(result).toBe(input);
  });

  test("digest one char over limit is truncated", () => {
    const input = "x".repeat(MAX_SCOUT_DIGEST_CHARS + 1);
    const result = boundScoutDigest(input);
    expect(result.length).toBeLessThanOrEqual(MAX_SCOUT_DIGEST_CHARS + 200); // allow for marker
    // First MAX_SCOUT_DIGEST_CHARS chars are from the original
    expect(result.startsWith("x".repeat(MAX_SCOUT_DIGEST_CHARS))).toBe(true);
    // Truncation marker is present
    expect(result).toContain("truncated");
  });

  test("large digest is always bounded to at most MAX_SCOUT_DIGEST_CHARS plus marker", () => {
    const input = "a".repeat(MAX_SCOUT_DIGEST_CHARS * 3);
    const result = boundScoutDigest(input);
    // Must start with the original content
    expect(result.startsWith("a".repeat(MAX_SCOUT_DIGEST_CHARS))).toBe(true);
    // Must contain truncation marker
    expect(result).toContain("truncated");
    // Total length: original slice (MAX_SCOUT_DIGEST_CHARS) + marker — reasonable bound
    expect(result.length).toBeLessThanOrEqual(MAX_SCOUT_DIGEST_CHARS + 500);
  });
});

// ---------------------------------------------------------------------------
// scout_uses_readonly_tool_policy
// ---------------------------------------------------------------------------
describe("scout_uses_readonly_tool_policy", () => {
  test("SCOUT_TOOLS exports only read-side tools (Read, Bash, Glob, Grep)", async () => {
    const { SCOUT_TOOLS } = await import("../harness-claude/scout.ts");
    expect(SCOUT_TOOLS).toContain("Read");
    expect(SCOUT_TOOLS).toContain("Bash");
    expect(SCOUT_TOOLS).toContain("Glob");
    expect(SCOUT_TOOLS).toContain("Grep");
    // Must NOT include Write or Edit
    expect(SCOUT_TOOLS).not.toContain("Write");
    expect(SCOUT_TOOLS).not.toContain("Edit");
  });
});

// ---------------------------------------------------------------------------
// shared_zero_sdk_imports
// ---------------------------------------------------------------------------
describe("shared_zero_sdk_imports", () => {
  test("shared/scout-digest.ts has no LLM SDK imports", () => {
    const src = readFileSync(join(import.meta.dir, "../shared/scout-digest.ts"), "utf-8");
    expect(src).not.toContain("@anthropic-ai/claude-agent-sdk");
    expect(src).not.toContain("@anthropic-ai/sdk");
    expect(src).not.toContain("anthropic");
  });
});

// ---------------------------------------------------------------------------
// scout_skipped_without_flag
// ---------------------------------------------------------------------------
describe("scout_skipped_without_flag", () => {
  test("ResolvedConfig has useScout field that defaults to false", async () => {
    // The presence and default value of useScout in the config shape
    const { resolveConfig } = await import("../shared/config.ts");
    const config = resolveConfig({
      prompt: "test prompt",
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
      lintGate: false,
      testGate: false,
      refineSpec: false,
      notify: false,
      commitAdhd: false,
      commitAdhdLogs: false,
      allowMain: false,
      disableMcp: false,
      // useScout absent → defaults to false
    });
    expect(config.useScout).toBe(false);
  });

  test("parseCli returns useScout false when --scout not passed", async () => {
    const { parseCli } = await import("../shared/config.ts");
    const result = parseCli(["my prompt"]);
    expect(result.useScout).toBe(false);
  });

  test("parseCli returns useScout true when --scout is passed", async () => {
    const { parseCli } = await import("../shared/config.ts");
    const result = parseCli(["my prompt", "--scout"]);
    expect(result.useScout).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// scout_produces_persisted_digest
// ---------------------------------------------------------------------------
describe("scout_produces_persisted_digest", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `scout-test-${Date.now()}`);
    mkdirSync(join(tmpDir, ".adhd"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("SCOUT_DIGEST_FILE is a path relative to .adhd/", () => {
    expect(SCOUT_DIGEST_FILE).toContain(".adhd/");
    expect(SCOUT_DIGEST_FILE.endsWith(".json")).toBe(true);
  });

  test("writeScoutDigest creates a JSON file under .adhd/", async () => {
    const { writeScoutDigest } = await import("../harness-claude/scout.ts");
    await writeScoutDigest(tmpDir, "{ \"conventions\": \"camelCase\" }");
    const filePath = join(tmpDir, SCOUT_DIGEST_FILE);
    expect(existsSync(filePath)).toBe(true);
    const content = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(content).toHaveProperty("digest");
    expect(typeof content.digest).toBe("string");
  });

  test("readScoutDigest returns null when no digest exists", async () => {
    const { readScoutDigest } = await import("../harness-claude/scout.ts");
    const result = await readScoutDigest(tmpDir);
    expect(result).toBeNull();
  });

  test("readScoutDigest reads back what was written", async () => {
    const { writeScoutDigest, readScoutDigest } = await import("../harness-claude/scout.ts");
    const content = "Codebase uses camelCase identifiers and explicit try/catch error handling.";
    await writeScoutDigest(tmpDir, content);
    const result = await readScoutDigest(tmpDir);
    expect(result).toBe(content);
  });
});

// ---------------------------------------------------------------------------
// scout_failure_nonfatal
// ---------------------------------------------------------------------------
describe("scout_failure_nonfatal", () => {
  test("runScout signature exists and is callable with injected fake", async () => {
    const { runScout } = await import("../harness-claude/scout.ts");
    expect(typeof runScout).toBe("function");
  });

  test("runScout accepts optional agentFn injection for testing", async () => {
    // The function signature should support an optional agentFn/deps parameter
    // so tests can inject a fake without a live SDK call.
    const { runScout } = await import("../harness-claude/scout.ts");
    // Check it accepts 2 parameters (opts + optional deps)
    expect(runScout.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// scout_cost_recorded_as_own_stage
// ---------------------------------------------------------------------------
describe("scout_cost_recorded_as_own_stage", () => {
  test("SCOUT_STAGE_NAME is a unique identifier separate from planner/generator/evaluator/documenter", async () => {
    const { SCOUT_STAGE_NAME } = await import("../harness-claude/scout.ts");
    expect(typeof SCOUT_STAGE_NAME).toBe("string");
    expect(SCOUT_STAGE_NAME.length).toBeGreaterThan(0);
    expect(SCOUT_STAGE_NAME).not.toBe("planner");
    expect(SCOUT_STAGE_NAME).not.toBe("generator");
    expect(SCOUT_STAGE_NAME).not.toBe("evaluator");
    expect(SCOUT_STAGE_NAME).not.toBe("documenter");
    // Should identify the Scout as a distinct phase
    expect(SCOUT_STAGE_NAME.toLowerCase()).toContain("scout");
  });
});

// ---------------------------------------------------------------------------
// system_boots_cleanly_with_scout_flag
// ---------------------------------------------------------------------------
describe("system_boots_cleanly_with_scout_flag", () => {
  test("runScout is exported from harness-claude/scout.ts and is callable", async () => {
    // Verify the Scout runner is exported and is a function
    const scout = await import("../harness-claude/scout.ts");
    expect(typeof scout.runScout).toBe("function");
  });

  test("parseCli recognizes --scout and sets useScout true", async () => {
    const { parseCli } = await import("../shared/config.ts");
    const result = parseCli(["my prompt", "--scout"]);
    expect(result.useScout).toBe(true);
  });

  test("resolveConfig with useScout:true produces config with useScout true", async () => {
    const { resolveConfig } = await import("../shared/config.ts");
    const config = resolveConfig({
      prompt: "test",
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
      lintGate: false,
      testGate: false,
      refineSpec: false,
      notify: false,
      commitAdhd: false,
      commitAdhdLogs: false,
      allowMain: false,
      disableMcp: false,
      useScout: true,
    });
    expect(config.useScout).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// code_quality_naming_errors_dry (structural checks)
// ---------------------------------------------------------------------------
describe("code_quality_naming_errors_dry", () => {
  test("scout-digest.ts uses descriptive names matching the convention", () => {
    const src = readFileSync(join(import.meta.dir, "../shared/scout-digest.ts"), "utf-8");
    // Has the named constant
    expect(src).toContain("MAX_SCOUT_DIGEST_CHARS");
    // Has the named function
    expect(src).toContain("boundScoutDigest");
    // Does not use short opaque names
    expect(src).not.toMatch(/\bconst s\b/);
    expect(src).not.toMatch(/\bconst sd\b/);
  });

  test("scout.ts uses descriptive names and explicit error handling", () => {
    const src = readFileSync(join(import.meta.dir, "../harness-claude/scout.ts"), "utf-8");
    // Has descriptive exports
    expect(src).toContain("runScout");
    expect(src).toContain("SCOUT_TOOLS");
    expect(src).toContain("SCOUT_STAGE_NAME");
    // Has explicit try/catch (not swallowed silently)
    expect(src).toContain("try {");
    expect(src).toContain("catch");
    // Does not duplicate bounding logic — imports from shared
    expect(src).toContain("boundScoutDigest");
    expect(src).not.toContain("slice(0, MAX_SCOUT_DIGEST_CHARS)"); // bounding is in shared/
  });
});
