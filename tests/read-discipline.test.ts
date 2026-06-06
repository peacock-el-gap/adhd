/**
 * Sprint 4 — Read-discipline prompting
 *
 * Tests that the locate-then-read, no-re-read, and scoped-test rules are
 * present in the system prompts for the Generator, Evaluator, and Planner,
 * and that they are defined via a named builder rather than as inline strings.
 */
import { describe, expect, test } from "bun:test";
import {
  MAX_SYSTEM_PROMPT_CHARS,
  buildEvaluatorPrompt,
  buildGeneratorPrompt,
  buildPlannerPrompt,
  buildReadDisciplineSection,
} from "../shared/prompts.ts";
import {
  VERIFICATION_NO_OP,
  buildBaselineVerificationSection,
  buildPostVerificationSection,
} from "../shared/verification.ts";

const baseCtx = {
  workDir: "/tmp/test-project",
  isGreenfield: false,
};

// A real (non-null) verification result for injection tests.
const realVerificationResult = {
  passed: false,
  total: 5,
  passCount: 4,
  failCount: 1,
  failingTests: ["src/foo.test.ts > should work"],
  output: "1 failing",
};

// ---------------------------------------------------------------------------
// generator_prompt_contains_all_three_rules
// ---------------------------------------------------------------------------

describe("generator_prompt_contains_all_three_rules", () => {
  test("Generator system prompt contains the full read-discipline section (all three rules)", () => {
    const prompt = buildGeneratorPrompt(baseCtx);
    const section = buildReadDisciplineSection(true);
    expect(prompt).toContain(section);
  });

  test("Generator prompt: locate-then-read rule names grep/search and a bounded range", () => {
    const prompt = buildGeneratorPrompt(baseCtx);
    expect(prompt.toLowerCase()).toMatch(/grep|search/);
    expect(prompt.toLowerCase()).toMatch(/bounded|range|needed range|only the needed/);
  });

  test("Generator prompt: no-re-read rule is a direct prohibition referencing the session", () => {
    const prompt = buildGeneratorPrompt(baseCtx);
    // Must state a prohibition (do not, never, must not, etc.)
    expect(prompt.toLowerCase()).toMatch(/do not open|never open|must not open|do not re-read|never re-read/);
    // Must reference the session context boundary
    expect(prompt.toLowerCase()).toContain("session");
  });

  test("Generator prompt: scoped-test rule mentions running only relevant test file(s)", () => {
    const prompt = buildGeneratorPrompt(baseCtx);
    expect(prompt.toLowerCase()).toMatch(/relevant test file|only.*test file|test file.*only/);
  });

  test("Generator prompt: scoped-test rule prohibits running the full test suite", () => {
    const prompt = buildGeneratorPrompt(baseCtx);
    expect(prompt.toLowerCase()).toMatch(/do not run the full|never run the full|not the full suite|avoid.*full suite/);
  });
});

// ---------------------------------------------------------------------------
// evaluator_prompt_contains_all_three_rules
// ---------------------------------------------------------------------------

describe("evaluator_prompt_contains_all_three_rules", () => {
  test("Evaluator system prompt contains the full read-discipline section (all three rules)", () => {
    const prompt = buildEvaluatorPrompt(baseCtx);
    const section = buildReadDisciplineSection(true);
    expect(prompt).toContain(section);
  });

  test("Evaluator prompt: locate-then-read rule names grep/search and a bounded range", () => {
    const prompt = buildEvaluatorPrompt(baseCtx);
    expect(prompt.toLowerCase()).toMatch(/grep|search/);
    expect(prompt.toLowerCase()).toMatch(/bounded|range|needed range|only the needed/);
  });

  test("Evaluator prompt: no-re-read rule is a direct prohibition referencing the session", () => {
    const prompt = buildEvaluatorPrompt(baseCtx);
    expect(prompt.toLowerCase()).toMatch(/do not open|never open|must not open|do not re-read|never re-read/);
    expect(prompt.toLowerCase()).toContain("session");
  });

  test("Evaluator prompt: scoped-test rule mentions running only relevant test file(s)", () => {
    const prompt = buildEvaluatorPrompt(baseCtx);
    expect(prompt.toLowerCase()).toMatch(/relevant test file|only.*test file|test file.*only/);
  });

  test("Evaluator prompt: scoped-test rule prohibits running the full test suite", () => {
    const prompt = buildEvaluatorPrompt(baseCtx);
    expect(prompt.toLowerCase()).toMatch(/do not run the full|never run the full|not the full suite|avoid.*full suite/);
  });
});

// ---------------------------------------------------------------------------
// planner_prompt_contains_applicable_rules
// ---------------------------------------------------------------------------

describe("planner_prompt_contains_applicable_rules", () => {
  test("Planner system prompt contains the planning read-discipline section (locate + no-reread)", () => {
    const prompt = buildPlannerPrompt(baseCtx);
    const section = buildReadDisciplineSection(false);
    expect(prompt).toContain(section);
  });

  test("Planner prompt: locate-then-read rule names grep/search", () => {
    const prompt = buildPlannerPrompt(baseCtx);
    expect(prompt.toLowerCase()).toMatch(/grep|search/);
  });

  test("Planner prompt: no-re-read rule references the session", () => {
    const prompt = buildPlannerPrompt(baseCtx);
    expect(prompt.toLowerCase()).toContain("session");
  });

  test("Planner planning section does not contradict verification injection used by other agents", () => {
    // Planner has no test-running rule; it must not say anything contradictory
    // (e.g. "always run the full test suite") relative to what Generator/Evaluator say.
    const plannerPrompt = buildPlannerPrompt(baseCtx);
    expect(plannerPrompt.toLowerCase()).not.toMatch(/always run the full|must run the full suite/);
  });
});

// ---------------------------------------------------------------------------
// rules_reside_in_system_prompt_not_supplementary_context
// ---------------------------------------------------------------------------

describe("rules_reside_in_system_prompt_not_supplementary_context", () => {
  test("buildGeneratorPrompt returns the section — it is the system prompt builder", () => {
    // buildGeneratorPrompt produces the system prompt string; the rules must be there.
    const sysPrompt = buildGeneratorPrompt(baseCtx);
    expect(sysPrompt).toContain(buildReadDisciplineSection(true));
  });

  test("buildEvaluatorPrompt returns the section — it is the system prompt builder", () => {
    const sysPrompt = buildEvaluatorPrompt(baseCtx);
    expect(sysPrompt).toContain(buildReadDisciplineSection(true));
  });

  test("buildPlannerPrompt returns the section — it is the system prompt builder", () => {
    const sysPrompt = buildPlannerPrompt(baseCtx);
    expect(sysPrompt).toContain(buildReadDisciplineSection(false));
  });

  test("Generator rules are present even when no supplementaryContext is passed", () => {
    // Verify the rules come from the system prompt, not from supplementary context,
    // by checking that the plain buildGeneratorPrompt output (which is the system prompt)
    // contains the section without needing any supplementary injection.
    const sysPrompt = buildGeneratorPrompt(baseCtx);
    const section = buildReadDisciplineSection(true);
    expect(sysPrompt).toContain(section);
  });
});

// ---------------------------------------------------------------------------
// scoped_test_rule_present_when_no_verification_section_injected
// ---------------------------------------------------------------------------

describe("scoped_test_rule_present_when_no_verification_section_injected", () => {
  test("VERIFICATION_NO_OP produces empty baseline section (confirms null path)", () => {
    const section = buildBaselineVerificationSection(VERIFICATION_NO_OP);
    expect(section).toBe("");
  });

  test("VERIFICATION_NO_OP produces empty post-verification section (confirms null path)", () => {
    const section = buildPostVerificationSection(VERIFICATION_NO_OP, null);
    expect(section).toBe("");
  });

  test("Generator system prompt contains scoped-test rule even when passed is null (no injection)", () => {
    // No injection occurs when passed === null; system prompt rule covers this case.
    const baselineSection = buildBaselineVerificationSection(VERIFICATION_NO_OP);
    expect(baselineSection).toBe(""); // confirm no injection

    const sysPrompt = buildGeneratorPrompt(baseCtx);
    expect(sysPrompt).toContain(buildReadDisciplineSection(true));
    expect(sysPrompt.toLowerCase()).toMatch(/relevant test file|only.*test file|test file.*only/);
  });

  test("Evaluator system prompt contains scoped-test rule even when passed is null (no injection)", () => {
    const postSection = buildPostVerificationSection(VERIFICATION_NO_OP, null);
    expect(postSection).toBe(""); // confirm no injection

    const sysPrompt = buildEvaluatorPrompt(baseCtx);
    expect(sysPrompt).toContain(buildReadDisciplineSection(true));
    expect(sysPrompt.toLowerCase()).toMatch(/relevant test file|only.*test file|test file.*only/);
  });
});

// ---------------------------------------------------------------------------
// locate_then_read_rule_names_mechanism_and_scope
// ---------------------------------------------------------------------------

describe("locate_then_read_rule_names_mechanism_and_scope", () => {
  test("buildReadDisciplineSection(true) explicitly names grep or search as the mechanism", () => {
    const section = buildReadDisciplineSection(true);
    expect(section.toLowerCase()).toMatch(/grep|search/);
  });

  test("buildReadDisciplineSection(true) explicitly states reads should cover only the needed range", () => {
    const section = buildReadDisciplineSection(true);
    // Must explicitly say reads are bounded/ranged — not just "read narrowly" as a vague tip
    expect(section.toLowerCase()).toMatch(/bounded|range|needed range|only the needed/);
  });

  test("buildReadDisciplineSection(false) also names mechanism and scope (for Planner)", () => {
    const section = buildReadDisciplineSection(false);
    expect(section.toLowerCase()).toMatch(/grep|search/);
    expect(section.toLowerCase()).toMatch(/bounded|range|needed range|only the needed/);
  });
});

// ---------------------------------------------------------------------------
// no_re_read_rule_states_prohibition_affirmatively
// ---------------------------------------------------------------------------

describe("no_re_read_rule_states_prohibition_affirmatively", () => {
  test("buildReadDisciplineSection(true) contains a direct prohibition against re-opening files", () => {
    const section = buildReadDisciplineSection(true);
    // Must be a direct instruction, not an implied tip
    expect(section.toLowerCase()).toMatch(/do not open|never open|must not open|do not re-read|never re-read/);
  });

  test("prohibition references the current session as the boundary", () => {
    const section = buildReadDisciplineSection(true);
    expect(section.toLowerCase()).toContain("session");
  });

  test("buildReadDisciplineSection(false) also states prohibition affirmatively (for Planner)", () => {
    const section = buildReadDisciplineSection(false);
    expect(section.toLowerCase()).toMatch(/do not open|never open|must not open|do not re-read|never re-read/);
    expect(section.toLowerCase()).toContain("session");
  });
});

// ---------------------------------------------------------------------------
// prompt_size_guardrail_not_exceeded
// ---------------------------------------------------------------------------

describe("prompt_size_guardrail_not_exceeded", () => {
  test("MAX_SYSTEM_PROMPT_CHARS is exported from shared/prompts.ts", () => {
    expect(typeof MAX_SYSTEM_PROMPT_CHARS).toBe("number");
    expect(MAX_SYSTEM_PROMPT_CHARS).toBeGreaterThan(0);
  });

  test("Generator system prompt is within MAX_SYSTEM_PROMPT_CHARS", () => {
    const prompt = buildGeneratorPrompt(baseCtx);
    expect(prompt.length).toBeLessThan(MAX_SYSTEM_PROMPT_CHARS);
  });

  test("Evaluator system prompt is within MAX_SYSTEM_PROMPT_CHARS", () => {
    const prompt = buildEvaluatorPrompt(baseCtx);
    expect(prompt.length).toBeLessThan(MAX_SYSTEM_PROMPT_CHARS);
  });

  test("Planner system prompt is within MAX_SYSTEM_PROMPT_CHARS", () => {
    const prompt = buildPlannerPrompt(baseCtx);
    expect(prompt.length).toBeLessThan(MAX_SYSTEM_PROMPT_CHARS);
  });

  test("all prompts are well under a reasonable per-agent guardrail (20 000 chars)", () => {
    // Belt-and-suspenders: ensure no prompt is accidentally huge
    expect(buildGeneratorPrompt(baseCtx).length).toBeLessThan(20_000);
    expect(buildEvaluatorPrompt(baseCtx).length).toBeLessThan(20_000);
    expect(buildPlannerPrompt(baseCtx).length).toBeLessThan(20_000);
  });
});

// ---------------------------------------------------------------------------
// tests_cover_rules_across_injection_states
// ---------------------------------------------------------------------------

describe("tests_cover_rules_across_injection_states", () => {
  test("(a) no injection: Generator system prompt contains all three rules when passed is null", () => {
    // The null path — no supplementary context injected
    const baseline = buildBaselineVerificationSection(VERIFICATION_NO_OP);
    expect(baseline).toBe(""); // no injection

    const sysPrompt = buildGeneratorPrompt(baseCtx);
    expect(sysPrompt).toContain(buildReadDisciplineSection(true));
  });

  test("(b) injected: Generator system prompt still contains all three rules when verification is available", () => {
    // The non-null path — supplementary context would be injected by the caller
    const baseline = buildBaselineVerificationSection(realVerificationResult);
    expect(baseline).not.toBe(""); // injection exists

    // System prompt is independent of supplementaryContext; rules always present
    const sysPrompt = buildGeneratorPrompt(baseCtx);
    expect(sysPrompt).toContain(buildReadDisciplineSection(true));
  });

  test("(a) no injection: Evaluator system prompt contains all three rules when passed is null", () => {
    const postSection = buildPostVerificationSection(VERIFICATION_NO_OP, null);
    expect(postSection).toBe("");

    const sysPrompt = buildEvaluatorPrompt(baseCtx);
    expect(sysPrompt).toContain(buildReadDisciplineSection(true));
  });

  test("(b) injected: Evaluator system prompt still contains all three rules when verification is available", () => {
    const postSection = buildPostVerificationSection(realVerificationResult, {
      preExisting: [],
      newlyIntroduced: ["src/foo.test.ts > should work"],
      classified: true,
    });
    expect(postSection).not.toBe("");

    const sysPrompt = buildEvaluatorPrompt(baseCtx);
    expect(sysPrompt).toContain(buildReadDisciplineSection(true));
  });

  test("system scoped-test rule and injected no-rerun instruction are not verbatim duplicates", () => {
    // The system prompt rule about tests
    const systemRule = buildReadDisciplineSection(true);
    // The injected baseline section's test guidance
    const injectedSection = buildBaselineVerificationSection(realVerificationResult);

    // Injected section contains a no-rerun instruction; system prompt contains the scoped-test rule.
    // They must not be verbatim copies of each other.
    expect(systemRule).not.toBe(injectedSection);

    // Extract the specific test-related instruction from each.
    // System: something about "do not run the full test suite" or "only relevant test file"
    // Injected baseline: "Run the full suite only once at the end if you need a final check. For investigating a specific failure, run only the relevant test file."
    // These two are not identical strings:
    const sysTestLine = systemRule
      .split("\n")
      .find((l) => l.toLowerCase().includes("test file") || l.toLowerCase().includes("suite"));
    const injTestLine = injectedSection
      .split("\n")
      .find((l) => l.toLowerCase().includes("test file") || l.toLowerCase().includes("suite"));

    // At least one such line exists in each
    expect(sysTestLine).toBeTruthy();
    expect(injTestLine).toBeTruthy();
    // They are not verbatim duplicates
    expect(sysTestLine).not.toBe(injTestLine);
  });

  test("system scoped-test rule and injected no-rerun instruction are not contradictory", () => {
    const systemSection = buildReadDisciplineSection(true);
    const injectedBaseline = buildBaselineVerificationSection(realVerificationResult);

    // Neither should say "always run the full test suite" — that would contradict both.
    expect(systemSection.toLowerCase()).not.toMatch(/always run the full/);
    expect(injectedBaseline.toLowerCase()).not.toMatch(/always run the full/);

    // System prompt says to avoid/not run the full suite
    expect(systemSection.toLowerCase()).toMatch(
      /do not run the full|never run the full|not the full suite|avoid.*full suite/,
    );
    // Injected section also discourages re-running the full suite
    expect(injectedBaseline.toLowerCase()).toMatch(/do not re-run|not re-run|only.*relevant test file/);
  });
});

// ---------------------------------------------------------------------------
// rule_text_defined_in_named_constants_or_builder_not_inline
// ---------------------------------------------------------------------------

describe("rule_text_defined_in_named_constants_or_builder_not_inline", () => {
  test("buildReadDisciplineSection is exported from shared/prompts.ts as a function", () => {
    expect(typeof buildReadDisciplineSection).toBe("function");
  });

  test("buildReadDisciplineSection(true) returns a non-empty string containing all three rules", () => {
    const section = buildReadDisciplineSection(true);
    expect(typeof section).toBe("string");
    expect(section.length).toBeGreaterThan(50);
    // locate-then-read
    expect(section.toLowerCase()).toMatch(/grep|search/);
    // no-re-read
    expect(section.toLowerCase()).toContain("session");
    // scoped-test
    expect(section.toLowerCase()).toMatch(/test file|full suite/);
  });

  test("buildReadDisciplineSection(false) returns a string with locate and no-reread but shorter than full version", () => {
    const withTestRule = buildReadDisciplineSection(true);
    const withoutTestRule = buildReadDisciplineSection(false);
    expect(withoutTestRule.length).toBeLessThan(withTestRule.length);
    // Still has locate and no-reread
    expect(withoutTestRule.toLowerCase()).toMatch(/grep|search/);
    expect(withoutTestRule.toLowerCase()).toContain("session");
  });

  test("Generator and Evaluator both reference the same full section", () => {
    const section = buildReadDisciplineSection(true);
    expect(buildGeneratorPrompt(baseCtx)).toContain(section);
    expect(buildEvaluatorPrompt(baseCtx)).toContain(section);
  });

  test("Planner references the planning section (no test rule) not the full section", () => {
    const planningSection = buildReadDisciplineSection(false);
    const fullSection = buildReadDisciplineSection(true);
    const plannerPrompt = buildPlannerPrompt(baseCtx);
    expect(plannerPrompt).toContain(planningSection);
    // The full section (with test rule) should NOT be present in the planner
    // (because the full section has the test rule which the planner doesn't need)
    // Note: planningSection is a prefix/subset of fullSection so we check by
    // comparing the test-rule line specifically.
    const testRuleLine = fullSection
      .split("\n")
      .find(
        (l) =>
          l.toLowerCase().includes("test file") &&
          (l.toLowerCase().includes("do not run") || l.toLowerCase().includes("never run")),
      );
    if (testRuleLine) {
      expect(plannerPrompt).not.toContain(testRuleLine);
    }
  });
});
