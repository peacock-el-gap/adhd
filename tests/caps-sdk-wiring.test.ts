/**
 * Sprint 5 — per-agent caps SDK wiring
 *
 * Verifies that each agent function passes config.resolvedMaxTurns<Role>
 * as the `maxTurns` field in the RunAgentRequest handed to runAgent, so
 * the SDK actually enforces the configured per-agent ceiling.
 *
 * Strategy: use the test-only `_deps.runAgentFn` seam (same pattern as
 * `ensureGeneratorCommit`'s `deps` parameter) rather than mock.module(),
 * which would contaminate other test files sharing Bun's module cache.
 * The spy function captures every RunAgentRequest, letting assertions
 * inspect maxTurns without making any real SDK calls.
 */

import { describe, expect, test } from "bun:test";
import { makeIdentity } from "../shared/agent-identity.ts";
import { runGenerator } from "../harness-claude/generator.ts";
import type { RunAgentRequest, RunAgentResult } from "../harness-claude/run-agent.ts";
import { parseCli, resolveConfig } from "../shared/config.ts";
import type { SprintContract } from "../shared/types.ts";

// ── Shared fixtures ───────────────────────────────────────────────────────────

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

const mockContract: SprintContract = {
  sprintNumber: 1,
  features: ["feature-a"],
  criteria: [],
};

const mockIdentity = makeIdentity({
  role: "test",
  sprint: 1,
  attempt: 1,
  timestamp: "20240101-000000",
});

/** A minimal RunAgentResult that satisfies GeneratorResult's expectations. */
function makeRunAgentResult(overrides?: Partial<RunAgentResult>): RunAgentResult {
  return {
    response: "ok",
    sessionId: "test-session",
    sdkResult: {
      stop_reason: "end_turn",
      is_error: false,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
    durationMs: 1,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("F5: caps wired to SDK maxTurns — Generator (spy via deps seam)", () => {
  test("passes config.resolvedMaxTurnsGenerator as maxTurns to runAgent", async () => {
    const captured: Array<{ role: string; maxTurns: number }> = [];
    const spyRunAgent = async (req: RunAgentRequest): Promise<RunAgentResult> => {
      captured.push({ role: req.role, maxTurns: req.maxTurns });
      return makeRunAgentResult();
    };

    const saved = process.env.GENERATOR_MAX_TURNS;
    delete process.env.GENERATOR_MAX_TURNS;
    try {
      const config = resolveConfig({ ...baseCli, generatorMaxTurns: 27 });
      expect(config.resolvedMaxTurnsGenerator).toBe(27);

      await runGenerator(
        { config, identity: mockIdentity, spec: "# Test spec", contract: mockContract },
        { runAgentFn: spyRunAgent },
      );

      expect(captured).toHaveLength(1);
      expect(captured[0]?.role).toBe("GENERATOR");
      expect(captured[0]?.maxTurns).toBe(27);
    } finally {
      if (saved !== undefined) process.env.GENERATOR_MAX_TURNS = saved;
    }
  });

  test("default cap (50) is passed when no override is configured", async () => {
    const captured: Array<{ role: string; maxTurns: number }> = [];
    const spyRunAgent = async (req: RunAgentRequest): Promise<RunAgentResult> => {
      captured.push({ role: req.role, maxTurns: req.maxTurns });
      return makeRunAgentResult();
    };

    const savedEnv = process.env.GENERATOR_MAX_TURNS;
    delete process.env.GENERATOR_MAX_TURNS;
    try {
      const config = resolveConfig({ ...baseCli });
      expect(config.resolvedMaxTurnsGenerator).toBe(50);

      await runGenerator(
        { config, identity: mockIdentity, spec: "# Test spec", contract: mockContract },
        { runAgentFn: spyRunAgent },
      );

      expect(captured[0]?.maxTurns).toBe(50);
    } finally {
      if (savedEnv !== undefined) process.env.GENERATOR_MAX_TURNS = savedEnv;
    }
  });

  test("custom cap is isolated — changing generator cap does not affect the resolved value for other agents", async () => {
    const savedGen = process.env.GENERATOR_MAX_TURNS;
    const savedEval = process.env.EVALUATOR_MAX_TURNS;
    delete process.env.GENERATOR_MAX_TURNS;
    delete process.env.EVALUATOR_MAX_TURNS;
    try {
      const config = resolveConfig({ ...baseCli, generatorMaxTurns: 15 });

      // Only the generator cap is overridden
      expect(config.resolvedMaxTurnsGenerator).toBe(15);
      expect(config.resolvedMaxTurnsEvaluator).toBe(50); // default, unaffected

      // The spy captures the generator's maxTurns
      const captured: number[] = [];
      await runGenerator(
        { config, identity: mockIdentity, spec: "# Test spec", contract: mockContract },
        {
          runAgentFn: async (req: RunAgentRequest): Promise<RunAgentResult> => {
            captured.push(req.maxTurns);
            return makeRunAgentResult();
          },
        },
      );
      expect(captured[0]).toBe(15);
    } finally {
      if (savedGen !== undefined) process.env.GENERATOR_MAX_TURNS = savedGen;
      if (savedEval !== undefined) process.env.EVALUATOR_MAX_TURNS = savedEval;
    }
  });

  test("env var override flows through to runAgent maxTurns", async () => {
    const saved = process.env.GENERATOR_MAX_TURNS;
    process.env.GENERATOR_MAX_TURNS = "22";
    try {
      const config = resolveConfig({ ...baseCli });
      expect(config.resolvedMaxTurnsGenerator).toBe(22);

      const captured: number[] = [];
      await runGenerator(
        { config, identity: mockIdentity, spec: "# Test spec", contract: mockContract },
        {
          runAgentFn: async (req: RunAgentRequest): Promise<RunAgentResult> => {
            captured.push(req.maxTurns);
            return makeRunAgentResult();
          },
        },
      );
      expect(captured[0]).toBe(22);
    } finally {
      if (saved !== undefined) process.env.GENERATOR_MAX_TURNS = saved;
      else delete process.env.GENERATOR_MAX_TURNS;
    }
  });
});
