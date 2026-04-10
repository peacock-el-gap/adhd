import { describe, expect, test } from "bun:test";
import { parseCli, resolveConfig } from "../shared/config.ts";
import type { HarnessConfig } from "../shared/types.ts";

/**
 * Tests for Sprint 2 features: harness orchestration integration,
 * --no-docs CLI flag, --model-documenter override, and documenter git commit.
 *
 * These are unit tests for config/CLI parsing. Integration tests for the
 * actual harness orchestration are covered by structural analysis of harness.ts.
 */

// =====================================================
// --no-docs CLI flag (Feature 5)
// =====================================================

describe("--no-docs CLI flag", () => {
  test("parseCli accepts --no-docs without throwing (strict mode)", () => {
    expect(() => parseCli(["--no-docs", "test"])).not.toThrow();
  });

  test("--no-docs sets noDocs to true in ParsedCli", () => {
    const cli = parseCli(["--no-docs", "test"]);
    expect(cli.noDocs).toBe(true);
  });

  test("noDocs defaults to false when not passed", () => {
    const cli = parseCli(["test"]);
    expect(cli.noDocs).toBe(false);
  });
});

// =====================================================
// ADHD_NO_DOCS environment variable (Feature 5)
// =====================================================

describe("ADHD_NO_DOCS env var", () => {
  const baseCli = {
    prompt: "test", greenfield: false, resume: false, verbose: false,
    quiet: false, noInteractive: false, debug: false, dryRun: false,
    noBdd: false, noTdd: false, noDocs: false,
  };

  test("ADHD_NO_DOCS=1 sets noDocs to true", () => {
    const prev = process.env.ADHD_NO_DOCS;
    process.env.ADHD_NO_DOCS = "1";
    try {
      const config = resolveConfig({ ...baseCli });
      expect(config.noDocs).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.ADHD_NO_DOCS;
      else process.env.ADHD_NO_DOCS = prev;
    }
  });

  test("ADHD_NO_DOCS=true sets noDocs to true", () => {
    const prev = process.env.ADHD_NO_DOCS;
    process.env.ADHD_NO_DOCS = "true";
    try {
      const config = resolveConfig({ ...baseCli });
      expect(config.noDocs).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.ADHD_NO_DOCS;
      else process.env.ADHD_NO_DOCS = prev;
    }
  });

  test("ADHD_NO_DOCS not set and --no-docs not passed results in noDocs false", () => {
    const prev = process.env.ADHD_NO_DOCS;
    delete process.env.ADHD_NO_DOCS;
    try {
      const config = resolveConfig({ ...baseCli });
      expect(config.noDocs).toBe(false);
    } finally {
      if (prev !== undefined) process.env.ADHD_NO_DOCS = prev;
    }
  });

  test("--no-docs CLI flag takes precedence over ADHD_NO_DOCS=0", () => {
    const prev = process.env.ADHD_NO_DOCS;
    process.env.ADHD_NO_DOCS = "0";
    try {
      const config = resolveConfig({ ...baseCli, noDocs: true });
      expect(config.noDocs).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.ADHD_NO_DOCS;
      else process.env.ADHD_NO_DOCS = prev;
    }
  });
});

// =====================================================
// HarnessConfig noDocs field (Feature 5)
// =====================================================

describe("HarnessConfig noDocs field", () => {
  test("noDocs field exists and defaults to false in resolved config", () => {
    const prev = process.env.ADHD_NO_DOCS;
    delete process.env.ADHD_NO_DOCS;
    try {
      const config = resolveConfig({
        prompt: "test", greenfield: false, resume: false, verbose: false,
        quiet: false, noInteractive: false, debug: false, dryRun: false,
        noBdd: false, noTdd: false, noDocs: false,
      });
      expect(config.noDocs).toBe(false);
      expect(typeof config.noDocs).toBe("boolean");
    } finally {
      if (prev !== undefined) process.env.ADHD_NO_DOCS = prev;
    }
  });
});

// =====================================================
// --model-documenter CLI flag (Feature 6)
// =====================================================

describe("--model-documenter CLI flag", () => {
  test("parseCli accepts --model-documenter", () => {
    const cli = parseCli(["--model-documenter", "claude-sonnet-4-20250514", "test"]);
    expect(cli.modelDocumenter).toBe("claude-sonnet-4-20250514");
  });

  test("modelDocumenter defaults to undefined", () => {
    const cli = parseCli(["test"]);
    expect(cli.modelDocumenter).toBeUndefined();
  });
});

describe("modelDocumenter in resolveConfig", () => {
  const baseCli = {
    prompt: "test", greenfield: false, resume: false, verbose: false,
    quiet: false, noInteractive: false, debug: false, dryRun: false,
    noBdd: false, noTdd: false, noDocs: false,
  };

  test("CLI --model-documenter populates config.modelDocumenter", () => {
    const config = resolveConfig({ ...baseCli, modelDocumenter: "claude-sonnet-4-20250514" });
    expect(config.modelDocumenter).toBe("claude-sonnet-4-20250514");
  });

  test("modelDocumenter defaults to undefined (falls back to base model at call site)", () => {
    const prev = process.env.MODEL_DOCUMENTER;
    delete process.env.MODEL_DOCUMENTER;
    try {
      const config = resolveConfig({ ...baseCli });
      expect(config.modelDocumenter).toBeUndefined();
    } finally {
      if (prev !== undefined) process.env.MODEL_DOCUMENTER = prev;
    }
  });

  test("MODEL_DOCUMENTER env var is used when no CLI flag", () => {
    const prev = process.env.MODEL_DOCUMENTER;
    process.env.MODEL_DOCUMENTER = "claude-haiku-4-5-20251001";
    try {
      const config = resolveConfig({ ...baseCli });
      expect(config.modelDocumenter).toBe("claude-haiku-4-5-20251001");
    } finally {
      if (prev === undefined) delete process.env.MODEL_DOCUMENTER;
      else process.env.MODEL_DOCUMENTER = prev;
    }
  });

  test("CLI --model-documenter takes precedence over MODEL_DOCUMENTER env var", () => {
    const prev = process.env.MODEL_DOCUMENTER;
    process.env.MODEL_DOCUMENTER = "claude-haiku-4-5-20251001";
    try {
      const config = resolveConfig({ ...baseCli, modelDocumenter: "claude-opus-4-6" });
      expect(config.modelDocumenter).toBe("claude-opus-4-6");
    } finally {
      if (prev === undefined) delete process.env.MODEL_DOCUMENTER;
      else process.env.MODEL_DOCUMENTER = prev;
    }
  });
});

// =====================================================
// Skills routing for documenter (Feature 8 / Sprint 2 criteria)
// =====================================================

describe("documenter skills routing", () => {
  test("routeSkillsForAgent accepts 'documenter' as agent role", () => {
    const { routeSkillsForAgent } = require("../shared/skills.ts");
    const result = routeSkillsForAgent([], "documenter");
    expect(result).toBeDefined();
    expect(result.injected).toBe("");
    expect(result.referenceManifest).toBe("");
    expect(result.additionalDirs).toEqual([]);
  });
});
