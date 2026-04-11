import { type Options, query as originalQuery, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { log, logDebug } from "../shared/logger.ts";
import { noopTracer, type Span, type Tracer } from "../shared/tracing.ts";
import type { ResolvedConfig } from "../shared/types.ts";

// Re-export Options type so Claude-specific agents can import from here
export type { Options };

// --- Instrumented query ---
//
// When Langfuse is enabled, initTracing() replaces this with a version that:
// 1. Auto-captures prompts, responses, and tool use (arize instrumentation)
// 2. Adds cache token counts to usage_details (fixes cost calculation)
// When disabled, this stays as the original SDK query — zero overhead.

let activeQuery: typeof originalQuery = originalQuery;

/** The query function all agents should use. Instrumented when tracing is enabled. */
export { activeQuery as query };

// --- OTEL + Langfuse auto-instrumentation ---

let otelSdk: { shutdown(): Promise<void> } | null = null;

// Structural types for dynamically-imported OTEL modules (avoids `any`)
interface OtelTracer {
  startSpan(name: string, options: { attributes: Record<string, unknown> }, ctx: unknown): OtelSpan;
}
interface OtelSpan {
  setAttributes(attrs: Record<string, unknown>): void;
  end(): void;
}
interface OtelApi {
  context: { active(): unknown; with(ctx: unknown, fn: () => unknown): unknown };
  trace: {
    setSpan(ctx: unknown, span: OtelSpan): unknown;
    getTracer(name: string): OtelTracer;
    getActiveSpan?(): OtelSpan | undefined;
  };
}
type PropagateAttrs = (attrs: Record<string, unknown>, fn: () => unknown) => unknown;

interface TracingDeps {
  NodeSDK: new (opts: {
    spanProcessors: unknown[];
    instrumentations: unknown[];
  }) => { start(): void; shutdown(): Promise<void> };
  LangfuseSpanProcessor: new (opts: Record<string, unknown>) => unknown;
  isDefaultExportSpan: (span: unknown) => boolean;
  ClaudeAgentSDKInstrumentation: new () => { manuallyInstrument(mod: Record<string, unknown>): void };
  ClaudeAgentSDKModule: Record<string, unknown>;
  otelApi: OtelApi;
  propagateAttributes: PropagateAttrs;
}

function loadTracingDeps(): TracingDeps {
  const { NodeSDK } = require("@opentelemetry/sdk-node");
  const { LangfuseSpanProcessor, isDefaultExportSpan } = require("@langfuse/otel");
  const { ClaudeAgentSDKInstrumentation } = require("@arizeai/openinference-instrumentation-claude-agent-sdk");
  const ClaudeAgentSDKModule = require("@anthropic-ai/claude-agent-sdk");
  const otelApi = require("@opentelemetry/api");
  const { propagateAttributes } = require("@langfuse/core");
  return {
    NodeSDK,
    LangfuseSpanProcessor,
    isDefaultExportSpan,
    ClaudeAgentSDKInstrumentation,
    ClaudeAgentSDKModule,
    otelApi,
    propagateAttributes,
  };
}

export function initTracing(config: ResolvedConfig): Tracer {
  if (!config.langfusePublicKey || !config.langfuseSecretKey) {
    logDebug("HARNESS", "Langfuse tracing: disabled (no LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY)");
    return noopTracer;
  }

  try {
    // Set env vars for Langfuse OTEL span processor
    process.env.LANGFUSE_PUBLIC_KEY = config.langfusePublicKey;
    process.env.LANGFUSE_SECRET_KEY = config.langfuseSecretKey;
    if (config.langfuseBaseUrl) {
      process.env.LANGFUSE_BASEURL = config.langfuseBaseUrl;
    }

    // Dynamic imports to avoid loading when tracing is disabled
    const deps = loadTracingDeps();

    // Create a mutable copy — Bun's module namespace objects are frozen
    const mutableSDK = { ...deps.ClaudeAgentSDKModule };

    const instrumentation = new deps.ClaudeAgentSDKInstrumentation();
    instrumentation.manuallyInstrument(mutableSDK);

    // Capture the arize-patched query, then wrap it to fix cache token reporting.
    // The arize instrumentation only reports input_tokens/output_tokens, missing
    // cache_read_input_tokens entirely — which makes Langfuse show wrong costs.
    const arizeQuery = mutableSDK.query as typeof originalQuery;
    activeQuery = async function* patchedQuery(
      params: Parameters<typeof originalQuery>[0],
    ): AsyncGenerator<SDKMessage, void> {
      for await (const msg of arizeQuery(params)) {
        if (msg.type === "result" && msg.usage) {
          const data = {
            input: msg.usage.input_tokens ?? 0,
            output: msg.usage.output_tokens ?? 0,
            cache_read_input_tokens: msg.usage.cache_read_input_tokens ?? 0,
            cache_creation_input_tokens: msg.usage.cache_creation_input_tokens ?? 0,
          };
          const activeSpan = deps.otelApi.trace.getActiveSpan?.();
          if (activeSpan) {
            activeSpan.setAttributes({ "langfuse.observation.usage_details": JSON.stringify(data) });
          }
        }
        yield msg;
      }
    } as typeof originalQuery;

    const sdk = new deps.NodeSDK({
      spanProcessors: [
        new deps.LangfuseSpanProcessor({
          timeout: 15,
          flushAt: 10,
          flushInterval: 15,
          shouldExportSpan: ({ otelSpan }: { otelSpan: { instrumentationScope: { name: string } } }) =>
            deps.isDefaultExportSpan(otelSpan) ||
            otelSpan.instrumentationScope.name === "@arizeai/openinference-instrumentation-claude-agent-sdk" ||
            otelSpan.instrumentationScope.name === "adhd-harness",
        }),
      ],
      instrumentations: [instrumentation],
    });

    sdk.start();
    otelSdk = sdk;

    log("HARNESS", `Langfuse tracing: enabled (${config.langfuseBaseUrl ?? "https://cloud.langfuse.com"})`);

    // Get OTEL tracer for structural spans
    const otelTracer = deps.otelApi.trace.getTracer("adhd-harness");

    return {
      startSpan(name: string, metadata?: Record<string, unknown>): Span {
        return createOtelSpan(otelTracer, deps.otelApi, deps.propagateAttributes, name, metadata, undefined, name);
      },
      async flush(): Promise<void> {
        try {
          if (otelSdk) {
            await otelSdk.shutdown();
            otelSdk = null;
          }
        } catch (err) {
          logDebug("TRACING", `Failed to flush: ${err}`);
        }
      },
    };
  } catch (err) {
    console.warn(`[TRACING] Failed to initialize Langfuse OTEL tracing, continuing without tracing: ${err}`);
    return noopTracer;
  }
}

function createOtelSpan(
  otelTracer: OtelTracer,
  otelApi: OtelApi,
  propagateAttrs: PropagateAttrs,
  name: string,
  metadata?: Record<string, unknown>,
  parentCtx?: unknown,
  traceName?: string,
): Span {
  const activeCtx = parentCtx ?? otelApi.context.active();
  const attrs: Record<string, unknown> = flattenMetadata(metadata);
  // Set trace name directly on the root span so LangfuseSpanProcessor picks it up
  // even if propagateAttributes context doesn't survive Bun's async boundaries
  if (traceName) {
    attrs["langfuse.trace.name"] = traceName;
  }
  const otelSpan = otelTracer.startSpan(name, { attributes: attrs }, activeCtx);
  const spanCtx = otelApi.trace.setSpan(activeCtx, otelSpan);

  return {
    run<T>(fn: () => Promise<T>): Promise<T> {
      return otelApi.context.with(spanCtx, () =>
        // Only set traceName on the root span; children inherit via OTEL context
        traceName ? propagateAttrs({ traceName }, fn) : fn(),
      ) as Promise<T>;
    },

    startChild(childName: string, childMetadata?: Record<string, unknown>): Span {
      return createOtelSpan(otelTracer, otelApi, propagateAttrs, childName, childMetadata, spanCtx);
    },

    end(endMetadata?: Record<string, unknown>): void {
      if (endMetadata) {
        otelSpan.setAttributes(flattenMetadata(endMetadata));
      }
      otelSpan.end();
    },
  };
}

/** Flatten metadata object to OTEL-compatible string attributes. */
function flattenMetadata(metadata?: Record<string, unknown>): Record<string, string> {
  if (!metadata) return {};
  const attrs: Record<string, string> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (value !== undefined && value !== null) {
      attrs[`adhd.${key}`] = String(value);
    }
  }
  return attrs;
}
