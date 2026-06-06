import { describe, expect, test } from "bun:test";
import { parseCli, resolveConfig } from "../shared/config.ts";
import {
  buildRefinementPrompt,
  computeSpecDiff,
  countSprints,
  extractCompletedSprintSections,
  extractSprintSection,
  freezeCompletedSprints,
  spliceRefinementSections,
} from "../shared/refinement.ts";
import { countSprintHeadings } from "../shared/sprint-count.ts";

// --- CLI flag parsing ---

describe("--refine-spec CLI flag", () => {
  test("parseCli parses --refine-spec flag", () => {
    const cli = parseCli(["--refine-spec", "test"]);
    expect(cli.refineSpec).toBe(true);
  });

  test("--refine-spec defaults to false", () => {
    const cli = parseCli(["test"]);
    expect(cli.refineSpec).toBe(false);
  });

  test("resolveConfig sets refineSpec to true when flag is passed", () => {
    const config = resolveConfig({
      prompt: "test",
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
      refineSpec: true,
    });
    expect(config.refineSpec).toBe(true);
  });

  test("resolveConfig sets refineSpec to false when flag is not passed", () => {
    const config = resolveConfig({
      prompt: "test",
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
      refineSpec: false,
    });
    expect(config.refineSpec).toBe(false);
  });
});

// --- Sprint section extraction ---

const SAMPLE_SPEC = `# Product Spec

## Overview
A great product.

## Sprint 1

**Theme: Foundation**

Build the base layer.

## Sprint 2

**Theme: Features**

Add user-facing features.

## Sprint 3

**Theme: Polish**

Final polish and testing.
`;

describe("extractSprintSection", () => {
  test("extracts sprint 1 section", () => {
    const section = extractSprintSection(SAMPLE_SPEC, 1);
    expect(section).not.toBeNull();
    expect(section).toContain("## Sprint 1");
    expect(section).toContain("Build the base layer.");
    expect(section).not.toContain("## Sprint 2");
  });

  test("extracts sprint 2 section", () => {
    const section = extractSprintSection(SAMPLE_SPEC, 2);
    expect(section).not.toBeNull();
    expect(section).toContain("## Sprint 2");
    expect(section).toContain("Add user-facing features.");
    expect(section).not.toContain("## Sprint 3");
  });

  test("extracts last sprint section", () => {
    const section = extractSprintSection(SAMPLE_SPEC, 3);
    expect(section).not.toBeNull();
    expect(section).toContain("## Sprint 3");
    expect(section).toContain("Final polish and testing.");
  });

  test("returns null for non-existent sprint", () => {
    const section = extractSprintSection(SAMPLE_SPEC, 99);
    expect(section).toBeNull();
  });
});

describe("extractCompletedSprintSections", () => {
  test("extracts sections for completed sprints", () => {
    const sections = extractCompletedSprintSections(SAMPLE_SPEC, 2);
    expect(sections.size).toBe(2);
    expect(sections.has(1)).toBe(true);
    expect(sections.has(2)).toBe(true);
    expect(sections.has(3)).toBe(false);
  });

  test("returns empty map when no sprints completed", () => {
    const sections = extractCompletedSprintSections(SAMPLE_SPEC, 0);
    expect(sections.size).toBe(0);
  });
});

// --- Completed sprint freezing ---

describe("freezeCompletedSprints", () => {
  test("restores modified completed sprint sections", () => {
    const original = extractCompletedSprintSections(SAMPLE_SPEC, 2);

    // Simulate a proposed spec where sprint 1 was modified
    const proposedSpec = SAMPLE_SPEC.replace(
      "Build the base layer.",
      "Build the MODIFIED base layer.",
    );

    const frozen = freezeCompletedSprints(proposedSpec, original);
    expect(frozen).toContain("Build the base layer.");
    expect(frozen).not.toContain("Build the MODIFIED base layer.");
  });

  test("preserves changes to non-completed sprints", () => {
    const original = extractCompletedSprintSections(SAMPLE_SPEC, 1);

    const proposedSpec = SAMPLE_SPEC.replace(
      "Add user-facing features.",
      "Add MODIFIED user-facing features.",
    );

    const frozen = freezeCompletedSprints(proposedSpec, original);
    // Sprint 2 should still have the modification (not frozen)
    expect(frozen).toContain("Add MODIFIED user-facing features.");
    // Sprint 1 should be preserved
    expect(frozen).toContain("Build the base layer.");
  });
});

// --- Sprint count recalculation ---

describe("countSprints", () => {
  test("counts sprint headings in spec", () => {
    expect(countSprints(SAMPLE_SPEC)).toBe(3);
  });

  test("returns 0 for spec with no sprints", () => {
    expect(countSprints("# Product Spec\n\nJust an overview.")).toBe(0);
  });

  test("counts correctly when sprint is added", () => {
    const extended = SAMPLE_SPEC + "\n## Sprint 4\n\nNew sprint.\n";
    expect(countSprints(extended)).toBe(4);
  });

  test("counts correctly when sprint is removed", () => {
    // Remove sprint 3
    const reduced = SAMPLE_SPEC.replace(
      /## Sprint 3[\s\S]*$/,
      "",
    );
    expect(countSprints(reduced)).toBe(2);
  });
});

// --- Diff computation ---

describe("computeSpecDiff", () => {
  test("returns null for identical specs", () => {
    expect(computeSpecDiff("hello\nworld", "hello\nworld")).toBeNull();
  });

  test("shows added lines with + prefix", () => {
    const diff = computeSpecDiff("line1\nline2", "line1\nnew line\nline2");
    expect(diff).not.toBeNull();
    expect(diff).toContain("+ new line");
  });

  test("shows removed lines with - prefix", () => {
    const diff = computeSpecDiff("line1\nold line\nline2", "line1\nline2");
    expect(diff).not.toBeNull();
    expect(diff).toContain("- old line");
  });

  test("shows both additions and removals for replacements", () => {
    const diff = computeSpecDiff("line1\nold\nline3", "line1\nnew\nline3");
    expect(diff).not.toBeNull();
    expect(diff).toContain("- old");
    expect(diff).toContain("+ new");
  });
});

// --- No-op behavior when flag is absent ---

describe("no-op without --refine-spec", () => {
  test("refineSpec defaults to false in config", () => {
    const config = resolveConfig({
      prompt: "test",
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
      refineSpec: false,
    });
    // When refineSpec is false, the harness should not call any refinement logic
    expect(config.refineSpec).toBe(false);
  });
});

// --- Refinement prompt (Sprint 7: partial-output instructions) ---

describe("buildRefinementPrompt", () => {
  test("includes current spec content as reference", () => {
    const prompt = buildRefinementPrompt(SAMPLE_SPEC, [1, 2], [3]);
    expect(prompt).toContain(SAMPLE_SPEC);
  });

  test("includes completed sprint numbers", () => {
    const prompt = buildRefinementPrompt(SAMPLE_SPEC, [1, 2], [3]);
    expect(prompt).toContain("Completed sprints: 1, 2");
  });

  test("includes remaining sprint numbers", () => {
    const prompt = buildRefinementPrompt(SAMPLE_SPEC, [1, 2], [3]);
    expect(prompt).toContain("Remaining sprints: 3");
  });

  test("instructs to emit only remaining-sprint sections", () => {
    const prompt = buildRefinementPrompt(SAMPLE_SPEC, [1, 2], [3]);
    expect(prompt).toContain("Output only the revised remaining-sprint sections");
  });

  test("explicitly forbids re-emitting completed sprint sections", () => {
    const prompt = buildRefinementPrompt(SAMPLE_SPEC, [1, 2], [3]);
    expect(prompt).toContain("Do NOT re-emit any completed sprint sections");
    expect(prompt).toContain("## Sprint 1");
    expect(prompt).toContain("## Sprint 2");
  });

  test("instructs output to start with the first remaining sprint heading", () => {
    const prompt = buildRefinementPrompt(SAMPLE_SPEC, [1, 2], [3]);
    expect(prompt).toContain("## Sprint 3");
    // Output should start with the first remaining sprint
    expect(prompt).toContain("starting with `## Sprint 3`");
  });

  test("instructs to propose adjustments to remaining sprints", () => {
    const prompt = buildRefinementPrompt(SAMPLE_SPEC, [1], [2, 3]);
    expect(prompt).toContain("Propose adjustments to the REMAINING sprints");
  });

  test("does NOT instruct to re-read the codebase (map is injected via supplementaryContext)", () => {
    const prompt = buildRefinementPrompt(SAMPLE_SPEC, [1], [2, 3]);
    expect(prompt).not.toContain("Read the actual codebase");
  });

  test("does NOT instruct to write a complete revised spec including all sections", () => {
    const prompt = buildRefinementPrompt(SAMPLE_SPEC, [1], [2, 3]);
    expect(prompt).not.toContain("Include ALL sections");
  });
});

// --- spliceRefinementSections ---

describe("spliceRefinementSections", () => {
  // Happy path: Planner returns only the remaining sections (Sprint 3 onward)
  const REVISED_SPRINT_3 = `## Sprint 3

**Theme: Revised Polish**

Updated final polish with better testing.`;

  test("assembles full spec from completed sections + revised remaining", () => {
    const completedSections = extractCompletedSprintSections(SAMPLE_SPEC, 2);
    const result = spliceRefinementSections(SAMPLE_SPEC, completedSections, REVISED_SPRINT_3, 2);

    expect(result).toContain("## Sprint 1");
    expect(result).toContain("## Sprint 2");
    expect(result).toContain("## Sprint 3");
    expect(result).toContain("Revised Polish");
  });

  test("completed sections are preserved byte-for-byte", () => {
    const completedSections = extractCompletedSprintSections(SAMPLE_SPEC, 2);
    const result = spliceRefinementSections(SAMPLE_SPEC, completedSections, REVISED_SPRINT_3, 2);

    // Extract the completed sections from the result and compare verbatim
    const resultSections = extractCompletedSprintSections(result, 2);
    for (const [n, original] of completedSections) {
      expect(resultSections.get(n)).toBe(original);
    }
  });

  test("revised section replaces original remaining content", () => {
    const completedSections = extractCompletedSprintSections(SAMPLE_SPEC, 2);
    const result = spliceRefinementSections(SAMPLE_SPEC, completedSections, REVISED_SPRINT_3, 2);

    expect(result).not.toContain("Final polish and testing.");
    expect(result).toContain("Updated final polish with better testing.");
  });

  test("sprint count is preserved when Planner returns the same number of remaining sprints", () => {
    const completedSections = extractCompletedSprintSections(SAMPLE_SPEC, 2);
    const result = spliceRefinementSections(SAMPLE_SPEC, completedSections, REVISED_SPRINT_3, 2);

    expect(countSprintHeadings(result)).toBe(countSprintHeadings(SAMPLE_SPEC));
  });

  test("sections appear in correct ordinal order (completed before remaining)", () => {
    const completedSections = extractCompletedSprintSections(SAMPLE_SPEC, 2);
    const result = spliceRefinementSections(SAMPLE_SPEC, completedSections, REVISED_SPRINT_3, 2);

    const pos1 = result.indexOf("## Sprint 1");
    const pos2 = result.indexOf("## Sprint 2");
    const pos3 = result.indexOf("## Sprint 3");
    expect(pos1).toBeLessThan(pos2);
    expect(pos2).toBeLessThan(pos3);
  });

  test("preamble (non-sprint content) is preserved from original spec", () => {
    const completedSections = extractCompletedSprintSections(SAMPLE_SPEC, 2);
    const result = spliceRefinementSections(SAMPLE_SPEC, completedSections, REVISED_SPRINT_3, 2);

    expect(result).toContain("# Product Spec");
    expect(result).toContain("## Overview");
    expect(result).toContain("A great product.");
  });

  // Fallback: empty Planner response
  test("falls back to original spec on empty revised content", () => {
    const completedSections = extractCompletedSprintSections(SAMPLE_SPEC, 2);
    const result = spliceRefinementSections(SAMPLE_SPEC, completedSections, "", 2);
    expect(result).toBe(SAMPLE_SPEC);
  });

  test("falls back to original spec on blank revised content", () => {
    const completedSections = extractCompletedSprintSections(SAMPLE_SPEC, 2);
    const result = spliceRefinementSections(SAMPLE_SPEC, completedSections, "   \n  \n", 2);
    expect(result).toBe(SAMPLE_SPEC);
  });

  // Fallback: no recognisable ## Sprint N in the Planner output
  test("falls back to original spec when no ## Sprint N heading is in Planner output", () => {
    const completedSections = extractCompletedSprintSections(SAMPLE_SPEC, 2);
    const result = spliceRefinementSections(SAMPLE_SPEC, completedSections, "Some prose without headings.", 2);
    expect(result).toBe(SAMPLE_SPEC);
  });

  test("falls back to original spec when Planner output only contains completed sprint headings", () => {
    // Sprint 1 and 2 are completed; the Planner output contains only completed sprints
    const completedSections = extractCompletedSprintSections(SAMPLE_SPEC, 2);
    const onlyCompleted = "## Sprint 1\n\nSome content.\n\n## Sprint 2\n\nMore content.";
    const result = spliceRefinementSections(SAMPLE_SPEC, completedSections, onlyCompleted, 2);
    expect(result).toBe(SAMPLE_SPEC);
  });

  // Never-throwing contract
  test("never throws on empty originalSpec", () => {
    const completedSections = new Map<number, string>();
    expect(() => spliceRefinementSections("", completedSections, REVISED_SPRINT_3, 0)).not.toThrow();
  });

  test("never throws on empty completed sections map", () => {
    const completedSections = new Map<number, string>();
    const result = spliceRefinementSections(SAMPLE_SPEC, completedSections, REVISED_SPRINT_3, 0);
    // With no completed sections and completedSprint=0, firstRemaining=1
    // REVISED_SPRINT_3 starts with ## Sprint 3, which is > 0, so fuzzy fallback finds it
    expect(() =>
      spliceRefinementSections(SAMPLE_SPEC, completedSections, REVISED_SPRINT_3, 0),
    ).not.toThrow();
    expect(result).toContain("## Sprint 3");
  });

  test("never throws on completely invalid input", () => {
    const completedSections = new Map<number, string>();
    expect(() => spliceRefinementSections("", completedSections, "", 0)).not.toThrow();
  });

  // Fuzzy fallback: Planner returns full spec (heading drift scenario)
  test("handles case where Planner returns full spec by finding first remaining sprint heading", () => {
    // completedSprint=1, firstRemaining=2
    // Planner returns the full spec (which includes ## Sprint 1 and ## Sprint 2)
    const completedSections = extractCompletedSprintSections(SAMPLE_SPEC, 1);
    const fullSpecFromPlanner = SAMPLE_SPEC; // full spec
    const result = spliceRefinementSections(SAMPLE_SPEC, completedSections, fullSpecFromPlanner, 1);

    // Should find ## Sprint 2 and use it as the start of remaining content
    // Result: preamble + ## Sprint 1 (verbatim) + ## Sprint 2 onward (from planner)
    expect(result).toContain("## Sprint 1");
    expect(result).toContain("## Sprint 2");
    expect(result).toContain("## Sprint 3");
    // Sprint 1 should be verbatim from original
    const sprint1From = extractSprintSection(result, 1);
    const sprint1Original = extractSprintSection(SAMPLE_SPEC, 1);
    expect(sprint1From).toBe(sprint1Original);
  });

  // Multiple remaining sprints
  test("assembles multiple revised remaining sprints correctly", () => {
    const multiRemaining = `## Sprint 2

**Theme: Revised Features**

Revised user-facing features.

## Sprint 3

**Theme: Revised Polish**

Revised final polish.`;

    const completedSections = extractCompletedSprintSections(SAMPLE_SPEC, 1);
    const result = spliceRefinementSections(SAMPLE_SPEC, completedSections, multiRemaining, 1);

    expect(result).toContain("## Sprint 1");
    expect(result).toContain("## Sprint 2");
    expect(result).toContain("Revised user-facing features.");
    expect(result).toContain("## Sprint 3");
    expect(result).toContain("Revised final polish.");
    // Sprint 1 verbatim
    const sprint1From = extractSprintSection(result, 1);
    const sprint1Original = extractSprintSection(SAMPLE_SPEC, 1);
    expect(sprint1From).toBe(sprint1Original);
  });
});
