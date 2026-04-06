import type { HarnessConfig } from "./types.ts";

// --- Public interfaces (used by agents regardless of whether Langfuse is enabled) ---

export interface Tracer {
  startSpan(name: string, metadata?: Record<string, unknown>): Span;
  flush(): Promise<void>;
}

export interface Span {
  logMessage(role: string, content: string): void;
  logToolCall(name: string, input: unknown, output?: string): void;
  startChild(name: string, metadata?: Record<string, unknown>): Span;
  end(metadata?: Record<string, unknown>): void;
}

// --- No-op implementations ---

const noopSpan: Span = {
  logMessage() {},
  logToolCall() {},
  startChild() { return noopSpan; },
  end() {},
};

const noopTracer: Tracer = {
  startSpan() { return noopSpan; },
  async flush() {},
};

// --- Langfuse-backed implementations ---

export function initTracing(config: HarnessConfig): Tracer {
  if (!config.langfusePublicKey || !config.langfuseSecretKey) {
    return noopTracer;
  }

  try {
    // Dynamic import to avoid loading langfuse when not needed
    // We use require-style since we need synchronous init
    const { Langfuse } = require("langfuse") as typeof import("langfuse");

    const langfuse = new Langfuse({
      publicKey: config.langfusePublicKey,
      secretKey: config.langfuseSecretKey,
      baseUrl: config.langfuseBaseUrl ?? "https://cloud.langfuse.com",
    });

    const traceName = `harness-run-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    const trace = langfuse.trace({
      name: traceName,
      metadata: {
        model: config.model,
        workDir: config.workDir,
        isGreenfield: config.isGreenfield,
        maxSprints: config.maxSprints,
      },
    });

    return {
      startSpan(name: string, metadata?: Record<string, unknown>): Span {
        return createLangfuseSpan(trace.span({ name, metadata }));
      },
      async flush(): Promise<void> {
        try {
          await langfuse.flushAsync();
        } catch (err) {
          console.warn(`[TRACING] Failed to flush Langfuse data: ${err}`);
        }
      },
    };
  } catch (err) {
    console.warn(`[TRACING] Failed to initialize Langfuse, continuing without tracing: ${err}`);
    return noopTracer;
  }
}

function createLangfuseSpan(langfuseSpan: any): Span {
  const messages: Array<{ role: string; content: string }> = [];

  return {
    logMessage(role: string, content: string): void {
      messages.push({ role, content: content.slice(0, 10000) }); // cap to avoid huge payloads
    },

    logToolCall(name: string, input: unknown, output?: string): void {
      try {
        langfuseSpan.event({
          name: `tool:${name}`,
          metadata: {
            input: typeof input === "string" ? input.slice(0, 5000) : input,
            ...(output ? { output: output.slice(0, 5000) } : {}),
          },
        });
      } catch {
        // fire-and-forget
      }
    },

    startChild(name: string, metadata?: Record<string, unknown>): Span {
      try {
        return createLangfuseSpan(langfuseSpan.span({ name, metadata }));
      } catch {
        return noopSpan;
      }
    },

    end(metadata?: Record<string, unknown>): void {
      try {
        langfuseSpan.end({
          metadata: {
            ...metadata,
            messages: messages.slice(-50), // cap message history
          },
        });
      } catch {
        // fire-and-forget
      }
    },
  };
}
