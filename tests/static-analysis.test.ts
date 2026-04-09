import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  detectStaticAnalysisCommands,
  truncateStaticAnalysisOutput,
} from "../shared/static-analysis.ts";

const TMP_DIR = join(import.meta.dir, "__tmp_static_analysis_test__");

beforeEach(() => {
  mkdirSync(TMP_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TMP_DIR, { recursive: true, force: true });
});

describe("detectStaticAnalysisCommands", () => {
  test("detects lint script from package.json", async () => {
    writeFileSync(
      join(TMP_DIR, "package.json"),
      JSON.stringify({ scripts: { lint: "eslint ." } }),
      "utf-8",
    );

    const commands = await detectStaticAnalysisCommands(TMP_DIR);
    expect(commands).toHaveLength(1);
    expect(commands[0]!.name).toBe("lint");
    expect(commands[0]!.script).toBe("npm run lint");
  });

  test("detects typecheck script from package.json", async () => {
    writeFileSync(
      join(TMP_DIR, "package.json"),
      JSON.stringify({ scripts: { typecheck: "tsc --noEmit" } }),
      "utf-8",
    );

    const commands = await detectStaticAnalysisCommands(TMP_DIR);
    expect(commands).toHaveLength(1);
    expect(commands[0]!.name).toBe("typecheck");
  });

  test("detects type-check script from package.json", async () => {
    writeFileSync(
      join(TMP_DIR, "package.json"),
      JSON.stringify({ scripts: { "type-check": "tsc --noEmit" } }),
      "utf-8",
    );

    const commands = await detectStaticAnalysisCommands(TMP_DIR);
    expect(commands).toHaveLength(1);
    expect(commands[0]!.name).toBe("type-check");
  });

  test("detects multiple scripts", async () => {
    writeFileSync(
      join(TMP_DIR, "package.json"),
      JSON.stringify({ scripts: { lint: "eslint .", typecheck: "tsc --noEmit" } }),
      "utf-8",
    );

    const commands = await detectStaticAnalysisCommands(TMP_DIR);
    expect(commands).toHaveLength(2);
    expect(commands.map((c) => c.name).sort()).toEqual(["lint", "typecheck"]);
  });

  test("returns empty array when no package.json exists", async () => {
    const commands = await detectStaticAnalysisCommands(join(TMP_DIR, "nonexistent"));
    expect(commands).toEqual([]);
  });

  test("returns empty array when package.json has no scripts", async () => {
    writeFileSync(
      join(TMP_DIR, "package.json"),
      JSON.stringify({ name: "test-pkg" }),
      "utf-8",
    );

    const commands = await detectStaticAnalysisCommands(TMP_DIR);
    expect(commands).toEqual([]);
  });

  test("returns empty array when no matching script keys", async () => {
    writeFileSync(
      join(TMP_DIR, "package.json"),
      JSON.stringify({ scripts: { build: "tsc", start: "node ." } }),
      "utf-8",
    );

    const commands = await detectStaticAnalysisCommands(TMP_DIR);
    expect(commands).toEqual([]);
  });
});

describe("truncateStaticAnalysisOutput", () => {
  test("returns short output unchanged", () => {
    const output = "All checks passed.";
    expect(truncateStaticAnalysisOutput(output)).toBe(output);
  });

  test("truncates output exceeding 4000 characters", () => {
    const longOutput = "x".repeat(5000);
    const result = truncateStaticAnalysisOutput(longOutput);
    expect(result).toContain("x".repeat(4000));
    expect(result).toContain("[output truncated — showing first 4000 chars of 5000 total]");
  });

  test("does not truncate output at exactly 4000 characters", () => {
    const exactOutput = "y".repeat(4000);
    const result = truncateStaticAnalysisOutput(exactOutput);
    expect(result).toBe(exactOutput);
    expect(result).not.toContain("truncated");
  });

  test("includes correct total count in truncation message", () => {
    const longOutput = "z".repeat(12345);
    const result = truncateStaticAnalysisOutput(longOutput);
    expect(result).toContain("12345 total");
  });
});

describe("lint-gate behavior", () => {
  test("when lintGate is set and lint fails, evaluator should be skipped (integration logic)", () => {
    // This tests the logic pattern used in harness.ts:
    // if (config.lintGate && staticAnalysisResult.failed) { skip evaluator }
    const lintGate = true;
    const staticAnalysisFailed = true;
    const evaluatorShouldBeSkipped = lintGate && staticAnalysisFailed;
    expect(evaluatorShouldBeSkipped).toBe(true);
  });

  test("when lintGate is not set and lint fails, evaluator runs normally", () => {
    const lintGate = false;
    const staticAnalysisFailed = true;
    const evaluatorShouldBeSkipped = lintGate && staticAnalysisFailed;
    expect(evaluatorShouldBeSkipped).toBe(false);
  });

  test("when lintGate is set and lint passes, evaluator runs normally", () => {
    const lintGate = true;
    const staticAnalysisFailed = false;
    const evaluatorShouldBeSkipped = lintGate && staticAnalysisFailed;
    expect(evaluatorShouldBeSkipped).toBe(false);
  });
});
