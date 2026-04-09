import { describe, expect, test } from "bun:test";
import { parseCli, resolveConfig } from "../shared/config.ts";
import {
  buildRefinementPrompt,
  computeSpecDiff,
  countSprints,
  extractCompletedSprintSections,
  extractSprintSection,
  freezeCompletedSprints,
} from "../shared/refinement.ts";

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

// --- Refinement prompt ---

describe("buildRefinementPrompt", () => {
  test("includes current spec content", () => {
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

  test("instructs to read codebase", () => {
    const prompt = buildRefinementPrompt(SAMPLE_SPEC, [1], [2, 3]);
    expect(prompt).toContain("Read the actual codebase");
  });

  test("instructs to preserve completed sprints", () => {
    const prompt = buildRefinementPrompt(SAMPLE_SPEC, [1, 2], [3]);
    expect(prompt).toContain("preserve all completed sprint sections");
    expect(prompt).toContain("## Sprint 1");
    expect(prompt).toContain("## Sprint 2");
  });

  test("instructs to only modify remaining sprints", () => {
    const prompt = buildRefinementPrompt(SAMPLE_SPEC, [1], [2, 3]);
    expect(prompt).toContain("Only modify not-yet-started sprint sections");
  });
});
