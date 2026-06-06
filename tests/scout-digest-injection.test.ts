/**
 * Sprint 10 / F10 — Generator wiring end-to-end test.
 *
 * Verifies that when readScoutDigest returns a non-null digest the Scout section
 * heading appears in the prompt passed to the agent, and that when it returns
 * null the heading is absent — without spawning any real SDK call.
 *
 * Uses two test-only seams:
 *   • deps.runAgentFn  — captures the RunAgentRequest (established in Sprint 5)
 *   • deps.readScoutDigestFn — overrides readScoutDigest (Sprint 10)
 */

import { describe, expect, test } from "bun:test";
import { runGenerator } from "../harness-claude/generator.ts";
import type { RunAgentRequest, RunAgentResult } from "../harness-claude/run-agent.ts";
import { makeIdentity } from "../shared/agent-identity.ts";
import { parseCli, resolveConfig } from "../shared/config.ts";
import { SCOUT_SECTION_HEADING } from "../shared/generator-context.ts";
import type { SprintContract } from "../shared/types.ts";

// ── Shared fixtures ────────────────────────────────────────────────────────────

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
  attempt: 0,
  timestamp: "20240101-000000",
});

function makeRunAgentResult(overrides?: Partial<RunAgentResult>): RunAgentResult {
  return {
    response: "ok",
    sessionId: "test-session",
    sdkResult: {
      stop_reason: "end_turn",
      is_error: false,
      usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0 },
    },
    durationMs: 1,
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("F10: Scout digest injection into Generator prompt", () => {
  test("Scout section heading present when readScoutDigest returns a non-null digest", async () => {
    const capturedPrompts: string[] = [];

    const spyRunAgent = async (req: RunAgentRequest): Promise<RunAgentResult> => {
      capturedPrompts.push(req.prompt);
      return makeRunAgentResult();
    };

    const config = resolveConfig(baseCli);

    await runGenerator(
      {
        config,
        identity: mockIdentity,
        spec: "# Test spec",
        contract: mockContract,
        supplementaryContext: "## Codebase Map\n\nmap content",
      },
      {
        runAgentFn: spyRunAgent,
        readScoutDigestFn: async (_workDir) => "naming: camelCase\nerror-handling: try/catch",
      },
    );

    expect(capturedPrompts).toHaveLength(1);
    const prompt = capturedPrompts[0] ?? "";
    expect(prompt).toContain(SCOUT_SECTION_HEADING);
    expect(prompt).toContain("naming: camelCase");
  });

  test("Scout section heading absent when readScoutDigest returns null", async () => {
    const capturedPrompts: string[] = [];

    const spyRunAgent = async (req: RunAgentRequest): Promise<RunAgentResult> => {
      capturedPrompts.push(req.prompt);
      return makeRunAgentResult();
    };

    const config = resolveConfig(baseCli);

    await runGenerator(
      {
        config,
        identity: mockIdentity,
        spec: "# Test spec",
        contract: mockContract,
        supplementaryContext: "## Codebase Map\n\nmap content",
      },
      {
        runAgentFn: spyRunAgent,
        readScoutDigestFn: async (_workDir) => null,
      },
    );

    expect(capturedPrompts).toHaveLength(1);
    const prompt = capturedPrompts[0] ?? "";
    expect(prompt).not.toContain(SCOUT_SECTION_HEADING);
    // Existing context still present
    expect(prompt).toContain("## Codebase Map");
  });

  test("existing supplementaryContext preserved alongside Scout section", async () => {
    const capturedPrompts: string[] = [];

    const spyRunAgent = async (req: RunAgentRequest): Promise<RunAgentResult> => {
      capturedPrompts.push(req.prompt);
      return makeRunAgentResult();
    };

    const config = resolveConfig(baseCli);
    const existingContext = "## Verification Baseline\n\nbaseline text\n\n## Codebase Map\n\nmap text";

    await runGenerator(
      {
        config,
        identity: mockIdentity,
        spec: "# Test spec",
        contract: mockContract,
        supplementaryContext: existingContext,
      },
      {
        runAgentFn: spyRunAgent,
        readScoutDigestFn: async (_workDir) => "scout digest content",
      },
    );

    const prompt = capturedPrompts[0] ?? "";
    // Both existing sections intact
    expect(prompt).toContain("## Verification Baseline");
    expect(prompt).toContain("## Codebase Map");
    // Scout section added
    expect(prompt).toContain(SCOUT_SECTION_HEADING);
    // Scout appears after the codebase map
    expect(prompt.indexOf(SCOUT_SECTION_HEADING)).toBeGreaterThan(prompt.indexOf("## Codebase Map"));
  });

  test("no-op path: generator runs unchanged when no digest and no supplementaryContext", async () => {
    const capturedPrompts: string[] = [];

    const spyRunAgent = async (req: RunAgentRequest): Promise<RunAgentResult> => {
      capturedPrompts.push(req.prompt);
      return makeRunAgentResult();
    };

    const config = resolveConfig(baseCli);

    await runGenerator(
      {
        config,
        identity: mockIdentity,
        spec: "# Test spec",
        contract: mockContract,
        // no supplementaryContext
      },
      {
        runAgentFn: spyRunAgent,
        readScoutDigestFn: async (_workDir) => null,
      },
    );

    const prompt = capturedPrompts[0] ?? "";
    expect(prompt).not.toContain(SCOUT_SECTION_HEADING);
  });
});
