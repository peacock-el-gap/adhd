import { describe, expect, test } from "bun:test";
import { parseCli, resolveConfig } from "../shared/config.ts";

const baseCli = {
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

// =====================================================
// CLI Parsing: --sprint flag
// =====================================================

describe("parseCli --sprint flag", () => {
  test("parses --sprint 3 correctly", () => {
    const cli = parseCli(["--sprint", "3"]);
    expect(cli.sprint).toBe(3);
  });

  test("--sprint defaults to undefined when omitted", () => {
    const cli = parseCli(["test prompt"]);
    expect(cli.sprint).toBeUndefined();
  });

  test("parses --sprint 1 correctly", () => {
    const cli = parseCli(["--sprint", "1"]);
    expect(cli.sprint).toBe(1);
  });

  test("parses --sprint with large value", () => {
    const cli = parseCli(["--sprint", "99"]);
    expect(cli.sprint).toBe(99);
  });
});

// =====================================================
// Config: sprint field on HarnessConfig
// =====================================================

describe("resolveConfig sprint field", () => {
  test("maps parsed CLI sprint to config.sprint", () => {
    const config = resolveConfig({ ...baseCli, sprint: 3 });
    expect(config.sprint).toBe(3);
  });

  test("sprint is undefined when not provided", () => {
    const config = resolveConfig({ ...baseCli, prompt: "test" });
    expect(config.sprint).toBeUndefined();
  });
});

// =====================================================
// Mutual Exclusion: --sprint and --resume
// =====================================================

describe("sprint and resume mutual exclusion", () => {
  test("throws when both --sprint and --resume are set", () => {
    expect(() =>
      resolveConfig({ ...baseCli, sprint: 3, resume: true })
    ).toThrow("Cannot use --sprint and --resume together");
  });

  test("--sprint alone works without error", () => {
    const config = resolveConfig({ ...baseCli, sprint: 3 });
    expect(config.sprint).toBe(3);
  });

  test("--resume alone works without error", () => {
    const config = resolveConfig({ ...baseCli, resume: true });
    expect(config.isResume).toBe(true);
  });
});

// =====================================================
// Sprint flag validation
// =====================================================

describe("sprint flag validation", () => {
  test("rejects --sprint 0", () => {
    expect(() =>
      resolveConfig({ ...baseCli, sprint: 0 })
    ).toThrow("Invalid --sprint value");
  });

  test("rejects --sprint -1", () => {
    expect(() =>
      resolveConfig({ ...baseCli, sprint: -1 })
    ).toThrow("Invalid --sprint value");
  });

  test("rejects non-integer sprint (NaN from non-numeric)", () => {
    // parseCli would produce NaN for non-numeric
    expect(() =>
      resolveConfig({ ...baseCli, sprint: NaN })
    ).toThrow("Invalid --sprint value");
  });

  test("accepts --sprint 1 (minimum valid)", () => {
    const config = resolveConfig({ ...baseCli, sprint: 1 });
    expect(config.sprint).toBe(1);
  });
});

// =====================================================
// No prompt required in sprint mode
// =====================================================

describe("no prompt required for sprint mode", () => {
  test("--sprint N without a prompt does not throw", () => {
    const config = resolveConfig({ ...baseCli, sprint: 3 });
    expect(config.sprint).toBe(3);
    expect(config.userPrompt).toBe("");
  });

  test("without --sprint or --resume, missing prompt throws", () => {
    expect(() =>
      resolveConfig({ ...baseCli })
    ).toThrow("A prompt is required");
  });
});

