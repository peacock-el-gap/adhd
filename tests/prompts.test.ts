import { describe, expect, test } from "bun:test";
import { buildPlannerPrompt, buildGeneratorPrompt, buildEvaluatorPrompt } from "../shared/prompts.ts";

const baseCtx = {
  workDir: "/tmp/test-project",
  isGreenfield: false,
};

// --- BDD: Planner ---

describe("buildPlannerPrompt — BDD", () => {
  test("includes Given/When/Then instruction by default", () => {
    const prompt = buildPlannerPrompt(baseCtx);
    expect(prompt).toContain("Given/When/Then");
    expect(prompt).toContain("acceptance criteria");
  });

  test("excludes Given/When/Then when noBdd is true", () => {
    const prompt = buildPlannerPrompt({ ...baseCtx, noBdd: true });
    expect(prompt).not.toContain("Given/When/Then");
  });
});

// --- TDD: Generator ---

describe("buildGeneratorPrompt — TDD", () => {
  test("includes TDD instruction by default", () => {
    const prompt = buildGeneratorPrompt(baseCtx);
    expect(prompt).toContain("failing tests first");
  });

  test("excludes TDD instruction when noTdd is true", () => {
    const prompt = buildGeneratorPrompt({ ...baseCtx, noTdd: true });
    expect(prompt).not.toContain("failing tests first");
  });
});

// --- BDD: Evaluator ---

describe("buildEvaluatorPrompt — BDD verification", () => {
  test("includes test verification instruction by default", () => {
    const prompt = buildEvaluatorPrompt(baseCtx);
    expect(prompt).toContain("tests exist for each acceptance scenario");
  });

  test("excludes test verification when noBdd is true", () => {
    const prompt = buildEvaluatorPrompt({ ...baseCtx, noBdd: true });
    expect(prompt).not.toContain("tests exist for each acceptance scenario");
  });
});

// --- WP2: Default directory conventions ---

describe("buildPlannerPrompt — directory conventions", () => {
  test("includes default src/tests directories", () => {
    const prompt = buildPlannerPrompt(baseCtx);
    expect(prompt).toContain("`src`");
    expect(prompt).toContain("`tests`");
  });

  test("uses custom sourceDir and testDir when provided", () => {
    const prompt = buildPlannerPrompt({ ...baseCtx, sourceDir: "lib", testDir: "spec" });
    expect(prompt).toContain("`lib`");
    expect(prompt).toContain("`spec`");
    expect(prompt).not.toContain("`src`");
  });

  test("includes instruction to examine existing project structure", () => {
    const prompt = buildPlannerPrompt(baseCtx);
    expect(prompt).toContain("Examine the existing project structure");
  });
});

// --- Context-dependent prompts ---

describe("buildPlannerPrompt — greenfield vs existing", () => {
  test("greenfield prompt mentions brand-new project", () => {
    const prompt = buildPlannerPrompt({ ...baseCtx, isGreenfield: true });
    expect(prompt).toContain("brand-new project");
  });

  test("existing project prompt mentions existing codebase", () => {
    const prompt = buildPlannerPrompt({ ...baseCtx, isGreenfield: false });
    expect(prompt).toContain("existing codebase");
  });
});

describe("buildGeneratorPrompt — greenfield vs existing", () => {
  test("greenfield prompt mentions app/ subdirectory", () => {
    const prompt = buildGeneratorPrompt({ ...baseCtx, isGreenfield: true });
    expect(prompt).toContain("app/");
  });

  test("existing project prompt mentions project root", () => {
    const prompt = buildGeneratorPrompt({ ...baseCtx, isGreenfield: false });
    expect(prompt).toContain("project root directory");
  });
});
