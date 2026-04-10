import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { detectStaticAnalysisCommands, truncateStaticAnalysisOutput } from "./static-analysis.ts";

const TMP_DIR = join(import.meta.dir, "__tmp_sa_unit__");

beforeEach(() => {
  mkdirSync(TMP_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TMP_DIR, { recursive: true, force: true });
});

describe("detectStaticAnalysisCommands", () => {
  test("finds lint script from package.json", async () => {
    writeFileSync(join(TMP_DIR, "package.json"), JSON.stringify({ scripts: { lint: "eslint ." } }), "utf-8");

    const commands = await detectStaticAnalysisCommands(TMP_DIR);
    expect(commands).toHaveLength(1);
    expect(commands[0]?.name).toBe("lint");
    expect(commands[0]?.script).toBe("npm run lint");
  });

  test("finds typecheck script from package.json", async () => {
    writeFileSync(join(TMP_DIR, "package.json"), JSON.stringify({ scripts: { typecheck: "tsc --noEmit" } }), "utf-8");

    const commands = await detectStaticAnalysisCommands(TMP_DIR);
    expect(commands).toHaveLength(1);
    expect(commands[0]?.name).toBe("typecheck");
  });

  test("finds type-check script from package.json", async () => {
    writeFileSync(
      join(TMP_DIR, "package.json"),
      JSON.stringify({ scripts: { "type-check": "tsc --noEmit" } }),
      "utf-8",
    );

    const commands = await detectStaticAnalysisCommands(TMP_DIR);
    expect(commands).toHaveLength(1);
    expect(commands[0]?.name).toBe("type-check");
  });

  test("returns empty array when no package.json exists", async () => {
    const commands = await detectStaticAnalysisCommands(join(TMP_DIR, "nonexistent"));
    expect(commands).toEqual([]);
  });

  test("returns empty array when no matching scripts exist", async () => {
    writeFileSync(
      join(TMP_DIR, "package.json"),
      JSON.stringify({ scripts: { build: "tsc", start: "node ." } }),
      "utf-8",
    );

    const commands = await detectStaticAnalysisCommands(TMP_DIR);
    expect(commands).toEqual([]);
  });

  test("returns empty array when package.json has no scripts field", async () => {
    writeFileSync(join(TMP_DIR, "package.json"), JSON.stringify({ name: "test-pkg" }), "utf-8");

    const commands = await detectStaticAnalysisCommands(TMP_DIR);
    expect(commands).toEqual([]);
  });

  test("finds multiple matching scripts", async () => {
    writeFileSync(
      join(TMP_DIR, "package.json"),
      JSON.stringify({ scripts: { lint: "eslint .", typecheck: "tsc --noEmit" } }),
      "utf-8",
    );

    const commands = await detectStaticAnalysisCommands(TMP_DIR);
    expect(commands).toHaveLength(2);
    expect(commands.map((c) => c.name).sort()).toEqual(["lint", "typecheck"]);
  });
});

describe("truncateStaticAnalysisOutput", () => {
  test("passes through output under the limit unchanged", () => {
    const output = "All checks passed.";
    expect(truncateStaticAnalysisOutput(output)).toBe(output);
  });

  test("truncates at 4000 chars with warning message", () => {
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
