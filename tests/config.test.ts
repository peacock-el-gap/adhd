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

  test("parses --debug", () => {
    expect(parseCli(["--debug", "test"]).debug).toBe(true);
  });

  test("defaults boolean flags to false", () => {
    const cli = parseCli(["test"]);
    expect(cli.greenfield).toBe(false);
    expect(cli.resume).toBe(false);
    expect(cli.verbose).toBe(false);
    expect(cli.quiet).toBe(false);
    expect(cli.debug).toBe(false);
  });

  test("parses --editor flag", () => {
    const cli = parseCli(["--editor", "code --wait", "test"]);
    expect(cli.editor).toBe("code --wait");
  });

  test("parses --gate-timeout flag", () => {
    const cli = parseCli(["--gate-timeout", "60", "test"]);
    expect(cli.gateTimeout).toBe(60);
  });

  test("--gate-timeout 0 means skip gates", () => {
    const cli = parseCli(["--gate-timeout", "0", "test"]);
    expect(cli.gateTimeout).toBe(0);
  });

  test("editor and gateTimeout default to undefined", () => {
    const cli = parseCli(["test"]);
    expect(cli.editor).toBeUndefined();
    expect(cli.gateTimeout).toBeUndefined();
  });

  // Phase B CLI tests
  test("parses --dry-run flag", () => {
    const cli = parseCli(["--dry-run", "test"]);
    expect(cli.dryRun).toBe(true);
  });

  test("--dry-run defaults to false", () => {
    const cli = parseCli(["test"]);
    expect(cli.dryRun).toBe(false);
  });

  test("parses --context flag (single)", () => {
    const cli = parseCli(["--context", "api-spec.yaml", "test"]);
    expect(cli.context).toEqual(["api-spec.yaml"]);
  });

  test("parses --context flag (multiple)", () => {
    const cli = parseCli(["--context", "api-spec.yaml", "--context", "db-schema.sql", "test"]);
    expect(cli.context).toEqual(["api-spec.yaml", "db-schema.sql"]);
  });

  test("context defaults to undefined", () => {
    const cli = parseCli(["test"]);
    expect(cli.context).toBeUndefined();
  });

  test("parses per-agent model flags", () => {
    const cli = parseCli(["--model-planner", "claude-sonnet-4-6", "--model-generator", "claude-opus-4-6", "--model-evaluator", "claude-haiku-4-5-20251001", "test"]);
    expect(cli.modelPlanner).toBe("claude-sonnet-4-6");
    expect(cli.modelGenerator).toBe("claude-opus-4-6");
    expect(cli.modelEvaluator).toBe("claude-haiku-4-5-20251001");
  });

  test("per-agent model flags default to undefined", () => {
    const cli = parseCli(["test"]);
    expect(cli.modelPlanner).toBeUndefined();
    expect(cli.modelGenerator).toBeUndefined();
    expect(cli.modelEvaluator).toBeUndefined();
  });

  // Phase C CLI tests
  test("parses --branch flag", () => {
    const cli = parseCli(["--branch", "feature/foo", "test"]);
    expect(cli.branch).toBe("feature/foo");
  });

  test("--branch defaults to undefined", () => {
    const cli = parseCli(["test"]);
    expect(cli.branch).toBeUndefined();
  });
});

// --- loadHarnessEnv ---

describe("loadHarnessEnv", () => {
  const tmpDir = join(import.meta.dir, "__env_test_tmp");
  const harnessDir = join(tmpDir, ".adhd");
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
    expect(() => resolveConfig({ greenfield: false, resume: false, verbose: false, quiet: false, noInteractive: false, debug: false, dryRun: false })).toThrow("A prompt is required");
  });

  test("allows missing prompt when resuming", () => {
    const config = resolveConfig({ resume: true, greenfield: false, verbose: false, quiet: false, noInteractive: false, debug: false, dryRun: false });
    expect(config.isResume).toBe(true);
    expect(config.userPrompt).toBe("");
  });

  test("resolves log level from flags", () => {
    const verbose = resolveConfig({ prompt: "test", greenfield: false, resume: false, verbose: true, quiet: false, noInteractive: false, debug: false, dryRun: false });
    expect(verbose.logLevel).toBe("verbose");

    const quiet = resolveConfig({ prompt: "test", greenfield: false, resume: false, verbose: false, quiet: true, noInteractive: false, debug: false, dryRun: false });
    expect(quiet.logLevel).toBe("quiet");

    const debug = resolveConfig({ prompt: "test", greenfield: false, resume: false, verbose: false, quiet: false, noInteractive: false, debug: true, dryRun: false });
    expect(debug.logLevel).toBe("debug");
  });

  const baseCli = { prompt: "test", greenfield: false, resume: false, verbose: false, quiet: false, noInteractive: false, debug: false, dryRun: false };

  test("resolves editor from CLI flag", () => {
    const config = resolveConfig({ ...baseCli, editor: "code --wait" });
    expect(config.editor).toBe("code --wait");
  });

  test("resolves editor from ADHD_EDITOR env var", () => {
    const prev = process.env.ADHD_EDITOR;
    process.env.ADHD_EDITOR = "nano";
    try {
      const config = resolveConfig({ ...baseCli });
      expect(config.editor).toBe("nano");
    } finally {
      if (prev === undefined) delete process.env.ADHD_EDITOR;
      else process.env.ADHD_EDITOR = prev;
    }
  });

  test("CLI editor takes precedence over env var", () => {
    const prev = process.env.ADHD_EDITOR;
    process.env.ADHD_EDITOR = "nano";
    try {
      const config = resolveConfig({ ...baseCli, editor: "vim" });
      expect(config.editor).toBe("vim");
    } finally {
      if (prev === undefined) delete process.env.ADHD_EDITOR;
      else process.env.ADHD_EDITOR = prev;
    }
  });

  test("resolves gateTimeout from CLI flag", () => {
    const config = resolveConfig({ ...baseCli, gateTimeout: 0 });
    expect(config.gateTimeout).toBe(0);
  });

  test("resolves gateTimeout from env var", () => {
    const prev = process.env.ADHD_GATE_TIMEOUT;
    process.env.ADHD_GATE_TIMEOUT = "60";
    try {
      const config = resolveConfig({ ...baseCli });
      expect(config.gateTimeout).toBe(60);
    } finally {
      if (prev === undefined) delete process.env.ADHD_GATE_TIMEOUT;
      else process.env.ADHD_GATE_TIMEOUT = prev;
    }
  });

  test("editor and gateTimeout default to undefined", () => {
    const prevEditor = process.env.ADHD_EDITOR;
    const prevTimeout = process.env.ADHD_GATE_TIMEOUT;
    const prevSysEditor = process.env.EDITOR;
    delete process.env.ADHD_EDITOR;
    delete process.env.ADHD_GATE_TIMEOUT;
    delete process.env.EDITOR;
    try {
      const config = resolveConfig({ ...baseCli });
      expect(config.editor).toBeUndefined();
      expect(config.gateTimeout).toBeUndefined();
    } finally {
      if (prevEditor !== undefined) process.env.ADHD_EDITOR = prevEditor;
      if (prevTimeout !== undefined) process.env.ADHD_GATE_TIMEOUT = prevTimeout;
      if (prevSysEditor !== undefined) process.env.EDITOR = prevSysEditor;
    }
  });

  // Phase B resolveConfig tests
  test("resolves isDryRun from CLI flag", () => {
    const config = resolveConfig({ ...baseCli, dryRun: true });
    expect(config.isDryRun).toBe(true);
  });

  test("isDryRun defaults to false", () => {
    const config = resolveConfig({ ...baseCli });
    expect(config.isDryRun).toBe(false);
  });

  test("resolves contextFiles from CLI", () => {
    const config = resolveConfig({ ...baseCli, context: ["api.yaml", "schema.sql"] });
    expect(config.contextFiles).toEqual(["api.yaml", "schema.sql"]);
  });

  test("resolves per-agent models from CLI flags", () => {
    const config = resolveConfig({ ...baseCli, modelPlanner: "claude-sonnet-4-6", modelGenerator: "claude-opus-4-6" });
    expect(config.modelPlanner).toBe("claude-sonnet-4-6");
    expect(config.modelGenerator).toBe("claude-opus-4-6");
    expect(config.modelEvaluator).toBeUndefined();
  });

  test("resolves per-agent models from env vars", () => {
    const prev = process.env.MODEL_PLANNER;
    process.env.MODEL_PLANNER = "claude-haiku-4-5-20251001";
    try {
      const config = resolveConfig({ ...baseCli });
      expect(config.modelPlanner).toBe("claude-haiku-4-5-20251001");
    } finally {
      if (prev === undefined) delete process.env.MODEL_PLANNER;
      else process.env.MODEL_PLANNER = prev;
    }
  });

  test("CLI per-agent model takes precedence over env var", () => {
    const prev = process.env.MODEL_GENERATOR;
    process.env.MODEL_GENERATOR = "claude-haiku-4-5-20251001";
    try {
      const config = resolveConfig({ ...baseCli, modelGenerator: "claude-opus-4-6" });
      expect(config.modelGenerator).toBe("claude-opus-4-6");
    } finally {
      if (prev === undefined) delete process.env.MODEL_GENERATOR;
      else process.env.MODEL_GENERATOR = prev;
    }
  });

  // Phase C resolveConfig tests
  test("resolves branch from CLI flag", () => {
    const config = resolveConfig({ ...baseCli, branch: "feature/my-branch" });
    expect(config.branch).toBe("feature/my-branch");
  });

  test("branch defaults to undefined", () => {
    const config = resolveConfig({ ...baseCli });
    expect(config.branch).toBeUndefined();
  });
});
