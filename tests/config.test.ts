import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { CLI_FLAG_HELP, loadHarnessEnv, parseCli, resolveConfig, validateConfig } from "../shared/config.ts";
import {
  DEFAULT_MODEL_DOCUMENTER,
  DEFAULT_MODEL_EVALUATOR,
  DEFAULT_MODEL_GENERATOR,
  DEFAULT_MODEL_PLANNER,
} from "../shared/models.ts";
import type { HarnessConfig } from "../shared/types.ts";

// --- validateConfig ---

describe("validateConfig", () => {
  const base: HarnessConfig = {
    userPrompt: "test",
    workDir: "/tmp",
    maxSprints: 5,
    maxRetriesPerSprint: 3,
    passThreshold: 7,
    maxFeatures: 3,
    maxCriteria: 10,
    maxSurfaces: 2,
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

  // F4: contract size ceiling validation
  test("rejects maxFeatures below 1", () => {
    expect(() => validateConfig({ ...base, maxFeatures: 0 })).toThrow("Invalid max-features");
  });

  test("rejects negative maxFeatures", () => {
    expect(() => validateConfig({ ...base, maxFeatures: -2 })).toThrow("Invalid max-features");
  });

  test("rejects non-integer maxFeatures", () => {
    expect(() => validateConfig({ ...base, maxFeatures: 2.5 })).toThrow("Invalid max-features");
  });

  test("rejects NaN maxCriteria (non-numeric flag value)", () => {
    expect(() => validateConfig({ ...base, maxCriteria: NaN })).toThrow("Invalid max-criteria");
  });

  test("rejects maxCriteria below 1", () => {
    expect(() => validateConfig({ ...base, maxCriteria: 0 })).toThrow("Invalid max-criteria");
  });

  test("rejects maxSurfaces below 1", () => {
    expect(() => validateConfig({ ...base, maxSurfaces: 0 })).toThrow("Invalid max-surfaces");
  });

  test("accepts boundary limit values", () => {
    expect(() => validateConfig({ ...base, maxFeatures: 1, maxCriteria: 1, maxSurfaces: 1 })).not.toThrow();
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

  test("parses contract size limit flags", () => {
    const cli = parseCli(["--max-features", "2", "--max-criteria", "5", "--max-surfaces", "1", "test"]);
    expect(cli.maxFeatures).toBe(2);
    expect(cli.maxCriteria).toBe(5);
    expect(cli.maxSurfaces).toBe(1);
  });

  test("contract size limit flags default to undefined", () => {
    const cli = parseCli(["test"]);
    expect(cli.maxFeatures).toBeUndefined();
    expect(cli.maxCriteria).toBeUndefined();
    expect(cli.maxSurfaces).toBeUndefined();
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

  // WP1: BDD/TDD flags
  test("parses --no-bdd flag", () => {
    const cli = parseCli(["--no-bdd", "test"]);
    expect(cli.noBdd).toBe(true);
  });

  test("parses --no-tdd flag", () => {
    const cli = parseCli(["--no-tdd", "test"]);
    expect(cli.noTdd).toBe(true);
  });

  test("--no-bdd and --no-tdd default to false", () => {
    const cli = parseCli(["test"]);
    expect(cli.noBdd).toBe(false);
    expect(cli.noTdd).toBe(false);
  });

  // WP2: directory convention flags
  test("parses --source-dir and --test-dir flags", () => {
    const cli = parseCli(["--source-dir", "lib", "--test-dir", "spec", "test"]);
    expect(cli.sourceDir).toBe("lib");
    expect(cli.testDir).toBe("spec");
  });

  test("--source-dir and --test-dir default to undefined", () => {
    const cli = parseCli(["test"]);
    expect(cli.sourceDir).toBeUndefined();
    expect(cli.testDir).toBeUndefined();
  });

  // OPP-13-A: --no-docs and --model-documenter
  test("parses --no-docs flag", () => {
    const cli = parseCli(["--no-docs", "test"]);
    expect(cli.noDocs).toBe(true);
  });

  test("--no-docs defaults to false", () => {
    const cli = parseCli(["test"]);
    expect(cli.noDocs).toBe(false);
  });

  test("parses --model-documenter flag", () => {
    const cli = parseCli(["--model-documenter", "claude-sonnet-4-20250514", "test"]);
    expect(cli.modelDocumenter).toBe("claude-sonnet-4-20250514");
  });

  test("--model-documenter defaults to undefined", () => {
    const cli = parseCli(["test"]);
    expect(cli.modelDocumenter).toBeUndefined();
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
    expect(() => resolveConfig({ greenfield: false, resume: false, verbose: false, quiet: false, noInteractive: false, debug: false, dryRun: false, noBdd: false, noTdd: false, noDocs: false })).toThrow("A prompt is required");
  });

  test("allows missing prompt when resuming", () => {
    const config = resolveConfig({ resume: true, greenfield: false, verbose: false, quiet: false, noInteractive: false, debug: false, dryRun: false, noBdd: false, noTdd: false, noDocs: false });
    expect(config.isResume).toBe(true);
    expect(config.userPrompt).toBe("");
  });

  test("resolves log level from flags", () => {
    const verbose = resolveConfig({ prompt: "test", greenfield: false, resume: false, verbose: true, quiet: false, noInteractive: false, debug: false, dryRun: false, noBdd: false, noTdd: false, noDocs: false });
    expect(verbose.logLevel).toBe("verbose");

    const quiet = resolveConfig({ prompt: "test", greenfield: false, resume: false, verbose: false, quiet: true, noInteractive: false, debug: false, dryRun: false, noBdd: false, noTdd: false, noDocs: false });
    expect(quiet.logLevel).toBe("quiet");

    const debug = resolveConfig({ prompt: "test", greenfield: false, resume: false, verbose: false, quiet: false, noInteractive: false, debug: true, dryRun: false, noBdd: false, noTdd: false, noDocs: false });
    expect(debug.logLevel).toBe("debug");
  });

  const baseCli = { prompt: "test", greenfield: false, resume: false, verbose: false, quiet: false, noInteractive: false, debug: false, dryRun: false, noBdd: false, noTdd: false, noDocs: false };

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

  // WP1: BDD/TDD config resolution
  test("resolves noBdd and noTdd from CLI flags", () => {
    const config = resolveConfig({ ...baseCli, noBdd: true, noTdd: true });
    expect(config.noBdd).toBe(true);
    expect(config.noTdd).toBe(true);
  });

  test("noBdd and noTdd default to false", () => {
    const config = resolveConfig({ ...baseCli });
    expect(config.noBdd).toBe(false);
    expect(config.noTdd).toBe(false);
  });

  // WP2: directory convention config resolution
  test("resolves sourceDir and testDir from CLI flags", () => {
    const config = resolveConfig({ ...baseCli, sourceDir: "lib", testDir: "spec" });
    expect(config.sourceDir).toBe("lib");
    expect(config.testDir).toBe("spec");
  });

  test("sourceDir and testDir default to 'src' and 'tests'", () => {
    const prevSrc = process.env.SOURCE_DIR;
    const prevTest = process.env.TEST_DIR;
    delete process.env.SOURCE_DIR;
    delete process.env.TEST_DIR;
    try {
      const config = resolveConfig({ ...baseCli });
      expect(config.sourceDir).toBe("src");
      expect(config.testDir).toBe("tests");
    } finally {
      if (prevSrc !== undefined) process.env.SOURCE_DIR = prevSrc;
      if (prevTest !== undefined) process.env.TEST_DIR = prevTest;
    }
  });

  test("resolves sourceDir and testDir from env vars", () => {
    const prevSrc = process.env.SOURCE_DIR;
    const prevTest = process.env.TEST_DIR;
    process.env.SOURCE_DIR = "app";
    process.env.TEST_DIR = "test";
    try {
      const config = resolveConfig({ ...baseCli });
      expect(config.sourceDir).toBe("app");
      expect(config.testDir).toBe("test");
    } finally {
      if (prevSrc === undefined) delete process.env.SOURCE_DIR;
      else process.env.SOURCE_DIR = prevSrc;
      if (prevTest === undefined) delete process.env.TEST_DIR;
      else process.env.TEST_DIR = prevTest;
    }
  });

  test("CLI sourceDir/testDir takes precedence over env vars", () => {
    const prevSrc = process.env.SOURCE_DIR;
    process.env.SOURCE_DIR = "env-src";
    try {
      const config = resolveConfig({ ...baseCli, sourceDir: "cli-src" });
      expect(config.sourceDir).toBe("cli-src");
    } finally {
      if (prevSrc === undefined) delete process.env.SOURCE_DIR;
      else process.env.SOURCE_DIR = prevSrc;
    }
  });

  // OPP-13-A: noDocs config resolution
  test("noDocs defaults to false", () => {
    const prev = process.env.ADHD_NO_DOCS;
    delete process.env.ADHD_NO_DOCS;
    try {
      const config = resolveConfig({ ...baseCli, noDocs: false });
      expect(config.noDocs).toBe(false);
    } finally {
      if (prev !== undefined) process.env.ADHD_NO_DOCS = prev;
    }
  });

  test("noDocs from --no-docs CLI flag", () => {
    const config = resolveConfig({ ...baseCli, noDocs: true });
    expect(config.noDocs).toBe(true);
  });

  test("noDocs from ADHD_NO_DOCS env var", () => {
    const prev = process.env.ADHD_NO_DOCS;
    process.env.ADHD_NO_DOCS = "1";
    try {
      const config = resolveConfig({ ...baseCli, noDocs: false });
      expect(config.noDocs).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.ADHD_NO_DOCS;
      else process.env.ADHD_NO_DOCS = prev;
    }
  });

  test("noDocs from ADHD_NO_DOCS=true env var", () => {
    const prev = process.env.ADHD_NO_DOCS;
    process.env.ADHD_NO_DOCS = "true";
    try {
      const config = resolveConfig({ ...baseCli, noDocs: false });
      expect(config.noDocs).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.ADHD_NO_DOCS;
      else process.env.ADHD_NO_DOCS = prev;
    }
  });

  test("--no-docs CLI flag takes precedence over env var", () => {
    const prev = process.env.ADHD_NO_DOCS;
    process.env.ADHD_NO_DOCS = "0";
    try {
      const config = resolveConfig({ ...baseCli, noDocs: true });
      expect(config.noDocs).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.ADHD_NO_DOCS;
      else process.env.ADHD_NO_DOCS = prev;
    }
  });

  // OPP-13-A: modelDocumenter config resolution
  test("modelDocumenter from --model-documenter CLI flag", () => {
    const config = resolveConfig({ ...baseCli, modelDocumenter: "claude-sonnet-4-20250514" });
    expect(config.modelDocumenter).toBe("claude-sonnet-4-20250514");
  });

  test("modelDocumenter defaults to undefined", () => {
    const prev = process.env.MODEL_DOCUMENTER;
    delete process.env.MODEL_DOCUMENTER;
    try {
      const config = resolveConfig({ ...baseCli });
      expect(config.modelDocumenter).toBeUndefined();
    } finally {
      if (prev !== undefined) process.env.MODEL_DOCUMENTER = prev;
    }
  });

  test("modelDocumenter from MODEL_DOCUMENTER env var", () => {
    const prev = process.env.MODEL_DOCUMENTER;
    process.env.MODEL_DOCUMENTER = "claude-haiku-4-5-20251001";
    try {
      const config = resolveConfig({ ...baseCli });
      expect(config.modelDocumenter).toBe("claude-haiku-4-5-20251001");
    } finally {
      if (prev === undefined) delete process.env.MODEL_DOCUMENTER;
      else process.env.MODEL_DOCUMENTER = prev;
    }
  });

  test("CLI --model-documenter takes precedence over MODEL_DOCUMENTER env var", () => {
    const prev = process.env.MODEL_DOCUMENTER;
    process.env.MODEL_DOCUMENTER = "claude-haiku-4-5-20251001";
    try {
      const config = resolveConfig({ ...baseCli, modelDocumenter: "claude-opus-4-6" });
      expect(config.modelDocumenter).toBe("claude-opus-4-6");
    } finally {
      if (prev === undefined) delete process.env.MODEL_DOCUMENTER;
      else process.env.MODEL_DOCUMENTER = prev;
    }
  });

  // F4: contract size ceiling resolution
  function withoutLimitEnv<T>(fn: () => T): T {
    const prev = {
      f: process.env.MAX_FEATURES,
      c: process.env.MAX_CRITERIA,
      s: process.env.MAX_SURFACES,
    };
    delete process.env.MAX_FEATURES;
    delete process.env.MAX_CRITERIA;
    delete process.env.MAX_SURFACES;
    try {
      return fn();
    } finally {
      if (prev.f !== undefined) process.env.MAX_FEATURES = prev.f;
      if (prev.c !== undefined) process.env.MAX_CRITERIA = prev.c;
      if (prev.s !== undefined) process.env.MAX_SURFACES = prev.s;
    }
  }

  test("contract size limits default to 3 / 10 / 2", () => {
    withoutLimitEnv(() => {
      const config = resolveConfig({ ...baseCli });
      expect(config.maxFeatures).toBe(3);
      expect(config.maxCriteria).toBe(10);
      expect(config.maxSurfaces).toBe(2);
    });
  });

  test("contract size limits resolve from CLI flags as integers", () => {
    withoutLimitEnv(() => {
      const config = resolveConfig({ ...baseCli, maxFeatures: 2, maxCriteria: 5, maxSurfaces: 1 });
      expect(config.maxFeatures).toBe(2);
      expect(config.maxCriteria).toBe(5);
      expect(config.maxSurfaces).toBe(1);
    });
  });

  test("contract size limits resolve from env vars", () => {
    withoutLimitEnv(() => {
      process.env.MAX_FEATURES = "4";
      process.env.MAX_CRITERIA = "8";
      process.env.MAX_SURFACES = "3";
      const config = resolveConfig({ ...baseCli });
      expect(config.maxFeatures).toBe(4);
      expect(config.maxCriteria).toBe(8);
      expect(config.maxSurfaces).toBe(3);
    });
  });

  test("CLI contract size limit flag takes precedence over env var", () => {
    withoutLimitEnv(() => {
      process.env.MAX_FEATURES = "9";
      const config = resolveConfig({ ...baseCli, maxFeatures: 2 });
      expect(config.maxFeatures).toBe(2);
    });
  });

  test("rejects invalid contract size limit during resolveConfig", () => {
    withoutLimitEnv(() => {
      expect(() => resolveConfig({ ...baseCli, maxCriteria: 0 })).toThrow("Invalid max-criteria");
    });
  });
});

// --- F6: per-agent model defaults, precedence, and --model-contract ---

describe("F6 per-agent model resolution", () => {
  const baseCliF6 = {
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
  };

  /** Run fn with every model-related env var cleared, then restore. */
  function withoutModelEnv<T>(fn: () => T): T {
    const keys = ["CLAUDE_MODEL", "MODEL_PLANNER", "MODEL_GENERATOR", "MODEL_EVALUATOR", "MODEL_DOCUMENTER", "MODEL_CONTRACT"];
    const prev: Record<string, string | undefined> = {};
    for (const k of keys) {
      prev[k] = process.env[k];
      delete process.env[k];
    }
    try {
      return fn();
    } finally {
      for (const k of keys) {
        if (prev[k] === undefined) delete process.env[k];
        else process.env[k] = prev[k];
      }
    }
  }

  test("no flags → recommended matrix (Opus/Sonnet/Opus/Haiku)", () => {
    withoutModelEnv(() => {
      const config = resolveConfig({ ...baseCliF6 });
      expect(config.resolvedModelPlanner).toBe(DEFAULT_MODEL_PLANNER);
      expect(config.resolvedModelGenerator).toBe(DEFAULT_MODEL_GENERATOR);
      expect(config.resolvedModelEvaluator).toBe(DEFAULT_MODEL_EVALUATOR);
      expect(config.resolvedModelDocumenter).toBe(DEFAULT_MODEL_DOCUMENTER);
      // Each resolved field must be a concrete, non-empty string
      for (const m of [
        config.resolvedModelPlanner,
        config.resolvedModelGenerator,
        config.resolvedModelEvaluator,
        config.resolvedModelDocumenter,
      ]) {
        expect(typeof m).toBe("string");
        expect(m.length).toBeGreaterThan(0);
      }
    });
  });

  test("explicit uniform --model applies to all four agents (matrix not applied)", () => {
    withoutModelEnv(() => {
      const config = resolveConfig({ ...baseCliF6, model: "my-uniform-model" });
      expect(config.resolvedModelPlanner).toBe("my-uniform-model");
      expect(config.resolvedModelGenerator).toBe("my-uniform-model");
      expect(config.resolvedModelEvaluator).toBe("my-uniform-model");
      expect(config.resolvedModelDocumenter).toBe("my-uniform-model");
    });
  });

  test("per-agent override wins over the matrix default", () => {
    withoutModelEnv(() => {
      const config = resolveConfig({ ...baseCliF6, modelGenerator: "override-gen" });
      expect(config.resolvedModelGenerator).toBe("override-gen");
      // The others still follow the matrix
      expect(config.resolvedModelPlanner).toBe(DEFAULT_MODEL_PLANNER);
    });
  });

  test("per-agent override wins over an explicit uniform --model", () => {
    withoutModelEnv(() => {
      const config = resolveConfig({ ...baseCliF6, model: "uniform", modelEvaluator: "override-eval" });
      expect(config.resolvedModelEvaluator).toBe("override-eval");
      expect(config.resolvedModelGenerator).toBe("uniform");
    });
  });

  test("graceful degradation: blank --model falls back to the matrix, never empty", () => {
    withoutModelEnv(() => {
      const config = resolveConfig({ ...baseCliF6, model: "   " });
      expect(config.resolvedModelPlanner).toBe(DEFAULT_MODEL_PLANNER);
      expect(config.resolvedModelGenerator).toBe(DEFAULT_MODEL_GENERATOR);
    });
  });

  test("graceful degradation: blank per-agent override falls back, never empty", () => {
    withoutModelEnv(() => {
      const config = resolveConfig({ ...baseCliF6, modelGenerator: "  " });
      expect(config.resolvedModelGenerator).toBe(DEFAULT_MODEL_GENERATOR);
    });
  });

  test("unknown per-agent override is passed through unchanged (no throw)", () => {
    withoutModelEnv(() => {
      const config = resolveConfig({ ...baseCliF6, modelDocumenter: "some-future-model-id" });
      expect(config.resolvedModelDocumenter).toBe("some-future-model-id");
    });
  });

  test("parses --model-contract flag; defaults to undefined", () => {
    expect(parseCli(["--model-contract", "contract-model", "test"]).modelContract).toBe("contract-model");
    expect(parseCli(["test"]).modelContract).toBeUndefined();
  });

  test("resolves modelContract from CLI flag and MODEL_CONTRACT env var", () => {
    withoutModelEnv(() => {
      expect(resolveConfig({ ...baseCliF6, modelContract: "cli-contract" }).modelContract).toBe("cli-contract");
      process.env.MODEL_CONTRACT = "env-contract";
      expect(resolveConfig({ ...baseCliF6 }).modelContract).toBe("env-contract");
    });
  });

  test("modelContract defaults to undefined when unset", () => {
    withoutModelEnv(() => {
      expect(resolveConfig({ ...baseCliF6 }).modelContract).toBeUndefined();
    });
  });
});

// --- printHelp / CLI_FLAG_HELP ---

describe("CLI_FLAG_HELP contract size limits", () => {
  test("documents all three new flags with descriptions and defaults", () => {
    expect(CLI_FLAG_HELP["--max-features"]).toContain("default: 3");
    expect(CLI_FLAG_HELP["--max-criteria"]).toContain("default: 10");
    expect(CLI_FLAG_HELP["--max-surfaces"]).toContain("default: 2");
  });
});

describe("CLI_FLAG_HELP model documentation (F6)", () => {
  test("--model help no longer cites the stale claude-opus-4-6 default ID", () => {
    expect(CLI_FLAG_HELP["--model"]).not.toContain("claude-opus-4-6");
  });

  test("documents --model-contract including its MODEL_CONTRACT env var", () => {
    expect(CLI_FLAG_HELP["--model-contract"]).toBeDefined();
    expect(CLI_FLAG_HELP["--model-contract"]).toContain("MODEL_CONTRACT");
  });

  test("per-agent flag help names the recommended default tiers", () => {
    expect(CLI_FLAG_HELP["--model-generator"]).toContain("Sonnet");
    expect(CLI_FLAG_HELP["--model-evaluator"]).toContain("Opus");
    expect(CLI_FLAG_HELP["--model-documenter"]).toContain("Haiku");
  });
});

// --- Phase 1 Deepen flags (consolidated from shared/config.test.ts) ---

const baseCli1d = {
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
};

describe("parseCli Phase 1 Deepen flags", () => {
  test("parses --lint-gate flag", () => {
    const cli = parseCli(["--lint-gate", "test"]);
    expect(cli.lintGate).toBe(true);
  });

  test("--lint-gate defaults to false", () => {
    const cli = parseCli(["test"]);
    expect(cli.lintGate).toBe(false);
  });

  test("parses --sprint N flag", () => {
    const cli = parseCli(["--sprint", "3"]);
    expect(cli.sprint).toBe(3);
  });

  test("--sprint defaults to undefined", () => {
    const cli = parseCli(["test"]);
    expect(cli.sprint).toBeUndefined();
  });

  test("parses --refine-spec flag", () => {
    const cli = parseCli(["--refine-spec", "test"]);
    expect(cli.refineSpec).toBe(true);
  });

  test("--refine-spec defaults to false", () => {
    const cli = parseCli(["test"]);
    expect(cli.refineSpec).toBe(false);
  });

  test("parses --no-bdd flag", () => {
    const cli = parseCli(["--no-bdd", "test"]);
    expect(cli.noBdd).toBe(true);
  });

  test("--no-bdd defaults to false", () => {
    const cli = parseCli(["test"]);
    expect(cli.noBdd).toBe(false);
  });
});

describe("resolveConfig --sprint and --resume mutual exclusion", () => {
  test("throws exact error message when both --sprint and --resume are set", () => {
    expect(() => resolveConfig({ ...baseCli1d, sprint: 3, resume: true })).toThrow(
      "Cannot use --sprint and --resume together.",
    );
  });

  test("--sprint alone works", () => {
    const config = resolveConfig({ ...baseCli1d, sprint: 3 });
    expect(config.sprint).toBe(3);
  });

  test("--resume alone works", () => {
    const config = resolveConfig({ ...baseCli1d, resume: true });
    expect(config.isResume).toBe(true);
  });
});

describe("resolveConfig --sprint validation", () => {
  test("--sprint without prompt works (sprint mode doesn't require prompt)", () => {
    const config = resolveConfig({ ...baseCli1d, sprint: 1 });
    expect(config.sprint).toBe(1);
    expect(config.userPrompt).toBe("");
  });

  test("rejects --sprint 0 as invalid", () => {
    expect(() => resolveConfig({ ...baseCli1d, sprint: 0 })).toThrow("Invalid --sprint value");
  });

  test("rejects --sprint -1 as invalid", () => {
    expect(() => resolveConfig({ ...baseCli1d, sprint: -1 })).toThrow("Invalid --sprint value");
  });

  test("rejects non-integer sprint (NaN)", () => {
    expect(() => resolveConfig({ ...baseCli1d, sprint: NaN })).toThrow("Invalid --sprint value");
  });

  test("accepts --sprint 1 (minimum valid)", () => {
    const config = resolveConfig({ ...baseCli1d, sprint: 1 });
    expect(config.sprint).toBe(1);
  });
});

describe("resolveConfig Phase 1 Deepen flags resolution", () => {
  test("resolves lintGate from CLI", () => {
    const config = resolveConfig({ ...baseCli1d, prompt: "test", lintGate: true });
    expect(config.lintGate).toBe(true);
  });

  test("lintGate defaults to false", () => {
    const config = resolveConfig({ ...baseCli1d, prompt: "test" });
    expect(config.lintGate).toBe(false);
  });

  test("resolves noBdd from CLI", () => {
    const config = resolveConfig({ ...baseCli1d, prompt: "test", noBdd: true });
    expect(config.noBdd).toBe(true);
  });

  test("resolves refineSpec from CLI", () => {
    const config = resolveConfig({ ...baseCli1d, prompt: "test", refineSpec: true });
    expect(config.refineSpec).toBe(true);
  });
});
