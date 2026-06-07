/**
 * F9 — Invalid log-level warning
 *
 * When LOG_LEVEL is set to an unrecognised value, the harness must emit a warning
 * on the warning channel (console.warn / logWarn) rather than silently ignoring the
 * value. The run still proceeds with the documented fallback level ("normal"), and the
 * warning names the offending value and the fallback applied.
 *
 * Test-first: the assertions below FAIL against the current code (silent ignore)
 * and PASS once the fix lands.
 */

import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { resolveConfig } from "../shared/config.ts";

const baseCli = {
  prompt: "test",
  greenfield: false,
  resume: false,
  verbose: false,
  quiet: false,
  noInteractive: false,
  debug: false,
  dryRun: false,
  noBdd: false,
  noTdd: false,
  noDocs: false,
};

describe("invalid LOG_LEVEL env var", () => {
  let warnSpy: ReturnType<typeof spyOn>;
  let originalLogLevel: string | undefined;

  beforeEach(() => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    originalLogLevel = process.env.LOG_LEVEL;
  });

  afterEach(() => {
    warnSpy.mockRestore();
    if (originalLogLevel === undefined) {
      delete process.env.LOG_LEVEL;
    } else {
      process.env.LOG_LEVEL = originalLogLevel;
    }
  });

  it("emits a warning on console.warn when LOG_LEVEL is unrecognised", () => {
    process.env.LOG_LEVEL = "turbo-verbose";

    resolveConfig(baseCli);

    const warnCalls = warnSpy.mock.calls.map((args: unknown[]) => String(args[0]));
    expect(warnCalls.some((m: string) => m.toLowerCase().includes("log") || m.toLowerCase().includes("level"))).toBe(true);
  });

  it("includes the offending value in the warning message", () => {
    process.env.LOG_LEVEL = "INVALID_LEVEL";

    resolveConfig(baseCli);

    const warnCalls = warnSpy.mock.calls.map((args: unknown[]) => String(args[0]));
    expect(warnCalls.some((m: string) => m.includes("INVALID_LEVEL"))).toBe(true);
  });

  it("falls back to 'normal' log level when LOG_LEVEL is unrecognised", () => {
    process.env.LOG_LEVEL = "extremelyverbose";

    const config = resolveConfig(baseCli);

    expect(config.logLevel).toBe("normal");
  });

  it("does NOT warn when LOG_LEVEL is a valid value", () => {
    process.env.LOG_LEVEL = "verbose";

    resolveConfig(baseCli);

    const warnCalls = warnSpy.mock.calls.map((args: unknown[]) => String(args[0]));
    // No warning about LOG_LEVEL for a valid value
    expect(warnCalls.some((m: string) => m.includes("extremelyverbose") || m.includes("INVALID"))).toBe(false);
  });

  it("does NOT warn when LOG_LEVEL is absent", () => {
    delete process.env.LOG_LEVEL;

    resolveConfig(baseCli);

    const warnCalls = warnSpy.mock.calls.map((args: unknown[]) => String(args[0]));
    // No LOG_LEVEL warning when env var is simply absent
    expect(
      warnCalls.some((m: string) => m.includes("LOG_LEVEL") || (m.includes("log") && m.includes("level"))),
    ).toBe(false);
  });
});
