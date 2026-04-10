import { describe, expect, test } from "bun:test";
import {
  buildRefinementPrompt,
  computeSpecDiff,
  countSprints,
  extractCompletedSprintSections,
  extractSprintSection,
  freezeCompletedSprints,
} from "./refinement.ts";

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

## Sprint 4

**Theme: Launch**

Ship the product.
`;

describe("extractSprintSection", () => {
  test("extracts correct section content for sprint 1", () => {
    const section = extractSprintSection(SAMPLE_SPEC, 1);
    expect(section).not.toBeNull();
    expect(section).toContain("## Sprint 1");
    expect(section).toContain("Build the base layer.");
    expect(section).not.toContain("## Sprint 2");
  });

  test("extracts correct section content for sprint 2", () => {
    const section = extractSprintSection(SAMPLE_SPEC, 2);
    expect(section).not.toBeNull();
    expect(section).toContain("## Sprint 2");
    expect(section).toContain("Add user-facing features.");
    expect(section).not.toContain("## Sprint 3");
  });

  test("extracts last sprint section", () => {
    const section = extractSprintSection(SAMPLE_SPEC, 4);
    expect(section).not.toBeNull();
    expect(section).toContain("## Sprint 4");
    expect(section).toContain("Ship the product.");
  });

  test("returns null for non-existent sprint", () => {
    expect(extractSprintSection(SAMPLE_SPEC, 99)).toBeNull();
  });
});

describe("extractCompletedSprintSections", () => {
  test("returns map for sprints 1..N", () => {
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

  test("returns single entry for completedSprint=1", () => {
    const sections = extractCompletedSprintSections(SAMPLE_SPEC, 1);
    expect(sections.size).toBe(1);
    expect(sections.has(1)).toBe(true);
  });
});

describe("freezeCompletedSprints", () => {
  test("replaces modified completed sections with originals", () => {
    const originalSections = extractCompletedSprintSections(SAMPLE_SPEC, 2);

    const proposedSpec = SAMPLE_SPEC.replace("Build the base layer.", "Build the MODIFIED base layer.").replace(
      "Add user-facing features.",
      "Add MODIFIED features.",
    );

    const frozen = freezeCompletedSprints(proposedSpec, originalSections);
    expect(frozen).toContain("Build the base layer.");
    expect(frozen).not.toContain("MODIFIED base layer");
    expect(frozen).toContain("Add user-facing features.");
    expect(frozen).not.toContain("MODIFIED features");
  });

  test("preserves changes to non-completed sprints", () => {
    const originalSections = extractCompletedSprintSections(SAMPLE_SPEC, 2);

    const proposedSpec = SAMPLE_SPEC.replace("Final polish and testing.", "Completely rewritten sprint 3.");

    const frozen = freezeCompletedSprints(proposedSpec, originalSections);
    expect(frozen).toContain("Completely rewritten sprint 3.");
  });

  test("no-op when completed sections are unchanged", () => {
    const originalSections = extractCompletedSprintSections(SAMPLE_SPEC, 1);
    const frozen = freezeCompletedSprints(SAMPLE_SPEC, originalSections);
    expect(frozen).toBe(SAMPLE_SPEC);
  });
});

describe("countSprints", () => {
  test("counts ## Sprint N headings correctly", () => {
    expect(countSprints(SAMPLE_SPEC)).toBe(4);
  });

  test("returns 0 for spec with no sprints", () => {
    expect(countSprints("# Product Spec\n\nJust an overview.")).toBe(0);
  });

  test("counts correctly when sprint is added", () => {
    const extended = `${SAMPLE_SPEC}\n## Sprint 5\n\nNew sprint.\n`;
    expect(countSprints(extended)).toBe(5);
  });
});

describe("computeSpecDiff", () => {
  test("returns null for identical specs", () => {
    expect(computeSpecDiff("hello\nworld", "hello\nworld")).toBeNull();
  });

  test("returns correct + prefixed lines for additions", () => {
    const diff = computeSpecDiff("line1\nline2", "line1\nnew line\nline2");
    expect(diff).not.toBeNull();
    expect(diff).toContain("+ new line");
  });

  test("returns correct - prefixed lines for removals", () => {
    const diff = computeSpecDiff("line1\nold line\nline2", "line1\nline2");
    expect(diff).not.toBeNull();
    expect(diff).toContain("- old line");
  });

  test("unchanged lines are not in output", () => {
    const diff = computeSpecDiff("line1\nold\nline3", "line1\nnew\nline3");
    expect(diff).not.toBeNull();
    // "line1" and "line3" should NOT appear in the diff since they are unchanged
    expect(diff).not.toContain("line1");
    expect(diff).not.toContain("line3");
    expect(diff).toContain("- old");
    expect(diff).toContain("+ new");
  });
});

describe("buildRefinementPrompt", () => {
  test("includes completed sprint numbers", () => {
    const prompt = buildRefinementPrompt(SAMPLE_SPEC, [1, 2], [3, 4]);
    expect(prompt).toContain("Completed sprints: 1, 2");
  });

  test("includes remaining sprint numbers", () => {
    const prompt = buildRefinementPrompt(SAMPLE_SPEC, [1, 2], [3, 4]);
    expect(prompt).toContain("Remaining sprints: 3, 4");
  });

  test("includes the current spec content", () => {
    const prompt = buildRefinementPrompt(SAMPLE_SPEC, [1], [2, 3, 4]);
    expect(prompt).toContain("## Current Spec");
    expect(prompt).toContain("A great product.");
  });

  test("instructs to preserve completed sprints", () => {
    const prompt = buildRefinementPrompt(SAMPLE_SPEC, [1, 2], [3, 4]);
    expect(prompt).toContain("preserve all completed sprint sections");
    expect(prompt).toContain("## Sprint 1");
    expect(prompt).toContain("## Sprint 2");
  });
});
