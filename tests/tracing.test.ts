import { describe, expect, test } from "bun:test";
import { initTracing, query } from "../shared/tracing.ts";
import type { HarnessConfig } from "../shared/types.ts";

const baseConfig: HarnessConfig = {
  userPrompt: "test",
  workDir: "/tmp/test",
  maxSprints: 1,
  maxRetriesPerSprint: 0,
  passThreshold: 7,
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
    const config: HarnessConfig = {
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
