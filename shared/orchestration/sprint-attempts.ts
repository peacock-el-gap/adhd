import { execSync } from "node:child_process";
import { computeDiffSection } from "../diff.ts";
import { writeFeedback, writeProgress } from "../files.ts";
import { promptGate } from "../interaction.ts";
import { fileTimestamp, log, logError, shouldLog } from "../logger.ts";
import { buildRegressionSection, readRegressionCriteria } from "../regression.ts";
import type { CommitSource, EvalResult } from "../types.ts";
import { handleFatalError, withTransientRetry } from "./error-handling.ts";
import { commitAdhdArtifacts } from "./git-ops.ts";
import { runStaticAnalysis } from "./static-analysis-runner.ts";
import type { SprintAttemptContext, SprintAttemptResult } from "./types.ts";

export async function runSprintAttempts(ctx: SprintAttemptContext): Promise<SprintAttemptResult> {
  const { config, spec, contract, sprint, gDir, sprintSpan, progress, usage, skills, results, agents } = ctx;

  let passed = false;
  let lastEval: EvalResult | undefined;
  let attempts = 0;
  let lastCommitSource: CommitSource = "none";

  for (let retry = 0; retry <= config.maxRetriesPerSprint; retry++) {
    attempts = retry + 1;
    const attemptSpan = sprintSpan.startChild(`${fileTimestamp()}-sprint-${sprint}-attempt-${retry}`, { attempt: retry });

    // Capture SHA before generator runs
    let beforeSha = "";
    try {
      beforeSha = execSync("git rev-parse HEAD", { cwd: gDir, encoding: "utf-8" }).trim();
    } catch {
      // No git repo or no commits yet
    }

    // Build
    progress.status = "building";
    progress.retryCount = retry;
    await writeProgress(config.workDir, progress);

    // Commit .adhd/ artifacts before Generator invocation for clean working tree
    commitAdhdArtifacts(config.workDir, gDir, sprint);

    const generatorTs = fileTimestamp();
    const generatorSpan = attemptSpan.startChild(`${generatorTs}-sprint-${sprint}-attempt-${retry}-generator`, {
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
              spec,
              contract,
              previousFeedback: lastEval,
              attempt: retry,
              skills: skills?.generator,
              logTimestamp: generatorTs,
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
    if (retry > 0 && beforeSha) {
      const diffSection = computeDiffSection(gDir, beforeSha, retry);
      if (diffSection) {
        supplementaryContext += diffSection;
      }
    }

    if (staticAnalysisResult.output) {
      supplementaryContext += `\n\n## Static Analysis Results\n\n${staticAnalysisResult.output}`;
    }

    const evaluatorTs = fileTimestamp();
    const evaluatorSpan = attemptSpan.startChild(`${evaluatorTs}-sprint-${sprint}-attempt-${retry}-evaluator`, {
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
              contract,
              attempt: retry,
              skills: skills?.evaluator,
              supplementaryContext: supplementaryContext || undefined,
              logTimestamp: evaluatorTs,
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
