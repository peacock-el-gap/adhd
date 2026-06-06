import { existsSync } from "node:fs";
import { join } from "node:path";
import { makeIdentity, timedName } from "../agent-identity.ts";
import { buildTopicBranchName } from "../branch-name.ts";
import {
  DEFAULT_MAX_TURNS_DOCUMENTER,
  DEFAULT_MAX_TURNS_EVALUATOR,
  DEFAULT_MAX_TURNS_GENERATOR,
  DEFAULT_MAX_TURNS_PLANNER,
} from "../config.ts";
import {
  gitDir,
  harnessDir,
  initWorkspace,
  loadExistingContract,
  readProgress,
  readSpec,
  writeContract,
  writeProgress,
  writeSpec,
} from "../files.ts";
import { promptGate } from "../interaction.ts";
import { fileTimestamp, log, logDebug, logDivider, logError, setDisplayTimezone } from "../logger.ts";
import { describeAgentCaps, describeAgentModels, evaluatorInvariantWarning } from "../models.ts";
import { notify } from "../notifications.ts";
import { readLiveUsage, writeRunRecord } from "../run-history.ts";
import { resolveAllAgentSkills } from "../skills.ts";
import { countSprintHeadings } from "../sprint-count.ts";
import type { Tracer } from "../tracing.ts";
import type { HarnessProgress, HarnessResult, ResolvedConfig, SprintContract, SprintResult } from "../types.ts";
import { createUsageTracker, type UsageTracker } from "../usage.ts";
import { handleFatalError, UserAbortError, withTransientRetry } from "./error-handling.ts";
import { specApprovalGate } from "./gates.ts";
import { checkDirtyTree, commitFinalMetadata, ensureTopicBranch, revertToCheckpoint } from "./git-ops.ts";
import { runSprintAttempts } from "./sprint-attempts.ts";
import { handleSprintSuccess, runDocumenterPhase } from "./sprint-success.ts";
import type { AgentRunners, SprintLoopContext } from "./types.ts";

export async function runHarness(config: ResolvedConfig, agents: AgentRunners): Promise<HarnessResult> {
  const startTime = Date.now();
  const { model, isGreenfield } = config;

  // Configure timezone display for terminal
  if (config.tzDisplay) {
    setDisplayTimezone(config.tzDisplay);
  }

  // Initialize tracing and usage tracking
  const tracer = agents.initTracing(config);
  const usage = createUsageTracker(config.workDir);

  log("HARNESS", "Initializing Claude Agent SDK harness");
  log("HARNESS", `Work directory: ${config.workDir}`);
  // Print the resolved model for every agent (including the Documenter, which was
  // previously omitted) so the startup configuration is honest now that the
  // per-agent default matrix makes the agents differ.
  for (const line of describeAgentModels(config)) {
    log("HARNESS", line);
  }
  // Print any per-agent turn caps that differ from the defaults so the operator
  // can see what's in effect without having to read the full config.
  const defaultCaps = {
    resolvedMaxTurnsPlanner: DEFAULT_MAX_TURNS_PLANNER,
    resolvedMaxTurnsGenerator: DEFAULT_MAX_TURNS_GENERATOR,
    resolvedMaxTurnsEvaluator: DEFAULT_MAX_TURNS_EVALUATOR,
    resolvedMaxTurnsDocumenter: DEFAULT_MAX_TURNS_DOCUMENTER,
  };
  for (const line of describeAgentCaps(config, defaultCaps)) {
    log("HARNESS", line);
  }
  // Advisory check: warn (don't stop) when the judge is a weaker tier than the producer.
  const invariantWarning = evaluatorInvariantWarning(config.resolvedModelEvaluator, config.resolvedModelGenerator);
  if (invariantWarning) {
    logError("HARNESS", invariantWarning);
  }
  log(
    "HARNESS",
    `Max sprints: ${config.maxSprints} | Max retries: ${config.maxRetriesPerSprint} | Threshold: ${config.passThreshold}/10`,
  );
  // Show active gate flags so the operator knows what cost-saving gates are on.
  const activeGates: string[] = [];
  if (config.lintGate) activeGates.push("lint-gate");
  if (config.testGate) activeGates.push("test-gate");
  if (activeGates.length > 0) {
    log("HARNESS", `Active gates: ${activeGates.join(", ")}`);
  }
  // Announce Scout pass when enabled (it adds cost, so the banner must be honest).
  if (config.useScout) {
    log("HARNESS", `Scout pass: enabled (model: ${config.resolvedModelEvaluator}) — skipped in greenfield mode`);
  }
  // Announce Reviewer when enabled (it adds cost per passing sprint, so the banner must be honest).
  if (config.useReview) {
    log("HARNESS", `Reviewer: enabled (model: ${config.resolvedModelReviewer}) — runs after each passing sprint`);
  }

  // --- Resume path ---
  if (config.isResume) {
    const result = await resumeHarness(config, startTime, tracer, usage, agents);
    await tracer.flush();
    return result;
  }

  // --- Sprint selection path ---
  if (config.sprint !== undefined) {
    const result = await sprintSelectionHarness(config, startTime, tracer, usage, agents);
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

  const skills = resolveAllAgentSkills(config.workDir, join(import.meta.dir, ".."), {
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

  const harnessSpan = tracer.startSpan(`${fileTimestamp()}-harness-run`, {
    model,
    workDir: config.workDir,
    isGreenfield,
    maxSprints: config.maxSprints,
  });

  // Wrap the entire run inside harnessSpan context so all query() calls nest under it
  return harnessSpan.run(async () => {
    try {
      logDebug("HARNESS", "Calling runPlanner...");
      const plannerIdentity = makeIdentity({ role: "planner" });
      const plannerSpan = harnessSpan.startChild(timedName(plannerIdentity), { model: config.resolvedModelPlanner });
      const plannerResult = await plannerSpan.run(() =>
        agents.runPlanner({ config, identity: plannerIdentity, skills: skills.planner }),
      );
      if (plannerResult.sdkResult) {
        usage.recordStage("planner", config.resolvedModelPlanner, plannerResult.sdkResult);
      }
      plannerSpan.end();
      const spec = plannerResult.spec;
      logDebug("HARNESS", `Planner returned, spec length: ${spec.length}`);
      await writeSpec(config.workDir, spec);
      log("HARNESS", "Product spec written");

      progress.status = "spec-review";
      await writeProgress(config.workDir, progress);
      const approvedSpec = await specApprovalGate(config, spec, harnessSpan, usage, agents.runPlanner, skills.planner);
      progress.specApproved = true;
      await writeProgress(config.workDir, progress);

      if (config.isDryRun) {
        progress.totalSprints = Math.min(countSprintHeadings(approvedSpec) || config.maxSprints, config.maxSprints);
        await writeProgress(config.workDir, progress);
        log("HARNESS", "Dry-run complete. Spec approved and saved.");
        usage.printSummary();
        await usage.save();
        return { success: true, sprints: [], totalDurationMs: Date.now() - startTime };
      }

      // Auto-branch: in existing-project mode, move off main by default before
      // the sprint loop so all [auto-commit] commits land on a topic branch.
      // --allow-main skips this entirely (run on whatever the current branch is).
      // --greenfield uses its own app/ repo — no host-repo branching needed.
      if (!isGreenfield && !config.allowMain) {
        const gDir = gitDir(config.workDir, isGreenfield);
        // Explicit --branch <name> takes precedence over the auto-generated name.
        const sessionStamp = config.sessionDir ?? fileTimestamp();
        const branchName = config.branch ?? buildTopicBranchName(config.userPrompt, sessionStamp);
        // ensureTopicBranch creates the branch or reuses an existing one.
        // On git failure it throws a hard Error — halts before the sprint loop.
        ensureTopicBranch({ branchName, gitDir: gDir });
        log("HARNESS", `Topic branch: ${branchName}`);
        progress.branch = branchName;
        await writeProgress(config.workDir, progress);
      }

      // Scout pass: read-only pre-Generator codebase analysis.
      // Skipped in greenfield (empty codebase) and when --scout flag is absent.
      if (config.useScout && !isGreenfield && agents.runScout) {
        logDivider();
        log("HARNESS", "PHASE 1b: SCOUT (codebase analysis)");
        logDivider();
        const scoutIdentity = makeIdentity({ role: "scout" });
        const scoutResult = await agents.runScout({ config, identity: scoutIdentity });
        if (scoutResult.sdkResult) {
          usage.recordStage("scout", config.resolvedModelEvaluator, scoutResult.sdkResult);
        }
      }

      // Count sprints from the (possibly edited) spec
      const totalSprints = Math.min(countSprintHeadings(approvedSpec) || config.maxSprints, config.maxSprints);
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
        agents,
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
  agents: AgentRunners,
): Promise<HarnessResult> {
  const { model, isGreenfield } = config;
  log("HARNESS", "Resuming from checkpoint...");

  // Don't clean artifacts on resume
  await initWorkspace(config.workDir, { greenfield: isGreenfield, resume: true });

  const skills = resolveAllAgentSkills(config.workDir, join(import.meta.dir, ".."), {
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

      const harnessSpan = tracer.startSpan(`${fileTimestamp()}-harness-resume-docs`, {
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
            agents,
          });
        } catch {
          // Documenter failure is non-fatal
        }

        const totalDuration = Date.now() - startTime;
        usage.printSummary();
        await usage.save();

        // Preserve run history after docs-only resume completes.
        if (config.sessionDir) {
          try {
            const savedUsage = readLiveUsage(config.workDir);
            await writeRunRecord(config.workDir, config.sessionDir, savedUsage, progress);
          } catch {
            // Non-fatal.
          }
        }

        // Final end-of-run metadata commit after docs-only resume
        if (config.commitAdhd) {
          const gDir = gitDir(config.workDir, isGreenfield);
          commitFinalMetadata(config.workDir, gDir, config.commitAdhdLogs);
        }

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
    spec = await reviewSpan.run(() =>
      specApprovalGate(config, spec, reviewSpan, usage, agents.runPlanner, skills.planner),
    );
    reviewSpan.end();
    progress.specApproved = true;
    await writeProgress(config.workDir, progress);
  }

  // Always recompute from the spec — progress.totalSprints is a cache, not the source of truth.
  // Guards against dry-run runs that persisted specApproved without a sprint count, and picks up manual spec edits.
  progress.totalSprints = Math.min(countSprintHeadings(spec) || config.maxSprints, config.maxSprints);

  // Branch handling on resume: reuse the branch recorded in progress.json.
  // --allow-main skips this entirely (run on whatever the current branch is).
  // --greenfield uses its own app/ repo — no host-repo branching needed.
  if (!isGreenfield && !config.allowMain) {
    if (!progress.branch) {
      // No branch was recorded — this progress file predates auto-branching.
      // A clear, actionable error is better than silently generating a fresh branch.
      throw new Error(
        "Cannot resume: no branch was recorded in progress.json. " +
          "This run may have been started before auto-branching was introduced. " +
          "Pass --allow-main to resume on the current branch instead.",
      );
    }
    const gDir = gitDir(config.workDir, isGreenfield);
    ensureTopicBranch({ branchName: progress.branch, gitDir: gDir });
    log("HARNESS", `Resuming on branch: ${progress.branch}`);
  }

  // Restore prior sprint results
  const results: SprintResult[] = progress.sprintResults ?? [];

  // Git revert if there are commits after the last checkpoint
  if (progress.lastPassedCommitSha) {
    await revertToCheckpoint(config.workDir, isGreenfield, progress);
  }

  const startSprint = progress.completedSprints + 1;
  const harnessSpan = tracer.startSpan(`${fileTimestamp()}-harness-resume`, {
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
      agents,
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
  agents: AgentRunners,
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
  const skills = resolveAllAgentSkills(config.workDir, join(import.meta.dir, ".."), {
    noBdd: config.noBdd,
    noTdd: config.noTdd,
  });

  // Load spec
  const spec = await readSpec(config.workDir);
  log("HARNESS", "Loaded spec from disk");

  // Count total sprints from spec
  const totalSprints = Math.min(countSprintHeadings(spec) || config.maxSprints, config.maxSprints);

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

  const harnessSpan = tracer.startSpan(`${fileTimestamp()}-harness-sprint-${sprintN}`, {
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
      agents,
    }),
  );
  harnessSpan.end();
  return result;
}

async function runSprintLoop(ctx: SprintLoopContext): Promise<HarnessResult> {
  const { config, progress, results, startSprint, startTime, parentSpan, usage, skills, agents } = ctx;
  let { spec, totalSprints } = ctx;
  const { workDir, isGreenfield } = config;
  const gDir = gitDir(workDir, isGreenfield);

  for (let sprint = startSprint; sprint <= totalSprints; sprint++) {
    logDivider();
    log("HARNESS", `SPRINT ${sprint}/${totalSprints}`);
    logDivider();

    progress.status = "negotiating";
    progress.currentSprint = sprint;
    progress.retryCount = 0;
    await writeProgress(config.workDir, progress);

    const sprintSpan = parentSpan.startChild(`${fileTimestamp()}-sprint-${sprint}`, { sprintNumber: sprint });

    // Try to reuse existing contract (--sprint mode or --resume mode)
    let contract: SprintContract | undefined;
    if (config.sprint !== undefined || config.isResume) {
      const existing = await loadExistingContract(config.workDir, sprint);
      if (existing) {
        contract = existing;
        log("HARNESS", `Loaded contract from disk for sprint ${sprint} with ${contract.criteria.length} criteria`);
      }
    }

    if (!contract) {
      log("HARNESS", "Negotiating sprint contract...");
      const negotiationIdentity = makeIdentity({ role: "contract-negotiation", sprint });
      const negotiationSpan = sprintSpan.startChild(timedName(negotiationIdentity), {
        sprint,
      });
      try {
        contract = await negotiationSpan.run(() =>
          withTransientRetry(
            () =>
              agents.negotiateContract({
                workDir: config.workDir,
                spec,
                sprintNumber: sprint,
                proposalModel: config.resolvedModelGenerator,
                reviewModel: config.resolvedModelEvaluator,
                usage,
                maxFeatures: config.maxFeatures,
                maxCriteria: config.maxCriteria,
                maxSurfaces: config.maxSurfaces,
                modelContract: config.modelContract,
                sessionDir: config.sessionDir,
              }),
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
      notify(`Sprint ${sprint} contract ready for review`, { notify: config.notify });
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

    // Build-Evaluate retry loop
    const attemptResult = await runSprintAttempts({
      config,
      spec,
      contract,
      sprint,
      gDir,
      sprintSpan,
      progress,
      usage,
      skills,
      results,
      agents,
    });

    // Fatal error during attempts — propagate immediately
    if (attemptResult.fatalResult) return attemptResult.fatalResult;

    const { passed, attempts, lastEval, lastCommitSource } = attemptResult;

    results.push({
      sprintNumber: sprint,
      passed,
      attempts,
      evalResult: lastEval,
      commitSource: lastCommitSource,
    });

    sprintSpan.end({ passed, attempts });

    if (passed) {
      const successResult = await handleSprintSuccess({
        config,
        contract,
        spec,
        sprint,
        totalSprints,
        gDir,
        progress,
        results,
        parentSpan,
        usage,
        skills,
        agents,
      });
      spec = successResult.spec;
      totalSprints = successResult.totalSprints;
      if (successResult.skipNextSprint) {
        results.push({ sprintNumber: sprint + 1, passed: true, attempts: 0, skipped: true });
        progress.completedSprints++;
        sprint++;
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
  const allPassed = results.length > 0 && results.every((r) => r.passed);

  if (allPassed && !config.noDocs) {
    progress.status = "documenting";
    await writeProgress(config.workDir, progress);

    await runDocumenterPhase({
      config,
      parentSpan,
      usage,
      documenterSkills: skills?.documenter,
      results,
      progress,
      agents,
    });
  }

  progress.status = allPassed ? "complete" : "failed";
  await writeProgress(config.workDir, progress);

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

  // Preserve run history: snapshot usage.json and progress.json under
  // .adhd/runs/<sessionStamp>/ for later comparison via `adhd compare`.
  // Runs regardless of --commit-adhd — no git operation is performed.
  if (config.sessionDir) {
    try {
      const savedUsage = readLiveUsage(workDir);
      await writeRunRecord(workDir, config.sessionDir, savedUsage, progress);
    } catch {
      // Non-fatal: history preservation must never disrupt the run.
    }
  }

  // Final end-of-run metadata commit: captures the terminal progress.json
  // (status complete/failed, docs-generated flag) and the fully-accumulated
  // usage.json. Only runs when --commit-adhd is set; non-fatal.
  if (config.commitAdhd && allPassed) {
    commitFinalMetadata(workDir, gDir, config.commitAdhdLogs);
  }

  return { success: allPassed, sprints: results, totalDurationMs: totalDuration };
}
