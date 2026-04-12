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
  notify: false,
  commitAdhd: false,
  commitAdhdLogs: false,
};

// --- HITL Notifications ---

describe("parseCli --notify flag", () => {
  test("parses --notify flag", () => {
    const cli = parseCli(["--notify", "test"]);
    expect(cli.notify).toBe(true);
  });

  test("--notify defaults to false", () => {
    const cli = parseCli(["test"]);
    expect(cli.notify).toBe(false);
  });
});

describe("resolveConfig --notify", () => {
  test("notify defaults to false", () => {
    const config = resolveConfig({ ...baseCli, prompt: "test" });
    expect(config.notify).toBe(false);
  });

  test("notify true when --notify set", () => {
    const config = resolveConfig({ ...baseCli, prompt: "test", notify: true });
    expect(config.notify).toBe(true);
  });
});

// --- --commit-adhd and --commit-adhd-logs ---

describe("parseCli --commit-adhd flags", () => {
  test("parses --commit-adhd flag", () => {
    const cli = parseCli(["--commit-adhd", "test"]);
    expect(cli.commitAdhd).toBe(true);
  });

  test("--commit-adhd defaults to false", () => {
    const cli = parseCli(["test"]);
    expect(cli.commitAdhd).toBe(false);
  });

  test("parses --commit-adhd-logs flag", () => {
    const cli = parseCli(["--commit-adhd-logs", "test"]);
    expect(cli.commitAdhdLogs).toBe(true);
  });

  test("--commit-adhd-logs defaults to false", () => {
    const cli = parseCli(["test"]);
    expect(cli.commitAdhdLogs).toBe(false);
  });
});

describe("resolveConfig --commit-adhd flags", () => {
  test("commitAdhd defaults to false", () => {
    const config = resolveConfig({ ...baseCli, prompt: "test" });
    expect(config.commitAdhd).toBe(false);
  });

  test("commitAdhdLogs defaults to false", () => {
    const config = resolveConfig({ ...baseCli, prompt: "test" });
    expect(config.commitAdhdLogs).toBe(false);
  });

  test("commitAdhd true when --commit-adhd set", () => {
    const config = resolveConfig({ ...baseCli, prompt: "test", commitAdhd: true });
    expect(config.commitAdhd).toBe(true);
  });

  test("commitAdhdLogs true when --commit-adhd-logs set", () => {
    const config = resolveConfig({ ...baseCli, prompt: "test", commitAdhdLogs: true });
    expect(config.commitAdhdLogs).toBe(true);
  });

  test("--commit-adhd-logs implies commitAdhd", () => {
    const config = resolveConfig({ ...baseCli, prompt: "test", commitAdhdLogs: true, commitAdhd: false });
    expect(config.commitAdhd).toBe(true);
    expect(config.commitAdhdLogs).toBe(true);
  });

  test("default behavior: no adhd commits when neither flag set", () => {
    const config = resolveConfig({ ...baseCli, prompt: "test" });
    expect(config.commitAdhd).toBe(false);
    expect(config.commitAdhdLogs).toBe(false);
  });
});
