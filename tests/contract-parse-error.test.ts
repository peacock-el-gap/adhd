import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseContract } from "../harness-claude/contract.ts";

// A realistic session stamp in the YYYY.MM.DD-HH.MM.SS format used by timedName
const SESSION_STAMP = "2026.06.06-12.00.00";

async function setupTmpDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "parse-error-"));
  // Note: do NOT pre-create .adhd/logs/ — test that it's created on demand
  return dir;
}

describe("parseContract error diagnostics", () => {
  // Capture all warning output across the whole suite so no amber lines
  // propagate unpredictably to the test runner output.
  let warnSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  test("writes diagnostic file on parse failure", async () => {
    const dir = await setupTmpDir();
    const rawText = "This is completely unparseable garbage text that has no JSON";

    parseContract(rawText, 3, dir);

    // Verify the warning was emitted with the right content
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const call = warnSpy.mock.calls[0]?.[0] as string;
    expect(call).toContain("sprint 3");
    expect(call).toContain("generic default contract");

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

    // Warning should have been emitted
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const call = warnSpy.mock.calls[0]?.[0] as string;
    expect(call).toContain("sprint 1");
    expect(call).toContain("generic default contract");

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

    // No warning on success
    expect(warnSpy).not.toHaveBeenCalled();

    expect(result.criteria).toHaveLength(1);
    expect(result.criteria[0]!.name).toBe("works");

    const diagnosticPath = join(dir, ".adhd", "logs", "sprint-2-contract-parse-error.txt");
    expect(existsSync(diagnosticPath)).toBe(false);
  });

  test("diagnostic file contains full raw text even when long", async () => {
    const dir = await setupTmpDir();
    const longText = "x".repeat(5000);

    parseContract(longText, 4, dir);

    // Warning emitted with sprint number and fallback phrase
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const call = warnSpy.mock.calls[0]?.[0] as string;
    expect(call).toContain("sprint 4");
    expect(call).toContain("generic default contract");

    await Bun.sleep(100);

    const diagnosticPath = join(dir, ".adhd", "logs", "sprint-4-contract-parse-error.txt");
    const content = await readFile(diagnosticPath, "utf-8");
    expect(content.length).toBe(5000);
  });

  test("returns default contract on parse failure (existing behavior preserved)", () => {
    const result = parseContract("not json at all", 5);

    // Warning emitted even without workDir
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const call = warnSpy.mock.calls[0]?.[0] as string;
    expect(call).toContain("sprint 5");
    expect(call).toContain("generic default contract");

    expect(result.sprintNumber).toBe(5);
    expect(result.criteria).toHaveLength(3);
    expect(result.criteria[0]!.name).toBe("basic_functionality");
  });

  test("truncated preview is capped at reasonable length for long text", async () => {
    // This tests that the parse still works; the warning is captured by the spy.
    const dir = await setupTmpDir();
    const longText = "A".repeat(2000);

    parseContract(longText, 6, dir);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const call = warnSpy.mock.calls[0]?.[0] as string;
    expect(call).toContain("sprint 6");
    expect(call).toContain("generic default contract");

    await Bun.sleep(100);

    // Full text in diagnostic file
    const diagnosticPath = join(dir, ".adhd", "logs", "sprint-6-contract-parse-error.txt");
    const content = await readFile(diagnosticPath, "utf-8");
    expect(content.length).toBe(2000);
  });

  test("does not crash when workDir is not provided (backward compat)", () => {
    // parseContract without workDir should still work (no diagnostic written)
    const result = parseContract("not json", 1);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const call = warnSpy.mock.calls[0]?.[0] as string;
    expect(call).toContain("sprint 1");
    expect(call).toContain("generic default contract");

    expect(result.sprintNumber).toBe(1);
    expect(result.criteria).toHaveLength(3);
  });

  test("error during diagnostic write does not crash or mask parse failure", async () => {
    // Use a path that will fail (read-only or invalid)
    const result = parseContract("not json", 1, "/dev/null/impossible/path");

    expect(result.sprintNumber).toBe(1);
    expect(result.criteria).toHaveLength(3);

    // Wait for the fire-and-forget write to settle so its failure warning is
    // captured by THIS test's spy rather than leaking into the next test.
    // (The write failure is now logged at warning severity per the sprint 4
    // no_swallowed_errors criterion, so we must drain it here.)
    await Bun.sleep(100);

    // The spy should have at least the parse-failure warning; the write-failure
    // warning may or may not appear depending on timing, but critically it must
    // NOT leak into later tests.
    const calls = warnSpy.mock.calls.map((c: unknown[]) => c[0] as string);
    const parseWarn = calls.find((c: string) => c.includes("sprint 1") && c.includes("generic default contract"));
    expect(parseWarn).toBeDefined();
    // If we get here, the error was handled gracefully
  });
});

// ── Sprint 4: session-directory routing ───────────────────────────────────────

describe("parseContract diagnostic session-directory routing", () => {
  let warnSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  test("diagnostic_lands_in_session_directory: diagnostic written inside session subdirectory when stamp is present", async () => {
    const dir = await mkdtemp(join(tmpdir(), "parse-error-sess-"));
    const rawText = "This is completely unparseable text — session stamp test";

    parseContract(rawText, 7, dir, SESSION_STAMP);

    // Amber warning should be emitted exactly once
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const call = warnSpy.mock.calls[0]?.[0] as string;
    expect(call).toContain("sprint 7");

    await Bun.sleep(100);

    // Must appear inside the session subdirectory, NOT in the flat root
    const sessionPath = join(dir, ".adhd", "logs", SESSION_STAMP, "sprint-7-contract-parse-error.txt");
    const flatPath = join(dir, ".adhd", "logs", "sprint-7-contract-parse-error.txt");

    expect(existsSync(sessionPath)).toBe(true);
    expect(existsSync(flatPath)).toBe(false);

    const content = await readFile(sessionPath, "utf-8");
    expect(content).toBe(rawText);
  });

  test("graceful_degrade_without_session_stamp: diagnostic written to flat root when stamp is absent", async () => {
    const dir = await mkdtemp(join(tmpdir(), "parse-error-flat-"));
    const rawText = "Unparseable — no session stamp provided";

    parseContract(rawText, 8, dir);

    expect(warnSpy).toHaveBeenCalledTimes(1);

    await Bun.sleep(100);

    // Must appear in the flat root, not under any session subdirectory
    const flatPath = join(dir, ".adhd", "logs", "sprint-8-contract-parse-error.txt");
    expect(existsSync(flatPath)).toBe(true);

    const content = await readFile(flatPath, "utf-8");
    expect(content).toBe(rawText);
  });

  test("no_diagnostic_on_clean_parse: no diagnostic file created anywhere when parse succeeds (with session stamp)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "parse-error-clean-"));
    await mkdir(join(dir, ".adhd", "logs", SESSION_STAMP), { recursive: true });

    const validContract = {
      sprintNumber: 9,
      features: ["logging"],
      criteria: [{ name: "works", description: "Logging works", threshold: 7 }],
    };

    const result = parseContract(JSON.stringify(validContract), 9, dir, SESSION_STAMP);
    await Bun.sleep(100);

    // No warning on success
    expect(warnSpy).not.toHaveBeenCalled();
    expect(result.criteria).toHaveLength(1);

    const sessionPath = join(dir, ".adhd", "logs", SESSION_STAMP, "sprint-9-contract-parse-error.txt");
    const flatPath = join(dir, ".adhd", "logs", "sprint-9-contract-parse-error.txt");
    expect(existsSync(sessionPath)).toBe(false);
    expect(existsSync(flatPath)).toBe(false);
  });

  test("two_runs_produce_separate_diagnostics: each run's diagnostic resides in its own session folder", async () => {
    const dir = await mkdtemp(join(tmpdir(), "parse-error-two-runs-"));
    const stampA = "2026.06.06-10.00.00";
    const stampB = "2026.06.06-11.00.00";

    parseContract("not json run A", 1, dir, stampA);
    parseContract("not json run B", 2, dir, stampB);

    await Bun.sleep(100);

    const pathA = join(dir, ".adhd", "logs", stampA, "sprint-1-contract-parse-error.txt");
    const pathB = join(dir, ".adhd", "logs", stampB, "sprint-2-contract-parse-error.txt");

    // Each diagnostic is in its own session folder
    expect(existsSync(pathA)).toBe(true);
    expect(existsSync(pathB)).toBe(true);

    // Neither diagnostic appears in the other run's folder
    const wrongA = join(dir, ".adhd", "logs", stampB, "sprint-1-contract-parse-error.txt");
    const wrongB = join(dir, ".adhd", "logs", stampA, "sprint-2-contract-parse-error.txt");
    expect(existsSync(wrongA)).toBe(false);
    expect(existsSync(wrongB)).toBe(false);

    // Content is correct
    expect(await readFile(pathA, "utf-8")).toBe("not json run A");
    expect(await readFile(pathB, "utf-8")).toBe("not json run B");
  });

  test("session_stamp_threaded_consistently: session directory is created on demand when stamp is provided", async () => {
    // The session subdirectory must not need to exist beforehand — it should be
    // created by mkdir({ recursive: true }) inside writeParseErrorDiagnostic.
    const dir = await mkdtemp(join(tmpdir(), "parse-error-makedirs-"));

    parseContract("no json here", 3, dir, SESSION_STAMP);

    await Bun.sleep(100);

    const sessionDir = join(dir, ".adhd", "logs", SESSION_STAMP);
    expect(existsSync(sessionDir)).toBe(true);
    expect(existsSync(join(sessionDir, "sprint-3-contract-parse-error.txt"))).toBe(true);
  });

  test("run_continues_after_diagnostic_write: returns generic default contract even when session stamp is set", () => {
    // Synchronous return value must be the generic default — diagnostic is fire-and-forget
    const result = parseContract("completely invalid", 10, undefined, SESSION_STAMP);

    // Warning emitted
    expect(warnSpy).toHaveBeenCalledTimes(1);

    // Returns default contract
    expect(result.sprintNumber).toBe(10);
    expect(result.criteria).toHaveLength(3);
    expect(result.criteria[0]!.name).toBe("basic_functionality");
  });
});
