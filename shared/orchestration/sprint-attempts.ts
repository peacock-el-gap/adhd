import { execSync } from "node:child_process";
import { bareName, makeIdentity, timedName } from "../agent-identity.ts";
import { computeChangedFilesSince, computeDiffSection } from "../diff.ts";
import { buildSkippedEvaluatorResult } from "../eval-result.ts";
import { writeFeedback, writeProgress } from "../files.ts";
import { promptGate } from "../interaction.ts";
import { fileTimestamp, log, logDebug, logError, shouldLog } from "../logger.ts";
import { notify } from "../notifications.ts";
import { buildRegressionSection, readRegressionCriteria } from "../regression.ts";
import { checkSurfaceCoverage, normalizeSurfaces } from "../surfaces.ts";
import type { CommitSource, EvalResult } from "../types.ts";
import { handleFatalError, withTransientRetry } from "./error-handling.ts";
import { commitAdhdArtifacts } from "./git-ops.ts";
import { runStaticAnalysis } from "./static-analysis-runner.ts";
import type { SprintAttemptContext, SprintAttemptResult } from "./types.ts";

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
              attempt: retry,
              skills: skills?.generator,
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
        });
        log("HARNESS", `Commit source: ${lastCommitSource}`);
      } catch (err) {
        logError("HARNESS", `Commit enforcement failed: ${err}`);
      }
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
              attempt: retry,
              skills: skills?.evaluator,
              supplementaryContext: supplementaryContext || undefined,
            }),
          "evaluator",
        ),
      );
      if (evalWithUsage.sdkResult) {
        usage.recordStage(bareName(evaluatorIdentity), config.resolvedModelEvaluator, evalWithUsage.sdkResult);
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
