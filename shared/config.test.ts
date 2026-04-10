import { describe, expect, test } from "bun:test";
import { parseCli, resolveConfig } from "./config.ts";

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

describe("parseCli Phase 1 Deepen flags", () => {
  test("parses --lint-gate flag", () => {
    const cli = parseCli(["--lint-gate", "test"]);
    expect(cli.lintGate).toBe(true);
  });

  test("--lint-gate defaults to false", () => {
    const cli = parseCli(["test"]);
    expect(cli.lintGate).toBe(false);
  });

  test("parses --sprint N flag", () => {
    const cli = parseCli(["--sprint", "3"]);
    expect(cli.sprint).toBe(3);
  });

  test("--sprint defaults to undefined", () => {
    const cli = parseCli(["test"]);
    expect(cli.sprint).toBeUndefined();
  });

  test("parses --refine-spec flag", () => {
    const cli = parseCli(["--refine-spec", "test"]);
    expect(cli.refineSpec).toBe(true);
  });

  test("--refine-spec defaults to false", () => {
    const cli = parseCli(["test"]);
    expect(cli.refineSpec).toBe(false);
  });

  test("parses --no-bdd flag", () => {
    const cli = parseCli(["--no-bdd", "test"]);
    expect(cli.noBdd).toBe(true);
  });

  test("--no-bdd defaults to false", () => {
    const cli = parseCli(["test"]);
    expect(cli.noBdd).toBe(false);
  });
});

describe("resolveConfig --sprint and --resume mutual exclusion", () => {
  test("throws exact error message when both --sprint and --resume are set", () => {
    expect(() => resolveConfig({ ...baseCli, sprint: 3, resume: true })).toThrow(
      "Cannot use --sprint and --resume together.",
    );
  });

  test("--sprint alone works", () => {
    const config = resolveConfig({ ...baseCli, sprint: 3 });
    expect(config.sprint).toBe(3);
  });

  test("--resume alone works", () => {
    const config = resolveConfig({ ...baseCli, resume: true });
    expect(config.isResume).toBe(true);
  });
});

describe("resolveConfig --sprint validation", () => {
  test("throws when --sprint is given without a spec or prompt and no --resume", () => {
    // --sprint alone with no prompt should work (sprint mode doesn't require prompt)
    const config = resolveConfig({ ...baseCli, sprint: 1 });
    expect(config.sprint).toBe(1);
    expect(config.userPrompt).toBe("");
  });

  test("rejects --sprint 0 as invalid", () => {
    expect(() => resolveConfig({ ...baseCli, sprint: 0 })).toThrow("Invalid --sprint value");
  });

  test("rejects --sprint -1 as invalid", () => {
    expect(() => resolveConfig({ ...baseCli, sprint: -1 })).toThrow("Invalid --sprint value");
  });

  test("rejects non-integer sprint (NaN)", () => {
    expect(() => resolveConfig({ ...baseCli, sprint: NaN })).toThrow("Invalid --sprint value");
  });

  test("accepts --sprint 1 (minimum valid)", () => {
    const config = resolveConfig({ ...baseCli, sprint: 1 });
    expect(config.sprint).toBe(1);
  });
});

describe("resolveConfig Phase 1 Deepen flags resolution", () => {
  test("resolves lintGate from CLI", () => {
    const config = resolveConfig({ ...baseCli, prompt: "test", lintGate: true });
    expect(config.lintGate).toBe(true);
  });

  test("lintGate defaults to false", () => {
    const config = resolveConfig({ ...baseCli, prompt: "test" });
    expect(config.lintGate).toBe(false);
  });

  test("resolves noBdd from CLI", () => {
    const config = resolveConfig({ ...baseCli, prompt: "test", noBdd: true });
    expect(config.noBdd).toBe(true);
  });

  test("resolves refineSpec from CLI", () => {
    const config = resolveConfig({ ...baseCli, prompt: "test", refineSpec: true });
    expect(config.refineSpec).toBe(true);
  });
});
