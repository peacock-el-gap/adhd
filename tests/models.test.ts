import { describe, expect, test } from "bun:test";
import {
  blankToUndefined,
  DEFAULT_MODEL_DOCUMENTER,
  DEFAULT_MODEL_EVALUATOR,
  DEFAULT_MODEL_GENERATOR,
  DEFAULT_MODEL_PLANNER,
  describeAgentModels,
  evaluatorInvariantWarning,
  evaluatorWeakerThanGenerator,
  MODEL_HAIKU,
  MODEL_OPUS,
  MODEL_SONNET,
  modelTier,
  resolveAgentModel,
} from "../shared/models.ts";

describe("named tier constants", () => {
  test("are concrete, non-empty, and distinct", () => {
    for (const id of [MODEL_OPUS, MODEL_SONNET, MODEL_HAIKU]) {
      expect(typeof id).toBe("string");
      expect(id.length).toBeGreaterThan(0);
    }
    expect(new Set([MODEL_OPUS, MODEL_SONNET, MODEL_HAIKU]).size).toBe(3);
  });

  test("the stale uniform default string is gone", () => {
    expect([MODEL_OPUS, MODEL_SONNET, MODEL_HAIKU]).not.toContain("claude-opus-4-6");
  });

  test("tiers are pinned to the current generally-available model IDs", () => {
    // This guard is the canary for stale defaults: refreshing a tier must update
    // it here too, so the IDs can never silently drift behind the current models.
    expect(MODEL_OPUS).toBe("claude-opus-4-8");
    expect(MODEL_SONNET).toBe("claude-sonnet-4-6");
    expect(MODEL_HAIKU).toBe("claude-haiku-4-5-20251001");
  });

  test("recommended matrix maps each agent to its tier", () => {
    expect(DEFAULT_MODEL_PLANNER).toBe(MODEL_OPUS);
    expect(DEFAULT_MODEL_GENERATOR).toBe(MODEL_SONNET);
    expect(DEFAULT_MODEL_EVALUATOR).toBe(MODEL_OPUS);
    expect(DEFAULT_MODEL_DOCUMENTER).toBe(MODEL_HAIKU);
  });
});

describe("modelTier", () => {
  test("maps known families by name, case-insensitively", () => {
    expect(modelTier(MODEL_OPUS)).toBe("opus");
    expect(modelTier(MODEL_SONNET)).toBe("sonnet");
    expect(modelTier(MODEL_HAIKU)).toBe("haiku");
    expect(modelTier("CLAUDE-OPUS-XYZ")).toBe("opus");
  });

  test("unknown / blank / missing degrade to 'unknown' without throwing", () => {
    expect(modelTier("gpt-4o")).toBe("unknown");
    expect(modelTier("")).toBe("unknown");
    expect(modelTier("   ")).toBe("unknown");
    expect(modelTier(undefined)).toBe("unknown");
  });
});

describe("evaluatorWeakerThanGenerator", () => {
  test("true only when evaluator tier is strictly below generator tier", () => {
    expect(evaluatorWeakerThanGenerator(MODEL_SONNET, MODEL_OPUS)).toBe(true);
    expect(evaluatorWeakerThanGenerator(MODEL_HAIKU, MODEL_SONNET)).toBe(true);
  });

  test("false when evaluator tier is equal or higher", () => {
    expect(evaluatorWeakerThanGenerator(MODEL_OPUS, MODEL_OPUS)).toBe(false);
    expect(evaluatorWeakerThanGenerator(MODEL_OPUS, MODEL_SONNET)).toBe(false);
  });

  test("false (stay quiet) when either side is unrecognized", () => {
    expect(evaluatorWeakerThanGenerator("custom-model", MODEL_OPUS)).toBe(false);
    expect(evaluatorWeakerThanGenerator(MODEL_HAIKU, "custom-model")).toBe(false);
  });
});

describe("blankToUndefined", () => {
  test("trims and collapses blanks to undefined", () => {
    expect(blankToUndefined(undefined)).toBeUndefined();
    expect(blankToUndefined("")).toBeUndefined();
    expect(blankToUndefined("   ")).toBeUndefined();
    expect(blankToUndefined("  x  ")).toBe("x");
  });
});

describe("resolveAgentModel precedence", () => {
  test("override wins over uniform and tier default", () => {
    expect(resolveAgentModel("o", "u", "d")).toBe("o");
  });
  test("uniform wins over tier default when no override", () => {
    expect(resolveAgentModel(undefined, "u", "d")).toBe("u");
  });
  test("tier default applies when neither override nor uniform set", () => {
    expect(resolveAgentModel(undefined, undefined, "d")).toBe("d");
  });
  test("blank override / uniform are ignored", () => {
    expect(resolveAgentModel("  ", "  ", "d")).toBe("d");
  });
});

describe("describeAgentModels", () => {
  test("prints all four agents including the Documenter", () => {
    const lines = describeAgentModels({
      resolvedModelPlanner: MODEL_OPUS,
      resolvedModelGenerator: MODEL_SONNET,
      resolvedModelEvaluator: MODEL_OPUS,
      resolvedModelDocumenter: MODEL_HAIKU,
    });
    expect(lines).toHaveLength(4);
    expect(lines.some((l) => l.includes("Documenter") && l.includes(MODEL_HAIKU))).toBe(true);
    expect(lines.some((l) => l.includes("Generator") && l.includes(MODEL_SONNET))).toBe(true);
  });
});

describe("evaluatorInvariantWarning", () => {
  test("returns a message naming the invariant when evaluator is weaker", () => {
    const warning = evaluatorInvariantWarning(MODEL_SONNET, MODEL_OPUS);
    expect(warning).not.toBeNull();
    expect(warning).toContain("Evaluator");
    expect(warning).toContain("Generator");
  });

  test("returns null when the invariant holds", () => {
    expect(evaluatorInvariantWarning(MODEL_OPUS, MODEL_SONNET)).toBeNull();
    expect(evaluatorInvariantWarning(MODEL_OPUS, MODEL_OPUS)).toBeNull();
  });
});
