import { describe, expect, test } from "bun:test";
import {
  CONTRACT_NEGOTIATION_GENERATOR_PROMPT,
  buildContractReviewPrompt,
  buildEvaluatorPrompt,
} from "../shared/prompts.ts";

const CONTRACT_NEGOTIATION_EVALUATOR_PROMPT = buildContractReviewPrompt({
  maxFeatures: 3,
  maxCriteria: 10,
  maxSurfaces: 2,
});

const baseCtx = {
  workDir: "/tmp/test-project",
  isGreenfield: false,
};

describe("CONTRACT_NEGOTIATION_GENERATOR_PROMPT — quality criteria", () => {
  test("mentions naming conventions", () => {
    expect(CONTRACT_NEGOTIATION_GENERATOR_PROMPT).toContain("naming conventions");
  });

  test("mentions code duplication", () => {
    expect(CONTRACT_NEGOTIATION_GENERATOR_PROMPT).toContain("duplication");
  });

  test("mentions error handling patterns", () => {
    expect(CONTRACT_NEGOTIATION_GENERATOR_PROMPT).toContain("error handling patterns");
  });

  test("mentions maintainability", () => {
    expect(CONTRACT_NEGOTIATION_GENERATOR_PROMPT).toContain("maintainability");
  });

  test("instructs to include at least one implementation quality criterion", () => {
    expect(CONTRACT_NEGOTIATION_GENERATOR_PROMPT).toContain('type "implementation"');
    expect(CONTRACT_NEGOTIATION_GENERATOR_PROMPT).toContain("at least one");
  });

  test("marks quality criteria as implementation type", () => {
    // The prompt should specify quality criteria use "implementation" type
    expect(CONTRACT_NEGOTIATION_GENERATOR_PROMPT).toContain("implementation");
    // And mentions these are for code quality
    expect(CONTRACT_NEGOTIATION_GENERATOR_PROMPT).toContain("code quality");
  });
});

describe("CONTRACT_NEGOTIATION_EVALUATOR_PROMPT — quality criteria enforcement", () => {
  test("instructs to reject purely-functional contracts", () => {
    expect(CONTRACT_NEGOTIATION_EVALUATOR_PROMPT).toContain("reject");
    // Should mention rejecting contracts without quality criteria
    expect(CONTRACT_NEGOTIATION_EVALUATOR_PROMPT).toContain("quality criteria");
  });

  test("requires at least one quality criterion", () => {
    expect(CONTRACT_NEGOTIATION_EVALUATOR_PROMPT).toContain("at least one");
    expect(CONTRACT_NEGOTIATION_EVALUATOR_PROMPT).toContain("quality");
  });

  test("mentions naming or duplication or maintainability", () => {
    const prompt = CONTRACT_NEGOTIATION_EVALUATOR_PROMPT;
    const hasQualityKeyword =
      prompt.includes("naming") || prompt.includes("duplication") || prompt.includes("maintainability");
    expect(hasQualityKeyword).toBe(true);
  });

  test("specifies quality criteria should be type implementation", () => {
    expect(CONTRACT_NEGOTIATION_EVALUATOR_PROMPT).toContain('type "implementation"');
  });
});

describe("buildEvaluatorPrompt — quality criteria scoring", () => {
  test("includes quality criteria scoring instructions", () => {
    const prompt = buildEvaluatorPrompt(baseCtx);
    expect(prompt).toContain("Quality Criteria");
  });

  test("instructs same rigor for quality criteria", () => {
    const prompt = buildEvaluatorPrompt(baseCtx);
    expect(prompt).toContain("same scoring rigor");
  });

  test("mentions naming conventions in quality section", () => {
    const prompt = buildEvaluatorPrompt(baseCtx);
    expect(prompt).toContain("naming conventions");
  });

  test("mentions duplication in quality section", () => {
    const prompt = buildEvaluatorPrompt(baseCtx);
    expect(prompt).toContain("duplication");
  });

  test("mentions maintainability in quality section", () => {
    const prompt = buildEvaluatorPrompt(baseCtx);
    expect(prompt).toContain("Maintainable");
  });

  test("quality criteria are not optional", () => {
    const prompt = buildEvaluatorPrompt(baseCtx);
    expect(prompt).toContain("NOT optional");
  });
});
