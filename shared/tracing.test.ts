import { describe, expect, it } from "bun:test";
import { initTracing } from "./tracing.ts";
import type { HarnessConfig } from "./types.ts";

describe("tracing", () => {
  const baseConfig: HarnessConfig = {
    userPrompt: "test",
    workDir: "/tmp/test",
    maxSprints: 5,
    maxRetriesPerSprint: 3,
    passThreshold: 7,
    noBdd: false,
    noTdd: false,
    noDocs: false,
  };

  it("returns a noop tracer when no langfuse keys are configured", () => {
    const tracer = initTracing(baseConfig);
    expect(tracer).toBeDefined();
    expect(typeof tracer.startSpan).toBe("function");
    expect(typeof tracer.flush).toBe("function");
  });

  it("noop tracer startSpan returns a span with expected methods", () => {
    const tracer = initTracing(baseConfig);
    const span = tracer.startSpan("test-span");
    expect(typeof span.run).toBe("function");
    expect(typeof span.startChild).toBe("function");
    expect(typeof span.end).toBe("function");
  });

  it("noop span.run executes the function normally", async () => {
    const tracer = initTracing(baseConfig);
    const span = tracer.startSpan("test");
    const result = await span.run(async () => 42);
    expect(result).toBe(42);
  });

  it("noop tracer flush resolves without error", async () => {
    const tracer = initTracing(baseConfig);
    await expect(tracer.flush()).resolves.toBeUndefined();
  });

  it("noop span.end does not throw", () => {
    const tracer = initTracing(baseConfig);
    const span = tracer.startSpan("test");
    expect(() => span.end()).not.toThrow();
    expect(() => span.end({ key: "value" })).not.toThrow();
  });

  it("noop span startChild returns another working span", async () => {
    const tracer = initTracing(baseConfig);
    const parent = tracer.startSpan("parent");
    const child = parent.startChild("child");
    const result = await child.run(async () => "nested");
    expect(result).toBe("nested");
    child.end();
  });
});
