/**
 * Unit tests for shared/budget.ts (F12).
 *
 * Exercises computeSprintTokenUsage and checkSprintBudget directly with mock
 * StageUsage arrays — no harness-claude/ code or SDK objects required.
 * Satisfies the `budget_summation_pure_shared` contract criterion.
 */
import { describe, expect, test } from "bun:test";
import { checkSprintBudget, computeSprintTokenUsage, formatBudgetMessage } from "../shared/budget.ts";
import type { StageUsage } from "../shared/types.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStage(name: string, input: number, output: number): StageUsage {
  return {
    stage: name,
    model: "claude-test",
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: 0,
    costUsd: 0,
    durationMs: 0,
  };
}

// ---------------------------------------------------------------------------
// computeSprintTokenUsage
// ---------------------------------------------------------------------------

describe("computeSprintTokenUsage", () => {
  const stages: StageUsage[] = [
    makeStage("sprint-1-contract-proposal", 100, 50),
    makeStage("sprint-1-contract-review", 80, 30),
    makeStage("sprint-1-attempt-0-generator", 500, 200),
    makeStage("sprint-1-attempt-0-evaluator", 300, 100),
    // Sprint 2 stages — should NOT be counted for sprint 1
    makeStage("sprint-2-contract-proposal", 999, 999),
    makeStage("sprint-2-attempt-0-generator", 999, 999),
  ];

  test("sums only stages belonging to the requested sprint", () => {
    const total = computeSprintTokenUsage(stages, 1);
    // sprint-1 stages: 100+50 + 80+30 + 500+200 + 300+100 = 1360
    expect(total).toBe(1360);
  });

  test("does not include stages from other sprints", () => {
    const total = computeSprintTokenUsage(stages, 1);
    // sprint-2 stages contribute 999*4 = 3996 extra — must NOT appear
    expect(total).toBeLessThan(1361);
  });

  test("returns 0 when no stages match the sprint", () => {
    const total = computeSprintTokenUsage(stages, 99);
    expect(total).toBe(0);
  });

  test("returns 0 for empty stages array", () => {
    expect(computeSprintTokenUsage([], 1)).toBe(0);
  });

  test("returns 0 for non-array input (graceful degradation)", () => {
    // @ts-expect-error — testing runtime robustness
    expect(computeSprintTokenUsage(null, 1)).toBe(0);
    // @ts-expect-error
    expect(computeSprintTokenUsage(undefined, 1)).toBe(0);
    // @ts-expect-error
    expect(computeSprintTokenUsage("not-an-array", 1)).toBe(0);
  });

  test("returns 0 for invalid sprintNumber", () => {
    expect(computeSprintTokenUsage(stages, 0)).toBe(0);
    expect(computeSprintTokenUsage(stages, -1)).toBe(0);
    // @ts-expect-error
    expect(computeSprintTokenUsage(stages, "1")).toBe(0);
  });

  test("treats missing token fields as zero (malformed StageUsage)", () => {
    const malformed = [
      { stage: "sprint-3-attempt-0-generator" } as unknown as StageUsage,
      { stage: "sprint-3-attempt-0-evaluator", inputTokens: null, outputTokens: undefined } as unknown as StageUsage,
      { stage: "sprint-3-contract-proposal", inputTokens: Number.NaN, outputTokens: Number.POSITIVE_INFINITY } as StageUsage,
    ];
    const total = computeSprintTokenUsage(malformed, 3);
    expect(total).toBe(0);
  });

  test("handles readonly array input (type safety)", () => {
    const readonlyStages: readonly StageUsage[] = [makeStage("sprint-5-attempt-0-generator", 100, 50)];
    expect(computeSprintTokenUsage(readonlyStages, 5)).toBe(150);
  });
});

// ---------------------------------------------------------------------------
// checkSprintBudget
// ---------------------------------------------------------------------------

describe("checkSprintBudget", () => {
  test("returns 'none' when tokens are well below 80%", () => {
    const result = checkSprintBudget(500, 1000, false);
    expect(result.threshold).toBe("none");
    expect(result.tokensUsed).toBe(500);
    expect(result.budget).toBe(1000);
    expect(result.percentUsed).toBe(50);
  });

  test("returns 'none' when exactly at 79.9%", () => {
    const result = checkSprintBudget(799, 1000, false);
    expect(result.threshold).toBe("none");
  });

  test("returns 'warn-at-80' when crossing the 80% threshold", () => {
    const result = checkSprintBudget(800, 1000, false);
    expect(result.threshold).toBe("warn-at-80");
    expect(result.percentUsed).toBe(80);
  });

  test("returns 'warn-at-80' when between 80% and 99%", () => {
    const result = checkSprintBudget(900, 1000, false);
    expect(result.threshold).toBe("warn-at-80");
  });

  test("idempotency: 80% threshold suppressed when alreadyWarned80=true", () => {
    const result = checkSprintBudget(900, 1000, true);
    // Already warned — should not warn again for 80%
    expect(result.threshold).toBe("none");
  });

  test("returns 'gate-at-100' when exactly at 100%", () => {
    const result = checkSprintBudget(1000, 1000, false);
    expect(result.threshold).toBe("gate-at-100");
    expect(result.percentUsed).toBe(100);
  });

  test("returns 'gate-at-100' when exceeding 100%", () => {
    const result = checkSprintBudget(1200, 1000, false);
    expect(result.threshold).toBe("gate-at-100");
  });

  test("gate-at-100 fires even when alreadyWarned80=true (100% takes priority)", () => {
    const result = checkSprintBudget(1000, 1000, true);
    expect(result.threshold).toBe("gate-at-100");
  });

  test("returns 'none' with safe defaults for invalid inputs", () => {
    // @ts-expect-error — testing runtime robustness
    const r1 = checkSprintBudget("not-a-number", 1000, false);
    expect(r1.threshold).toBe("none");
    expect(r1.tokensUsed).toBe(0);

    const r2 = checkSprintBudget(Number.NaN, 1000, false);
    expect(r2.threshold).toBe("none");

    const r3 = checkSprintBudget(500, 0, false);
    expect(r3.threshold).toBe("none");

    const r4 = checkSprintBudget(500, -100, false);
    expect(r4.threshold).toBe("none");
  });

  test("never throws for any input", () => {
    expect(() => checkSprintBudget(Number.NaN, Number.NaN, false)).not.toThrow();
    // @ts-expect-error
    expect(() => checkSprintBudget(null, undefined, "yes")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// formatBudgetMessage
// ---------------------------------------------------------------------------

describe("formatBudgetMessage", () => {
  test("formats warn-at-80 message with spend and remaining", () => {
    const result = checkSprintBudget(800, 1000, false);
    const msg = formatBudgetMessage(result, 3);
    expect(msg).toContain("Sprint 3");
    expect(msg).toContain("80%");
    expect(msg).toContain("800");
    expect(msg).toContain("1,000");
  });

  test("formats gate-at-100 message", () => {
    const result = checkSprintBudget(1000, 1000, false);
    const msg = formatBudgetMessage(result, 5);
    expect(msg).toContain("Sprint 5");
    expect(msg).toContain("budget reached");
  });

  test("formats a 'none' status message without threshold language", () => {
    const result = checkSprintBudget(300, 1000, false);
    const msg = formatBudgetMessage(result, 1);
    expect(msg).toContain("Sprint 1");
    expect(msg).not.toContain("reached");
    expect(msg).not.toContain("warning");
  });
});

// ---------------------------------------------------------------------------
// Integration: summing sprint stages into budget check
// ---------------------------------------------------------------------------

describe("computeSprintTokenUsage + checkSprintBudget integration", () => {
  test("correctly derives threshold from real stage array", () => {
    const stages: StageUsage[] = [
      makeStage("sprint-2-contract-proposal", 200, 100),
      makeStage("sprint-2-attempt-0-generator", 400, 150),
    ];
    const budget = 1000;
    const tokensUsed = computeSprintTokenUsage(stages, 2);
    // 200+100 + 400+150 = 850 → 85% → warn-at-80
    expect(tokensUsed).toBe(850);
    const result = checkSprintBudget(tokensUsed, budget, false);
    expect(result.threshold).toBe("warn-at-80");
  });

  test("gate-at-100 fires when sprint stages exceed budget", () => {
    const stages: StageUsage[] = [
      makeStage("sprint-4-attempt-0-generator", 600, 200),
      makeStage("sprint-4-attempt-0-evaluator", 300, 100),
    ];
    const budget = 1000;
    const tokensUsed = computeSprintTokenUsage(stages, 4);
    // 600+200 + 300+100 = 1200 → 120% → gate-at-100
    expect(tokensUsed).toBe(1200);
    const result = checkSprintBudget(tokensUsed, budget, false);
    expect(result.threshold).toBe("gate-at-100");
  });

  test("inert when budget is not set (caller checks first)", () => {
    // Callers guard with `if (!config.sprintTokenBudget)`. Verify that passing
    // budget=0 returns "none" (the inert behavior).
    const stages: StageUsage[] = [makeStage("sprint-1-attempt-0-generator", 9999, 9999)];
    const tokensUsed = computeSprintTokenUsage(stages, 1);
    const result = checkSprintBudget(tokensUsed, 0, false);
    expect(result.threshold).toBe("none");
  });
});
