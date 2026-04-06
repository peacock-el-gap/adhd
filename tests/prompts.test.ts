import { describe, expect, test } from "bun:test";
import { buildPlannerPrompt, buildGeneratorPrompt, buildEvaluatorPrompt } from "../shared/prompts.ts";
import type { AgentSkills } from "../shared/skills.ts";

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

// --- Skills injection into prompts ---

const injectedSkills: AgentSkills = {
  injected: "Always use snake_case for variables.",
  referenceManifest: "",
  additionalDirs: [],
};

const referenceSkills: AgentSkills = {
  injected: "",
  referenceManifest: "The following docs are available:\n- `/skills/api-guide.md` — API patterns",
  additionalDirs: ["/skills"],
};

const bothSkills: AgentSkills = {
  injected: "Use TDD for all features.",
  referenceManifest: "Available:\n- `/ref/patterns.md`",
  additionalDirs: ["/ref"],
};

describe("buildPlannerPrompt — skills injection", () => {
  test("appends injected skill content under ## Skills", () => {
    const prompt = buildPlannerPrompt({ ...baseCtx, skills: injectedSkills });
    expect(prompt).toContain("## Skills");
    expect(prompt).toContain("Always use snake_case for variables.");
  });

  test("appends reference manifest under ## Reference Materials", () => {
    const prompt = buildPlannerPrompt({ ...baseCtx, skills: referenceSkills });
    expect(prompt).toContain("## Reference Materials");
    expect(prompt).toContain("`/skills/api-guide.md`");
  });

  test("appends both sections when skills have inject + reference", () => {
    const prompt = buildPlannerPrompt({ ...baseCtx, skills: bothSkills });
    expect(prompt).toContain("## Skills");
    expect(prompt).toContain("Use TDD for all features.");
    expect(prompt).toContain("## Reference Materials");
    expect(prompt).toContain("`/ref/patterns.md`");
  });

  test("no skills sections when skills is undefined", () => {
    const prompt = buildPlannerPrompt(baseCtx);
    expect(prompt).not.toContain("## Skills");
    expect(prompt).not.toContain("## Reference Materials");
  });

  test("no skills sections when skills has empty content", () => {
    const emptySkills: AgentSkills = { injected: "", referenceManifest: "", additionalDirs: [] };
    const prompt = buildPlannerPrompt({ ...baseCtx, skills: emptySkills });
    expect(prompt).not.toContain("## Skills");
    expect(prompt).not.toContain("## Reference Materials");
  });
});

describe("buildGeneratorPrompt — skills injection", () => {
  test("appends injected skill content", () => {
    const prompt = buildGeneratorPrompt({ ...baseCtx, skills: injectedSkills });
    expect(prompt).toContain("## Skills");
    expect(prompt).toContain("Always use snake_case for variables.");
  });

  test("appends reference manifest", () => {
    const prompt = buildGeneratorPrompt({ ...baseCtx, skills: referenceSkills });
    expect(prompt).toContain("## Reference Materials");
  });
});

describe("buildEvaluatorPrompt — skills injection", () => {
  test("appends injected skill content", () => {
    const prompt = buildEvaluatorPrompt({ ...baseCtx, skills: injectedSkills });
    expect(prompt).toContain("## Skills");
    expect(prompt).toContain("Always use snake_case for variables.");
  });

  test("appends reference manifest", () => {
    const prompt = buildEvaluatorPrompt({ ...baseCtx, skills: referenceSkills });
    expect(prompt).toContain("## Reference Materials");
  });
});
