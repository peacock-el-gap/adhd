/**
 * Sprint 5 — Per-agent turn caps
 *
 * Tests cover:
 *  (a) Default resolution for all four agents
 *  (b) Valid CLI/env overrides for at least two agents
 *  (c) Invalid values (non-numeric, negative, zero) degrading to defaults
 *  (d) Precedence ordering (CLI beats env)
 *  (e) Cap isolation (one override doesn't affect others)
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  CLI_FLAG_HELP,
  DEFAULT_MAX_TURNS_DOCUMENTER,
  DEFAULT_MAX_TURNS_EVALUATOR,
  DEFAULT_MAX_TURNS_GENERATOR,
  DEFAULT_MAX_TURNS_PLANNER,
  parseCli,
  resolveAgentCap,
  resolveConfig,
} from "../shared/config.ts";
import { describeAgentCaps } from "../shared/models.ts";

// ---------------------------------------------------------------------------
// Helpers
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

/** Run fn with all cap env vars cleared, then restore. */
function withoutCapEnv<T>(fn: () => T): T {
  const keys = [
    "PLANNER_MAX_TURNS",
    "GENERATOR_MAX_TURNS",
    "EVALUATOR_MAX_TURNS",
    "DOCUMENTER_MAX_TURNS",
  ];
  const saved: Record<string, string | undefined> = {};
  for (const k of keys) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  try {
    return fn();
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

// ---------------------------------------------------------------------------
// resolveAgentCap — pure helper
// ---------------------------------------------------------------------------

describe("resolveAgentCap", () => {
  test("undefined → default", () => {
    expect(resolveAgentCap(undefined, 50)).toBe(50);
  });

  test("valid positive integer string → parsed value", () => {
    expect(resolveAgentCap("30", 50)).toBe(30);
  });

  test("valid positive integer number → value unchanged", () => {
    expect(resolveAgentCap(30, 50)).toBe(30);
  });

  test("zero → default (not a valid cap)", () => {
    expect(resolveAgentCap("0", 50)).toBe(50);
    expect(resolveAgentCap(0, 50)).toBe(50);
  });

  test("negative integer → default", () => {
    expect(resolveAgentCap("-5", 50)).toBe(50);
    expect(resolveAgentCap(-5, 50)).toBe(50);
  });

  test("non-numeric string → default", () => {
    expect(resolveAgentCap("abc", 50)).toBe(50);
  });

  test("NaN number → default", () => {
    expect(resolveAgentCap(NaN, 50)).toBe(50);
  });

  test("float string → parseInt truncation (2.5 → 2, which is valid)", () => {
    // parseInt("2.5") = 2, which is a valid positive integer; no degradation
    expect(resolveAgentCap("2.5", 50)).toBe(2);
  });

  test("boundary: 1 is valid", () => {
    expect(resolveAgentCap("1", 50)).toBe(1);
    expect(resolveAgentCap(1, 50)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// (a) Default resolution for all four agents
// ---------------------------------------------------------------------------

describe("F5: default per-agent caps", () => {
  test("all four agents default to their documented default cap (no env, no CLI)", () => {
    withoutCapEnv(() => {
      const config = resolveConfig({ ...baseCli });
      expect(config.resolvedMaxTurnsPlanner).toBe(DEFAULT_MAX_TURNS_PLANNER);
      expect(config.resolvedMaxTurnsGenerator).toBe(DEFAULT_MAX_TURNS_GENERATOR);
      expect(config.resolvedMaxTurnsEvaluator).toBe(DEFAULT_MAX_TURNS_EVALUATOR);
      expect(config.resolvedMaxTurnsDocumenter).toBe(DEFAULT_MAX_TURNS_DOCUMENTER);
    });
  });

  test("Generator default cap is exactly 50 (preserves prior CLAUDE_MAX_TURNS behavior)", () => {
    withoutCapEnv(() => {
      const config = resolveConfig({ ...baseCli });
      expect(config.resolvedMaxTurnsGenerator).toBe(50);
    });
  });

  test("all default caps are positive integers >= 50 (no regression from prior ceiling)", () => {
    withoutCapEnv(() => {
      const config = resolveConfig({ ...baseCli });
      for (const cap of [
        config.resolvedMaxTurnsPlanner,
        config.resolvedMaxTurnsGenerator,
        config.resolvedMaxTurnsEvaluator,
        config.resolvedMaxTurnsDocumenter,
      ]) {
        expect(typeof cap).toBe("number");
        expect(Number.isInteger(cap)).toBe(true);
        expect(cap).toBeGreaterThanOrEqual(50);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// (b) Valid CLI/env overrides for at least two agents
// ---------------------------------------------------------------------------

describe("F5: CLI flag overrides", () => {
  test("--generator-max-turns 30 overrides generator cap", () => {
    withoutCapEnv(() => {
      const cli = parseCli(["--generator-max-turns", "30", "test"]);
      expect(cli.generatorMaxTurns).toBe(30);
      const config = resolveConfig({ ...baseCli, generatorMaxTurns: 30 });
      expect(config.resolvedMaxTurnsGenerator).toBe(30);
    });
  });

  test("--planner-max-turns 20 overrides planner cap", () => {
    withoutCapEnv(() => {
      const cli = parseCli(["--planner-max-turns", "20", "test"]);
      expect(cli.plannerMaxTurns).toBe(20);
      const config = resolveConfig({ ...baseCli, plannerMaxTurns: 20 });
      expect(config.resolvedMaxTurnsPlanner).toBe(20);
    });
  });

  test("--evaluator-max-turns 40 overrides evaluator cap", () => {
    withoutCapEnv(() => {
      const config = resolveConfig({ ...baseCli, evaluatorMaxTurns: 40 });
      expect(config.resolvedMaxTurnsEvaluator).toBe(40);
    });
  });

  test("--documenter-max-turns 15 overrides documenter cap", () => {
    withoutCapEnv(() => {
      const config = resolveConfig({ ...baseCli, documenterMaxTurns: 15 });
      expect(config.resolvedMaxTurnsDocumenter).toBe(15);
    });
  });

  test("parseCli defaults: all per-agent cap flags default to undefined", () => {
    const cli = parseCli(["test"]);
    expect(cli.plannerMaxTurns).toBeUndefined();
    expect(cli.generatorMaxTurns).toBeUndefined();
    expect(cli.evaluatorMaxTurns).toBeUndefined();
    expect(cli.documenterMaxTurns).toBeUndefined();
  });
});

describe("F5: env var overrides", () => {
  test("GENERATOR_MAX_TURNS=30 overrides generator cap", () => {
    withoutCapEnv(() => {
      process.env.GENERATOR_MAX_TURNS = "30";
      const config = resolveConfig({ ...baseCli });
      expect(config.resolvedMaxTurnsGenerator).toBe(30);
    });
  });

  test("PLANNER_MAX_TURNS=25 overrides planner cap", () => {
    withoutCapEnv(() => {
      process.env.PLANNER_MAX_TURNS = "25";
      const config = resolveConfig({ ...baseCli });
      expect(config.resolvedMaxTurnsPlanner).toBe(25);
    });
  });

  test("EVALUATOR_MAX_TURNS=60 overrides evaluator cap", () => {
    withoutCapEnv(() => {
      process.env.EVALUATOR_MAX_TURNS = "60";
      const config = resolveConfig({ ...baseCli });
      expect(config.resolvedMaxTurnsEvaluator).toBe(60);
    });
  });

  test("DOCUMENTER_MAX_TURNS=10 overrides documenter cap", () => {
    withoutCapEnv(() => {
      process.env.DOCUMENTER_MAX_TURNS = "10";
      const config = resolveConfig({ ...baseCli });
      expect(config.resolvedMaxTurnsDocumenter).toBe(10);
    });
  });
});

// ---------------------------------------------------------------------------
// (c) Invalid values degrade to defaults
// ---------------------------------------------------------------------------

describe("F5: invalid cap values degrade to defaults (never throw)", () => {
  test("non-numeric CLI value for generator → default", () => {
    withoutCapEnv(() => {
      // parseCli produces NaN for non-numeric --generator-max-turns
      const config = resolveConfig({ ...baseCli, generatorMaxTurns: NaN });
      expect(config.resolvedMaxTurnsGenerator).toBe(DEFAULT_MAX_TURNS_GENERATOR);
    });
  });

  test("negative CLI value for planner → default", () => {
    withoutCapEnv(() => {
      const config = resolveConfig({ ...baseCli, plannerMaxTurns: -5 });
      expect(config.resolvedMaxTurnsPlanner).toBe(DEFAULT_MAX_TURNS_PLANNER);
    });
  });

  test("zero CLI value for evaluator → default", () => {
    withoutCapEnv(() => {
      const config = resolveConfig({ ...baseCli, evaluatorMaxTurns: 0 });
      expect(config.resolvedMaxTurnsEvaluator).toBe(DEFAULT_MAX_TURNS_EVALUATOR);
    });
  });

  test("non-numeric env var GENERATOR_MAX_TURNS=abc → default", () => {
    withoutCapEnv(() => {
      process.env.GENERATOR_MAX_TURNS = "abc";
      const config = resolveConfig({ ...baseCli });
      expect(config.resolvedMaxTurnsGenerator).toBe(DEFAULT_MAX_TURNS_GENERATOR);
    });
  });

  test("negative env var DOCUMENTER_MAX_TURNS=-3 → default", () => {
    withoutCapEnv(() => {
      process.env.DOCUMENTER_MAX_TURNS = "-3";
      const config = resolveConfig({ ...baseCli });
      expect(config.resolvedMaxTurnsDocumenter).toBe(DEFAULT_MAX_TURNS_DOCUMENTER);
    });
  });

  test("zero env var PLANNER_MAX_TURNS=0 → default", () => {
    withoutCapEnv(() => {
      process.env.PLANNER_MAX_TURNS = "0";
      const config = resolveConfig({ ...baseCli });
      expect(config.resolvedMaxTurnsPlanner).toBe(DEFAULT_MAX_TURNS_PLANNER);
    });
  });

  test("resolveConfig does not throw for any invalid cap value", () => {
    withoutCapEnv(() => {
      expect(() => resolveConfig({ ...baseCli, generatorMaxTurns: NaN })).not.toThrow();
      expect(() => resolveConfig({ ...baseCli, generatorMaxTurns: -1 })).not.toThrow();
      expect(() => resolveConfig({ ...baseCli, generatorMaxTurns: 0 })).not.toThrow();
    });
  });
});

// ---------------------------------------------------------------------------
// (d) Precedence ordering: CLI > env > default
// ---------------------------------------------------------------------------

describe("F5: precedence ordering CLI > env > default", () => {
  test("CLI cap beats matching env var (generator)", () => {
    withoutCapEnv(() => {
      process.env.GENERATOR_MAX_TURNS = "99";
      const config = resolveConfig({ ...baseCli, generatorMaxTurns: 25 });
      expect(config.resolvedMaxTurnsGenerator).toBe(25);
    });
  });

  test("CLI cap beats matching env var (planner)", () => {
    withoutCapEnv(() => {
      process.env.PLANNER_MAX_TURNS = "99";
      const config = resolveConfig({ ...baseCli, plannerMaxTurns: 15 });
      expect(config.resolvedMaxTurnsPlanner).toBe(15);
    });
  });

  test("env var beats default when CLI absent (evaluator)", () => {
    withoutCapEnv(() => {
      process.env.EVALUATOR_MAX_TURNS = "75";
      const config = resolveConfig({ ...baseCli });
      expect(config.resolvedMaxTurnsEvaluator).toBe(75);
    });
  });

  test("invalid CLI value falls through to env var, not default", () => {
    // When CLI cap is invalid (NaN), the env var should win over default
    withoutCapEnv(() => {
      process.env.GENERATOR_MAX_TURNS = "40";
      const config = resolveConfig({ ...baseCli, generatorMaxTurns: NaN });
      // NaN CLI → resolved from env var "40"
      expect(config.resolvedMaxTurnsGenerator).toBe(40);
    });
  });
});

// ---------------------------------------------------------------------------
// (e) Cap isolation: one override doesn't affect others
// ---------------------------------------------------------------------------

describe("F5: cap isolation", () => {
  test("overriding generator cap does not change planner, evaluator, or documenter caps", () => {
    withoutCapEnv(() => {
      const config = resolveConfig({ ...baseCli, generatorMaxTurns: 30 });
      expect(config.resolvedMaxTurnsGenerator).toBe(30);
      expect(config.resolvedMaxTurnsPlanner).toBe(DEFAULT_MAX_TURNS_PLANNER);
      expect(config.resolvedMaxTurnsEvaluator).toBe(DEFAULT_MAX_TURNS_EVALUATOR);
      expect(config.resolvedMaxTurnsDocumenter).toBe(DEFAULT_MAX_TURNS_DOCUMENTER);
    });
  });

  test("overriding documenter cap does not change the other three agents", () => {
    withoutCapEnv(() => {
      const config = resolveConfig({ ...baseCli, documenterMaxTurns: 10 });
      expect(config.resolvedMaxTurnsDocumenter).toBe(10);
      expect(config.resolvedMaxTurnsPlanner).toBe(DEFAULT_MAX_TURNS_PLANNER);
      expect(config.resolvedMaxTurnsGenerator).toBe(DEFAULT_MAX_TURNS_GENERATOR);
      expect(config.resolvedMaxTurnsEvaluator).toBe(DEFAULT_MAX_TURNS_EVALUATOR);
    });
  });
});

// ---------------------------------------------------------------------------
// CLI_FLAG_HELP documents the new flags
// ---------------------------------------------------------------------------

describe("F5: CLI_FLAG_HELP documents per-agent turn cap flags", () => {
  test("--generator-max-turns is documented", () => {
    expect(CLI_FLAG_HELP["--generator-max-turns"]).toBeDefined();
    expect((CLI_FLAG_HELP["--generator-max-turns"] ?? "").length).toBeGreaterThan(0);
  });

  test("--planner-max-turns is documented", () => {
    expect(CLI_FLAG_HELP["--planner-max-turns"]).toBeDefined();
  });

  test("--evaluator-max-turns is documented", () => {
    expect(CLI_FLAG_HELP["--evaluator-max-turns"]).toBeDefined();
  });

  test("--documenter-max-turns is documented", () => {
    expect(CLI_FLAG_HELP["--documenter-max-turns"]).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// describeAgentCaps
// ---------------------------------------------------------------------------

describe("F5: describeAgentCaps", () => {
  const defaults = {
    resolvedMaxTurnsPlanner: 50,
    resolvedMaxTurnsGenerator: 50,
    resolvedMaxTurnsEvaluator: 50,
    resolvedMaxTurnsDocumenter: 50,
  };

  test("all defaults → empty array (nothing to print)", () => {
    const lines = describeAgentCaps(defaults, defaults);
    expect(lines).toEqual([]);
  });

  test("non-default generator cap → includes generator line", () => {
    const lines = describeAgentCaps({ ...defaults, resolvedMaxTurnsGenerator: 30 }, defaults);
    expect(lines.some((l) => l.includes("Generator") && l.includes("30"))).toBe(true);
  });

  test("non-default planner cap → includes planner line", () => {
    const lines = describeAgentCaps({ ...defaults, resolvedMaxTurnsPlanner: 20 }, defaults);
    expect(lines.some((l) => l.includes("Planner") && l.includes("20"))).toBe(true);
  });

  test("multiple non-default caps → one line per changed cap", () => {
    const lines = describeAgentCaps(
      { ...defaults, resolvedMaxTurnsGenerator: 30, resolvedMaxTurnsDocumenter: 10 },
      defaults,
    );
    expect(lines.length).toBe(2);
  });
});
