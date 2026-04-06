import { describe, expect, test } from "bun:test";
import { initTracing, type Span } from "../shared/tracing.ts";
import type { HarnessConfig } from "../shared/types.ts";

const baseConfig: HarnessConfig = {
  userPrompt: "test",
  workDir: "/tmp/test",
  maxSprints: 1,
  maxRetriesPerSprint: 0,
  passThreshold: 7,
};

describe("initTracing — noop when disabled", () => {
  test("returns noop tracer when no Langfuse keys", () => {
    const tracer = initTracing(baseConfig);
    expect(tracer).toBeDefined();
    expect(typeof tracer.startSpan).toBe("function");
    expect(typeof tracer.flush).toBe("function");
  });

  test("noop tracer.startSpan returns a span with startChild and end", () => {
    const tracer = initTracing(baseConfig);
    const span = tracer.startSpan("test-span");
    expect(typeof span.startChild).toBe("function");
    expect(typeof span.end).toBe("function");
  });

  test("noop span operations do not throw", () => {
    const tracer = initTracing(baseConfig);
    const span = tracer.startSpan("test-span", { key: "value" });
    const child = span.startChild("child-span", { nested: true });
    child.end({ result: "ok" });
    span.end({ result: "done" });
  });

  test("noop flush resolves without error", async () => {
    const tracer = initTracing(baseConfig);
    await tracer.flush();
  });

  test("noop span.startChild returns chainable spans", () => {
    const tracer = initTracing(baseConfig);
    const span = tracer.startSpan("root");
    const child = span.startChild("child");
    const grandchild = child.startChild("grandchild");
    grandchild.end();
    child.end();
    span.end();
  });
});

describe("initTracing — graceful fallback with invalid keys", () => {
  test("returns working tracer even with invalid Langfuse credentials", () => {
    const config: HarnessConfig = {
      ...baseConfig,
      langfusePublicKey: "pk-lf-invalid",
      langfuseSecretKey: "sk-lf-invalid",
      langfuseBaseUrl: "https://cloud.langfuse.com",
    };
    // Should not throw — falls back to noop if OTEL init fails
    const tracer = initTracing(config);
    expect(tracer).toBeDefined();
    expect(typeof tracer.startSpan).toBe("function");
    expect(typeof tracer.flush).toBe("function");
  });
});

describe("Span interface contract", () => {
  test("Span has no logMessage or logToolCall methods", () => {
    const tracer = initTracing(baseConfig);
    const span = tracer.startSpan("test") as unknown as Record<string, unknown>;
    expect(span.logMessage).toBeUndefined();
    expect(span.logToolCall).toBeUndefined();
  });
});
