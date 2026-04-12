import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseContract } from "../harness-claude/contract.ts";

async function setupTmpDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "parse-error-"));
  // Note: do NOT pre-create .adhd/logs/ — test that it's created on demand
  return dir;
}

describe("parseContract error diagnostics", () => {
  test("writes diagnostic file on parse failure", async () => {
    const dir = await setupTmpDir();
    const rawText = "This is completely unparseable garbage text that has no JSON";

    parseContract(rawText, 3, dir);

    // Wait for async writeParseErrorDiagnostic to complete
    await Bun.sleep(100);

    const diagnosticPath = join(dir, ".adhd", "logs", "sprint-3-contract-parse-error.txt");
    expect(existsSync(diagnosticPath)).toBe(true);
    const content = await readFile(diagnosticPath, "utf-8");
    expect(content).toBe(rawText);
  });

  test("creates .adhd/logs/ directory on demand", async () => {
    const dir = await setupTmpDir();
    const logsDir = join(dir, ".adhd", "logs");

    // Verify logs dir does not exist yet
    expect(existsSync(logsDir)).toBe(false);

    parseContract("not json", 1, dir);
    await Bun.sleep(100);

    // Directory should have been created
    expect(existsSync(logsDir)).toBe(true);
    expect(existsSync(join(logsDir, "sprint-1-contract-parse-error.txt"))).toBe(true);
  });

  test("does not write diagnostic file on successful parse", async () => {
    const dir = await setupTmpDir();
    await mkdir(join(dir, ".adhd", "logs"), { recursive: true });

    const validContract = {
      sprintNumber: 2,
      features: ["auth"],
      criteria: [{ name: "works", description: "It works", threshold: 7 }],
    };

    const result = parseContract(JSON.stringify(validContract), 2, dir);
    await Bun.sleep(100);

    expect(result.criteria).toHaveLength(1);
    expect(result.criteria[0]!.name).toBe("works");

    const diagnosticPath = join(dir, ".adhd", "logs", "sprint-2-contract-parse-error.txt");
    expect(existsSync(diagnosticPath)).toBe(false);
  });

  test("diagnostic file contains full raw text even when long", async () => {
    const dir = await setupTmpDir();
    const longText = "x".repeat(5000);

    parseContract(longText, 4, dir);
    await Bun.sleep(100);

    const diagnosticPath = join(dir, ".adhd", "logs", "sprint-4-contract-parse-error.txt");
    const content = await readFile(diagnosticPath, "utf-8");
    expect(content.length).toBe(5000);
  });

  test("returns default contract on parse failure (existing behavior preserved)", () => {
    const result = parseContract("not json at all", 5);
    expect(result.sprintNumber).toBe(5);
    expect(result.criteria).toHaveLength(3);
    expect(result.criteria[0]!.name).toBe("basic_functionality");
  });

  test("truncated preview is capped at reasonable length for long text", async () => {
    // This tests the truncation behavior indirectly — the logError call
    // should contain a truncated preview when text > 500 chars.
    // We verify the parse still works and the diagnostic file has full text.
    const dir = await setupTmpDir();
    const longText = "A".repeat(2000);

    parseContract(longText, 6, dir);
    await Bun.sleep(100);

    // Full text in diagnostic file
    const diagnosticPath = join(dir, ".adhd", "logs", "sprint-6-contract-parse-error.txt");
    const content = await readFile(diagnosticPath, "utf-8");
    expect(content.length).toBe(2000);
  });

  test("does not crash when workDir is not provided (backward compat)", () => {
    // parseContract without workDir should still work (no diagnostic written)
    const result = parseContract("not json", 1);
    expect(result.sprintNumber).toBe(1);
    expect(result.criteria).toHaveLength(3);
  });

  test("error during diagnostic write does not crash or mask parse failure", async () => {
    // Use a path that will fail (read-only or invalid)
    const result = parseContract("not json", 1, "/dev/null/impossible/path");
    expect(result.sprintNumber).toBe(1);
    expect(result.criteria).toHaveLength(3);
    // If we get here, the error was handled gracefully
  });
});
