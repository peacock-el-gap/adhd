import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { loadHarnessEnv, parseCli, resolveConfig, validateConfig } from "../shared/config.ts";
import type { HarnessConfig } from "../shared/types.ts";

// --- validateConfig ---

describe("validateConfig", () => {
  const base: HarnessConfig = {
    userPrompt: "test",
    workDir: "/tmp",
    maxSprints: 5,
    maxRetriesPerSprint: 3,
    passThreshold: 7,
  };

  test("accepts valid config", () => {
    expect(() => validateConfig(base)).not.toThrow();
  });

  test("rejects threshold below 1", () => {
    expect(() => validateConfig({ ...base, passThreshold: 0 })).toThrow("Invalid threshold");
  });

  test("rejects threshold above 10", () => {
    expect(() => validateConfig({ ...base, passThreshold: 11 })).toThrow("Invalid threshold");
  });

  test("rejects maxSprints below 1", () => {
    expect(() => validateConfig({ ...base, maxSprints: 0 })).toThrow("Invalid max-sprints");
  });

  test("rejects negative maxRetries", () => {
    expect(() => validateConfig({ ...base, maxRetriesPerSprint: -1 })).toThrow("Invalid max-retries");
  });

  test("accepts zero maxRetries", () => {
    expect(() => validateConfig({ ...base, maxRetriesPerSprint: 0 })).not.toThrow();
  });

  test("accepts boundary threshold values", () => {
    expect(() => validateConfig({ ...base, passThreshold: 1 })).not.toThrow();
    expect(() => validateConfig({ ...base, passThreshold: 10 })).not.toThrow();
  });
});

// --- parseCli ---

describe("parseCli", () => {
  test("parses positional prompt", () => {
    const cli = parseCli(["Build a task manager"]);
    expect(cli.prompt).toBe("Build a task manager");
  });

  test("parses --file flag", () => {
    const cli = parseCli(["--file", "prompt.md"]);
    expect(cli.file).toBe("prompt.md");
  });

  test("parses --greenfield and --resume", () => {
    const cli = parseCli(["--greenfield", "--resume"]);
    expect(cli.greenfield).toBe(true);
    expect(cli.resume).toBe(true);
  });

  test("parses numeric options", () => {
    const cli = parseCli(["--max-sprints", "8", "--max-retries", "5", "--threshold", "9", "test"]);
    expect(cli.maxSprints).toBe(8);
    expect(cli.maxRetries).toBe(5);
    expect(cli.threshold).toBe(9);
  });

  test("parses --verbose and --quiet", () => {
    expect(parseCli(["--verbose", "test"]).verbose).toBe(true);
    expect(parseCli(["--quiet", "test"]).quiet).toBe(true);
  });

  test("defaults boolean flags to false", () => {
    const cli = parseCli(["test"]);
    expect(cli.greenfield).toBe(false);
    expect(cli.resume).toBe(false);
    expect(cli.verbose).toBe(false);
    expect(cli.quiet).toBe(false);
  });
});

// --- loadHarnessEnv ---

describe("loadHarnessEnv", () => {
  const tmpDir = join(import.meta.dir, "__env_test_tmp");
  const harnessDir = join(tmpDir, ".harness");
  const envPath = join(harnessDir, ".env");

  beforeEach(() => {
    mkdirSync(harnessDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    // Clean up test env vars
    delete process.env.TEST_HARNESS_VAR;
    delete process.env.TEST_QUOTED_VAR;
  });

  test("loads key=value pairs into process.env", () => {
    writeFileSync(envPath, "TEST_HARNESS_VAR=hello\n");
    loadHarnessEnv(tmpDir);
    expect(process.env.TEST_HARNESS_VAR).toBe("hello");
  });

  test("strips surrounding quotes", () => {
    writeFileSync(envPath, 'TEST_QUOTED_VAR="quoted value"\n');
    loadHarnessEnv(tmpDir);
    expect(process.env.TEST_QUOTED_VAR).toBe("quoted value");
  });

  test("does not overwrite existing env vars", () => {
    process.env.TEST_HARNESS_VAR = "existing";
    writeFileSync(envPath, "TEST_HARNESS_VAR=new_value\n");
    loadHarnessEnv(tmpDir);
    expect(process.env.TEST_HARNESS_VAR).toBe("existing");
  });

  test("skips comments and blank lines", () => {
    writeFileSync(envPath, "# comment\n\nTEST_HARNESS_VAR=works\n");
    loadHarnessEnv(tmpDir);
    expect(process.env.TEST_HARNESS_VAR).toBe("works");
  });

  test("does nothing if .env file does not exist", () => {
    rmSync(envPath, { force: true });
    expect(() => loadHarnessEnv(tmpDir)).not.toThrow();
  });
});

// --- resolveConfig ---

describe("resolveConfig", () => {
  test("throws when no prompt and not resuming", () => {
    expect(() => resolveConfig({ greenfield: false, resume: false, verbose: false, quiet: false, noInteractive: false })).toThrow("A prompt is required");
  });

  test("allows missing prompt when resuming", () => {
    const config = resolveConfig({ resume: true, greenfield: false, verbose: false, quiet: false, noInteractive: false });
    expect(config.isResume).toBe(true);
    expect(config.userPrompt).toBe("");
  });

  test("resolves log level from flags", () => {
    const verbose = resolveConfig({ prompt: "test", greenfield: false, resume: false, verbose: true, quiet: false, noInteractive: false });
    expect(verbose.logLevel).toBe("verbose");

    const quiet = resolveConfig({ prompt: "test", greenfield: false, resume: false, verbose: false, quiet: true, noInteractive: false });
    expect(quiet.logLevel).toBe("quiet");
  });
});
