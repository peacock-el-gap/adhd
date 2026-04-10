import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { harnessDir } from "./files.ts";
import type { RegressionCriterion, SprintContract } from "./types.ts";

/** Path to the regression.json file within .adhd/ */
export function regressionPath(workDir: string): string {
  return join(harnessDir(workDir), "regression.json");
}

/**
 * Read accumulated regression criteria from .adhd/regression.json.
 * Returns an empty array if the file does not exist.
 * Logs a warning and returns an empty array if the file exists but contains
 * invalid JSON or an unexpected schema (graceful degradation).
 */
export async function readRegressionCriteria(workDir: string): Promise<RegressionCriterion[]> {
  const filePath = regressionPath(workDir);
  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch {
    // File does not exist — normal case, no warning needed
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed as RegressionCriterion[];
    }
    // File exists but is not an array — malformed schema
    console.warn(
      `[HARNESS] Warning: regression.json has unexpected schema (expected array, got ${typeof parsed}). Proceeding without regression criteria.`,
    );
    return [];
  } catch (err) {
    // File exists but contains invalid JSON
    console.warn(
      `[HARNESS] Warning: regression.json contains invalid JSON: ${err instanceof Error ? err.message : String(err)}. Proceeding without regression criteria.`,
    );
    return [];
  }
}

/**
 * After a sprint passes, accumulate its behavioral criteria into regression.json.
 * Criteria with type !== "behavioral" are excluded.
 * Deduplicates by name — newer criteria (higher sprintNumber) replace older ones.
 */
export async function accumulateRegressionCriteria(workDir: string, contract: SprintContract): Promise<void> {
  const behavioralCriteria = contract.criteria.filter((c) => c.type === "behavioral");
  if (behavioralCriteria.length === 0) return;

  const existing = await readRegressionCriteria(workDir);

  // Build a map for deduplication (by name)
  const criteriaMap = new Map<string, RegressionCriterion>();
  for (const c of existing) {
    criteriaMap.set(c.name, c);
  }

  // Add/replace with new behavioral criteria
  for (const c of behavioralCriteria) {
    criteriaMap.set(c.name, {
      name: c.name,
      description: c.description,
      threshold: c.threshold,
      sprintNumber: contract.sprintNumber,
    });
  }

  const accumulated = Array.from(criteriaMap.values());
  await writeFile(regressionPath(workDir), JSON.stringify(accumulated, null, 2), "utf-8");
}

/**
 * Build a "## Regression Criteria" section string for injection into the Evaluator prompt.
 * Returns an empty string if no regression criteria exist.
 */
export function buildRegressionSection(criteria: RegressionCriterion[]): string {
  if (criteria.length === 0) return "";

  const lines = [
    "\n## Regression Criteria\n",
    "The following behavioral criteria from previous sprints MUST still pass. Score each one alongside the current sprint's criteria.\n",
  ];

  for (const c of criteria) {
    lines.push(`- **${c.name}** (from sprint ${c.sprintNumber}, threshold: ${c.threshold}/10): ${c.description}`);
  }

  return lines.join("\n");
}
