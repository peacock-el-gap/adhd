/**
 * Integration tests for sprint selection (--sprint N) with contract reuse,
 * and refinement freezes completed sprints.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { readContract, writeContract } from "../shared/files.ts";
import {
  computeSpecDiff,
  extractCompletedSprintSections,
  extractSprintSection,
  freezeCompletedSprints,
} from "../shared/refinement.ts";
import type { SprintContract } from "../shared/types.ts";

const TMP_DIR = join(import.meta.dir, "__tmp_sprint_sel_integration__");
const ADHD_DIR = join(TMP_DIR, ".adhd");

beforeEach(() => {
  mkdirSync(join(ADHD_DIR, "contracts"), { recursive: true });
  mkdirSync(join(ADHD_DIR, "feedback"), { recursive: true });
});

afterEach(() => {
  rmSync(TMP_DIR, { recursive: true, force: true });
});

describe("sprint selection contract reuse", () => {
  test("when contract file exists, it is loaded without negotiation", async () => {
    const existingContract: SprintContract = {
      sprintNumber: 3,
      features: ["Feature X"],
      criteria: [{ name: "x_works", description: "Feature X is functional", threshold: 7, type: "behavioral" }],
    };

    await writeContract(TMP_DIR, existingContract);

    // Verify the file exists
    const contractPath = join(ADHD_DIR, "contracts", "sprint-3.json");
    expect(existsSync(contractPath)).toBe(true);

    // Simulate what harness does: try to read existing contract
    let contract: SprintContract | null = null;
    let negotiationRan = false;

    try {
      contract = await readContract(TMP_DIR, 3);
    } catch {
      contract = null;
    }

    if (!contract) {
      negotiationRan = true;
    }

    expect(contract).not.toBeNull();
    expect(contract?.sprintNumber).toBe(3);
    expect(contract?.features).toEqual(["Feature X"]);
    expect(negotiationRan).toBe(false);
  });

  test("when no contract file exists, negotiation proceeds", async () => {
    // Don't write any contract file
    let contract: SprintContract | null = null;
    let negotiationRan = false;

    try {
      contract = await readContract(TMP_DIR, 5);
    } catch {
      contract = null;
    }

    if (!contract) {
      negotiationRan = true;
    }

    expect(contract).toBeNull();
    expect(negotiationRan).toBe(true);
  });

  test("loaded contract has correct structure", async () => {
    const existingContract: SprintContract = {
      sprintNumber: 2,
      features: ["Feature A", "Feature B"],
      criteria: [
        { name: "a_works", description: "A is functional", threshold: 7, type: "behavioral" },
        { name: "b_clean", description: "B is clean", threshold: 7, type: "implementation" },
      ],
    };

    await writeContract(TMP_DIR, existingContract);
    const loaded = await readContract(TMP_DIR, 2);

    expect(loaded.sprintNumber).toBe(2);
    expect(loaded.features).toHaveLength(2);
    expect(loaded.criteria).toHaveLength(2);
    expect(loaded.criteria[0]?.type).toBe("behavioral");
  });
});

describe("refinement freezes completed sprints", () => {
  const SPEC = `# Spec

## Sprint 1

Build authentication.

## Sprint 2

Build dashboard.

## Sprint 3

Build reporting.

## Sprint 4

Build admin panel.
`;

  test("sprints 1-2 completed, proposed changes to sprint 1 are reverted", () => {
    const originalSections = extractCompletedSprintSections(SPEC, 2);

    // Proposed spec modifies sprint 1 content
    const proposedSpec = SPEC.replace(
      "Build authentication.",
      "Completely rewrite authentication from scratch.",
    ).replace("Build reporting.", "Build advanced reporting with charts.");

    const frozen = freezeCompletedSprints(proposedSpec, originalSections);

    // Sprint 1 should match original exactly
    const sprint1Frozen = extractSprintSection(frozen, 1);
    const sprint1Original = extractSprintSection(SPEC, 1);
    expect(sprint1Frozen).toBe(sprint1Original);

    // Sprint 2 should also match original
    const sprint2Frozen = extractSprintSection(frozen, 2);
    const sprint2Original = extractSprintSection(SPEC, 2);
    expect(sprint2Frozen).toBe(sprint2Original);

    // Sprint 3-4 should reflect proposed changes
    expect(frozen).toContain("Build advanced reporting with charts.");
    expect(frozen).toContain("Build admin panel.");
  });

  test("proposed changes to sprint 2 content are also reverted when sprint 2 is completed", () => {
    const originalSections = extractCompletedSprintSections(SPEC, 2);

    const proposedSpec = SPEC.replace("Build dashboard.", "Build MODIFIED dashboard.");

    const frozen = freezeCompletedSprints(proposedSpec, originalSections);
    expect(frozen).toContain("Build dashboard.");
    expect(frozen).not.toContain("MODIFIED dashboard");
  });

  test("sprint 3 and 4 changes are preserved when only sprints 1-2 frozen", () => {
    const originalSections = extractCompletedSprintSections(SPEC, 2);

    const proposedSpec = SPEC.replace("Build reporting.", "Build reporting with analytics.").replace(
      "Build admin panel.",
      "Build admin panel with RBAC.",
    );

    const frozen = freezeCompletedSprints(proposedSpec, originalSections);
    expect(frozen).toContain("Build reporting with analytics.");
    expect(frozen).toContain("Build admin panel with RBAC.");
  });
});

describe("spec diff computation accuracy", () => {
  test("additions are prefixed with + ", () => {
    const oldSpec = "line1\nline2\nline3";
    const newSpec = "line1\nline2\nnew line\nline3";
    const diff = computeSpecDiff(oldSpec, newSpec);
    expect(diff).not.toBeNull();
    expect(diff).toContain("+ new line");
  });

  test("removals are prefixed with - ", () => {
    const oldSpec = "line1\nremoved\nline3";
    const newSpec = "line1\nline3";
    const diff = computeSpecDiff(oldSpec, newSpec);
    expect(diff).not.toBeNull();
    expect(diff).toContain("- removed");
  });

  test("unchanged lines are not in output", () => {
    const oldSpec = "unchanged\nold\nunchanged2";
    const newSpec = "unchanged\nnew\nunchanged2";
    const diff = computeSpecDiff(oldSpec, newSpec);
    expect(diff).not.toBeNull();
    // unchanged lines should NOT be in the diff
    expect(diff).not.toContain("unchanged\n");
    expect(diff).not.toContain("unchanged2");
    expect(diff).toContain("- old");
    expect(diff).toContain("+ new");
  });

  test("returns null when old and new are identical", () => {
    const spec = "line1\nline2\nline3";
    const diff = computeSpecDiff(spec, spec);
    expect(diff).toBeNull();
  });

  test("handles multi-line additions correctly", () => {
    const oldSpec = "start\nend";
    const newSpec = "start\nadded1\nadded2\nend";
    const diff = computeSpecDiff(oldSpec, newSpec);
    expect(diff).not.toBeNull();
    expect(diff).toContain("+ added1");
    expect(diff).toContain("+ added2");
  });
});
