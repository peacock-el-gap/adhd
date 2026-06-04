/**
 * Contract size ceiling — the pure, deterministic half of F5 enforcement.
 *
 * A sprint contract can grow too big during negotiation (the classic
 * 1→5→11 inflation): more features, more criteria, and more surfaces than a
 * single sprint can honestly deliver. This module answers two questions with
 * no side effects:
 *
 *   - does a contract exceed any configured limit? ({@link exceedsContractLimits})
 *   - what is the in-budget version of that contract? ({@link trimContractToLimits})
 *
 * It sits beside the scope logic in `shared/surfaces.ts` (it reuses
 * {@link normalizeSurfaces} to clean trimmed surface lists) and, like that
 * module, performs zero git/filesystem/network I/O and never throws on odd
 * input — degenerate contracts simply yield the best clean interpretation.
 * The SDK-driven reviewer round that complements this trim lives at the edge
 * in `harness-claude/contract.ts`.
 */

import { normalizeSurfaces } from "./surfaces.ts";
import type { SprintContract } from "./types.ts";

/** The three configurable per-sprint ceilings (resolved in F4). */
export interface ContractLimits {
  maxFeatures: number;
  maxCriteria: number;
  maxSurfaces: number;
}

/** A snapshot of a contract's size along the three bounded dimensions. */
export interface ContractCounts {
  features: number;
  criteria: number;
  surfaces: number;
}

/** Which individual limits a contract exceeds (true = over that cap). */
export interface LimitViolations {
  features: boolean;
  criteria: boolean;
  surfaces: boolean;
}

/** The outcome of trimming a contract back within its limits. */
export interface ContractTrimResult {
  /** The in-budget contract (a new object; the input is never mutated). */
  contract: SprintContract;
  /** True when any dimension was actually reduced. */
  trimmed: boolean;
  /** Which limits the original contract exceeded. */
  exceeded: LimitViolations;
  /** Size of the contract before trimming. */
  before: ContractCounts;
  /** Size of the contract after trimming. */
  after: ContractCounts;
}

/** A list-or-undefined value coerced to a safe array (never throws). */
function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/**
 * Coerce a configured limit into a safe, non-negative integer cap. Invalid or
 * missing limits (NaN, negatives, non-numbers) disable trimming for that
 * dimension by returning `Infinity`, so odd config never crashes a run or
 * silently empties a contract.
 */
function safeCap(limit: unknown): number {
  return typeof limit === "number" && Number.isInteger(limit) && limit >= 0 ? limit : Number.POSITIVE_INFINITY;
}

/**
 * Count a contract's size along the three bounded dimensions. Surfaces are
 * counted after {@link normalizeSurfaces} so unknown/duplicate tokens never
 * inflate the number. Pure and never-throwing.
 */
export function countContract(contract: SprintContract): ContractCounts {
  return {
    features: asArray(contract?.features).length,
    criteria: asArray(contract?.criteria).length,
    surfaces: (normalizeSurfaces(contract?.surfaces) ?? []).length,
  };
}

/** Report which individual limits a contract exceeds. Pure, never throws. */
export function getLimitViolations(contract: SprintContract, limits: ContractLimits): LimitViolations {
  const counts = countContract(contract);
  return {
    features: counts.features > safeCap(limits?.maxFeatures),
    criteria: counts.criteria > safeCap(limits?.maxCriteria),
    surfaces: counts.surfaces > safeCap(limits?.maxSurfaces),
  };
}

/** True when the contract exceeds any configured limit. Pure, never throws. */
export function exceedsContractLimits(contract: SprintContract, limits: ContractLimits): boolean {
  const v = getLimitViolations(contract, limits);
  return v.features || v.criteria || v.surfaces;
}

/**
 * Produce an in-budget copy of a contract by keeping the first N items within
 * each cap: the first N features, the first N criteria, and the first N
 * *declared* surfaces routed through {@link normalizeSurfaces} (which drops
 * duplicates/unknown tokens while preserving the contract's declared ordering
 * rather than re-sorting to canonical order).
 *
 * The input contract is never mutated. When no dimension is over its limit the
 * returned contract is content-equivalent and `trimmed` is `false`. Pure and
 * never-throwing — degenerate input degrades to the cleanest in-budget result.
 */
export function trimContractToLimits(contract: SprintContract, limits: ContractLimits): ContractTrimResult {
  const exceeded = getLimitViolations(contract, limits);
  const before = countContract(contract);

  const features = asArray<string>(contract?.features);
  const criteria = asArray<SprintContract["criteria"][number]>(contract?.criteria);

  const trimmedContract: SprintContract = {
    ...contract,
    features: features.slice(0, capLength(features.length, limits?.maxFeatures)),
    criteria: criteria.slice(0, capLength(criteria.length, limits?.maxCriteria)),
  };

  // Only touch `surfaces` when it was actually declared, so legacy contracts
  // without the field keep it absent rather than gaining an empty array.
  if (contract?.surfaces !== undefined) {
    const declared = asArray<string>(contract.surfaces);
    const surfaceCap = capLength(declared.length, limits?.maxSurfaces);
    trimmedContract.surfaces = normalizeSurfaces(declared.slice(0, surfaceCap)) ?? [];
  }

  const after = countContract(trimmedContract);
  const trimmed =
    after.features < before.features || after.criteria < before.criteria || after.surfaces < before.surfaces;

  return { contract: trimmedContract, trimmed, exceeded, before, after };
}

/** Resolve how many items to keep for a dimension given its (possibly odd) cap. */
function capLength(count: number, limit: unknown): number {
  const cap = safeCap(limit);
  return cap === Number.POSITIVE_INFINITY ? count : Math.min(count, cap);
}
