import { log, logDebug } from "./logger.ts";
import type { HarnessConfig } from "./types.ts";

// --- Public interfaces (used by harness for structural spans) ---

export interface Tracer {
  startSpan(name: string, metadata?: Record<string, unknown>): Span;
  flush(): Promise<void>;
}

export interface Span {
  startChild(name: string, metadata?: Record<string, unknown>): Span;
  end(metadata?: Record<string, unknown>): void;
}

// --- No-op implementations ---

const noopSpan: Span = {
  startChild() {
    return noopSpan;
  },
  end() {},
};

const noopTracer: Tracer = {
  startSpan() {
    return noopSpan;
  },
  async flush() {},
};

// --- OTEL + Langfuse auto-instrumentation ---
//
// Uses the official Langfuse integration for the Claude Agent SDK:
//   @arizeai/openinference-instrumentation-claude-agent-sdk
//   @langfuse/otel
//   @opentelemetry/sdk-node
//
// This auto-captures all query() calls with full prompts, responses, and tool use.
// Harness-level spans (sprint, attempt, etc.) are structural only.

let otelSdk: { shutdown(): Promise<void> } | null = null;

export function initTracing(config: HarnessConfig): Tracer {
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
    // biome-ignore lint/style/noVar: dynamic require
    var { NodeSDK } = require("@opentelemetry/sdk-node");
    // biome-ignore lint/style/noVar: dynamic require
    var { LangfuseSpanProcessor, isDefaultExportSpan } = require("@langfuse/otel");
    // biome-ignore lint/style/noVar: dynamic require
    var { ClaudeAgentSDKInstrumentation } = require(
      "@arizeai/openinference-instrumentation-claude-agent-sdk",
    );
    // biome-ignore lint/style/noVar: dynamic require
    var ClaudeAgentSDKModule = require("@anthropic-ai/claude-agent-sdk");

    const instrumentation = new ClaudeAgentSDKInstrumentation();
    instrumentation.manuallyInstrument({ ...ClaudeAgentSDKModule });

    const sdk = new NodeSDK({
      spanProcessors: [
        new LangfuseSpanProcessor({
          shouldExportSpan: ({ otelSpan }: { otelSpan: { instrumentationScope: { name: string } } }) =>
            isDefaultExportSpan(otelSpan) ||
            otelSpan.instrumentationScope.name === "@arizeai/openinference-instrumentation-claude-agent-sdk",
        }),
      ],
      instrumentations: [instrumentation],
    });

    sdk.start();
    otelSdk = sdk;

    log("HARNESS", `Langfuse tracing: enabled (${config.langfuseBaseUrl ?? "https://cloud.langfuse.com"})`);

    return {
      startSpan() {
        return noopSpan;
      },
      async flush(): Promise<void> {
        try {
          if (otelSdk) {
            await otelSdk.shutdown();
            otelSdk = null;
          }
        } catch (err) {
          console.warn(`[TRACING] Failed to flush: ${err}`);
        }
      },
    };
  } catch (err) {
    console.warn(`[TRACING] Failed to initialize Langfuse OTEL tracing, continuing without tracing: ${err}`);
    return noopTracer;
  }
}
