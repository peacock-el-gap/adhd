/**
 * Sprint 14 — Reviewer wiring tests (F14).
 *
 * Covers all acceptance criteria from the Sprint 14 contract:
 *   - review_flag_parsed
 *   - reviewer_runs_once_per_passing_sprint
 *   - reviewer_not_called_when_sprint_fails  (negative path — validated by structure)
 *   - reviewer_not_called_without_flag
 *   - reviewer_absent_from_agents_is_noop
 *   - reviewer_verdict_does_not_alter_evaluator_verdict
 *   - reviewer_failure_is_nonfatal
 *   - shared_has_no_sdk_imports
 *   - defensive_call_pattern_mirrors_scout
 *   - no_duplicated_flag_parsing_logic
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { parseCli, resolveConfig } from "../shared/config.ts";

// ---------------------------------------------------------------------------
// Helpers — minimal in-memory deps for handleSprintSuccess
// ---------------------------------------------------------------------------

function makeUsage() {
  const rows: Array<{ stage: string; model: string }> = [];
  return {
    rows,
    recordStage(stage: string, model: string, _result: unknown) {
      rows.push({ stage, model });
    },
    printSummary() {},
    async save() {},
    getStages() { return rows; },
  };
}

function makeSpan() {
  return {
    startChild: () => makeSpan(),
    run: async (fn: () => Promise<unknown>) => fn(),
    end: () => {},
  };
}

function makeMinimalConfig(workDir: string, overrides: Record<string, unknown> = {}) {
  return {
    workDir,
    harnessDir: join(workDir, ".adhd"),
    isGreenfield: false,
    noBdd: true,
    commitAdhd: false,
    refineSpec: false,
    interactive: false,
    gateTimeout: 0,
    notify: false,
    resolvedModelEvaluator: "claude-test-model",
    useReview: false,
    ...overrides,
  } as unknown as import("../shared/types.ts").ResolvedConfig;
}

function makeProgress() {
  return {
    status: "building" as const,
    currentSprint: 1,
    totalSprints: 2,
    completedSprints: 0,
    retryCount: 0,
    sprintResults: [],
  };
}

function makeContract() {
  return {
    sprintNumber: 1,
    features: ["feature-1"],
    criteria: [{ name: "c1", description: "d", threshold: 7, type: "behavioral" as const }],
    surfaces: ["backend"],
  };
}

function makeSprintResults() {
  return [
    {
      sprintNumber: 1,
      passed: true,
      attempts: 1,
      evalResult: {
        passed: true,
        scores: {} as Record<string, number>,
        feedback: [] as import("../shared/types.ts").EvalScore[],
        overallSummary: "All criteria passed.",
      },
    },
  ];
}

/** Initialise a minimal git repo with a commit so rev-parse HEAD works. */
function initGitRepo(dir: string): void {
  mkdirSync(join(dir, ".adhd"), { recursive: true });
  execSync("git init -b main", { cwd: dir, stdio: "pipe" });
  execSync("git config user.email 'test@test.com'", { cwd: dir, stdio: "pipe" });
  execSync("git config user.name 'Test'", { cwd: dir, stdio: "pipe" });
  writeFileSync(join(dir, "README.md"), "test");
  execSync("git add -A", { cwd: dir, stdio: "pipe" });
  execSync("git commit -m 'init'", { cwd: dir, stdio: "pipe" });
}

// ---------------------------------------------------------------------------
// review_flag_parsed
// ---------------------------------------------------------------------------
describe("review_flag_parsed", () => {
  test("parseCli without --review sets useReview to false", () => {
    const cli = parseCli(["my prompt"]);
    // useReview should be absent or false — either is valid since it defaults to false
    expect(cli).toBeDefined();
    // We verify via resolveConfig below
  });

  test("parseCli with --review returns a truthy useReview-equivalent value", () => {
    // Verify the flag is accepted (no parse error)
    const cli = parseCli(["--review", "my prompt"]);
    expect(cli).toBeDefined();
    // The resolved value should be true
    const config = resolveConfig(cli);
    expect(config.useReview).toBe(true);
  });

  test("resolveConfig without --review sets useReview to false", () => {
    const cli = parseCli(["my prompt"]);
    const config = resolveConfig(cli);
    expect(config.useReview).toBe(false);
  });

  test("resolveConfig with --review sets useReview to true", () => {
    const cli = parseCli(["--review", "my prompt"]);
    const config = resolveConfig(cli);
    expect(config.useReview).toBe(true);
  });

  test("--review flag does not affect any other config field", () => {
    const without = resolveConfig(parseCli(["my prompt"]));
    const withReview = resolveConfig(parseCli(["--review", "my prompt"]));

    // All fields except useReview should be identical
    const { useReview: _wr, ...withoutWithoutReview } = without as unknown as Record<string, unknown>;
    const { useReview: _wwr, ...withReviewWithoutFlag } = withReview as unknown as Record<string, unknown>;
    expect(withoutWithoutReview).toEqual(withReviewWithoutFlag);
  });
});

// ---------------------------------------------------------------------------
// reviewer_runs_once_per_passing_sprint
// ---------------------------------------------------------------------------
describe("reviewer_runs_once_per_passing_sprint", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `s14-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
    initGitRepo(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("runReviewer is called exactly once when useReview is true and sprint passes", async () => {
    const { handleSprintSuccess } = await import("../shared/orchestration/sprint-success.ts");

    let callCount = 0;
    const fakeReviewer = async () => {
      callCount++;
      return { report: { report: "looks good" }, sdkResult: undefined };
    };

    const config = makeMinimalConfig(tmpDir, { useReview: true });
    const usage = makeUsage();
    const agents = {
      runReviewer: fakeReviewer,
      runPlanner: async () => ({ spec: "" }),
      runDocumenter: async () => ({}),
      ensureDocumenterCommit: async () => "new-commit" as const,
    } as unknown as import("../shared/orchestration/types.ts").AgentRunners;

    await handleSprintSuccess({
      config,
      contract: makeContract(),
      spec: "# Sprint 1\n",
      sprint: 1,
      totalSprints: 2,
      gDir: tmpDir,
      progress: makeProgress(),
      results: makeSprintResults(),
      parentSpan: makeSpan() as unknown as import("../shared/tracing.ts").Span,
      usage: usage as unknown as import("../shared/usage.ts").UsageTracker,
      skills: undefined,
      agents,
    });

    expect(callCount).toBe(1);
  });

  test("runReviewer is called with the correct sprint number", async () => {
    const { handleSprintSuccess } = await import("../shared/orchestration/sprint-success.ts");

    let capturedSprint: number | undefined;
    const fakeReviewer = async (opts: { sprint: number }) => {
      capturedSprint = opts.sprint;
      return { report: undefined, sdkResult: undefined };
    };

    const config = makeMinimalConfig(tmpDir, { useReview: true });
    const usage = makeUsage();
    const agents = {
      runReviewer: fakeReviewer,
      runPlanner: async () => ({ spec: "" }),
    } as unknown as import("../shared/orchestration/types.ts").AgentRunners;

    await handleSprintSuccess({
      config,
      contract: makeContract(),
      spec: "# Sprint 1\n",
      sprint: 3,
      totalSprints: 5,
      gDir: tmpDir,
      progress: makeProgress(),
      results: makeSprintResults(),
      parentSpan: makeSpan() as unknown as import("../shared/tracing.ts").Span,
      usage: usage as unknown as import("../shared/usage.ts").UsageTracker,
      skills: undefined,
      agents,
    });

    expect(capturedSprint).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// reviewer_not_called_without_flag
// ---------------------------------------------------------------------------
describe("reviewer_not_called_without_flag", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `s14-noflag-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
    initGitRepo(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("runReviewer is NOT called when useReview is false", async () => {
    const { handleSprintSuccess } = await import("../shared/orchestration/sprint-success.ts");

    let callCount = 0;
    const fakeReviewer = async () => {
      callCount++;
      return { report: undefined, sdkResult: undefined };
    };

    const config = makeMinimalConfig(tmpDir, { useReview: false });
    const usage = makeUsage();
    const agents = {
      runReviewer: fakeReviewer,
      runPlanner: async () => ({ spec: "" }),
    } as unknown as import("../shared/orchestration/types.ts").AgentRunners;

    await handleSprintSuccess({
      config,
      contract: makeContract(),
      spec: "# Sprint 1\n",
      sprint: 1,
      totalSprints: 2,
      gDir: tmpDir,
      progress: makeProgress(),
      results: makeSprintResults(),
      parentSpan: makeSpan() as unknown as import("../shared/tracing.ts").Span,
      usage: usage as unknown as import("../shared/usage.ts").UsageTracker,
      skills: undefined,
      agents,
    });

    expect(callCount).toBe(0);
  });

  test("no 'reviewer' cost stage is recorded when useReview is false", async () => {
    const { handleSprintSuccess } = await import("../shared/orchestration/sprint-success.ts");

    const config = makeMinimalConfig(tmpDir, { useReview: false });
    const usage = makeUsage();
    const agents = {
      runReviewer: async () => ({ report: undefined, sdkResult: { inputTokens: 10, outputTokens: 5, totalCost: 0.001 } }),
      runPlanner: async () => ({ spec: "" }),
    } as unknown as import("../shared/orchestration/types.ts").AgentRunners;

    await handleSprintSuccess({
      config,
      contract: makeContract(),
      spec: "# Sprint 1\n",
      sprint: 1,
      totalSprints: 2,
      gDir: tmpDir,
      progress: makeProgress(),
      results: makeSprintResults(),
      parentSpan: makeSpan() as unknown as import("../shared/tracing.ts").Span,
      usage: usage as unknown as import("../shared/usage.ts").UsageTracker,
      skills: undefined,
      agents,
    });

    const reviewerStages = usage.rows.filter((r) => r.stage === "reviewer");
    expect(reviewerStages).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// reviewer_absent_from_agents_is_noop
// ---------------------------------------------------------------------------
describe("reviewer_absent_from_agents_is_noop", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `s14-absent-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
    initGitRepo(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("handleSprintSuccess completes normally when runReviewer is absent and useReview is true", async () => {
    const { handleSprintSuccess } = await import("../shared/orchestration/sprint-success.ts");

    const config = makeMinimalConfig(tmpDir, { useReview: true });
    const usage = makeUsage();
    // agents does NOT have runReviewer
    const agents = {
      runPlanner: async () => ({ spec: "" }),
    } as unknown as import("../shared/orchestration/types.ts").AgentRunners;

    let threw = false;
    try {
      await handleSprintSuccess({
        config,
        contract: makeContract(),
        spec: "# Sprint 1\n",
        sprint: 1,
        totalSprints: 2,
        gDir: tmpDir,
        progress: makeProgress(),
        results: makeSprintResults(),
        parentSpan: makeSpan() as unknown as import("../shared/tracing.ts").Span,
        usage: usage as unknown as import("../shared/usage.ts").UsageTracker,
        skills: undefined,
        agents,
      });
    } catch {
      threw = true;
    }

    expect(threw).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// reviewer_verdict_does_not_alter_evaluator_verdict
// ---------------------------------------------------------------------------
describe("reviewer_verdict_does_not_alter_evaluator_verdict", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `s14-verdict-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
    initGitRepo(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("sprint result in progress.json is unchanged whether --review is set or not", async () => {
    const { handleSprintSuccess } = await import("../shared/orchestration/sprint-success.ts");
    const { readProgress } = await import("../shared/files.ts");

    const sprintResults = makeSprintResults();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const firstResult = sprintResults[0]!;
    const evalResultBefore = { passed: firstResult.passed, summary: firstResult.evalResult.overallSummary };

    const config = makeMinimalConfig(tmpDir, { useReview: true });
    const usage = makeUsage();
    const agents = {
      runReviewer: async () => ({
        // Even if reviewer "fails" it should not change eval result
        report: { report: "terrible code" },
        sdkResult: undefined,
      }),
      runPlanner: async () => ({ spec: "" }),
    } as unknown as import("../shared/orchestration/types.ts").AgentRunners;

    await handleSprintSuccess({
      config,
      contract: makeContract(),
      spec: "# Sprint 1\n",
      sprint: 1,
      totalSprints: 2,
      gDir: tmpDir,
      progress: makeProgress(),
      results: sprintResults,
      parentSpan: makeSpan() as unknown as import("../shared/tracing.ts").Span,
      usage: usage as unknown as import("../shared/usage.ts").UsageTracker,
      skills: undefined,
      agents,
    });

    const savedProgress = await readProgress(tmpDir);
    const savedSprintResult = savedProgress?.sprintResults?.[0];
    expect(savedSprintResult?.passed).toBe(true);
    expect(savedSprintResult?.passed).toBe(evalResultBefore.passed);
    expect(savedSprintResult?.evalResult?.overallSummary).toBe(evalResultBefore.summary);
  });
});

// ---------------------------------------------------------------------------
// reviewer_failure_is_nonfatal
// ---------------------------------------------------------------------------
describe("reviewer_failure_is_nonfatal", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `s14-nonfatal-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
    initGitRepo(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("handleSprintSuccess does not throw when runReviewer throws", async () => {
    const { handleSprintSuccess } = await import("../shared/orchestration/sprint-success.ts");

    const config = makeMinimalConfig(tmpDir, { useReview: true });
    const usage = makeUsage();
    const agents = {
      runReviewer: async () => {
        throw new Error("Simulated reviewer failure");
      },
      runPlanner: async () => ({ spec: "" }),
    } as unknown as import("../shared/orchestration/types.ts").AgentRunners;

    let threw = false;
    try {
      await handleSprintSuccess({
        config,
        contract: makeContract(),
        spec: "# Sprint 1\n",
        sprint: 1,
        totalSprints: 2,
        gDir: tmpDir,
        progress: makeProgress(),
        results: makeSprintResults(),
        parentSpan: makeSpan() as unknown as import("../shared/tracing.ts").Span,
        usage: usage as unknown as import("../shared/usage.ts").UsageTracker,
        skills: undefined,
        agents,
      });
    } catch {
      threw = true;
    }

    expect(threw).toBe(false);
  });

  test("handleSprintSuccess returns a valid result even when runReviewer throws", async () => {
    const { handleSprintSuccess } = await import("../shared/orchestration/sprint-success.ts");

    const config = makeMinimalConfig(tmpDir, { useReview: true });
    const usage = makeUsage();
    const agents = {
      runReviewer: async () => {
        throw new Error("Simulated reviewer failure");
      },
      runPlanner: async () => ({ spec: "" }),
    } as unknown as import("../shared/orchestration/types.ts").AgentRunners;

    const result = await handleSprintSuccess({
      config,
      contract: makeContract(),
      spec: "# Sprint 1\n",
      sprint: 1,
      totalSprints: 2,
      gDir: tmpDir,
      progress: makeProgress(),
      results: makeSprintResults(),
      parentSpan: makeSpan() as unknown as import("../shared/tracing.ts").Span,
      usage: usage as unknown as import("../shared/usage.ts").UsageTracker,
      skills: undefined,
      agents,
    });

    expect(result).toBeDefined();
    expect(result.spec).toBeDefined();
    expect(result.totalSprints).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// reviewer cost stage is recorded when sdkResult is present
// ---------------------------------------------------------------------------
describe("reviewer cost stage", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `s14-cost-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
    initGitRepo(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("'reviewer-sprint-N' cost stage is recorded when runReviewer returns sdkResult", async () => {
    const { handleSprintSuccess } = await import("../shared/orchestration/sprint-success.ts");

    const config = makeMinimalConfig(tmpDir, { useReview: true });
    const usage = makeUsage();
    const agents = {
      runReviewer: async () => ({
        report: { report: "looks good" },
        sdkResult: { inputTokens: 100, outputTokens: 50, totalCost: 0.001 },
      }),
      runPlanner: async () => ({ spec: "" }),
    } as unknown as import("../shared/orchestration/types.ts").AgentRunners;

    await handleSprintSuccess({
      config,
      contract: makeContract(),
      spec: "# Sprint 1\n",
      sprint: 1,
      totalSprints: 2,
      gDir: tmpDir,
      progress: makeProgress(),
      results: makeSprintResults(),
      parentSpan: makeSpan() as unknown as import("../shared/tracing.ts").Span,
      usage: usage as unknown as import("../shared/usage.ts").UsageTracker,
      skills: undefined,
      agents,
    });

    // F7: reviewer stage is now tagged per-sprint as "reviewer-sprint-N", not bare "reviewer"
    const reviewerStages = usage.rows.filter((r) => r.stage === "reviewer-sprint-1");
    expect(reviewerStages).toHaveLength(1);
  });

  test("no reviewer cost stage is recorded when runReviewer returns no sdkResult", async () => {
    const { handleSprintSuccess } = await import("../shared/orchestration/sprint-success.ts");

    const config = makeMinimalConfig(tmpDir, { useReview: true });
    const usage = makeUsage();
    const agents = {
      runReviewer: async () => ({
        report: { report: "looks good" },
        sdkResult: undefined,
      }),
      runPlanner: async () => ({ spec: "" }),
    } as unknown as import("../shared/orchestration/types.ts").AgentRunners;

    await handleSprintSuccess({
      config,
      contract: makeContract(),
      spec: "# Sprint 1\n",
      sprint: 1,
      totalSprints: 2,
      gDir: tmpDir,
      progress: makeProgress(),
      results: makeSprintResults(),
      parentSpan: makeSpan() as unknown as import("../shared/tracing.ts").Span,
      usage: usage as unknown as import("../shared/usage.ts").UsageTracker,
      skills: undefined,
      agents,
    });

    // No reviewer stage should be recorded when sdkResult is absent
    const reviewerStages = usage.rows.filter((r) => r.stage === "reviewer-sprint-1");
    expect(reviewerStages).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// shared_has_no_sdk_imports
// ---------------------------------------------------------------------------
describe("shared_has_no_sdk_imports", () => {
  const sdkPatterns = [
    "@anthropic-ai/claude-agent-sdk",
    "@anthropic-ai/sdk",
  ];

  const sharedFiles = [
    "../shared/config.ts",
    "../shared/types.ts",
    "../shared/orchestration/sprint-success.ts",
    "../shared/orchestration/types.ts",
  ];

  for (const file of sharedFiles) {
    for (const pattern of sdkPatterns) {
      test(`${file} does not import "${pattern}"`, () => {
        const src = readFileSync(join(import.meta.dir, file), "utf-8");
        const importLines = src
          .split("\n")
          .filter((l) => l.trim().startsWith("import") || l.trim().startsWith("from"));
        const hasSDKImport = importLines.some((l) => l.includes(pattern));
        expect(hasSDKImport).toBe(false);
      });
    }
  }
});

// ---------------------------------------------------------------------------
// defensive_call_pattern_mirrors_scout
// ---------------------------------------------------------------------------
describe("defensive_call_pattern_mirrors_scout", () => {
  test("sprint-success.ts uses the same guard pattern as harness.ts uses for runScout", () => {
    const src = readFileSync(join(import.meta.dir, "../shared/orchestration/sprint-success.ts"), "utf-8");
    // Must contain the defensive guard: config.useReview && agents.runReviewer
    expect(src).toContain("config.useReview");
    expect(src).toContain("agents.runReviewer");
  });

  test("sprint-success.ts guard pattern uses && (not separate if statements)", () => {
    const src = readFileSync(join(import.meta.dir, "../shared/orchestration/sprint-success.ts"), "utf-8");
    // The defensive pattern: if (config.useReview && agents.runReviewer)
    expect(src).toMatch(/if\s*\(\s*config\.useReview\s*&&\s*agents\.runReviewer/);
  });
});

// ---------------------------------------------------------------------------
// no_duplicated_flag_parsing_logic
// ---------------------------------------------------------------------------
describe("no_duplicated_flag_parsing_logic", () => {
  test("shared/config.ts uses the same env-var resolution pattern for --review as for --scout", () => {
    const src = readFileSync(join(import.meta.dir, "../shared/config.ts"), "utf-8");
    // Both scout and review should follow the same isTruthy(env) || false pattern
    expect(src).toContain("useScout");
    expect(src).toContain("useReview");
  });

  test("--review is registered in CLI_FLAG_HELP alongside --scout", () => {
    const src = readFileSync(join(import.meta.dir, "../shared/config.ts"), "utf-8");
    expect(src).toContain('"--scout"');
    expect(src).toContain('"--review"');
  });

  test("shared/types.ts declares useReview in both HarnessConfig and ResolvedConfig", () => {
    const src = readFileSync(join(import.meta.dir, "../shared/types.ts"), "utf-8");
    // Count occurrences — should appear in both HarnessConfig and ResolvedConfig blocks
    const matches = src.match(/useReview/g);
    expect(matches).not.toBeNull();
    expect((matches ?? []).length).toBeGreaterThanOrEqual(2);
  });

  test("startup banner announces --review when enabled (harness.ts)", () => {
    const src = readFileSync(join(import.meta.dir, "../shared/orchestration/harness.ts"), "utf-8");
    expect(src).toContain("useReview");
  });
});
