/**
 * Tests for Sprint 4 / F5 — Robust, visible interactive gates and degradations.
 *
 * Three behaviours are covered:
 *  1. Editor-launch failure at the spec-approval gate returns a clear message
 *     and returns the operator to the gate instead of crashing the run.
 *  2. An empty "revise" submission shows a message and re-presents the gate
 *     rather than silently looping.
 *  3. Documenter degradation messages are routed through the warning channel
 *     (console.warn / logWarn) rather than plain stdout (console.log / log).
 *
 * TDD note: the initial commit of this file imports `tryExecEditor` and
 * `classifyReviseInput` from gates.ts — these did not exist before the fix,
 * making those tests RED. The documenter-degradation test was RED because
 * console.log was called instead of console.warn. All assertions turn GREEN
 * once the fixes land.
 */

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ── F5.1 — tryExecEditor ─────────────────────────────────────────────────────

import { classifyReviseInput, tryExecEditor } from "../shared/orchestration/gates.ts";

describe("tryExecEditor — editor launch error handling", () => {
  test("returns success:false with a self-contained message when exec throws an Error", () => {
    const fakeExec = (_cmd: string, _opts: { stdio: "inherit" }) => {
      const err = new Error("spawn nonexistent-editor ENOENT");
      (err as NodeJS.ErrnoException).code = "ENOENT";
      throw err;
    };

    const result = tryExecEditor("nonexistent-editor", "/tmp/spec.md", fakeExec);

    expect(result.success).toBe(false);
    if (!result.success) {
      // Message must name the editor that was attempted
      expect(result.message).toContain("nonexistent-editor");
      // Message must tell the operator what to do next
      expect(result.message.toLowerCase()).toContain("editor");
      // Must not expose internal function names
      expect(result.message).not.toContain("execSync");
    }
  });

  test("returns success:false and names the base command when editor has arguments", () => {
    const fakeExec = () => {
      throw new Error("spawn code ENOENT");
    };

    const result = tryExecEditor("code --wait", "/tmp/spec.md", fakeExec);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.message).toContain("code");
      expect(result.message).not.toContain("--wait"); // base name only, not the full command
    }
  });

  test("returns success:true when exec does not throw", () => {
    const fakeExec = (_cmd: string, _opts: { stdio: "inherit" }) => {
      // editor ran successfully — no-op
    };

    const result = tryExecEditor("vim", "/tmp/spec.md", fakeExec);

    expect(result.success).toBe(true);
  });

  test("re-throws non-Error exceptions without wrapping them", () => {
    const fakeExec = () => {
      // biome-ignore lint/complexity/noThisInStaticContext: intentional — simulating an unusual throw
      throw "string-exception";
    };

    expect(() => tryExecEditor("vim", "/tmp/spec.md", fakeExec)).toThrow("string-exception");
  });
});

// ── F5.2 — classifyReviseInput ───────────────────────────────────────────────

describe("classifyReviseInput — empty revise detection", () => {
  test("returns proceed:false with a clear message for an empty string", () => {
    const result = classifyReviseInput("");

    expect(result.proceed).toBe(false);
    if (!result.proceed) {
      expect(result.message).toBeTruthy();
      expect(result.message.length).toBeGreaterThan(10);
      // Must explain what went wrong
      expect(result.message.toLowerCase()).toMatch(/no feedback|feedback was not|nothing entered|empty/);
    }
  });

  test("returns proceed:false for undefined freeText", () => {
    const result = classifyReviseInput(undefined);
    expect(result.proceed).toBe(false);
  });

  test("returns proceed:true for non-empty feedback text", () => {
    const result = classifyReviseInput("The spec is missing error handling requirements.");
    expect(result.proceed).toBe(true);
  });

  test("returns proceed:true for a short but non-empty feedback", () => {
    const result = classifyReviseInput("fix it");
    expect(result.proceed).toBe(true);
  });
});

// ── F5.3 — Documenter degradation warning channel ───────────────────────────

import type { AgentRunners } from "../shared/orchestration/types.ts";
import { runDocumenterPhase } from "../shared/orchestration/sprint-success.ts";
import type { HarnessProgress, ResolvedConfig } from "../shared/types.ts";
import { noopSpan, noopTracer } from "../shared/tracing.ts";

function makeTmpWorkDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "adhd-gates-f5-"));
  mkdirSync(join(dir, ".adhd"), { recursive: true });
  return dir;
}

function makeMinimalConfig(workDir: string): ResolvedConfig {
  return {
    userPrompt: "test",
    workDir,
    maxSprints: 1,
    maxRetriesPerSprint: 1,
    passThreshold: 7,
    maxFeatures: 3,
    maxCriteria: 10,
    maxSurfaces: 3,
    model: "test-model",
    isGreenfield: false,
    isResume: false,
    logLevel: "quiet",
    interactive: false,
    harnessDir: join(workDir, ".adhd"),
    isDryRun: false,
    sourceDir: "src",
    testDir: "tests",
    noBdd: true,
    noTdd: true,
    noDocs: false,
    lintGate: false,
    testGate: false,
    refineSpec: false,
    resolvedModelPlanner: "test-model",
    resolvedModelGenerator: "test-model",
    resolvedModelEvaluator: "test-model",
    resolvedModelDocumenter: "test-model",
    resolvedModelReviewer: "test-model",
    resolvedMaxTurnsPlanner: 5,
    resolvedMaxTurnsGenerator: 10,
    resolvedMaxTurnsEvaluator: 5,
    resolvedMaxTurnsDocumenter: 5,
    notify: false,
    commitAdhd: false,
    commitAdhdLogs: false,
    allowMain: false,
    disableMcp: true,
    addMcpServers: {},
  };
}

function makeMinimalProgress(): HarnessProgress {
  return {
    status: "documenting",
    currentSprint: 1,
    totalSprints: 1,
    completedSprints: 1,
    retryCount: 0,
  };
}

const noopUsage = {
  recordStage: () => {},
  printSummary: () => {},
  save: async () => {},
  getStages: () => [] as const,
};

function makeMinimalAgents(override: Partial<AgentRunners>): AgentRunners {
  return {
    initTracing: () => noopTracer,
    runPlanner: async () => ({ spec: "" }),
    runGenerator: async () => ({ response: "" }),
    runEvaluator: async () => ({ passed: false, scores: {}, feedback: [], overallSummary: "" }),
    negotiateContract: async () => ({ sprintNumber: 1, features: [], surfaces: [], criteria: [] }),
    ensureGeneratorCommit: async () => "none" as const,
    ensureDocumenterCommit: async () => "none" as const,
    runDocumenter: async () => ({}),
    ...override,
  };
}

describe("runDocumenterPhase — degradation messages use warning channel", () => {
  test("outer catch: documenter failure goes to console.warn (logWarn), not console.log (log)", async () => {
    const workDir = makeTmpWorkDir();
    const warnMessages: string[] = [];
    const logMessages: string[] = [];
    const origWarn = console.warn;
    const origLog = console.log;

    try {
      console.warn = (...args: unknown[]) => {
        warnMessages.push(String(args[0]));
      };
      console.log = (...args: unknown[]) => {
        logMessages.push(String(args[0]));
      };

      await runDocumenterPhase({
        config: makeMinimalConfig(workDir),
        parentSpan: noopSpan,
        usage: noopUsage,
        documenterSkills: undefined,
        results: [],
        progress: makeMinimalProgress(),
        agents: makeMinimalAgents({
          runDocumenter: async () => {
            throw new Error("simulated documenter failure");
          },
        }),
      });
    } finally {
      console.warn = origWarn;
      console.log = origLog;
      rmSync(workDir, { recursive: true });
    }

    // After fix: the failure message goes through logWarn → console.warn
    const warnHasDocFailure = warnMessages.some(
      (m) => m.includes("Documenter failed") || m.includes("simulated documenter failure"),
    );
    expect(warnHasDocFailure).toBe(true);

    // Before fix: the message went through log → console.log with "WARNING:" prefix
    const logHasDocFailure = logMessages.some((m) => m.includes("WARNING: Documenter failed"));
    expect(logHasDocFailure).toBe(false);
  });

  test("inner catch: commit enforcement failure goes to console.warn, not console.log", async () => {
    const workDir = makeTmpWorkDir();
    const warnMessages: string[] = [];
    const logMessages: string[] = [];
    const origWarn = console.warn;
    const origLog = console.log;

    // For the inner catch to be reachable, git rev-parse HEAD must succeed so
    // beforeDocsSha is non-empty. We use execSync inside the test to set up
    // a real (but empty) git repo with one commit.
    const { execSync } = await import("node:child_process");
    try {
      execSync("git init && git commit --allow-empty -m init", {
        cwd: workDir,
        stdio: "pipe",
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "Test",
          GIT_AUTHOR_EMAIL: "test@test.com",
          GIT_COMMITTER_NAME: "Test",
          GIT_COMMITTER_EMAIL: "test@test.com",
        },
      });
    } catch {
      // If git setup fails, skip this test gracefully
      rmSync(workDir, { recursive: true });
      return;
    }

    try {
      console.warn = (...args: unknown[]) => {
        warnMessages.push(String(args[0]));
      };
      console.log = (...args: unknown[]) => {
        logMessages.push(String(args[0]));
      };

      await runDocumenterPhase({
        config: makeMinimalConfig(workDir),
        parentSpan: noopSpan,
        usage: noopUsage,
        documenterSkills: undefined,
        results: [],
        progress: makeMinimalProgress(),
        agents: makeMinimalAgents({
          runDocumenter: async () => ({}), // succeeds
          ensureDocumenterCommit: async () => {
            throw new Error("simulated commit failure");
          },
        }),
      });
    } finally {
      console.warn = origWarn;
      console.log = origLog;
      rmSync(workDir, { recursive: true });
    }

    // After fix: commit enforcement failure goes through logWarn → console.warn
    const warnHasCommitFailure = warnMessages.some(
      (m) =>
        m.includes("commit enforcement failed") ||
        m.includes("simulated commit failure"),
    );
    expect(warnHasCommitFailure).toBe(true);

    // Before fix: went through log → console.log with "WARNING:" prefix
    const logHasCommitFailure = logMessages.some((m) => m.includes("WARNING: Documenter commit enforcement failed"));
    expect(logHasCommitFailure).toBe(false);
  });
});
