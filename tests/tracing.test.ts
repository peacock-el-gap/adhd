import { describe, expect, test } from "bun:test";
import { initTracing, query } from "../shared/tracing.ts";
import type { ResolvedConfig } from "../shared/types.ts";

const baseConfig: ResolvedConfig = {
  userPrompt: "test",
  workDir: "/tmp/test",
  maxSprints: 1,
  maxRetriesPerSprint: 0,
  passThreshold: 7,
  model: "claude-opus-4-6",
  isGreenfield: false,
  isResume: false,
  logLevel: "normal",
  interactive: true,
  harnessDir: "/tmp/test/.adhd",
  isDryRun: false,
  sourceDir: "src",
  testDir: "tests",
  noBdd: false,
  noTdd: false,
  noDocs: false,
  lintGate: false,
  refineSpec: false,
  resolvedModelPlanner: "claude-opus-4-6",
  resolvedModelGenerator: "claude-opus-4-6",
  resolvedModelEvaluator: "claude-opus-4-6",
  resolvedModelDocumenter: "claude-opus-4-6",
};

describe("initTracing — noop when disabled", () => {
  test("returns tracer with flush when no Langfuse keys", () => {
    const tracer = initTracing(baseConfig);
    expect(tracer).toBeDefined();
    expect(typeof tracer.flush).toBe("function");
  });

  test("noop flush resolves without error", async () => {
    const tracer = initTracing(baseConfig);
    await tracer.flush();
  });
});

describe("query export", () => {
  test("query is exported as a function", () => {
    expect(typeof query).toBe("function");
  });

  test("query is the SDK query function when tracing is not initialized", () => {
    // Before initTracing with keys, query should be the original SDK function
    const { query: sdkQuery } = require("@anthropic-ai/claude-agent-sdk");
    expect(query).toBe(sdkQuery);
  });
});

describe("initTracing — with Langfuse keys", () => {
  test("returns working tracer and does not throw", () => {
    const config: ResolvedConfig = {
      ...baseConfig,
      langfusePublicKey: "pk-lf-test",
      langfuseSecretKey: "sk-lf-test",
      langfuseBaseUrl: "https://cloud.langfuse.com",
    };
    const tracer = initTracing(config);
    expect(tracer).toBeDefined();
    expect(typeof tracer.flush).toBe("function");
  });
});

// --- Noop tracer span methods (consolidated from shared/tracing.test.ts) ---

describe("noop tracer span methods", () => {
  test("startSpan returns a span with expected methods", () => {
    const tracer = initTracing(baseConfig);
    const span = tracer.startSpan("test-span");
    expect(typeof span.run).toBe("function");
    expect(typeof span.startChild).toBe("function");
    expect(typeof span.end).toBe("function");
  });

  test("span.run executes the function normally", async () => {
    const tracer = initTracing(baseConfig);
    const span = tracer.startSpan("test");
    const result = await span.run(async () => 42);
    expect(result).toBe(42);
  });

  test("span.end does not throw", () => {
    const tracer = initTracing(baseConfig);
    const span = tracer.startSpan("test");
    expect(() => span.end()).not.toThrow();
    expect(() => span.end({ key: "value" })).not.toThrow();
  });

  test("span startChild returns another working span", async () => {
    const tracer = initTracing(baseConfig);
    const parent = tracer.startSpan("parent");
    const child = parent.startChild("child");
    const result = await child.run(async () => "nested");
    expect(result).toBe("nested");
    child.end();
  });
});
