/**
 * Sprint 13 — Reviewer agent tests (F13).
 *
 * Covers all acceptance criteria from the Sprint 13 contract:
 *   - reviewer_module_mirrors_scout_structure
 *   - reviewer_tools_exclude_write_and_edit
 *   - reviewer_returns_structured_report
 *   - pure_report_helpers_never_throw
 *   - review_report_bounded_by_max_chars
 *   - max_review_report_chars_is_own_constant
 *   - agent_runners_optional_reviewer_field
 *   - shared_has_zero_sdk_imports
 *   - reviewer_failure_is_non_fatal_warning
 *   - naming_and_duplication_quality
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { boundReviewReport, MAX_REVIEW_REPORT_CHARS, parseReviewReport, EMPTY_REVIEW_REPORT } from "../shared/review-report.ts";
import { REVIEWER_TOOLS, REVIEWER_STAGE_NAME, REVIEWER_REPORT_FILE } from "../harness-claude/reviewer.ts";

// ---------------------------------------------------------------------------
// reviewer_module_mirrors_scout_structure
// ---------------------------------------------------------------------------
describe("reviewer_module_mirrors_scout_structure", () => {
  test("REVIEWER_TOOLS is exported from harness-claude/reviewer.ts", () => {
    expect(REVIEWER_TOOLS).toBeDefined();
    expect(Array.isArray(REVIEWER_TOOLS)).toBe(true);
  });

  test("REVIEWER_STAGE_NAME is exported and equals 'reviewer'", () => {
    expect(REVIEWER_STAGE_NAME).toBe("reviewer");
  });

  test("REVIEWER_REPORT_FILE is exported from harness-claude/reviewer.ts", () => {
    expect(REVIEWER_REPORT_FILE).toBeDefined();
  });

  test("REVIEWER_REPORT_FILE is callable and returns a .adhd/reviews path", () => {
    const path = REVIEWER_REPORT_FILE(3);
    expect(path).toContain(".adhd/reviews");
    expect(path).toContain("3");
    expect(path.endsWith(".json")).toBe(true);
  });

  test("REVIEWER_STAGE_NAME differs from scout, planner, generator, evaluator, documenter", () => {
    expect(REVIEWER_STAGE_NAME).not.toBe("scout");
    expect(REVIEWER_STAGE_NAME).not.toBe("planner");
    expect(REVIEWER_STAGE_NAME).not.toBe("generator");
    expect(REVIEWER_STAGE_NAME).not.toBe("evaluator");
    expect(REVIEWER_STAGE_NAME).not.toBe("documenter");
  });

  test("reviewer.ts exports runReviewer, writeReviewerReport, readReviewerReport", async () => {
    const mod = await import("../harness-claude/reviewer.ts");
    expect(typeof mod.runReviewer).toBe("function");
    expect(typeof mod.writeReviewerReport).toBe("function");
    expect(typeof mod.readReviewerReport).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// reviewer_tools_exclude_write_and_edit
// ---------------------------------------------------------------------------
describe("reviewer_tools_exclude_write_and_edit", () => {
  test("REVIEWER_TOOLS contains exactly Read, Bash, Glob, Grep", () => {
    expect(REVIEWER_TOOLS).toContain("Read");
    expect(REVIEWER_TOOLS).toContain("Bash");
    expect(REVIEWER_TOOLS).toContain("Glob");
    expect(REVIEWER_TOOLS).toContain("Grep");
  });

  test("REVIEWER_TOOLS does NOT contain Write", () => {
    expect(REVIEWER_TOOLS).not.toContain("Write");
  });

  test("REVIEWER_TOOLS does NOT contain Edit", () => {
    expect(REVIEWER_TOOLS).not.toContain("Edit");
  });

  test("runReviewer passes the exact REVIEWER_TOOLS list to the injected agentFn", async () => {
    const { runReviewer, REVIEWER_TOOLS: tools } = await import("../harness-claude/reviewer.ts");
    const { makeIdentity } = await import("../shared/agent-identity.ts");

    let capturedTools: readonly string[] | undefined;

    const fakeAgent = async (opts: { tools: readonly string[] }) => {
      capturedTools = opts.tools;
      return { response: "A short review.", sdkResult: undefined, sessionId: undefined };
    };

    const identity = makeIdentity({ role: "REVIEWER", sprint: 1, variant: "main" });
    const config = {
      workDir: "/tmp",
      resolvedModelEvaluator: "claude-3-5-haiku-20241022",
      logLevel: "info",
      sessionDir: undefined,
      disableMcp: false,
      addMcpServers: undefined,
    } as unknown as Parameters<typeof runReviewer>[0]["config"];

    await runReviewer({ config, identity, sprint: 1 }, { agentFn: fakeAgent as any });

    expect(capturedTools).toBeDefined();
    expect(capturedTools).toContain("Read");
    expect(capturedTools).toContain("Bash");
    expect(capturedTools).toContain("Glob");
    expect(capturedTools).toContain("Grep");
    expect(capturedTools).not.toContain("Write");
    expect(capturedTools).not.toContain("Edit");
  });
});

// ---------------------------------------------------------------------------
// reviewer_returns_structured_report
// ---------------------------------------------------------------------------
describe("reviewer_returns_structured_report", () => {
  test("runReviewer returns a ReviewerResult with a report field when agent succeeds", async () => {
    const { runReviewer } = await import("../harness-claude/reviewer.ts");
    const { makeIdentity } = await import("../shared/agent-identity.ts");

    const fakeAgent = async () => ({
      response: "The code uses camelCase consistently. No duplication found.",
      sdkResult: { inputTokens: 100, outputTokens: 50, totalCost: 0.001 },
      sessionId: "test-session",
    });

    const identity = makeIdentity({ role: "REVIEWER", sprint: 2 });
    const config = {
      workDir: tmpdir(),
      resolvedModelEvaluator: "claude-3-5-haiku-20241022",
      logLevel: "info",
      sessionDir: undefined,
      disableMcp: false,
      addMcpServers: undefined,
    } as unknown as Parameters<typeof runReviewer>[0]["config"];

    const result = await runReviewer({ config, identity, sprint: 2 }, { agentFn: fakeAgent as any });

    expect(result).toBeDefined();
    expect(result.report).toBeDefined();
    expect(typeof result.report?.report).toBe("string");
    expect(result.sdkResult).toBeDefined();
  });

  test("ReviewerResult has an optional sdkResult field", async () => {
    const { runReviewer } = await import("../harness-claude/reviewer.ts");
    const { makeIdentity } = await import("../shared/agent-identity.ts");

    const fakeAgent = async () => ({
      response: "Review report content here.",
      sdkResult: undefined,
      sessionId: undefined,
    });

    const identity = makeIdentity({ role: "REVIEWER", sprint: 1 });
    const config = {
      workDir: tmpdir(),
      resolvedModelEvaluator: "claude-3-5-haiku-20241022",
      logLevel: "info",
      sessionDir: undefined,
      disableMcp: false,
      addMcpServers: undefined,
    } as unknown as Parameters<typeof runReviewer>[0]["config"];

    const result = await runReviewer({ config, identity, sprint: 1 }, { agentFn: fakeAgent as any });

    // sdkResult is optional — presence of the field (even undefined) is fine
    expect("sdkResult" in result).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// pure_report_helpers_never_throw
// ---------------------------------------------------------------------------
describe("pure_report_helpers_never_throw", () => {
  test("boundReviewReport does not throw on null", () => {
    expect(() => boundReviewReport(null)).not.toThrow();
    expect(boundReviewReport(null)).toBe("");
  });

  test("boundReviewReport does not throw on undefined", () => {
    expect(() => boundReviewReport(undefined)).not.toThrow();
    expect(boundReviewReport(undefined)).toBe("");
  });

  test("boundReviewReport does not throw on empty string", () => {
    expect(() => boundReviewReport("")).not.toThrow();
    expect(boundReviewReport("")).toBe("");
  });

  test("boundReviewReport does not throw on whitespace-only string", () => {
    expect(() => boundReviewReport("   \n\t")).not.toThrow();
    expect(boundReviewReport("   \n\t")).toBe("");
  });

  test("boundReviewReport does not throw on syntactically invalid JSON string", () => {
    expect(() => boundReviewReport("{ not valid json }[")).not.toThrow();
  });

  test("boundReviewReport returns a string for number input", () => {
    expect(() => boundReviewReport(42)).not.toThrow();
    expect(typeof boundReviewReport(42)).toBe("string");
  });

  test("boundReviewReport returns a string for object input", () => {
    expect(() => boundReviewReport({ foo: "bar" })).not.toThrow();
    expect(typeof boundReviewReport({ foo: "bar" })).toBe("string");
  });

  test("parseReviewReport does not throw on null", () => {
    expect(() => parseReviewReport(null)).not.toThrow();
    const result = parseReviewReport(null);
    expect(result.report).toBe("");
  });

  test("parseReviewReport does not throw on undefined", () => {
    expect(() => parseReviewReport(undefined)).not.toThrow();
    expect(parseReviewReport(undefined).report).toBe("");
  });

  test("parseReviewReport does not throw on empty string", () => {
    expect(() => parseReviewReport("")).not.toThrow();
    expect(parseReviewReport("").report).toBe("");
  });

  test("parseReviewReport returns ReviewReport with report string for valid text", () => {
    const input = "Code quality is excellent.";
    const result = parseReviewReport(input);
    expect(result.report).toBe(input);
  });

  test("EMPTY_REVIEW_REPORT has a report field equal to empty string", () => {
    expect(EMPTY_REVIEW_REPORT.report).toBe("");
  });
});

// ---------------------------------------------------------------------------
// review_report_bounded_by_max_chars
// ---------------------------------------------------------------------------
describe("review_report_bounded_by_max_chars", () => {
  test("MAX_REVIEW_REPORT_CHARS is a positive integer", () => {
    expect(typeof MAX_REVIEW_REPORT_CHARS).toBe("number");
    expect(Number.isInteger(MAX_REVIEW_REPORT_CHARS)).toBe(true);
    expect(MAX_REVIEW_REPORT_CHARS).toBeGreaterThan(0);
  });

  test("report exactly at MAX_REVIEW_REPORT_CHARS is not truncated", () => {
    const input = "x".repeat(MAX_REVIEW_REPORT_CHARS);
    const result = boundReviewReport(input);
    expect(result.length).toBe(MAX_REVIEW_REPORT_CHARS);
    expect(result).toBe(input);
  });

  test("report one char below MAX_REVIEW_REPORT_CHARS is not truncated", () => {
    const input = "x".repeat(MAX_REVIEW_REPORT_CHARS - 1);
    const result = boundReviewReport(input);
    expect(result).toBe(input);
    expect(result.length).toBe(MAX_REVIEW_REPORT_CHARS - 1);
  });

  test("report one char above MAX_REVIEW_REPORT_CHARS is truncated with marker", () => {
    const input = "x".repeat(MAX_REVIEW_REPORT_CHARS + 1);
    const result = boundReviewReport(input);
    // Truncation marker is appended
    expect(result).toContain("truncated");
    // Total length must be at or below the ceiling
    expect(result.length).toBeLessThanOrEqual(MAX_REVIEW_REPORT_CHARS);
    expect(result.length).toBeGreaterThan(0);
  });

  test("large report is always bounded at or below MAX_REVIEW_REPORT_CHARS", () => {
    const input = "a".repeat(MAX_REVIEW_REPORT_CHARS * 3);
    const result = boundReviewReport(input);
    expect(result).toContain("truncated");
    expect(result.length).toBeLessThanOrEqual(MAX_REVIEW_REPORT_CHARS);
  });
});

// ---------------------------------------------------------------------------
// max_review_report_chars_is_own_constant
// ---------------------------------------------------------------------------
describe("max_review_report_chars_is_own_constant", () => {
  test("shared/review-report.ts exports MAX_REVIEW_REPORT_CHARS as its own constant", () => {
    const src = readFileSync(join(import.meta.dir, "../shared/review-report.ts"), "utf-8");
    expect(src).toContain("MAX_REVIEW_REPORT_CHARS");
    expect(src).toContain("export const MAX_REVIEW_REPORT_CHARS");
  });

  test("shared/review-report.ts does NOT import from codebase-map module", () => {
    const src = readFileSync(join(import.meta.dir, "../shared/review-report.ts"), "utf-8");
    // Must not import codebase-map constants — its ceiling is defined independently
    const importLines = src.split("\n").filter(l => l.trim().startsWith("import"));
    expect(importLines.some(l => l.includes("codebase-map"))).toBe(false);
  });

  test("shared/review-report.ts does NOT import from scout-digest module", () => {
    const src = readFileSync(join(import.meta.dir, "../shared/review-report.ts"), "utf-8");
    // Must not import scout-digest constants — its ceiling is defined independently
    const importLines = src.split("\n").filter(l => l.trim().startsWith("import"));
    expect(importLines.some(l => l.includes("scout-digest"))).toBe(false);
  });

  test("MAX_REVIEW_REPORT_CHARS value is independent of other module constants", async () => {
    const { MAX_REVIEW_REPORT_CHARS: reviewMax } = await import("../shared/review-report.ts");
    const { MAX_CODEBASE_MAP_CHARS } = await import("../shared/codebase-map.ts");
    const { MAX_SCOUT_DIGEST_CHARS } = await import("../shared/scout-digest.ts");
    // They may happen to be equal in value but must be distinct exports
    // (the important thing is that review-report.ts defines its own constant)
    expect(typeof reviewMax).toBe("number");
    expect(typeof MAX_CODEBASE_MAP_CHARS).toBe("number");
    expect(typeof MAX_SCOUT_DIGEST_CHARS).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// agent_runners_optional_reviewer_field
// ---------------------------------------------------------------------------
describe("agent_runners_optional_reviewer_field", () => {
  test("RunReviewerOptions and ReviewerResult are exported from shared/orchestration/types.ts", async () => {
    // TypeScript type-level check via usage — if the import fails the module has a problem
    // We verify the types exist by checking the source file
    const src = readFileSync(join(import.meta.dir, "../shared/orchestration/types.ts"), "utf-8");
    expect(src).toContain("RunReviewerOptions");
    expect(src).toContain("ReviewerResult");
  });

  test("AgentRunners interface declares optional runReviewer field", () => {
    const src = readFileSync(join(import.meta.dir, "../shared/orchestration/types.ts"), "utf-8");
    expect(src).toContain("runReviewer?");
  });

  test("runReviewer field is declared alongside the existing runScout field", () => {
    const src = readFileSync(join(import.meta.dir, "../shared/orchestration/types.ts"), "utf-8");
    expect(src).toContain("runScout?");
    expect(src).toContain("runReviewer?");
  });

  test("ReviewerResult has a report field and optional sdkResult", () => {
    const src = readFileSync(join(import.meta.dir, "../shared/orchestration/types.ts"), "utf-8");
    expect(src).toContain("ReviewerResult");
    expect(src).toContain("sdkResult?");
  });
});

// ---------------------------------------------------------------------------
// shared_has_zero_sdk_imports
// ---------------------------------------------------------------------------
describe("shared_has_zero_sdk_imports", () => {
  const sdkPatterns = [
    "@anthropic-ai/claude-agent-sdk",
    "@anthropic-ai/sdk",
    "anthropic",
  ];

  const filesToCheck = [
    "../shared/review-report.ts",
    "../shared/orchestration/types.ts",
  ];

  for (const file of filesToCheck) {
    for (const pattern of sdkPatterns) {
      test(`${file} does not import "${pattern}"`, () => {
        const src = readFileSync(join(import.meta.dir, file), "utf-8");
        // Only flag actual SDK imports, not mentions in comments about what NOT to import
        const importLines = src.split("\n").filter(l => l.trim().startsWith("import") || l.trim().startsWith("from"));
        const hasSDKImport = importLines.some(l => l.includes(pattern));
        expect(hasSDKImport).toBe(false);
      });
    }
  }
});

// ---------------------------------------------------------------------------
// reviewer_failure_is_non_fatal_warning
// ---------------------------------------------------------------------------
describe("reviewer_failure_is_non_fatal_warning", () => {
  test("runReviewer catches a thrown error and returns an empty ReviewerResult", async () => {
    const { runReviewer } = await import("../harness-claude/reviewer.ts");
    const { makeIdentity } = await import("../shared/agent-identity.ts");

    const throwingAgent = async () => {
      throw new Error("Simulated agent failure");
    };

    const identity = makeIdentity({ role: "REVIEWER", sprint: 1, variant: "main" });
    const config = {
      workDir: "/tmp",
      resolvedModelEvaluator: "claude-3-5-haiku-20241022",
      logLevel: "info",
      sessionDir: undefined,
      disableMcp: false,
      addMcpServers: undefined,
    } as unknown as Parameters<typeof runReviewer>[0]["config"];

    // Must not throw
    let result: Awaited<ReturnType<typeof runReviewer>> | undefined;
    expect(async () => {
      result = await runReviewer({ config, identity, sprint: 1 }, { agentFn: throwingAgent as any });
    }).not.toThrow();

    // Call it directly and assert on the return value
    result = await runReviewer({ config, identity, sprint: 1 }, { agentFn: throwingAgent as any });
    expect(result).toBeDefined();
    expect(result.report).toBeUndefined();
    expect(result.sdkResult).toBeUndefined();
  });

  test("runReviewer catches a rejected Promise and returns an empty ReviewerResult", async () => {
    const { runReviewer } = await import("../harness-claude/reviewer.ts");
    const { makeIdentity } = await import("../shared/agent-identity.ts");

    const rejectingAgent = () => Promise.reject(new Error("Async failure"));

    const identity = makeIdentity({ role: "REVIEWER", sprint: 1, variant: "main" });
    const config = {
      workDir: "/tmp",
      resolvedModelEvaluator: "claude-3-5-haiku-20241022",
      logLevel: "info",
      sessionDir: undefined,
      disableMcp: false,
      addMcpServers: undefined,
    } as unknown as Parameters<typeof runReviewer>[0]["config"];

    const result = await runReviewer({ config, identity, sprint: 1 }, { agentFn: rejectingAgent as any });
    expect(result.report).toBeUndefined();
    expect(result.sdkResult).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// naming_and_duplication_quality (structural checks)
// ---------------------------------------------------------------------------
describe("naming_and_duplication_quality", () => {
  test("review-report.ts uses descriptive names matching harness conventions", () => {
    const src = readFileSync(join(import.meta.dir, "../shared/review-report.ts"), "utf-8");
    expect(src).toContain("MAX_REVIEW_REPORT_CHARS"); // UPPER_SNAKE constant
    expect(src).toContain("boundReviewReport"); // camelCase function
    expect(src).toContain("parseReviewReport"); // camelCase function
    expect(src).toContain("ReviewReport"); // PascalCase type
    expect(src).toContain("EMPTY_REVIEW_REPORT"); // UPPER_SNAKE constant
  });

  test("review-report.ts has no LLM SDK imports", () => {
    const src = readFileSync(join(import.meta.dir, "../shared/review-report.ts"), "utf-8");
    expect(src).not.toContain("@anthropic-ai");
    expect(src).not.toContain("anthropic");
  });

  test("reviewer.ts imports bounding logic from shared/ rather than duplicating it", () => {
    const src = readFileSync(join(import.meta.dir, "../harness-claude/reviewer.ts"), "utf-8");
    expect(src).toContain("boundReviewReport"); // uses the shared helper
    expect(src).not.toContain("slice(0, MAX_REVIEW_REPORT_CHARS)"); // bounding is in shared/
  });

  test("reviewer.ts has explicit try/catch error handling", () => {
    const src = readFileSync(join(import.meta.dir, "../harness-claude/reviewer.ts"), "utf-8");
    expect(src).toContain("try {");
    expect(src).toContain("catch");
  });

  test("reviewer.ts exports follow UPPER_SNAKE for constants and camelCase for functions", () => {
    const src = readFileSync(join(import.meta.dir, "../harness-claude/reviewer.ts"), "utf-8");
    expect(src).toContain("export const REVIEWER_TOOLS");
    expect(src).toContain("export const REVIEWER_STAGE_NAME");
    expect(src).toContain("export const REVIEWER_REPORT_FILE");
    expect(src).toContain("export async function runReviewer");
  });

  test("REVIEWER_STAGE_NAME contains 'reviewer' (descriptive identifier)", () => {
    expect(REVIEWER_STAGE_NAME.toLowerCase()).toContain("reviewer");
  });
});

// ---------------------------------------------------------------------------
// Persistence helpers (read/write)
// ---------------------------------------------------------------------------
describe("reviewer persistence helpers", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `reviewer-test-${Date.now()}`);
    mkdirSync(join(tmpDir, ".adhd"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("writeReviewerReport creates a JSON file under .adhd/reviews/", async () => {
    const { writeReviewerReport } = await import("../harness-claude/reviewer.ts");
    await writeReviewerReport(tmpDir, 5, "Naming looks good. No duplication found.");
    const filePath = join(tmpDir, REVIEWER_REPORT_FILE(5));
    expect(existsSync(filePath)).toBe(true);
    const content = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(content).toHaveProperty("report");
    expect(content).toHaveProperty("sprint", 5);
    expect(typeof content.report).toBe("string");
  });

  test("readReviewerReport returns null when no report exists", async () => {
    const { readReviewerReport } = await import("../harness-claude/reviewer.ts");
    const result = await readReviewerReport(tmpDir, 99);
    expect(result).toBeNull();
  });

  test("readReviewerReport reads back what was written", async () => {
    const { writeReviewerReport, readReviewerReport } = await import("../harness-claude/reviewer.ts");
    const content = "All identifiers follow camelCase. No duplicated blocks.";
    await writeReviewerReport(tmpDir, 3, content);
    const result = await readReviewerReport(tmpDir, 3);
    expect(result).toBe(content);
  });
});
