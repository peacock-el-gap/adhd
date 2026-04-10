import { readFile as readFileRaw, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { harnessDir, writeSpec } from "../shared/files.ts";
import { promptGate } from "../shared/interaction.ts";
import { log, logDivider } from "../shared/logger.ts";
import {
  buildRefinementPrompt,
  computeSpecDiff,
  countSprints,
  extractCompletedSprintSections,
  freezeCompletedSprints,
} from "../shared/refinement.ts";
import type { AgentSkills } from "../shared/skills.ts";
import type { Span } from "../shared/tracing.ts";
import type { HarnessConfig } from "../shared/types.ts";
import type { UsageTracker } from "../shared/usage.ts";
import { runPlanner } from "./planner.ts";

export interface RefinementResult {
  specChanged: boolean;
  spec: string;
  newSprintCount: number;
}

/** Read raw regression.json content for preservation */
async function readRegressionFileRaw(workDir: string): Promise<string | null> {
  try {
    const path = join(harnessDir(workDir), "regression.json");
    return await readFileRaw(path, "utf-8");
  } catch {
    return null;
  }
}

/** Restore regression.json to its pre-refinement state */
async function restoreRegressionData(workDir: string, originalData: string | null): Promise<void> {
  const path = join(harnessDir(workDir), "regression.json");
  if (originalData !== null) {
    await writeFile(path, originalData, "utf-8");
  }
}

export async function performSpecRefinement(
  config: HarnessConfig,
  currentSpec: string,
  completedSprint: number,
  currentTotalSprints: number,
  parentSpan: Span,
  usage: UsageTracker,
  plannerSkills?: AgentSkills,
): Promise<RefinementResult> {
  log("HARNESS", `Spec refinement: invoking Planner for sprints ${completedSprint + 1}-${currentTotalSprints}...`);

  // Save original spec and regression state for preservation guarantees
  const originalSpec = currentSpec;
  const originalRegressionData = await readRegressionFileRaw(config.workDir);

  // Extract completed sprint sections for freezing
  const completedSections = extractCompletedSprintSections(currentSpec, completedSprint);

  // Build completed/remaining sprint number lists
  const completedSprintNumbers: number[] = [];
  for (let i = 1; i <= completedSprint; i++) completedSprintNumbers.push(i);
  const remainingSprintNumbers: number[] = [];
  for (let i = completedSprint + 1; i <= currentTotalSprints; i++) remainingSprintNumbers.push(i);

  let proposedSpec: string;
  try {
    const refinementSpan = parentSpan.startChild("spec-refinement", { completedSprint });
    const refinementPrompt = buildRefinementPrompt(currentSpec, completedSprintNumbers, remainingSprintNumbers);

    proposedSpec = await refinementSpan.run(() =>
      runPlanner({ ...config, userPrompt: refinementPrompt }, undefined, usage, plannerSkills),
    );
    refinementSpan.end();

    if (!proposedSpec || proposedSpec.trim().length === 0) {
      log("HARNESS", "Warning: Planner returned empty spec during refinement. Preserving original.");
      await restoreRegressionData(config.workDir, originalRegressionData);
      return { specChanged: false, spec: originalSpec, newSprintCount: currentTotalSprints };
    }
  } catch (err) {
    log(
      "HARNESS",
      `Warning: Spec refinement failed: ${err instanceof Error ? err.message : String(err)}. Preserving original spec.`,
    );
    await writeSpec(config.workDir, originalSpec);
    await restoreRegressionData(config.workDir, originalRegressionData);
    return { specChanged: false, spec: originalSpec, newSprintCount: currentTotalSprints };
  }

  // Freeze completed sprint sections — programmatic enforcement
  proposedSpec = freezeCompletedSprints(proposedSpec, completedSections);

  // Verify completed sections are preserved
  const newCompletedSections = extractCompletedSprintSections(proposedSpec, completedSprint);
  for (const [sprintNum, originalSection] of completedSections) {
    const newSection = newCompletedSections.get(sprintNum);
    if (newSection !== originalSection) {
      log("HARNESS", `Warning: Completed sprint ${sprintNum} section was modified. Repairing...`);
      // Force-repair by replacing
      if (newSection) {
        proposedSpec = proposedSpec.replace(newSection, originalSection);
      }
    }
  }

  // Compute and display diff
  const diff = computeSpecDiff(originalSpec, proposedSpec);
  if (!diff) {
    log("HARNESS", "Spec refinement: no changes proposed.");
    await writeSpec(config.workDir, originalSpec);
    await restoreRegressionData(config.workDir, originalRegressionData);
    return { specChanged: false, spec: originalSpec, newSprintCount: currentTotalSprints };
  }

  logDivider();
  log("HARNESS", "Spec refinement diff:");
  for (const line of diff.split("\n")) {
    if (line.startsWith("+ ")) {
      process.stdout.write(`  \x1b[32m${line}\x1b[0m\n`);
    } else if (line.startsWith("- ")) {
      process.stdout.write(`  \x1b[31m${line}\x1b[0m\n`);
    }
  }
  logDivider();

  // Gate: accept or reject
  const isInteractive = (config.interactive ?? true) && config.gateTimeout !== 0;

  if (!isInteractive) {
    // Auto-accept in non-interactive mode
    log("HARNESS", "Spec refinement auto-accepted (non-interactive mode).");
    await writeSpec(config.workDir, proposedSpec);
    await restoreRegressionData(config.workDir, originalRegressionData);
    const newCount = countSprints(proposedSpec);
    return { specChanged: true, spec: proposedSpec, newSprintCount: newCount };
  }

  const gate = await promptGate(
    "Accept revised spec? (Reject preserves original spec unchanged)",
    [
      { key: "a", label: "Accept — use revised spec", isDefault: true },
      { key: "r", label: "Reject — keep original spec (no changes)", isDefault: false },
    ],
    config.gateTimeout ?? 30,
    config.interactive ?? true,
  );

  if (gate.key === "r") {
    log("HARNESS", "Spec refinement rejected. Original spec preserved.");
    await writeSpec(config.workDir, originalSpec);
    await restoreRegressionData(config.workDir, originalRegressionData);
    return { specChanged: false, spec: originalSpec, newSprintCount: currentTotalSprints };
  }

  // Accept
  log("HARNESS", "Spec refinement accepted.");
  await writeSpec(config.workDir, proposedSpec);
  await restoreRegressionData(config.workDir, originalRegressionData);
  const newCount = countSprints(proposedSpec);
  return { specChanged: true, spec: proposedSpec, newSprintCount: newCount };
}
