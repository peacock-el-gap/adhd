import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { computeDiffSection } from "../shared/diff.ts";
import { validateDocumentation } from "../shared/doc-validation.ts";
import {
  harnessDir,
  initWorkspace,
  readContract,
  readProgress,
  readSpec,
  writeContract,
  writeFeedback,
  writeProgress,
  writeSpec,
} from "../shared/files.ts";
import { promptGate } from "../shared/interaction.ts";
import { log, logDebug, logDivider, logError, setDisplayTimezone, shouldLog } from "../shared/logger.ts";
import { accumulateRegressionCriteria, buildRegressionSection, readRegressionCriteria } from "../shared/regression.ts";
import type { AgentSkills, AllAgentSkills } from "../shared/skills.ts";
import { resolveAllAgentSkills } from "../shared/skills.ts";
import { initTracing, type Span, type Tracer } from "../shared/tracing.ts";
import type {
  CommitSource,
  EvalResult,
  HarnessProgress,
  HarnessResult,
  ResolvedConfig,
  SprintContract,
  SprintResult,
} from "../shared/types.ts";
import { createUsageTracker, type UsageTracker } from "../shared/usage.ts";
import { negotiateContract } from "./contract.ts";
import { runDocumenter } from "./documenter.ts";
import { handleFatalError, UserAbortError, withTransientRetry } from "./error-handling.ts";
import { runEvaluator } from "./evaluator.ts";
import { specApprovalGate } from "./gates.ts";
import { ensureGeneratorCommit, runGenerator } from "./generator.ts";
import { checkDirtyTree, revertToCheckpoint } from "./git-ops.ts";
import { runPlanner } from "./planner.ts";
import { performSpecRefinement } from "./spec-refinement.ts";
import { runStaticAnalysis } from "./static-analysis-runner.ts";

export async function runHarness(config: ResolvedConfig): Promise<HarnessResult> {
  const startTime = Date.now();
  const { model, isGreenfield } = config;

  // Configure timezone display for terminal
  if (config.tzDisplay) {
    setDisplayTimezone(config.tzDisplay);
  }

  // Initialize tracing and usage tracking
  const tracer = initTracing(config);
  const usage = createUsageTracker(config.workDir);

  log("HARNESS", "Initializing Claude Agent SDK harness");
  log("HARNESS", `Work directory: ${config.workDir}`);
  const modelInfo = [config.modelPlanner, config.modelGenerator, config.modelEvaluator].some(Boolean)
    ? `Models: planner=${config.modelPlanner ?? model}, generator=${config.modelGenerator ?? model}, evaluator=${config.modelEvaluator ?? model}`
    : `Model: ${model}`;
  log(
    "HARNESS",
    `${modelInfo} | Max sprints: ${config.maxSprints} | Max retries: ${config.maxRetriesPerSprint} | Threshold: ${config.passThreshold}/10`,
  );

  // --- Resume path ---
  if (config.isResume) {
    const result = await resumeHarness(config, startTime, tracer, usage);
    await tracer.flush();
    return result;
  }

  // --- Sprint selection path ---
  if (config.sprint !== undefined) {
    const result = await sprintSelectionHarness(config, startTime, tracer, usage);
    await tracer.flush();
    return result;
  }

  // --- Fresh run path ---

  // Pre-flight dirty-tree check (skip in greenfield mode — no existing repo)
  if (!isGreenfield) {
    await checkDirtyTree(config);
  }

  logDebug("HARNESS", "Initializing workspace...");
  await initWorkspace(config.workDir, { greenfield: isGreenfield });
  logDebug("HARNESS", "Workspace initialized");

  const skills = resolveAllAgentSkills(config.workDir, join(import.meta.dir, "../shared"), {
    noBdd: config.noBdd,
    noTdd: config.noTdd,
  });

  // Planning
  logDivider();
  log("HARNESS", "PHASE 1: PLANNING");
  logDivider();

  const progress: HarnessProgress = {
    status: "planning",
    currentSprint: 0,
    totalSprints: 0,
    completedSprints: 0,
    retryCount: 0,
  };
  await writeProgress(config.workDir, progress);

  const harnessSpan = tracer.startSpan(`harness-run-${new Date().toISOString().replace(/[:.]/g, "-")}`, {
    model,
    workDir: config.workDir,
    isGreenfield,
    maxSprints: config.maxSprints,
  });

  // Wrap the entire run inside harnessSpan context so all query() calls nest under it
  return harnessSpan.run(async () => {
    try {
      logDebug("HARNESS", "Calling runPlanner...");
      const plannerSpan = harnessSpan.startChild("planner", { model: config.modelPlanner ?? model });
      const spec = await plannerSpan.run(() => runPlanner(config, undefined, usage, skills.planner));
      plannerSpan.end();
      logDebug("HARNESS", `Planner returned, spec length: ${spec.length}`);
      await writeSpec(config.workDir, spec);
      log("HARNESS", "Product spec written");

      progress.status = "spec-review";
      await writeProgress(config.workDir, progress);
      const approvedSpec = await specApprovalGate(config, spec, harnessSpan, usage, skills.planner);
      progress.specApproved = true;
      await writeProgress(config.workDir, progress);

      if (config.isDryRun) {
        log("HARNESS", "Dry-run complete. Spec approved and saved.");
        usage.printSummary();
        await usage.save();
        return { success: true, sprints: [], totalDurationMs: Date.now() - startTime };
      }

      if (config.branch) {
        const gitDir = isGreenfield ? join(config.workDir, "app") : config.workDir;
        execSync(`git checkout -b ${config.branch}`, { cwd: gitDir, stdio: "pipe" });
        log("HARNESS", `Created branch: ${config.branch}`);
        progress.branch = config.branch;
        await writeProgress(config.workDir, progress);
      }

      // Count sprints from the (possibly edited) spec
      const sprintMatches = approvedSpec.match(/##\s*Sprint\s+\d+/gi);
      const totalSprints = sprintMatches ? Math.min(sprintMatches.length, config.maxSprints) : config.maxSprints;
      progress.totalSprints = totalSprints;

      return await runSprintLoop({
        config,
        spec: approvedSpec,
        progress,
        results: [],
        startSprint: 1,
        totalSprints,
        startTime,
        parentSpan: harnessSpan,
        usage,
        skills,
      });
    } catch (err) {
      if (err instanceof UserAbortError) {
        usage.printSummary();
        await usage.save();
        return { success: false, sprints: [], totalDurationMs: Date.now() - startTime };
      }
      throw err;
    } finally {
      harnessSpan.end();
      await tracer.flush();
    }
  }); // end harnessSpan.run()
}

async function resumeHarness(
  config: ResolvedConfig,
  startTime: number,
  tracer: Tracer,
  usage: UsageTracker,
): Promise<HarnessResult> {
  const { model, isGreenfield } = config;
  log("HARNESS", "Resuming from checkpoint...");

  // Don't clean artifacts on resume
  await initWorkspace(config.workDir, { greenfield: isGreenfield, resume: true });

  const skills = resolveAllAgentSkills(config.workDir, join(import.meta.dir, "../shared"), {
    noBdd: config.noBdd,
    noTdd: config.noTdd,
  });

  let progress: HarnessProgress;
  try {
    progress = await readProgress(config.workDir);
  } catch {
    throw new Error("Nothing to resume. No .adhd/progress.json found. Run without --resume first.");
  }

  if (progress.status === "complete") {
    // If sprints complete but docs not generated, run just the documenter
    if (!progress.docsGenerated && !config.noDocs) {
      log("HARNESS", "All sprints complete. Running Documenter phase only...");

      const harnessSpan = tracer.startSpan(`harness-resume-docs-${new Date().toISOString().replace(/[:.]/g, "-")}`, {
        model,
        workDir: config.workDir,
        isGreenfield,
        docsOnly: true,
      });

      const results: SprintResult[] = progress.sprintResults ?? [];

      return harnessSpan.run(async () => {
        try {
          await runDocumenterPhase({
            config,
            parentSpan: harnessSpan,
            usage,
            documenterSkills: skills.documenter,
            results,
            progress,
          });
        } catch {
          // Documenter failure is non-fatal
        }

        const totalDuration = Date.now() - startTime;
        usage.printSummary();
        await usage.save();
        harnessSpan.end();
        return { success: true, sprints: results, totalDurationMs: totalDuration };
      });
    }

    // Both sprints and docs done (or --no-docs)
    if (progress.docsGenerated) {
      throw new Error("All sprints and documentation already completed. Nothing to resume.");
    }
    throw new Error("All sprints already completed. Nothing to resume.");
  }

  let spec = await readSpec(config.workDir);
  log("HARNESS", `Loaded spec from disk. Completed sprints: ${progress.completedSprints}/${progress.totalSprints}`);

  // If spec was written but not yet approved, show the gate
  if (!progress.specApproved) {
    log("HARNESS", "Spec exists but was not approved. Showing review gate.");
    const reviewSpan = tracer.startSpan("spec-review");
    spec = await reviewSpan.run(() => specApprovalGate(config, spec, reviewSpan, usage, skills.planner));
    reviewSpan.end();
    progress.specApproved = true;
    await writeProgress(config.workDir, progress);
    // Re-count sprints in case spec was edited
    const sprintMatches = spec.match(/##\s*Sprint\s+\d+/gi);
    progress.totalSprints = sprintMatches ? Math.min(sprintMatches.length, config.maxSprints) : config.maxSprints;
  }

  // Resume branch check — warn if HEAD is on a different branch
  if (progress.branch) {
    const gitDir = isGreenfield ? join(config.workDir, "app") : config.workDir;
    try {
      const currentBranch = execSync("git branch --show-current", { cwd: gitDir, encoding: "utf-8" }).trim();
      if (currentBranch !== progress.branch) {
        log("HARNESS", `Warning: previous run used branch "${progress.branch}" but HEAD is on "${currentBranch}".`);
        log("HARNESS", `Consider: git checkout ${progress.branch}`);
      }
    } catch {
      // Not a git repo — skip
    }
  }

  // Restore prior sprint results
  const results: SprintResult[] = progress.sprintResults ?? [];

  // Git revert if there are commits after the last checkpoint
  if (progress.lastPassedCommitSha) {
    await revertToCheckpoint(config.workDir, isGreenfield, progress);
  }

  const startSprint = progress.completedSprints + 1;
  const harnessSpan = tracer.startSpan(`harness-resume-${new Date().toISOString().replace(/[:.]/g, "-")}`, {
    model,
    workDir: config.workDir,
    isGreenfield,
    resumeFrom: startSprint,
  });
  const result = await harnessSpan.run(() =>
    runSprintLoop({
      config,
      spec,
      progress,
      results,
      startSprint,
      totalSprints: progress.totalSprints,
      startTime,
      parentSpan: harnessSpan,
      usage,
      skills,
    }),
  );
  harnessSpan.end();
  return result;
}

async function sprintSelectionHarness(
  config: ResolvedConfig,
  startTime: number,
  tracer: Tracer,
  usage: UsageTracker,
): Promise<HarnessResult> {
  const { model, isGreenfield } = config;
  const sprintN = config.sprint ?? 1;
  log("HARNESS", `Sprint selection mode: targeting sprint ${sprintN}`);

  // Check spec exists
  const specPath = join(harnessDir(config.workDir), "spec.md");
  if (!existsSync(specPath)) {
    throw new Error("No spec found. Run the planner first or provide a spec.");
  }

  // Don't clean artifacts — preserve existing state (resume-like)
  await initWorkspace(config.workDir, { greenfield: isGreenfield, resume: true });

  // Resolve skills
  const skills = resolveAllAgentSkills(config.workDir, join(import.meta.dir, "../shared"), {
    noBdd: config.noBdd,
    noTdd: config.noTdd,
  });

  // Load spec
  const spec = await readSpec(config.workDir);
  log("HARNESS", "Loaded spec from disk");

  // Count total sprints from spec
  const sprintMatches = spec.match(/##\s*Sprint\s+\d+/gi);
  const totalSprints = sprintMatches ? Math.min(sprintMatches.length, config.maxSprints) : config.maxSprints;

  // Warn if sprint exceeds total
  if (sprintN > totalSprints) {
    log("HARNESS", `Warning: --sprint ${sprintN} exceeds detected sprint count (${totalSprints}).`);
  }

  // Check for prior sprint checkpoint (warn if missing)
  if (sprintN > 1) {
    let hasPriorCheckpoint = false;
    try {
      const progress = await readProgress(config.workDir);
      hasPriorCheckpoint = progress.completedSprints >= sprintN - 1;
    } catch {
      // No progress file
    }
    if (!hasPriorCheckpoint) {
      log("HARNESS", `Warning: No checkpoint for sprint ${sprintN - 1}. Ensure the codebase is in the expected state.`);
    }
  }

  // Build progress (minimal, for the sprint loop)
  const progress: HarnessProgress = {
    status: "building",
    currentSprint: sprintN,
    totalSprints,
    completedSprints: sprintN - 1, // assume prior sprints completed
    retryCount: 0,
  };

  // Try to load existing progress to preserve sprintResults
  try {
    const existingProgress = await readProgress(config.workDir);
    if (existingProgress.sprintResults) {
      progress.sprintResults = existingProgress.sprintResults;
    }
    if (existingProgress.lastPassedCommitSha) {
      progress.lastPassedCommitSha = existingProgress.lastPassedCommitSha;
    }
  } catch {
    // No existing progress — fine
  }

  const harnessSpan = tracer.startSpan(`harness-sprint-${sprintN}-${new Date().toISOString().replace(/[:.]/g, "-")}`, {
    model,
    workDir: config.workDir,
    isGreenfield,
    targetSprint: sprintN,
  });

  const result = await harnessSpan.run(() =>
    runSprintLoop({
      config,
      spec,
      progress,
      results: [],
      startSprint: sprintN,
      totalSprints: sprintN,
      startTime,
      parentSpan: harnessSpan,
      usage,
      skills,
    }),
  );
  harnessSpan.end();
  return result;
}

interface SprintLoopContext {
  config: ResolvedConfig;
  spec: string;
  progress: HarnessProgress;
  results: SprintResult[];
  startSprint: number;
  totalSprints: number;
  startTime: number;
  parentSpan: Span;
  usage: UsageTracker;
  skills?: AllAgentSkills;
}

async function runSprintLoop(ctx: SprintLoopContext): Promise<HarnessResult> {
  const { config, progress, results, startSprint, startTime, parentSpan, usage, skills } = ctx;
  let { spec, totalSprints } = ctx;
  const { workDir, isGreenfield } = config;
  const gitDir = isGreenfield ? join(workDir, "app") : workDir;

  for (let sprint = startSprint; sprint <= totalSprints; sprint++) {
    logDivider();
    log("HARNESS", `SPRINT ${sprint}/${totalSprints}`);
    logDivider();

    progress.status = "negotiating";
    progress.currentSprint = sprint;
    progress.retryCount = 0;
    await writeProgress(config.workDir, progress);

    const sprintSpan = parentSpan.startChild(`sprint-${sprint}`, { sprintNumber: sprint });

    // Try to reuse existing contract (especially in --sprint mode)
    let contract: SprintContract | undefined;
    if (config.sprint !== undefined) {
      try {
        contract = await readContract(config.workDir, sprint);
        log(
          "HARNESS",
          `Loaded existing contract for sprint ${sprint}: ${contract.criteria.length} criteria for ${contract.features.length} features`,
        );
      } catch {
        // No existing contract — will negotiate below
      }
    }

    if (!contract) {
      log("HARNESS", "Negotiating sprint contract...");
      const negotiationSpan = sprintSpan.startChild("contract-negotiation", { sprint });
      try {
        contract = await negotiationSpan.run(() =>
          withTransientRetry(
            () =>
              negotiateContract(
                config.workDir,
                spec,
                sprint,
                config.modelGenerator ?? config.model,
                config.modelEvaluator ?? config.model,
                usage,
              ),
            "contract negotiation",
          ),
        );
      } catch (err) {
        negotiationSpan.end({ error: String(err) });
        sprintSpan.end({ error: String(err) });
        return await handleFatalError(err, config, progress, results);
      }
      negotiationSpan.end({ criteria: contract.criteria.length, features: contract.features.length });
      await writeContract(config.workDir, contract);
      log("HARNESS", `Contract agreed: ${contract.criteria.length} criteria for ${contract.features.length} features`);
    }

    if (config.interactive && config.gateTimeout !== 0) {
      const gate = await promptGate(
        `Sprint ${sprint} contract:\n  Features: ${contract.features.join(", ")}\n  Criteria: ${contract.criteria.length}`,
        [
          { key: "a", label: "Accept", isDefault: true },
          { key: "x", label: "Abort", isDefault: false },
        ],
        config.gateTimeout ?? 15,
        config.interactive,
      );
      if (gate.key === "x") {
        log("HARNESS", "Aborted by user at contract preview.");
        throw new UserAbortError("Contract preview aborted");
      }
    }

    // Build-Evaluate Loop
    let passed = false;
    let lastEval: EvalResult | undefined;
    let attempts = 0;
    let lastCommitSource: CommitSource = "none";

    for (let retry = 0; retry <= config.maxRetriesPerSprint; retry++) {
      attempts = retry + 1;
      const attemptSpan = sprintSpan.startChild(`attempt-${retry}`, { attempt: retry });

      // Capture SHA before generator runs
      let beforeSha = "";
      try {
        beforeSha = execSync("git rev-parse HEAD", { cwd: gitDir, encoding: "utf-8" }).trim();
      } catch {
        // No git repo or no commits yet
      }

      // Build
      progress.status = "building";
      progress.retryCount = retry;
      await writeProgress(config.workDir, progress);

      const generatorModel = config.modelGenerator ?? config.model;
      const generatorSpan = attemptSpan.startChild("generator", { model: generatorModel, sprint, attempt: retry });
      let generatorSessionId: string | undefined;
      try {
        const result = await generatorSpan.run(() =>
          withTransientRetry(
            () =>
              runGenerator({
                config,
                spec,
                contract,
                previousFeedback: lastEval,
                attempt: retry,
                skills: skills?.generator,
              }),
            "generator",
          ),
        );
        generatorSessionId = result.sessionId;
        if (result.sdkResult) {
          usage.recordStage(`sprint-${sprint}-attempt-${retry}-generator`, result.sdkResult);
        }
      } catch (err) {
        generatorSpan.end({ error: String(err) });
        attemptSpan.end({ error: String(err) });
        sprintSpan.end({ error: String(err) });
        return await handleFatalError(err, config, progress, results);
      }
      generatorSpan.end();

      // Ensure generator committed its work
      if (beforeSha) {
        try {
          lastCommitSource = await ensureGeneratorCommit(
            config.workDir,
            gitDir,
            beforeSha,
            generatorSessionId,
            contract,
            retry > 0,
            config.modelGenerator ?? config.model,
          );
          log("HARNESS", `Commit source: ${lastCommitSource}`);
        } catch (err) {
          logError("HARNESS", `Commit enforcement failed: ${err}`);
        }
      }

      // Evaluate
      progress.status = "evaluating";
      await writeProgress(config.workDir, progress);

      // Build supplementary context for the evaluator
      let supplementaryContext = "";

      // Regression criteria injection
      if (!config.noBdd && sprint > 1) {
        try {
          const regressionCriteria = await readRegressionCriteria(config.workDir);
          const regressionSection = buildRegressionSection(regressionCriteria);
          if (regressionSection) {
            supplementaryContext += regressionSection;
          }
        } catch {
          // Graceful degradation — proceed without regression criteria
        }
      }

      const staticAnalysisResult = await runStaticAnalysis(config);
      if (staticAnalysisResult.output) {
        // Hard gate: if --lint-gate and any command failed, skip evaluator
        if (config.lintGate && staticAnalysisResult.failed) {
          log("HARNESS", "Lint gate: static analysis failed, skipping evaluator");
          lastEval = {
            passed: false,
            scores: {},
            feedback: contract.criteria.map((c) => ({
              criterion: c.name,
              score: 0,
              details: "Evaluator skipped due to --lint-gate: static analysis failed",
            })),
            overallSummary: `Static analysis failed (--lint-gate). Output:\n${staticAnalysisResult.output}`,
          };
          await writeFeedback(config.workDir, sprint, retry, lastEval);
          attemptSpan.end({ passed: false, lintGate: true });
          continue;
        }
      }

      // Diff-aware evaluation on retries
      // Ordering: regression → diff → static analysis (deterministic)
      if (retry > 0 && beforeSha) {
        const diffSection = computeDiffSection(gitDir, beforeSha, retry);
        if (diffSection) {
          supplementaryContext += diffSection;
        }
      }

      if (staticAnalysisResult.output) {
        supplementaryContext += `\n\n## Static Analysis Results\n\n${staticAnalysisResult.output}`;
      }

      const evaluatorModel = config.modelEvaluator ?? config.model;
      const evaluatorSpan = attemptSpan.startChild("evaluator", { model: evaluatorModel, sprint, attempt: retry });
      try {
        const evalWithUsage = await evaluatorSpan.run(() =>
          withTransientRetry(
            () =>
              runEvaluator({
                config,
                contract,
                attempt: retry,
                skills: skills?.evaluator,
                supplementaryContext: supplementaryContext || undefined,
              }),
            "evaluator",
          ),
        );
        if (evalWithUsage.sdkResult) {
          usage.recordStage(`sprint-${sprint}-attempt-${retry}-evaluator`, evalWithUsage.sdkResult);
        }
        lastEval = evalWithUsage;
      } catch (err) {
        evaluatorSpan.end({ error: String(err) });
        attemptSpan.end({ error: String(err) });
        sprintSpan.end({ error: String(err) });
        return await handleFatalError(err, config, progress, results);
      }
      evaluatorSpan.end();
      await writeFeedback(config.workDir, sprint, retry, lastEval);

      attemptSpan.end({ passed: lastEval.passed });

      if (lastEval.passed) {
        passed = true;
        if (shouldLog("quiet", config.logLevel)) {
          log("HARNESS", `Sprint ${sprint} PASSED on attempt ${attempts}`);
        }
        break;
      }

      if (config.interactive && config.gateTimeout !== 0 && retry < config.maxRetriesPerSprint) {
        const minScore = Math.min(...Object.values(lastEval.scores));
        const gate = await promptGate(
          `Evaluator scored ${minScore}/10 (threshold: ${config.passThreshold}). Override?`,
          [
            { key: "n", label: "Accept score — retry", isDefault: true },
            { key: "p", label: "Force PASS — proceed to next sprint", isDefault: false },
          ],
          config.gateTimeout ?? 15,
          config.interactive,
        );
        if (gate.key === "p") {
          lastEval.passed = true;
          lastEval.overridden = true;
          passed = true;
          log("HARNESS", `Sprint ${sprint} PASSED (user override) on attempt ${attempts}`);
          break;
        }
      }

      if (retry < config.maxRetriesPerSprint) {
        if (shouldLog("normal", config.logLevel)) {
          log("HARNESS", `Sprint ${sprint} failed attempt ${attempts}, retrying...`);
        }
      } else {
        logError("HARNESS", `Sprint ${sprint} FAILED after ${attempts} attempts`);
      }
    }

    results.push({
      sprintNumber: sprint,
      passed,
      attempts,
      evalResult: lastEval,
      commitSource: lastCommitSource,
    });

    sprintSpan.end({ passed, attempts });

    if (passed) {
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
        const headSha = execSync("git rev-parse HEAD", { cwd: gitDir, encoding: "utf-8" }).trim();
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

      log(
        "HARNESS",
        `Sprint ${sprint} PASSED — checkpoint saved. To resume later: bun run claude-harness/index.ts --resume`,
      );

      // Progressive Spec Refinement (only when --refine-spec is set and not last sprint)
      if (config.refineSpec && sprint < totalSprints) {
        const refinementResult = await performSpecRefinement(
          config,
          spec,
          sprint,
          totalSprints,
          parentSpan,
          usage,
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
        const steerOptions: import("../shared/interaction.ts").GateOption[] = [
          { key: "c", label: "Continue", isDefault: true },
          ...(config.editor ? [{ key: "e", label: "Edit spec", isDefault: false }] : []),
          { key: "s", label: `Skip sprint ${sprint + 1}`, isDefault: false },
          { key: "x", label: "Abort", isDefault: false },
        ];

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
          results.push({ sprintNumber: sprint + 1, passed: true, attempts: 0, skipped: true });
          progress.completedSprints++;
          sprint++; // Advance past the skipped sprint
          continue; // Loop increment makes sprint = skip+2
        }
        if (gate.key === "e" && config.editor) {
          const specPath = join(harnessDir(config.workDir), "spec.md");
          execSync(`${config.editor} ${JSON.stringify(specPath)}`, { stdio: "inherit" });
          spec = readFileSync(specPath, "utf-8");
          // Re-count sprints
          const newMatches = spec.match(/##\s*Sprint\s+\d+/gi);
          if (newMatches) totalSprints = Math.min(newMatches.length, config.maxSprints);
        }
      }
    } else {
      progress.status = "failed";
      progress.sprintResults = results.map(({ sprintNumber, passed, attempts, evalResult }) => ({
        sprintNumber,
        passed,
        attempts,
        evalResult,
      }));
      await writeProgress(config.workDir, progress);
      logError("HARNESS", `Harness stopped: sprint ${sprint} could not pass evaluation`);
      break;
    }
  }

  // Final status
  const allPassed = results.every((r) => r.passed);
  progress.status = allPassed ? "complete" : "failed";
  await writeProgress(config.workDir, progress);

  if (allPassed && !config.noDocs) {
    await runDocumenterPhase({
      config,
      parentSpan,
      usage,
      documenterSkills: skills?.documenter,
      results,
      progress,
    });
  }

  const totalDuration = Date.now() - startTime;
  logDivider();
  log("HARNESS", `Harness ${allPassed ? "COMPLETED" : "FAILED"} in ${(totalDuration / 1000 / 60).toFixed(1)} minutes`);
  log("HARNESS", `Sprints: ${results.filter((r) => r.passed).length}/${results.length} passed`);

  usage.printSummary();
  try {
    await usage.save();
  } catch {
    // Non-critical — don't fail the run if usage save fails
  }

  return { success: allPassed, sprints: results, totalDurationMs: totalDuration };
}

interface DocumenterPhaseContext {
  config: ResolvedConfig;
  parentSpan: Span;
  usage: UsageTracker;
  documenterSkills?: AgentSkills;
  results: SprintResult[];
  progress: HarnessProgress;
}

async function runDocumenterPhase(ctx: DocumenterPhaseContext): Promise<void> {
  const { config, parentSpan, usage, documenterSkills, results, progress } = ctx;
  const { isGreenfield } = config;
  const documenterModel = config.modelDocumenter ?? config.model;
  const gitDir = isGreenfield ? join(config.workDir, "app") : config.workDir;
  const documenterSpan = parentSpan.startChild("documenter", { model: documenterModel });
  try {
    // Capture HEAD SHA before documenter runs
    let beforeDocsSha = "";
    try {
      beforeDocsSha = execSync("git rev-parse HEAD", { cwd: gitDir, encoding: "utf-8" }).trim();
    } catch {
      // No git repo or no commits yet
    }

    const docResult = await documenterSpan.run(() =>
      runDocumenter({ config, skills: documenterSkills, sprintResults: results }),
    );

    // Record usage
    if (docResult.sdkResult) {
      usage.recordStage("documenter", docResult.sdkResult);
    }

    // Git commit enforcement for documenter
    if (beforeDocsSha) {
      try {
        const afterDocsSha = execSync("git rev-parse HEAD", { cwd: gitDir, encoding: "utf-8" }).trim();
        const docsDirty = execSync("git status --porcelain", { cwd: gitDir, encoding: "utf-8" }).trim();

        if (afterDocsSha !== beforeDocsSha && !docsDirty) {
          log("HARNESS", "Documenter commit source: agent");
        } else if (docsDirty) {
          // Fallback auto-commit with [docs] prefix
          log("HARNESS", "Documenter left uncommitted changes — fallback auto-commit");
          execSync(`git add -A && git commit -m "[docs] Add project documentation"`, {
            cwd: gitDir,
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
    validateDocumentation(isGreenfield ? join(config.workDir, "app") : config.workDir);

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
