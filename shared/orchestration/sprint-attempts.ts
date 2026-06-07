import { execSync } from "node:child_process";
import { bareName, makeIdentity, timedName } from "../agent-identity.ts";
import { checkSprintBudget, computeSprintTokenUsage, formatBudgetMessage } from "../budget.ts";
import { buildCodebaseMap } from "../codebase-map.ts";
import { computeChangedFilesSince, computeDiffSection } from "../diff.ts";
import { buildSkippedEvaluatorResult } from "../eval-result.ts";
import { writeBaselineVerification, writeFeedback, writeProgress } from "../files.ts";
import { promptGate } from "../interaction.ts";
import { fileTimestamp, log, logDebug, logError, shouldLog } from "../logger.ts";
import { notify } from "../notifications.ts";
import { buildRegressionSection, readRegressionCriteria } from "../regression.ts";
import { checkSurfaceCoverage, normalizeSurfaces } from "../surfaces.ts";
import type { CommitSource, EvalResult } from "../types.ts";
import { buildBaselineVerificationSection, buildPostVerificationSection, classifyFailures } from "../verification.ts";
import { handleFatalError, UserAbortError, withTransientRetry } from "./error-handling.ts";
import { commitAdhdArtifacts } from "./git-ops.ts";
import { runStaticAnalysis } from "./static-analysis-runner.ts";
import type { SprintAttemptContext, SprintAttemptResult } from "./types.ts";
import { createVerificationRunner } from "./verification-runner.ts";

export async function runSprintAttempts(ctx: SprintAttemptContext): Promise<SprintAttemptResult> {
  const { config, spec, contract, sprint, gDir, sprintSpan, progress, usage, skills, results, agents } = ctx;

  let passed = false;
  let lastEval: EvalResult | undefined;
  // The most recent EvalResult that came from an actual Evaluator run (not a
  // gate skip). Carried into a later gate-skip's feedback so the next Generator
  // attempt never loses the real defect under boilerplate (see Fix #2 below).
  let lastRealEval: EvalResult | undefined;
  let attempts = 0;
  let lastCommitSource: CommitSource = "none";

  // Per-sprint budget tracking (F12). State is reset fresh for each sprint
  // invocation — `runSprintAttempts` is called once per sprint.
  let budgetWarned80 = false;
  let budgetExtended = false;

  /**
   * Check the per-sprint token budget after recording a stage. Emits a
   * soft warning at 80%, and at 100% either pauses (interactive) or logs and
   * continues (non-interactive). Inert when no budget is configured.
   * Never throws except via deliberate UserAbortError on operator abort.
   */
  async function runBudgetCheck(): Promise<void> {
    if (!config.sprintTokenBudget || budgetExtended) return;
    try {
      const stages = usage.getStages();
      const tokensUsed = computeSprintTokenUsage(stages, sprint);
      const result = checkSprintBudget(tokensUsed, config.sprintTokenBudget, budgetWarned80);
      if (result.threshold === "warn-at-80") {
        log("HARNESS", formatBudgetMessage(result, sprint));
        budgetWarned80 = true;
      } else if (result.threshold === "gate-at-100") {
        log("HARNESS", formatBudgetMessage(result, sprint));
        if (config.interactive) {
          const gate = await promptGate(
            `Sprint ${sprint} has reached its token budget. Extend or abort?`,
            [
              { key: "e", label: "Extend — continue without further budget checks this sprint", isDefault: true },
              { key: "a", label: "Abort — stop the run now", isDefault: false },
            ],
            config.gateTimeout ?? 15,
            config.interactive,
          );
          if (gate.key === "a") {
            throw new UserAbortError(`Sprint ${sprint} token budget exceeded; operator chose to abort.`);
          }
          // Extend: suppress all further budget gates for this sprint.
          budgetExtended = true;
        } else {
          // Non-interactive: log once and auto-continue; suppress further gates.
          log("HARNESS", `Sprint ${sprint} token budget exceeded in non-interactive mode — continuing automatically.`);
          budgetExtended = true;
        }
      }
    } catch (err) {
      if (err instanceof UserAbortError) throw err;
      // Any other error in budget accounting is non-fatal — silently ignore.
    }
  }

  // Capture a verification baseline before the Generator runs so that any
  // tests that were already failing can be distinguished from failures the
  // Generator introduced. The baseline is captured once per sprint (not once
  // per retry) because it represents the state of the project before this
  // sprint's code changes begin.
  const baselineRunner = createVerificationRunner();
  const baselineResult = await baselineRunner.run(gDir);
  if (baselineResult.passed !== null) {
    log(
      "HARNESS",
      `Verification baseline captured: ${baselineResult.passCount} passing, ${baselineResult.failCount} failing before code changes begin.`,
    );
    await writeBaselineVerification(config.workDir, sprint, baselineResult);
  }

  // Build a codebase map once per sprint (deterministic, so one build is enough)
  // and compose it with the baseline section for injection into the Generator.
  // The map never fails the run: a build error yields an empty string, and an
  // empty map is simply omitted from the context (no section injected).
  let codbaseMapRaw = "";
  try {
    codbaseMapRaw = buildCodebaseMap(gDir);
  } catch {
    // Graceful degradation — empty map, run continues unchanged
  }

  // The sprint's starting checkpoint — HEAD captured before the FIRST attempt's
  // generator commit, equal to the previous sprint's checkpoint. The surface
  // coverage gate measures coverage cumulatively from here so a surface touched
  // on any attempt counts as covered, even if a later attempt only fixes a
  // different surface. Captured once (on retry 0) and reused on every retry.
  let sprintBaseSha = "";

  for (let retry = 0; retry <= config.maxRetriesPerSprint; retry++) {
    attempts = retry + 1;
    const attemptSpan = sprintSpan.startChild(`${fileTimestamp()}-sprint-${sprint}-attempt-${retry}`, {
      attempt: retry,
    });

    // Capture SHA before generator runs
    let beforeSha = "";
    try {
      beforeSha = execSync("git rev-parse HEAD", { cwd: gDir, encoding: "utf-8" }).trim();
    } catch {
      // No git repo or no commits yet
    }
    // The first attempt's pre-generator HEAD is the sprint's base checkpoint.
    if (retry === 0) sprintBaseSha = beforeSha;

    // Build
    progress.status = "building";
    progress.retryCount = retry;
    await writeProgress(config.workDir, progress);

    // Commit .adhd/ artifacts before Generator invocation for clean working tree
    commitAdhdArtifacts(config.workDir, gDir, sprint);

    // Build the Generator's supplementary context: compose the pre-sprint
    // baseline (which tests were already failing) with the harness-generated
    // codebase map (structure and exported names) so the Generator does not
    // re-explore the project from scratch. Each section has its own ## heading
    // so they are clearly delimited even without an explicit separator.
    const baselineSection = buildBaselineVerificationSection(baselineResult);
    const generatorContextParts = [baselineSection, codbaseMapRaw].filter(Boolean);
    const generatorSupplementaryContext =
      generatorContextParts.length > 0 ? generatorContextParts.join("\n\n") : undefined;

    const generatorIdentity = makeIdentity({ role: "generator", sprint, attempt: retry });
    const generatorSpan = attemptSpan.startChild(timedName(generatorIdentity), {
      model: config.resolvedModelGenerator,
      sprint,
      attempt: retry,
    });
    let generatorSessionId: string | undefined;
    try {
      const result = await generatorSpan.run(() =>
        withTransientRetry(
          () =>
            agents.runGenerator({
              config,
              identity: generatorIdentity,
              spec,
              contract,
              previousFeedback: lastEval,
              skills: skills?.generator,
              supplementaryContext: generatorSupplementaryContext,
            }),
          "generator",
        ),
      );
      generatorSessionId = result.sessionId;
      if (result.sdkResult) {
        usage.recordStage(bareName(generatorIdentity), config.resolvedModelGenerator, result.sdkResult);
      }
    } catch (err) {
      generatorSpan.end({ error: String(err) });
      attemptSpan.end({ error: String(err) });
      sprintSpan.end({ error: String(err) });
      return {
        passed,
        attempts,
        lastEval,
        lastCommitSource,
        fatalResult: await handleFatalError(err, config, progress, results),
      };
    }
    generatorSpan.end();
    // Check per-sprint token budget after generator stage is recorded (F12).
    await runBudgetCheck();

    // Ensure generator committed its work
    if (beforeSha) {
      try {
        lastCommitSource = await agents.ensureGeneratorCommit({
          workDir: config.workDir,
          gitDir: gDir,
          beforeSha,
          sessionId: generatorSessionId,
          contract,
          isRetry: retry > 0,
          model: config.resolvedModelGenerator,
          // F7: pass the usage tracker so any commit-resume token spend is recorded
          usage,
        });
        log("HARNESS", `Commit source: ${lastCommitSource}`);
      } catch (err) {
        logError("HARNESS", `Commit enforcement failed: ${err}`);
      }
    }

    // --- Post-Generator verification run ---
    // Run the test suite once after the Generator commits. This result is
    // shared with both the Evaluator (as the authoritative outcome) and the
    // test gate (if --test-gate is set). A new runner is created per attempt
    // so each attempt gets a fresh, uncached run.
    const postRunner = createVerificationRunner();
    const postVerificationResult = await postRunner.run(gDir);
    if (postVerificationResult.passed !== null) {
      log(
        "HARNESS",
        `Post-Generator verification: ${postVerificationResult.passCount} passing, ${postVerificationResult.failCount} failing.`,
      );
    }

    // Classify post-Generator failures against the pre-sprint baseline so we
    // know which failures the Generator introduced vs. which were pre-existing.
    const classification = classifyFailures(baselineResult, postVerificationResult);
    if (classification.classified && shouldLog("verbose", config.logLevel)) {
      log(
        "HARNESS",
        `Failure classification — pre-existing: [${classification.preExisting.join(", ") || "none"}], newly introduced: [${classification.newlyIntroduced.join(", ") || "none"}]`,
      );
    }

    // --- Surface coverage gate ---
    // Surface coverage check: did the Generator touch every part of the code it
    // promised to (the contract's declared surfaces)? This is a cheap, AI-free
    // check that runs after the Generator commits but before the Evaluator, so a
    // silently dropped surface fails the attempt at zero AI cost.
    //
    // Gate ordering: this gate runs BEFORE the static-analysis / --lint-gate
    // block below because it is the cheaper of the two cost-saving gates (one
    // `git diff --name-only` versus running the configured lint/test commands).
    // When both gates are active, whichever fails first short-circuits the
    // attempt without invoking the Evaluator. It degrades gracefully — a legacy
    // contract with no surfaces, or a changed-file list that cannot be computed
    // (missing beforeSha, git failure, or only .adhd/ metadata changed), simply
    // skips the check and proceeds to the Evaluator as before.
    const declaredSurfaces = normalizeSurfaces(contract.surfaces) ?? [];
    if (declaredSurfaces.length > 0) {
      // Cumulative coverage: measure every product file the sprint has touched
      // since its base checkpoint, across ALL attempts so far — not just this
      // attempt's commit. A surface touched on an earlier attempt stays covered
      // when a later attempt only fixes a different surface, so the sprint can
      // converge instead of ping-ponging between surfaces.
      //
      // Attempt 0 is exempt: the Evaluator always runs on the first attempt, so
      // a feature that builds one surface first and another later is never
      // failed before the Evaluator has seen anything.
      const changedFiles = retry > 0 ? computeChangedFilesSince(gDir, sprintBaseSha) : undefined;
      if (changedFiles && changedFiles.length > 0) {
        logDebug("HARNESS", `Surface coverage — files changed since sprint base: ${changedFiles.join(", ")}`);
        const { covered, missing } = checkSurfaceCoverage(declaredSurfaces, changedFiles);
        if (shouldLog("verbose", config.logLevel)) {
          log(
            "HARNESS",
            `Surface coverage — declared: [${declaredSurfaces.join(", ")}], touched: [${covered.join(", ") || "none"}]`,
          );
        }
        if (missing.length > 0) {
          const missingList = missing.join(", ");
          // Always log the cost-saving decision (normal level).
          log(
            "HARNESS",
            `Surface coverage check failed — the contract promised to change ${missingList} but no ${missingList} files were touched. Skipping Evaluator, no AI cost for this attempt.`,
          );
          lastEval = buildSkippedEvaluatorResult(
            contract,
            `Evaluator skipped: surface coverage check failed. Declared surface(s) not touched: ${missingList}.`,
            `Surface coverage check failed. The contract declared these surfaces but the Generator did not touch them: ${missingList}. Surfaces actually touched: ${covered.join(", ") || "none"}. The Evaluator was skipped to save cost — change the missing surface(s) on the next attempt.`,
            lastRealEval,
          );
          await writeFeedback(config.workDir, sprint, retry, lastEval);
          attemptSpan.end({ passed: false, surfaceCoverage: false });
          continue;
        }
        if (shouldLog("normal", config.logLevel)) {
          log("HARNESS", "Surface coverage check passed — all declared surfaces were touched.");
        }
      } else if (shouldLog("verbose", config.logLevel)) {
        log(
          "HARNESS",
          "Surface coverage check skipped — first attempt, or no cumulative changed files could be computed.",
        );
      }
    } else if (shouldLog("verbose", config.logLevel)) {
      log("HARNESS", "Surface coverage check skipped — the contract declared no surfaces.");
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
        const regressionSection = buildRegressionSection(regressionCriteria, contract.surfaces);
        if (regressionSection) {
          supplementaryContext += regressionSection;
        }
      } catch {
        // Graceful degradation — proceed without regression criteria
      }
    }

    const staticAnalysisResult = await runStaticAnalysis(config);
    if (staticAnalysisResult.output) {
      // Hard gate: if --lint-gate and any command failed, skip evaluator.
      // Gate ordering: surface-coverage gate → lint gate → test gate.
      // The lint gate runs here, before the test gate below, because static
      // analysis (lint/typecheck) is cheaper to re-run than a full test suite.
      if (config.lintGate && staticAnalysisResult.failed) {
        log("HARNESS", "Lint gate: static analysis failed, skipping evaluator");
        lastEval = buildSkippedEvaluatorResult(
          contract,
          "Evaluator skipped due to --lint-gate: static analysis failed",
          `Static analysis failed (--lint-gate). Output:\n${staticAnalysisResult.output}`,
          lastRealEval,
        );
        await writeFeedback(config.workDir, sprint, retry, lastEval);
        attemptSpan.end({ passed: false, lintGate: true });
        continue;
      }
    }

    // --- Test gate (opt-in, --test-gate / TEST_GATE) ---
    // Gate ordering: surface-coverage gate → lint gate → test gate (here).
    // The test gate is evaluated only after both cheaper gates have passed.
    // When the classification is unclassified (classified: false — no baseline,
    // or baseline.passed === null), the gate does NOT trigger; the attempt
    // proceeds to the Evaluator as normal. This matches the "unclassified
    // baseline does not trigger gate" invariant.
    if (config.testGate && classification.classified && classification.newlyIntroduced.length > 0) {
      const count = classification.newlyIntroduced.length;
      // Cost-saving decision: log at normal level in one sentence stating what
      // happened and the cost consequence — matching the surface-coverage and
      // lint-gate messages.
      log(
        "HARNESS",
        `Skipped Evaluator — ${count} newly-introduced test failure(s) detected; evaluation token cost avoided.`,
      );
      const failingList = classification.newlyIntroduced.join(", ");
      lastEval = buildSkippedEvaluatorResult(
        contract,
        `Evaluator skipped due to --test-gate: ${count} newly-introduced test failure(s): ${failingList}.`,
        `Test gate (--test-gate) triggered: ${count} test(s) started failing after the Generator ran: ${failingList}. Fix the failing tests on the next attempt. The Evaluator was skipped to save cost.`,
        lastRealEval,
      );
      await writeFeedback(config.workDir, sprint, retry, lastEval);
      attemptSpan.end({ passed: false, testGate: true });
      continue;
    }

    // Diff-aware evaluation on retries
    if (retry > 0 && beforeSha) {
      const diffSection = computeDiffSection(gDir, beforeSha, retry);
      if (diffSection) {
        supplementaryContext += diffSection;
      }
    }

    if (staticAnalysisResult.output) {
      supplementaryContext += `\n\n## Static Analysis Results\n\n${staticAnalysisResult.output}`;
    }

    // Inject the post-Generator verification result as the authoritative test
    // outcome. The Evaluator is told not to re-run the full suite — the harness
    // has already done it and the result is provided here.
    const postVerificationSection = buildPostVerificationSection(postVerificationResult, classification);
    if (postVerificationSection) {
      supplementaryContext += `\n\n${postVerificationSection}`;
    }

    const evaluatorIdentity = makeIdentity({ role: "evaluator", sprint, attempt: retry });
    const evaluatorSpan = attemptSpan.startChild(timedName(evaluatorIdentity), {
      model: config.resolvedModelEvaluator,
      sprint,
      attempt: retry,
    });
    try {
      const evalWithUsage = await evaluatorSpan.run(() =>
        withTransientRetry(
          () =>
            agents.runEvaluator({
              config,
              identity: evaluatorIdentity,
              contract,
              skills: skills?.evaluator,
              supplementaryContext: supplementaryContext || undefined,
            }),
          "evaluator",
        ),
      );
      if (evalWithUsage.sdkResult) {
        usage.recordStage(bareName(evaluatorIdentity), config.resolvedModelEvaluator, evalWithUsage.sdkResult);
      }
      // F7: record the evaluator max-tokens retry cost as a separate additive
      // stage so tokens spent on the JSON-recovery follow-up are not dropped.
      if (evalWithUsage.resumeSdkResult) {
        usage.recordStage(
          `${bareName(evaluatorIdentity)}-resume`,
          config.resolvedModelEvaluator,
          evalWithUsage.resumeSdkResult,
        );
      }
      lastEval = evalWithUsage;
      // Remember this as the last REAL evaluation so a subsequent gate skip can
      // carry its per-criterion findings forward instead of boilerplate.
      lastRealEval = evalWithUsage;
    } catch (err) {
      evaluatorSpan.end({ error: String(err) });
      attemptSpan.end({ error: String(err) });
      sprintSpan.end({ error: String(err) });
      return {
        passed,
        attempts,
        lastEval,
        lastCommitSource,
        fatalResult: await handleFatalError(err, config, progress, results),
      };
    }
    evaluatorSpan.end();
    // Check per-sprint token budget after evaluator stage is recorded (F12).
    await runBudgetCheck();
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
      notify(`Evaluator scored ${minScore}/10 — override decision needed`, { notify: config.notify });
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

  return { passed, attempts, lastEval, lastCommitSource };
}
