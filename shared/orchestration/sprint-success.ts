import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateDocumentation } from "../doc-validation.ts";
import { gitDir, harnessDir, writeProgress } from "../files.ts";
import { countSprintHeadings } from "../sprint-count.ts";
import { promptGate } from "../interaction.ts";
import { fileTimestamp, log, logError } from "../logger.ts";
import { notify } from "../notifications.ts";
import { accumulateRegressionCriteria } from "../regression.ts";
import { UserAbortError } from "./error-handling.ts";
import { performSpecRefinement } from "./spec-refinement.ts";
import type { DocumenterPhaseContext, SprintSuccessContext, SprintSuccessResult } from "./types.ts";

export async function handleSprintSuccess(ctx: SprintSuccessContext): Promise<SprintSuccessResult> {
  const { config, contract, sprint, gDir, progress, results, parentSpan, usage, skills, agents } = ctx;
  let { spec, totalSprints } = ctx;

  progress.completedSprints++;

  if (!config.noBdd) {
    try {
      await accumulateRegressionCriteria(config.workDir, contract);
    } catch (err) {
      logError("HARNESS", `Failed to accumulate regression criteria: ${err}`);
    }
  }

  // Checkpoint: save commit SHA and sprint results
  try {
    const headSha = execSync("git rev-parse HEAD", { cwd: gDir, encoding: "utf-8" }).trim();
    progress.lastPassedCommitSha = headSha;
  } catch {
    // No git repo or no commits — skip SHA capture
  }
  progress.sprintResults = results.map(({ sprintNumber, passed, attempts, evalResult }) => ({
    sprintNumber,
    passed,
    attempts,
    evalResult,
  }));
  await writeProgress(config.workDir, progress);

  log("HARNESS", `Sprint ${sprint} PASSED — checkpoint saved. To resume later: adhd --resume`);

  // Progressive Spec Refinement (only when --refine-spec is set and not last sprint)
  if (config.refineSpec && sprint < totalSprints) {
    const refinementResult = await performSpecRefinement(
      config,
      spec,
      sprint,
      totalSprints,
      parentSpan,
      usage,
      agents.runPlanner,
      skills?.planner,
    );
    if (refinementResult.specChanged) {
      spec = refinementResult.spec;
      if (refinementResult.newSprintCount !== totalSprints) {
        const capped = Math.min(refinementResult.newSprintCount, config.maxSprints);
        log("HARNESS", `Sprint count updated: ${totalSprints} → ${capped}`);
        totalSprints = capped;
        progress.totalSprints = totalSprints;
        await writeProgress(config.workDir, progress);
      }
    }
  }

  if (config.interactive && config.gateTimeout !== 0 && sprint < totalSprints) {
    const steerOptions: import("../interaction.ts").GateOption[] = [
      { key: "c", label: "Continue", isDefault: true },
      ...(config.editor ? [{ key: "e", label: "Edit spec", isDefault: false }] : []),
      { key: "s", label: `Skip sprint ${sprint + 1}`, isDefault: false },
      { key: "x", label: "Abort", isDefault: false },
    ];

    notify(`Sprint ${sprint} complete — steering decision needed`, { notify: config.notify });
    const gate = await promptGate(
      `Sprint ${sprint}/${totalSprints} complete. Next: Sprint ${sprint + 1}`,
      steerOptions,
      config.gateTimeout ?? 15,
      config.interactive,
    );

    if (gate.key === "x") {
      log("HARNESS", "Aborted by user at mid-run steering.");
      throw new UserAbortError("Mid-run steering aborted");
    }
    if (gate.key === "s") {
      return { spec, totalSprints, skipNextSprint: true };
    }
    if (gate.key === "e" && config.editor) {
      const specPath = join(harnessDir(config.workDir), "spec.md");
      execSync(`${config.editor} ${JSON.stringify(specPath)}`, { stdio: "inherit" });
      spec = readFileSync(specPath, "utf-8");
      // Re-count sprints
      const count = countSprintHeadings(spec);
      if (count > 0) totalSprints = Math.min(count, config.maxSprints);
    }
  }

  return { spec, totalSprints };
}

export async function runDocumenterPhase(ctx: DocumenterPhaseContext): Promise<void> {
  const { config, parentSpan, usage, documenterSkills, results, progress, agents } = ctx;
  const { isGreenfield } = config;
  const documenterModel = config.resolvedModelDocumenter;
  const gDir = gitDir(config.workDir, isGreenfield);
  const documenterTs = fileTimestamp();
  const documenterSpan = parentSpan.startChild(`${documenterTs}-documenter`, { model: documenterModel });
  try {
    // Capture HEAD SHA before documenter runs
    let beforeDocsSha = "";
    try {
      beforeDocsSha = execSync("git rev-parse HEAD", { cwd: gDir, encoding: "utf-8" }).trim();
    } catch {
      // No git repo or no commits yet
    }

    const docResult = await documenterSpan.run(() =>
      agents.runDocumenter({ config, skills: documenterSkills, sprintResults: results, logTimestamp: documenterTs }),
    );

    // Record usage
    if (docResult.sdkResult) {
      usage.recordStage("documenter", docResult.sdkResult);
    }

    // Git commit enforcement for documenter
    if (beforeDocsSha) {
      try {
        const afterDocsSha = execSync("git rev-parse HEAD", { cwd: gDir, encoding: "utf-8" }).trim();
        const docsDirty = execSync("git status --porcelain", { cwd: gDir, encoding: "utf-8" }).trim();

        if (afterDocsSha !== beforeDocsSha && !docsDirty) {
          log("HARNESS", "Documenter commit source: agent");
        } else if (docsDirty) {
          // Fallback auto-commit with [docs] prefix
          log("HARNESS", "Documenter left uncommitted changes — fallback auto-commit");
          execSync(`git add -A && git commit -m "[docs] Add project documentation"`, {
            cwd: gDir,
            stdio: "pipe",
          });
          log("HARNESS", "Documenter commit source: fallback");
        } else {
          log("HARNESS", "Documenter commit source: none (no changes)");
        }
      } catch (err) {
        log("HARNESS", `WARNING: Documenter commit enforcement failed: ${err}`);
      }
    }

    // Validate documentation output
    validateDocumentation(gDir);

    // Mark docs as generated in progress
    progress.docsGenerated = true;
    await writeProgress(config.workDir, progress);

    documenterSpan.end();
  } catch (err) {
    documenterSpan.end({ error: String(err) });
    log(
      "HARNESS",
      `WARNING: Documenter failed: ${err instanceof Error ? err.message : String(err)}. Documentation generation skipped.`,
    );
    // docsGenerated remains false/undefined so resume can re-attempt
  }
}
