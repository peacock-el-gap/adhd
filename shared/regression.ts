import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { harnessDir } from "./files.ts";
import { log } from "./logger.ts";
import type { RegressionCriterion, SprintContract } from "./types.ts";

/**
 * Maximum character count for the assembled regression section injected into
 * the Evaluator prompt. When the filtered criteria would exceed this limit the
 * section is truncated with a visible marker so context stays bounded even
 * when the accumulated suite is large.
 */
export const MAX_REGRESSION_SECTION_CHARS = 8_000;

/**
 * Path to the regression.json file within .adhd/
 * @param workDir - The project root directory
 * @returns Absolute path to .adhd/regression.json
 */
export function regressionPath(workDir: string): string {
  return join(harnessDir(workDir), "regression.json");
}

/**
 * Internal on-disk shape for regression.json as of Sprint 9.
 * Backward-compatible read: a bare JSON array is treated as a legacy store
 * with an empty retired-names set.
 */
interface RegressionStore {
  criteria: RegressionCriterion[];
  /** Durable set of criterion names that have been permanently retired. */
  retiredNames: string[];
}

/**
 * Read the full regression store from disk, handling both the legacy bare-array
 * format (pre-Sprint-9) and the Sprint-9 `{ criteria, retiredNames }` object.
 * Never throws — any parse error or unexpected schema degrades to an empty store.
 */
async function readRegressionStore(workDir: string): Promise<RegressionStore> {
  const filePath = regressionPath(workDir);
  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch {
    // File does not exist — normal on the first sprint
    return { criteria: [], retiredNames: [] };
  }

  try {
    const parsed = JSON.parse(raw);

    // Legacy format: a bare JSON array of RegressionCriterion objects
    if (Array.isArray(parsed)) {
      return { criteria: parsed as RegressionCriterion[], retiredNames: [] };
    }

    // Sprint-9 format: { criteria, retiredNames }
    if (parsed !== null && typeof parsed === "object" && Array.isArray(parsed.criteria)) {
      const retiredNames: string[] = Array.isArray(parsed.retiredNames)
        ? (parsed.retiredNames as unknown[]).filter((n): n is string => typeof n === "string")
        : [];
      return { criteria: parsed.criteria as RegressionCriterion[], retiredNames };
    }

    // Unexpected schema (e.g. null, a plain object without criteria, a number)
    log(
      "HARNESS",
      `Warning: regression.json has unexpected schema (expected array or {criteria,retiredNames} object). Proceeding without regression criteria.`,
    );
    return { criteria: [], retiredNames: [] };
  } catch (err) {
    // Invalid JSON
    log(
      "HARNESS",
      `Warning: regression.json contains invalid JSON: ${err instanceof Error ? err.message : String(err)}. Proceeding without regression criteria.`,
    );
    return { criteria: [], retiredNames: [] };
  }
}

/**
 * Read accumulated regression criteria from .adhd/regression.json.
 * Returns an empty array if the file does not exist.
 * Handles both the legacy bare-array format and the Sprint-9 richer format.
 * Logs a warning and returns an empty array on malformed input (graceful
 * degradation — never throws).
 * @param workDir - The project root directory
 * @returns Array of accumulated regression criteria, or empty array on failure
 */
export async function readRegressionCriteria(workDir: string): Promise<RegressionCriterion[]> {
  const store = await readRegressionStore(workDir);
  return store.criteria;
}

/**
 * After a sprint passes, accumulate its behavioral criteria into regression.json
 * and apply any retirements named in `contract.retire`.
 *
 * Retirement is durable: a name added to the retired-names set is never
 * re-admitted by a later same-named behavioral criterion (resurrection guard).
 * Retirements are announced in the plain HARNESS voice at normal log level.
 *
 * Criteria with type !== "behavioral" are excluded from accumulation.
 * New criteria are written with `tier: "core"` and `surfaces` taken from the
 * originating contract, so the relevance filter in `buildRegressionSection`
 * can later use them.
 *
 * @param workDir - The project root directory
 * @param contract - The sprint contract whose behavioral criteria should be
 *   accumulated; may also carry a `retire` list of names to permanently remove
 */
export async function accumulateRegressionCriteria(workDir: string, contract: SprintContract): Promise<void> {
  const behavioralCriteria = contract.criteria.filter((c) => c.type === "behavioral");
  const retireList: string[] = Array.isArray(contract.retire)
    ? (contract.retire as unknown[]).filter((n): n is string => typeof n === "string" && n.trim().length > 0)
    : [];

  // No-op when there is nothing to accumulate or retire
  if (behavioralCriteria.length === 0 && retireList.length === 0) return;

  const store = await readRegressionStore(workDir);
  const retiredNames = new Set<string>(store.retiredNames);

  // Apply retirements from this contract — durable: names added here block
  // any later same-named behavioral criterion from entering the suite
  for (const name of retireList) {
    if (!retiredNames.has(name)) {
      retiredNames.add(name);
      log("HARNESS", `Regression criterion '${name}' retired — suite shrunk by 1.`);
    }
  }

  // Build deduplicated criteria map, starting from existing stored criteria
  // but skipping any that are now in the retired-names set
  const criteriaMap = new Map<string, RegressionCriterion>();
  for (const c of store.criteria) {
    if (!retiredNames.has(c.name)) {
      criteriaMap.set(c.name, c);
    }
  }

  // Accumulate new behavioral criteria — skip any whose name is retired
  // (resurrection guard: retirement is durable against dedupe-by-name)
  for (const c of behavioralCriteria) {
    if (!retiredNames.has(c.name)) {
      const entry: RegressionCriterion = {
        name: c.name,
        description: c.description,
        threshold: c.threshold,
        sprintNumber: contract.sprintNumber,
        tier: "core",
      };
      // Only set surfaces when the contract declares them, so the field is
      // absent (omitted by JSON.stringify) when the contract has none —
      // matching the behavior of legacy criteria that predate surfaces
      if (contract.surfaces !== undefined) {
        entry.surfaces = contract.surfaces;
      }
      criteriaMap.set(c.name, entry);
    }
  }

  const newStore: RegressionStore = {
    criteria: Array.from(criteriaMap.values()),
    retiredNames: Array.from(retiredNames),
  };

  await writeFile(regressionPath(workDir), JSON.stringify(newStore, null, 2), "utf-8");
}

// ---------------------------------------------------------------------------
// Tiering helpers — pure, never-throwing, single-purpose
// ---------------------------------------------------------------------------

/**
 * Returns true when two surface arrays share at least one common element.
 * Both arrays are compared as plain strings (no normalization). Returns false
 * when either argument is absent or empty — there is nothing to intersect.
 */
function surfacesIntersect(criterionSurfaces: string[] | undefined, contractSurfaces: string[] | undefined): boolean {
  if (!criterionSurfaces || criterionSurfaces.length === 0) return false;
  if (!contractSurfaces || contractSurfaces.length === 0) return false;
  const contractSet = new Set(contractSurfaces);
  return criterionSurfaces.some((s) => contractSet.has(s));
}

/**
 * Returns true when `criterion` should be included in the regression section
 * for a sprint whose contract declares `contractSurfaces`.
 *
 * Rules (in priority order):
 * 1. Legacy criteria (no `tier` field) — always included, no surface check.
 * 2. tier="core" — always included, no surface check.
 * 3. tier="optional" with no contract surfaces declared — included (can't
 *    determine relevance, so default to safe inclusion).
 * 4. tier="optional" with declared contract surfaces — included only when the
 *    criterion's `surfaces` intersect the declared surfaces.
 * 5. Unknown tier value — always included (safe default).
 */
function isAlwaysChecked(criterion: RegressionCriterion, contractSurfaces: string[] | undefined): boolean {
  // Rule 1 & 5: no tier (legacy) or unrecognised tier — always check
  if (criterion.tier === undefined || (criterion.tier !== "core" && criterion.tier !== "optional")) {
    return true;
  }
  // Rule 2: core — always check
  if (criterion.tier === "core") return true;
  // Rules 3 & 4: optional
  // When the contract declares no surfaces we cannot do a relevance check —
  // include to stay safe (matches the harness graceful-degradation policy)
  if (!contractSurfaces || contractSurfaces.length === 0) return true;
  return surfacesIntersect(criterion.surfaces, contractSurfaces);
}

/**
 * Build a "## Regression Criteria" section string for injection into the
 * Evaluator prompt. Returns an empty string when there are no criteria or all
 * are filtered out by the relevance filter.
 *
 * Filtering rules:
 * - Legacy criteria (no `tier`) are always included.
 * - `tier="core"` criteria are always included.
 * - `tier="optional"` criteria are included only when their declared surfaces
 *   intersect `contractSurfaces`; if `contractSurfaces` is absent or empty,
 *   optional criteria are included (can't filter without declared surfaces).
 *
 * The output is capped at {@link MAX_REGRESSION_SECTION_CHARS} with a visible
 * truncation marker so the section size stays bounded as the suite grows.
 *
 * @param criteria - Accumulated regression criteria (filtered internally).
 * @param contractSurfaces - The current sprint contract's declared surfaces,
 *   used to decide which optional criteria are relevant. Pass undefined or an
 *   empty array when no surfaces are declared.
 * @returns Formatted markdown section string, or empty string if no criteria
 *   survive the filter.
 */
export function buildRegressionSection(criteria: RegressionCriterion[], contractSurfaces?: string[]): string {
  if (criteria.length === 0) return "";

  // Filter to only the criteria relevant for this sprint
  const relevant = criteria.filter((c) => isAlwaysChecked(c, contractSurfaces));
  if (relevant.length === 0) return "";

  const lines = [
    "\n## Regression Criteria\n",
    "The following behavioral criteria from previous sprints MUST still pass. Score each one alongside the current sprint's criteria.\n",
  ];

  for (const c of relevant) {
    lines.push(`- **${c.name}** (from sprint ${c.sprintNumber}, threshold: ${c.threshold}/10): ${c.description}`);
  }

  let section = lines.join("\n");

  // Apply the character-count ceiling with a visible truncation marker
  if (section.length > MAX_REGRESSION_SECTION_CHARS) {
    const truncated = section.slice(0, MAX_REGRESSION_SECTION_CHARS);
    // Break at the last newline so we don't cut mid-criterion
    const lastNewline = truncated.lastIndexOf("\n");
    const cutPoint = lastNewline > 0 ? lastNewline : MAX_REGRESSION_SECTION_CHARS;
    section = `${section.slice(0, cutPoint)}\n... (regression section truncated to stay within context limit)`;
  }

  return section;
}
