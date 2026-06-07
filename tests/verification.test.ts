import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  VERIFICATION_NO_OP,
  buildErrorVerificationResult,
  buildVerificationResult,
  parseTestOutput,
} from "../shared/verification.ts";
import { detectStaticAnalysisCommands, detectTestCommand } from "../shared/static-analysis.ts";

const TMP_DIR = join(import.meta.dir, "__tmp_verification_test__");

beforeEach(() => {
  mkdirSync(TMP_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TMP_DIR, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// detectTestCommand
// ---------------------------------------------------------------------------

describe("detectTestCommand", () => {
  test("detects test script from package.json", async () => {
    writeFileSync(
      join(TMP_DIR, "package.json"),
      JSON.stringify({ scripts: { test: "bun test" } }),
      "utf-8",
    );
    const cmd = await detectTestCommand(TMP_DIR);
    expect(cmd).not.toBeNull();
    expect(cmd!.name).toBe("test");
    expect(cmd!.script).toBe("npm run test");
  });

  test("detects test:unit script", async () => {
    writeFileSync(
      join(TMP_DIR, "package.json"),
      JSON.stringify({ scripts: { "test:unit": "jest --unit" } }),
      "utf-8",
    );
    const cmd = await detectTestCommand(TMP_DIR);
    expect(cmd).not.toBeNull();
    expect(cmd!.name).toBe("test:unit");
  });

  test("detects test:run script", async () => {
    writeFileSync(
      join(TMP_DIR, "package.json"),
      JSON.stringify({ scripts: { "test:run": "vitest run" } }),
      "utf-8",
    );
    const cmd = await detectTestCommand(TMP_DIR);
    expect(cmd).not.toBeNull();
    expect(cmd!.name).toBe("test:run");
  });

  test("prefers test over test:unit when both present", async () => {
    writeFileSync(
      join(TMP_DIR, "package.json"),
      JSON.stringify({ scripts: { test: "bun test", "test:unit": "jest" } }),
      "utf-8",
    );
    const cmd = await detectTestCommand(TMP_DIR);
    expect(cmd).not.toBeNull();
    expect(cmd!.name).toBe("test");
  });

  test("returns null when no test script in package.json", async () => {
    writeFileSync(
      join(TMP_DIR, "package.json"),
      JSON.stringify({ scripts: { lint: "eslint .", build: "tsc" } }),
      "utf-8",
    );
    const cmd = await detectTestCommand(TMP_DIR);
    expect(cmd).toBeNull();
  });

  test("returns null when no package.json", async () => {
    const cmd = await detectTestCommand(join(TMP_DIR, "nonexistent"));
    expect(cmd).toBeNull();
  });

  test("returns null when package.json has no scripts", async () => {
    writeFileSync(join(TMP_DIR, "package.json"), JSON.stringify({ name: "pkg" }), "utf-8");
    const cmd = await detectTestCommand(TMP_DIR);
    expect(cmd).toBeNull();
  });

  test("does not throw on malformed package.json", async () => {
    writeFileSync(join(TMP_DIR, "package.json"), "{ not valid json", "utf-8");
    const cmd = await detectTestCommand(TMP_DIR);
    expect(cmd).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// detectStaticAnalysisCommands — test coexistence with lint/typecheck
// ---------------------------------------------------------------------------

describe("detectStaticAnalysisCommands coexistence with test", () => {
  test("returns lint, typecheck, and test when all are present", async () => {
    writeFileSync(
      join(TMP_DIR, "package.json"),
      JSON.stringify({
        scripts: { lint: "eslint .", typecheck: "tsc --noEmit", test: "bun test" },
      }),
      "utf-8",
    );
    const commands = await detectStaticAnalysisCommands(TMP_DIR);
    expect(commands.length).toBe(3);
    const names = commands.map((c) => c.name).sort();
    expect(names).toEqual(["lint", "test", "typecheck"]);
  });

  test("returns only lint and typecheck when no test script", async () => {
    writeFileSync(
      join(TMP_DIR, "package.json"),
      JSON.stringify({ scripts: { lint: "eslint .", typecheck: "tsc --noEmit" } }),
      "utf-8",
    );
    const commands = await detectStaticAnalysisCommands(TMP_DIR);
    expect(commands.length).toBe(2);
    expect(commands.map((c) => c.name).sort()).toEqual(["lint", "typecheck"]);
  });

  test("returns only test when only test script present", async () => {
    writeFileSync(
      join(TMP_DIR, "package.json"),
      JSON.stringify({ scripts: { test: "bun test" } }),
      "utf-8",
    );
    const commands = await detectStaticAnalysisCommands(TMP_DIR);
    expect(commands.length).toBe(1);
    expect(commands[0]!.name).toBe("test");
  });

  test("returns empty when no matching scripts", async () => {
    writeFileSync(
      join(TMP_DIR, "package.json"),
      JSON.stringify({ scripts: { build: "tsc" } }),
      "utf-8",
    );
    const commands = await detectStaticAnalysisCommands(TMP_DIR);
    expect(commands).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// parseTestOutput
// ---------------------------------------------------------------------------

describe("parseTestOutput", () => {
  test("bun format: parses pass and fail counts", () => {
    const raw = [
      "bun test v1.3.11",
      "",
      " ✓ should pass (1ms)",
      " ✓ another pass (2ms)",
      " ✗ should fail (1ms)",
      "",
      " 2 pass",
      " 1 fail",
    ].join("\n");
    const result = parseTestOutput(raw, 1);
    expect(result.passCount).toBe(2);
    expect(result.failCount).toBe(1);
    expect(result.total).toBe(3);
    expect(result.passed).toBe(false);
  });

  test("exit code 0 means passed", () => {
    const raw = " 3 pass\n 0 fail";
    const result = parseTestOutput(raw, 0);
    expect(result.passed).toBe(true);
  });

  test("exit code non-zero means failed", () => {
    const raw = " 2 pass\n 1 fail";
    const result = parseTestOutput(raw, 1);
    expect(result.passed).toBe(false);
  });

  test("bun format: extracts failing test names via ✗", () => {
    const raw = " ✗ my failing test (5ms)\n ✓ passing test\n 1 pass\n 1 fail";
    const result = parseTestOutput(raw, 1);
    expect(result.failingTests).toContain("my failing test");
  });

  test("extracts failing test names via × character", () => {
    const raw = " × another failing test (3ms)\n 0 pass\n 1 fail";
    const result = parseTestOutput(raw, 1);
    expect(result.failingTests).toContain("another failing test");
  });

  test("jest format: parses counts from summary line", () => {
    const raw = "Tests: 2 failed, 5 passed, 7 total";
    const result = parseTestOutput(raw, 1);
    expect(result.failCount).toBe(2);
    expect(result.passCount).toBe(5);
    expect(result.total).toBe(7);
  });

  test("TAP format: extracts failing test names", () => {
    const raw = "not ok 1 - should do the thing\nok 2 - passes fine";
    const result = parseTestOutput(raw, 1);
    expect(result.failingTests).toContain("should do the thing");
  });

  test("total always equals passCount plus failCount", () => {
    const raw = " 5 pass\n 3 fail";
    const result = parseTestOutput(raw, 1);
    expect(result.total).toBe(result.passCount + result.failCount);
  });

  test("counts are non-negative when output is unparseable", () => {
    const result = parseTestOutput("something went wrong", 1);
    expect(result.passCount).toBeGreaterThanOrEqual(0);
    expect(result.failCount).toBeGreaterThanOrEqual(0);
    expect(result.total).toBeGreaterThanOrEqual(0);
  });

  test("strips timing suffix from failing test names", () => {
    const raw = " ✗ my test (123ms)";
    const result = parseTestOutput(raw, 1);
    expect(result.failingTests).toContain("my test");
    expect(result.failingTests[0]).not.toContain("(123ms)");
  });
});

// ---------------------------------------------------------------------------
// buildVerificationResult
// ---------------------------------------------------------------------------

describe("buildVerificationResult", () => {
  test("returns correct shape with all required fields", () => {
    const raw = " 3 pass\n 1 fail\n ✗ broken test (2ms)";
    const result = buildVerificationResult(raw, 1);
    expect(typeof result.passed).toBe("boolean");
    expect(typeof result.total).toBe("number");
    expect(typeof result.passCount).toBe("number");
    expect(typeof result.failCount).toBe("number");
    expect(Array.isArray(result.failingTests)).toBe(true);
    expect(typeof result.output).toBe("string");
  });

  test("truncates large output and keeps output field bounded", () => {
    const bigOutput = "x".repeat(6000);
    const result = buildVerificationResult(bigOutput, 0);
    expect(result.output.length).toBeLessThan(6000);
    expect(result.output).toContain("[output truncated");
  });

  test("returns output unchanged when within limit", () => {
    const small = " 1 pass\n 0 fail";
    const result = buildVerificationResult(small, 0);
    expect(result.output).toBe(small);
  });

  test("total equals passCount plus failCount", () => {
    const raw = " 4 pass\n 2 fail";
    const result = buildVerificationResult(raw, 1);
    expect(result.total).toBe(result.passCount + result.failCount);
  });
});

// ---------------------------------------------------------------------------
// buildErrorVerificationResult
// ---------------------------------------------------------------------------

describe("buildErrorVerificationResult", () => {
  test("returns a failed result with error captured in output", () => {
    const result = buildErrorVerificationResult("command not found: bun");
    expect(result.passed).toBe(false);
    expect(result.output).toContain("command not found: bun");
    expect(result.total).toBe(0);
    expect(result.failingTests).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// VERIFICATION_NO_OP
// ---------------------------------------------------------------------------

describe("VERIFICATION_NO_OP", () => {
  test("has null passed, zero counts, empty failing list", () => {
    expect(VERIFICATION_NO_OP.passed).toBeNull();
    expect(VERIFICATION_NO_OP.total).toBe(0);
    expect(VERIFICATION_NO_OP.passCount).toBe(0);
    expect(VERIFICATION_NO_OP.failCount).toBe(0);
    expect(VERIFICATION_NO_OP.failingTests).toEqual([]);
  });
});
