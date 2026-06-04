import { describe, expect, test } from "bun:test";
import {
  countContract,
  exceedsContractLimits,
  getLimitViolations,
  trimContractToLimits,
} from "../shared/contract-limits.ts";
import type { SprintContract } from "../shared/types.ts";

const limits = { maxFeatures: 3, maxCriteria: 10, maxSurfaces: 2 };

function criterion(name: string) {
  return { name, description: `desc ${name}`, threshold: 7, type: "behavioral" as const };
}

function makeContract(overrides: Partial<SprintContract> = {}): SprintContract {
  return {
    sprintNumber: 1,
    features: ["f1", "f2"],
    surfaces: ["backend", "tests"],
    criteria: [criterion("c1"), criterion("c2")],
    ...overrides,
  };
}

describe("countContract", () => {
  test("counts features, criteria, and normalized surfaces", () => {
    const counts = countContract(makeContract());
    expect(counts).toEqual({ features: 2, criteria: 2, surfaces: 2 });
  });

  test("counts surfaces after dropping duplicates and unknown tokens", () => {
    const counts = countContract(
      makeContract({ surfaces: ["backend", "backend", "api", "tests"] as string[] }),
    );
    expect(counts.surfaces).toBe(2);
  });

  test("never throws on odd input", () => {
    const odd = { sprintNumber: 1 } as unknown as SprintContract;
    expect(() => countContract(odd)).not.toThrow();
    expect(countContract(odd)).toEqual({ features: 0, criteria: 0, surfaces: 0 });
  });
});

describe("exceedsContractLimits / getLimitViolations", () => {
  test("under all limits reports no violations", () => {
    expect(exceedsContractLimits(makeContract(), limits)).toBe(false);
    expect(getLimitViolations(makeContract(), limits)).toEqual({
      features: false,
      criteria: false,
      surfaces: false,
    });
  });

  test("detects too many features", () => {
    const contract = makeContract({ features: ["a", "b", "c", "d", "e"] });
    expect(getLimitViolations(contract, limits).features).toBe(true);
    expect(exceedsContractLimits(contract, limits)).toBe(true);
  });

  test("detects too many criteria", () => {
    const contract = makeContract({
      criteria: Array.from({ length: 12 }, (_, i) => criterion(`c${i}`)),
    });
    expect(getLimitViolations(contract, limits).criteria).toBe(true);
  });

  test("detects too many surfaces", () => {
    const contract = makeContract({ surfaces: ["backend", "frontend", "tests"] });
    expect(getLimitViolations(contract, limits).surfaces).toBe(true);
  });
});

describe("trimContractToLimits", () => {
  test("leaves an in-budget contract unchanged", () => {
    const contract = makeContract();
    const result = trimContractToLimits(contract, limits);
    expect(result.trimmed).toBe(false);
    expect(result.contract.features).toEqual(contract.features);
    expect(result.contract.criteria).toEqual(contract.criteria);
    expect(result.contract.surfaces).toEqual(contract.surfaces);
  });

  test("keeps the first N features", () => {
    const contract = makeContract({ features: ["a", "b", "c", "d", "e"] });
    const result = trimContractToLimits(contract, limits);
    expect(result.trimmed).toBe(true);
    expect(result.contract.features).toEqual(["a", "b", "c"]);
    expect(result.before.features).toBe(5);
    expect(result.after.features).toBe(3);
  });

  test("keeps the first N criteria", () => {
    const contract = makeContract({
      criteria: Array.from({ length: 12 }, (_, i) => criterion(`c${i}`)),
    });
    const result = trimContractToLimits(contract, limits);
    expect(result.contract.criteria).toHaveLength(10);
    expect(result.contract.criteria[0]!.name).toBe("c0");
    expect(result.contract.criteria[9]!.name).toBe("c9");
  });

  test("trims surfaces over all limits simultaneously", () => {
    const contract = makeContract({
      features: ["a", "b", "c", "d"],
      surfaces: ["backend", "frontend", "tests"],
      criteria: Array.from({ length: 11 }, (_, i) => criterion(`c${i}`)),
    });
    const result = trimContractToLimits(contract, limits);
    expect(result.exceeded).toEqual({ features: true, criteria: true, surfaces: true });
    expect(result.contract.features).toHaveLength(3);
    expect(result.contract.criteria).toHaveLength(10);
    expect(result.contract.surfaces).toEqual(["backend", "frontend"]);
  });

  test("surface trim drops duplicates/unknown tokens and preserves declared order", () => {
    const contract = makeContract({
      // first-N = ["tests", "tests"] would normalize to one; ensure declared order is kept
      surfaces: ["tests", "backend", "api", "frontend"] as string[],
    });
    const result = trimContractToLimits(contract, { ...limits, maxSurfaces: 2 });
    // first 2 declared = ["tests", "backend"] → normalized keeps declared order
    expect(result.contract.surfaces).toEqual(["tests", "backend"]);
  });

  test("does not mutate the input contract", () => {
    const contract = makeContract({ features: ["a", "b", "c", "d"] });
    trimContractToLimits(contract, limits);
    expect(contract.features).toHaveLength(4);
  });

  test("leaves surfaces absent when the field was never declared", () => {
    const contract = makeContract({ surfaces: undefined });
    const result = trimContractToLimits(contract, limits);
    expect(result.contract.surfaces).toBeUndefined();
  });

  test("never throws on empty or odd input", () => {
    const empty = { sprintNumber: 1, features: [], criteria: [] } as SprintContract;
    expect(() => trimContractToLimits(empty, limits)).not.toThrow();
    const odd = {} as unknown as SprintContract;
    expect(() => trimContractToLimits(odd, limits)).not.toThrow();
    expect(trimContractToLimits(odd, limits).trimmed).toBe(false);
  });

  test("treats invalid limits as no trim rather than emptying the contract", () => {
    const contract = makeContract({ features: ["a", "b", "c", "d"] });
    const badLimits = { maxFeatures: 0.5, maxCriteria: Number.NaN, maxSurfaces: -1 } as unknown as typeof limits;
    const result = trimContractToLimits(contract, badLimits);
    expect(result.contract.features).toHaveLength(4);
    expect(result.trimmed).toBe(false);
  });
});
