/**
 * Tests for F1 — Reject malformed numeric flags and environment variables.
 *
 * These tests are written BEFORE the fix and should fail against the current
 * code (where NaN evades the bare range checks), then pass after the fix lands.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resolveConfig, validateConfig } from "../shared/config.ts";
import type { HarnessConfig } from "../shared/types.ts";

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

// ---------------------------------------------------------------------------
// validateConfig — NaN backstop (these currently pass NaN through silently)
// ---------------------------------------------------------------------------

describe("validateConfig — NaN backstop for previously unguarded fields", () => {
  test("rejects NaN passThreshold", () => {
    expect(() => validateConfig({ ...base, passThreshold: NaN })).toThrow(/threshold/i);
  });

  test("rejects NaN maxSprints", () => {
    expect(() => validateConfig({ ...base, maxSprints: NaN })).toThrow(/max-sprints/i);
  });

  test("rejects NaN maxRetriesPerSprint", () => {
    expect(() => validateConfig({ ...base, maxRetriesPerSprint: NaN })).toThrow(/max-retries/i);
  });

  test("rejects non-integer passThreshold (1.5)", () => {
    expect(() => validateConfig({ ...base, passThreshold: 1.5 })).toThrow(/threshold/i);
  });

  test("rejects non-integer maxSprints (2.9)", () => {
    expect(() => validateConfig({ ...base, maxSprints: 2.9 })).toThrow(/max-sprints/i);
  });

  test("rejects non-integer maxRetriesPerSprint (0.5)", () => {
    expect(() => validateConfig({ ...base, maxRetriesPerSprint: 0.5 })).toThrow(/max-retries/i);
  });

  // Legitimate boundary values must still be accepted
  test("accepts zero maxRetriesPerSprint (zero retry count is valid)", () => {
    expect(() => validateConfig({ ...base, maxRetriesPerSprint: 0 })).not.toThrow();
  });

  test("accepts passThreshold = 1 (minimum valid)", () => {
    expect(() => validateConfig({ ...base, passThreshold: 1 })).not.toThrow();
  });

  test("accepts passThreshold = 10 (maximum valid)", () => {
    expect(() => validateConfig({ ...base, passThreshold: 10 })).not.toThrow();
  });

  test("accepts maxSprints = 1 (minimum valid)", () => {
    expect(() => validateConfig({ ...base, maxSprints: 1 })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// resolveConfig — parse boundary: CLI NaN values must throw named errors
// ---------------------------------------------------------------------------

const baseCli = {
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

describe("resolveConfig — NaN CLI values throw named errors at parse boundary", () => {
  test("rejects NaN threshold (from --threshold abc)", () => {
    // parseCli("--threshold", "abc") produces threshold: NaN
    expect(() => resolveConfig({ ...baseCli, threshold: NaN })).toThrow(/threshold/i);
  });

  test("rejects NaN maxSprints (from --max-sprints abc)", () => {
    expect(() => resolveConfig({ ...baseCli, maxSprints: NaN })).toThrow(/max-sprints/i);
  });

  test("rejects NaN maxRetries (from --max-retries abc)", () => {
    expect(() => resolveConfig({ ...baseCli, maxRetries: NaN })).toThrow(/max-retries/i);
  });

  // Error messages must name the specific flag so the developer can find the issue
  test("threshold error message names the --threshold flag or PASS_THRESHOLD env var", () => {
    let message = "";
    try {
      resolveConfig({ ...baseCli, threshold: NaN });
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    // Message should mention "threshold" or "--threshold" or "PASS_THRESHOLD"
    expect(message.toLowerCase()).toMatch(/threshold/);
  });

  test("max-sprints error message names the --max-sprints flag or MAX_SPRINTS env var", () => {
    let message = "";
    try {
      resolveConfig({ ...baseCli, maxSprints: NaN });
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message.toLowerCase()).toMatch(/max.sprints|max_sprints/);
  });
});

// ---------------------------------------------------------------------------
// resolveConfig — parse boundary: non-numeric env vars must throw named errors
// ---------------------------------------------------------------------------

describe("resolveConfig — non-numeric environment variables throw named errors", () => {
  // Save and restore all modified env vars
  let savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedEnv = {
      PASS_THRESHOLD: process.env.PASS_THRESHOLD,
      MAX_SPRINTS: process.env.MAX_SPRINTS,
      MAX_RETRIES: process.env.MAX_RETRIES,
    };
  });

  afterEach(() => {
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
  });

  test("rejects non-numeric PASS_THRESHOLD env var", () => {
    process.env.PASS_THRESHOLD = "abc";
    expect(() => resolveConfig({ ...baseCli })).toThrow(/threshold/i);
  });

  test("error for PASS_THRESHOLD names the variable", () => {
    process.env.PASS_THRESHOLD = "notanumber";
    let message = "";
    try {
      resolveConfig({ ...baseCli });
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toMatch(/PASS_THRESHOLD|threshold/i);
  });

  test("rejects non-numeric MAX_SPRINTS env var", () => {
    process.env.MAX_SPRINTS = "bad";
    expect(() => resolveConfig({ ...baseCli })).toThrow(/max.sprints|max_sprints/i);
  });

  test("error for MAX_SPRINTS names the variable", () => {
    process.env.MAX_SPRINTS = "bad";
    let message = "";
    try {
      resolveConfig({ ...baseCli });
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toMatch(/MAX_SPRINTS|max-sprints/i);
  });

  test("rejects non-numeric MAX_RETRIES env var", () => {
    process.env.MAX_RETRIES = "??";
    expect(() => resolveConfig({ ...baseCli })).toThrow(/max.retries|max_retries/i);
  });

  test("error for MAX_RETRIES names the variable", () => {
    process.env.MAX_RETRIES = "??";
    let message = "";
    try {
      resolveConfig({ ...baseCli });
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toMatch(/MAX_RETRIES|max-retries/i);
  });

  // Legitimate values from env vars must still work
  test("accepts valid numeric MAX_SPRINTS env var", () => {
    process.env.MAX_SPRINTS = "8";
    expect(() => resolveConfig({ ...baseCli })).not.toThrow();
  });

  test("accepts MAX_RETRIES=0 env var (zero retries is valid)", () => {
    process.env.MAX_RETRIES = "0";
    expect(() => resolveConfig({ ...baseCli })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Legitimate zero and boundary values must pass through unchanged
// ---------------------------------------------------------------------------

describe("resolveConfig — legitimate boundary values are accepted", () => {
  let savedGateTimeout: string | undefined;

  beforeEach(() => {
    savedGateTimeout = process.env.ADHD_GATE_TIMEOUT;
  });

  afterEach(() => {
    if (savedGateTimeout === undefined) delete process.env.ADHD_GATE_TIMEOUT;
    else process.env.ADHD_GATE_TIMEOUT = savedGateTimeout;
  });

  test("maxRetries = 0 is accepted (zero retry count is meaningful)", () => {
    const config = resolveConfig({ ...baseCli, maxRetries: 0 });
    expect(config.maxRetriesPerSprint).toBe(0);
  });

  test("gateTimeout = 0 is accepted (skip all gates sentinel)", () => {
    const config = resolveConfig({ ...baseCli, gateTimeout: 0 });
    expect(config.gateTimeout).toBe(0);
  });

  test("gateTimeout = 0 from env var is accepted", () => {
    process.env.ADHD_GATE_TIMEOUT = "0";
    const config = resolveConfig({ ...baseCli });
    expect(config.gateTimeout).toBe(0);
  });

  test("threshold = 7 (default) is accepted", () => {
    const config = resolveConfig({ ...baseCli, threshold: 7 });
    expect(config.passThreshold).toBe(7);
  });

  test("maxSprints = 1 (minimum) is accepted", () => {
    const config = resolveConfig({ ...baseCli, maxSprints: 1 });
    expect(config.maxSprints).toBe(1);
  });
});
