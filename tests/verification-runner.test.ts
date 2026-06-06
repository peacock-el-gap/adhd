import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createVerificationRunner } from "../shared/orchestration/verification-runner.ts";
import type { CommandExecutor } from "../shared/orchestration/verification-runner.ts";

const TMP_DIR = join(import.meta.dir, "__tmp_verification_runner_test__");

beforeEach(() => {
  mkdirSync(TMP_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TMP_DIR, { recursive: true, force: true });
});

function makeProject(scripts: Record<string, string> = {}): string {
  writeFileSync(
    join(TMP_DIR, "package.json"),
    JSON.stringify({ scripts }),
    "utf-8",
  );
  return TMP_DIR;
}

// ---------------------------------------------------------------------------
// No test command — degrades to no-op
// ---------------------------------------------------------------------------

describe("no test command present", () => {
  test("returns no-op result when no package.json", async () => {
    const runner = createVerificationRunner();
    const result = await runner.run(join(TMP_DIR, "nonexistent"));
    expect(result.passed).toBeNull();
    expect(result.total).toBe(0);
    expect(result.failingTests).toEqual([]);
  });

  test("returns no-op result when package.json has no test script", async () => {
    const projectDir = makeProject({ lint: "eslint ." });
    const runner = createVerificationRunner();
    const result = await runner.run(projectDir);
    expect(result.passed).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Runs exactly once per runner instance (caching)
// ---------------------------------------------------------------------------

describe("runs exactly once per attempt", () => {
  test("executor is called only once even when run() is called twice", async () => {
    let callCount = 0;
    const mockExecutor: CommandExecutor = (_cmd, _cwd) => {
      callCount++;
      return { stdout: " 1 pass\n 0 fail", stderr: "", exitCode: 0 };
    };
    const projectDir = makeProject({ test: "bun test" });
    const runner = createVerificationRunner(mockExecutor);

    const first = await runner.run(projectDir);
    const second = await runner.run(projectDir);

    expect(callCount).toBe(1);
    // Both calls return the same result
    expect(first).toBe(second);
  });

  test("second call returns the same cached object reference", async () => {
    const mockExecutor: CommandExecutor = () => ({
      stdout: " 2 pass\n 0 fail",
      stderr: "",
      exitCode: 0,
    });
    const projectDir = makeProject({ test: "bun test" });
    const runner = createVerificationRunner(mockExecutor);

    const first = await runner.run(projectDir);
    const second = await runner.run(projectDir);

    expect(first).toBe(second);
  });
});

// ---------------------------------------------------------------------------
// Structured result shape
// ---------------------------------------------------------------------------

describe("structured result shape", () => {
  test("result contains all required fields when command succeeds", async () => {
    const mockExecutor: CommandExecutor = () => ({
      stdout: " 3 pass\n 0 fail",
      stderr: "",
      exitCode: 0,
    });
    const projectDir = makeProject({ test: "bun test" });
    const runner = createVerificationRunner(mockExecutor);

    const result = await runner.run(projectDir);

    expect(typeof result.passed).toBe("boolean");
    expect(result.passed).toBe(true);
    expect(typeof result.total).toBe("number");
    expect(typeof result.passCount).toBe("number");
    expect(typeof result.failCount).toBe("number");
    expect(Array.isArray(result.failingTests)).toBe(true);
    expect(typeof result.output).toBe("string");
  });

  test("total equals passCount plus failCount", async () => {
    const mockExecutor: CommandExecutor = () => ({
      stdout: " 4 pass\n 2 fail",
      stderr: "",
      exitCode: 1,
    });
    const projectDir = makeProject({ test: "bun test" });
    const runner = createVerificationRunner(mockExecutor);

    const result = await runner.run(projectDir);

    expect(result.total).toBe(result.passCount + result.failCount);
  });

  test("failing test names are captured", async () => {
    const mockExecutor: CommandExecutor = () => ({
      stdout: " ✗ broken widget (2ms)\n 0 pass\n 1 fail",
      stderr: "",
      exitCode: 1,
    });
    const projectDir = makeProject({ test: "bun test" });
    const runner = createVerificationRunner(mockExecutor);

    const result = await runner.run(projectDir);

    expect(result.failingTests).toContain("broken widget");
  });
});

// ---------------------------------------------------------------------------
// Graceful degradation on spawn failure
// ---------------------------------------------------------------------------

describe("spawn failure degrades gracefully", () => {
  test("throws from executor are caught — returns a failed result", async () => {
    const badExecutor: CommandExecutor = () => {
      throw new Error("command not found: bun");
    };
    const projectDir = makeProject({ test: "bun test" });
    const runner = createVerificationRunner(badExecutor);

    // Should not throw
    const result = await runner.run(projectDir);

    expect(result.passed).toBe(false);
    expect(result.output).toContain("command not found: bun");
  });

  test("non-zero exit code records a failed result", async () => {
    const mockExecutor: CommandExecutor = () => ({
      stdout: "Error: test setup failed",
      stderr: "fatal: something bad",
      exitCode: 127,
    });
    const projectDir = makeProject({ test: "bun test" });
    const runner = createVerificationRunner(mockExecutor);

    const result = await runner.run(projectDir);

    expect(result.passed).toBe(false);
  });

  test("large output is truncated — does not exceed bounded size", async () => {
    const bigOutput = "x".repeat(10000);
    const mockExecutor: CommandExecutor = () => ({
      stdout: bigOutput,
      stderr: "",
      exitCode: 0,
    });
    const projectDir = makeProject({ test: "bun test" });
    const runner = createVerificationRunner(mockExecutor);

    const result = await runner.run(projectDir);

    expect(result.output.length).toBeLessThan(10000);
    expect(result.output).toContain("[output truncated");
  });
});
