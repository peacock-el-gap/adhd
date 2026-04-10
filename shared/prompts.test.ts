import { describe, expect, it } from "bun:test";
import {
  buildDocumenterPrompt,
  buildEvaluatorPrompt,
  buildGeneratorPrompt,
  buildPlannerPrompt,
  CONTRACT_NEGOTIATION_EVALUATOR_PROMPT,
  CONTRACT_NEGOTIATION_GENERATOR_PROMPT,
  EVALUATOR_SYSTEM_PROMPT,
  GENERATOR_SYSTEM_PROMPT,
  PLANNER_SYSTEM_PROMPT,
} from "./prompts.ts";

describe("prompts", () => {
  const baseCtx = {
    workDir: "/test/project",
    isGreenfield: false,
    sourceDir: "src",
    testDir: "tests",
  };

  describe("buildPlannerPrompt", () => {
    it("includes project context for brownfield", () => {
      const prompt = buildPlannerPrompt(baseCtx);
      expect(prompt).toContain("existing codebase");
      expect(prompt).toContain("/test/project");
    });

    it("includes greenfield context", () => {
      const prompt = buildPlannerPrompt({ ...baseCtx, isGreenfield: true });
      expect(prompt).toContain("brand-new project");
    });
  });

  describe("buildGeneratorPrompt", () => {
    it("returns a non-empty prompt string", () => {
      const prompt = buildGeneratorPrompt(baseCtx);
      expect(prompt.length).toBeGreaterThan(0);
    });
  });

  describe("buildEvaluatorPrompt", () => {
    it("returns a non-empty prompt string", () => {
      const prompt = buildEvaluatorPrompt(baseCtx);
      expect(prompt.length).toBeGreaterThan(0);
    });
  });

  describe("buildDocumenterPrompt", () => {
    it("returns a non-empty prompt string", () => {
      const prompt = buildDocumenterPrompt(baseCtx);
      expect(prompt.length).toBeGreaterThan(0);
    });
  });

  describe("system prompts", () => {
    it("PLANNER_SYSTEM_PROMPT is a non-empty string", () => {
      expect(typeof PLANNER_SYSTEM_PROMPT).toBe("string");
      expect(PLANNER_SYSTEM_PROMPT.length).toBeGreaterThan(50);
    });

    it("GENERATOR_SYSTEM_PROMPT is a non-empty string", () => {
      expect(typeof GENERATOR_SYSTEM_PROMPT).toBe("string");
      expect(GENERATOR_SYSTEM_PROMPT.length).toBeGreaterThan(50);
    });

    it("EVALUATOR_SYSTEM_PROMPT is a non-empty string", () => {
      expect(typeof EVALUATOR_SYSTEM_PROMPT).toBe("string");
      expect(EVALUATOR_SYSTEM_PROMPT.length).toBeGreaterThan(50);
    });

    it("CONTRACT_NEGOTIATION_GENERATOR_PROMPT contains type classification instructions", () => {
      expect(CONTRACT_NEGOTIATION_GENERATOR_PROMPT).toContain("behavioral");
      expect(CONTRACT_NEGOTIATION_GENERATOR_PROMPT).toContain("implementation");
    });

    it("CONTRACT_NEGOTIATION_EVALUATOR_PROMPT contains quality criteria check", () => {
      expect(CONTRACT_NEGOTIATION_EVALUATOR_PROMPT).toContain("quality");
    });
  });
});
