// --- Public interfaces (SDK-independent) ---

export interface Tracer {
  startSpan(name: string, metadata?: Record<string, unknown>): Span;
  flush(): Promise<void>;
}

export interface Span {
  /** Run a function within this span's OTEL context. SDK calls inside will nest under this span. */
  run<T>(fn: () => Promise<T>): Promise<T>;
  startChild(name: string, metadata?: Record<string, unknown>): Span;
  end(metadata?: Record<string, unknown>): void;
}

// --- No-op implementations ---

export const noopSpan: Span = {
  run: <T>(fn: () => Promise<T>) => fn(),
  startChild() {
    return noopSpan;
  },
  end() {},
};

export const noopTracer: Tracer = {
  startSpan() {
    return noopSpan;
  },
  async flush() {},
};
