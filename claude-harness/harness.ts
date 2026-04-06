import { execSync } from "node:child_process";
import { readFile as readFileRaw } from "node:fs/promises";
import { join } from "node:path";
import { type Options, query } from "@anthropic-ai/claude-agent-sdk";
import { CLAUDE_MODEL } from "../shared/config.ts";
import { createConversationLog } from "../shared/conversation-logger.ts";
import {
  harnessDir,
  initWorkspace,
  readProgress,
  readSpec,
  writeContract,
  writeFeedback,
  writeProgress,
  writeSpec,
} from "../shared/files.ts";
import { promptGate, promptGateWithText } from "../shared/interaction.ts";
import { log, logDebug, logDivider, logError, setDisplayTimezone, shouldLog, summarize } from "../shared/logger.ts";
import { CONTRACT_NEGOTIATION_EVALUATOR_PROMPT, CONTRACT_NEGOTIATION_GENERATOR_PROMPT } from "../shared/prompts.ts";
import { initTracing, type Span, type Tracer } from "../shared/tracing.ts";
import type {
  CommitSource,
  EvalResult,
  HarnessConfig,
  HarnessProgress,
  HarnessResult,
  SprintContract,
  SprintResult,
} from "../shared/types.ts";
import { createUsageTracker, type UsageTracker } from "../shared/usage.ts";
import { runEvaluator } from "./evaluator.ts";
import { ensureGeneratorCommit, runGenerator } from "./generator.ts";
import { runPlanner } from "./planner.ts";

const TRANSIENT_RETRY_DELAYS = [30_000, 60_000, 120_000]; // 30s, 60s, 120s

export async function runHarness(config: HarnessConfig): Promise<HarnessResult> {
  const startTime = Date.now();
  const model = config.model ?? CLAUDE_MODEL;
  // B3: per-agent model overrides (fall back to base model)
  const generatorModel = config.modelGenerator ?? model;
  const evaluatorModel = config.modelEvaluator ?? model;
  const isGreenfield = config.isGreenfield ?? false;

  // Configure timezone display for terminal
  if (config.tzDisplay) {
    setDisplayTimezone(config.tzDisplay);
  }

  // Initialize tracing and usage tracking
  const tracer = initTracing(config);
  const usage = createUsageTracker(config.workDir);

  log("HARNESS", "Initializing Claude Agent SDK harness");
  log("HARNESS", `Work directory: ${config.workDir}`);
  // B3: show per-agent model overrides if configured
  const modelInfo = [config.modelPlanner, config.modelGenerator, config.modelEvaluator].some(Boolean)
    ? `Models: planner=${config.modelPlanner ?? model}, generator=${generatorModel}, evaluator=${evaluatorModel}`
    : `Model: ${model}`;
  log(
    "HARNESS",
    `${modelInfo} | Max sprints: ${config.maxSprints} | Max retries: ${config.maxRetriesPerSprint} | Threshold: ${config.passThreshold}/10`,
  );

  // --- Resume path ---
  if (config.isResume) {
    const result = await resumeHarness(config, model, isGreenfield, startTime, tracer, usage);
    await tracer.flush();
    return result;
  }

  // --- Fresh run path ---

  // A2: Pre-flight dirty-tree check (skip in greenfield mode — no existing repo)
  if (!isGreenfield) {
    await checkDirtyTree(config);
  }

  logDebug("HARNESS", "Initializing workspace...");
  await initWorkspace(config.workDir, { greenfield: isGreenfield });
  logDebug("HARNESS", "Workspace initialized");

  // Phase 1: Planning
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

  const plannerSpan = tracer.startSpan("planner", { model });
  logDebug("HARNESS", "Calling runPlanner...");
  const spec = await runPlanner(config, plannerSpan, undefined, usage);
  logDebug("HARNESS", `Planner returned, spec length: ${spec.length}`);
  await writeSpec(config.workDir, spec);
  log("HARNESS", "Product spec written");

  // A3: Spec approval gate
  progress.status = "spec-review";
  await writeProgress(config.workDir, progress);
  const approvedSpec = await specApprovalGate(config, spec, plannerSpan, usage);
  progress.specApproved = true;
  await writeProgress(config.workDir, progress);

  // B1: Dry-run exits here
  if (config.isDryRun) {
    log("HARNESS", "Dry-run complete. Spec approved and saved.");
    usage.printSummary();
    await usage.save();
    await tracer.flush();
    return { success: true, sprints: [], totalDurationMs: Date.now() - startTime };
  }

  // Count sprints from the (possibly edited) spec
  const sprintMatches = approvedSpec.match(/##\s*Sprint\s+\d+/gi);
  const totalSprints = sprintMatches ? Math.min(sprintMatches.length, config.maxSprints) : config.maxSprints;
  progress.totalSprints = totalSprints;

  const result = await runSprintLoop(
    config,
    model,
    isGreenfield,
    approvedSpec,
    progress,
    [],
    1,
    totalSprints,
    startTime,
    tracer,
    usage,
  );
  await tracer.flush();
  return result;
}

async function resumeHarness(
  config: HarnessConfig,
  model: string,
  isGreenfield: boolean,
  startTime: number,
  tracer: Tracer,
  usage: UsageTracker,
): Promise<HarnessResult> {
  log("HARNESS", "Resuming from checkpoint...");

  // Don't clean artifacts on resume
  await initWorkspace(config.workDir, { greenfield: isGreenfield, resume: true });

  let progress: HarnessProgress;
  try {
    progress = await readProgress(config.workDir);
  } catch {
    throw new Error("Nothing to resume. No .adhd/progress.json found. Run without --resume first.");
  }

  if (progress.status === "complete") {
    throw new Error("All sprints already completed. Nothing to resume.");
  }

  let spec = await readSpec(config.workDir);
  log("HARNESS", `Loaded spec from disk. Completed sprints: ${progress.completedSprints}/${progress.totalSprints}`);

  // If spec was written but not yet approved, show the gate
  if (!progress.specApproved) {
    log("HARNESS", "Spec exists but was not approved. Showing review gate.");
    spec = await specApprovalGate(config, spec, tracer.startSpan("spec-review"), usage);
    progress.specApproved = true;
    await writeProgress(config.workDir, progress);
    // Re-count sprints in case spec was edited
    const sprintMatches = spec.match(/##\s*Sprint\s+\d+/gi);
    progress.totalSprints = sprintMatches ? Math.min(sprintMatches.length, config.maxSprints) : config.maxSprints;
  }

  // Restore prior sprint results
  const results: SprintResult[] = progress.sprintResults ?? [];

  // Git revert if there are commits after the last checkpoint
  if (progress.lastPassedCommitSha) {
    await revertToCheckpoint(config.workDir, isGreenfield, progress);
  }

  const startSprint = progress.completedSprints + 1;
  return runSprintLoop(
    config,
    model,
    isGreenfield,
    spec,
    progress,
    results,
    startSprint,
    progress.totalSprints,
    startTime,
    tracer,
    usage,
  );
}

async function revertToCheckpoint(workDir: string, isGreenfield: boolean, progress: HarnessProgress): Promise<void> {
  const gitDir = isGreenfield ? join(workDir, "app") : workDir;
  const sha = progress.lastPassedCommitSha!;

  try {
    const currentHead = execSync("git rev-parse HEAD", { cwd: gitDir, encoding: "utf-8" }).trim();
    if (currentHead === sha) {
      log("HARNESS", "HEAD matches checkpoint — no revert needed");
      return;
    }

    log("HARNESS", `Reverting commits after checkpoint ${sha.slice(0, 8)}...`);
    execSync(
      `git revert --no-commit ${sha}..HEAD && git commit -m "Revert incomplete sprint ${progress.completedSprints + 1} attempt"`,
      { cwd: gitDir, stdio: "pipe" },
    );
    log("HARNESS", "Revert successful");
  } catch (err) {
    // Revert failed (conflicts) — warn and continue
    logError("HARNESS", `Git revert failed (conflicts?). Continuing without revert. Error: ${err}`);
    try {
      execSync("git revert --abort", { cwd: gitDir, stdio: "ignore" });
    } catch {
      // Already clean
    }
  }
}

async function runSprintLoop(
  config: HarnessConfig,
  model: string,
  isGreenfield: boolean,
  spec: string,
  progress: HarnessProgress,
  results: SprintResult[],
  startSprint: number,
  totalSprints: number,
  startTime: number,
  tracer: Tracer,
  usage: UsageTracker,
): Promise<HarnessResult> {
  const gitDir = isGreenfield ? join(config.workDir, "app") : config.workDir;
  const logLevel = config.logLevel ?? "normal";
  // B3: per-agent model overrides
  const generatorModel = config.modelGenerator ?? model;
  const evaluatorModel = config.modelEvaluator ?? model;

  for (let sprint = startSprint; sprint <= totalSprints; sprint++) {
    logDivider();
    log("HARNESS", `SPRINT ${sprint}/${totalSprints}`);
    logDivider();

    const sprintSpan = tracer.startSpan(`sprint-${sprint}`, { sprintNumber: sprint });

    // Phase 2: Contract Negotiation
    progress.status = "negotiating";
    progress.currentSprint = sprint;
    progress.retryCount = 0;
    await writeProgress(config.workDir, progress);

    log("HARNESS", "Negotiating sprint contract...");
    let contract: SprintContract;
    const negotiationSpan = sprintSpan.startChild("contract-negotiation", { sprint });
    try {
      contract = await withTransientRetry(
        () => negotiateContract(config.workDir, spec, sprint, generatorModel, evaluatorModel, negotiationSpan, usage),
        "contract negotiation",
      );
    } catch (err) {
      negotiationSpan.end({ error: String(err) });
      sprintSpan.end({ error: String(err) });
      return await handleFatalError(err, config, progress, results);
    }
    negotiationSpan.end({ criteria: contract.criteria.length, features: contract.features.length });
    await writeContract(config.workDir, contract);
    log("HARNESS", `Contract agreed: ${contract.criteria.length} criteria for ${contract.features.length} features`);

    // Phase 3-4: Build-Evaluate Loop
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

      const generatorSpan = attemptSpan.startChild("generator", { model: generatorModel, sprint, attempt: retry });
      let generatorSessionId: string | undefined;
      try {
        const result = await withTransientRetry(
          () =>
            runGenerator(
              config.workDir,
              spec,
              contract,
              lastEval,
              generatorModel,
              isGreenfield,
              logLevel,
              generatorSpan,
              retry,
            ),
          "generator",
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
            generatorModel,
          );
          log("HARNESS", `Commit source: ${lastCommitSource}`);
        } catch (err) {
          logError("HARNESS", `Commit enforcement failed: ${err}`);
        }
      }

      // Evaluate
      progress.status = "evaluating";
      await writeProgress(config.workDir, progress);

      const evaluatorSpan = attemptSpan.startChild("evaluator", { model: evaluatorModel, sprint, attempt: retry });
      try {
        const evalWithUsage = await withTransientRetry(
          () =>
            runEvaluator(
              config.workDir,
              contract,
              config.passThreshold,
              evaluatorModel,
              isGreenfield,
              logLevel,
              retry,
              evaluatorSpan,
            ),
          "evaluator",
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
      await writeFeedback(config.workDir, sprint, retry, lastEval);

      attemptSpan.end({ passed: lastEval.passed });

      if (lastEval.passed) {
        passed = true;
        if (shouldLog("quiet", logLevel)) {
          log("HARNESS", `Sprint ${sprint} PASSED on attempt ${attempts}`);
        }
        break;
      }

      if (retry < config.maxRetriesPerSprint) {
        if (shouldLog("normal", logLevel)) {
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

  const totalDuration = Date.now() - startTime;
  logDivider();
  log("HARNESS", `Harness ${allPassed ? "COMPLETED" : "FAILED"} in ${(totalDuration / 1000 / 60).toFixed(1)} minutes`);
  log("HARNESS", `Sprints: ${results.filter((r) => r.passed).length}/${results.length} passed`);

  // A1: Print and save usage summary
  usage.printSummary();
  try {
    await usage.save();
  } catch {
    // Non-critical — don't fail the run if usage save fails
  }

  return { success: allPassed, sprints: results, totalDurationMs: totalDuration };
}

// --- Error handling ---

export function isTransientError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  // HTTP 429 with short reset, 5xx, network errors
  if (lower.includes("429") && !lower.includes("quota") && !lower.includes("daily")) return true;
  if (/\b5\d{2}\b/.test(msg)) return true;
  if (lower.includes("timeout") || lower.includes("econnreset") || lower.includes("econnrefused")) return true;
  if (lower.includes("network") || lower.includes("socket hang up")) return true;
  return false;
}

async function withTransientRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  for (let attempt = 0; attempt <= TRANSIENT_RETRY_DELAYS.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt < TRANSIENT_RETRY_DELAYS.length && isTransientError(err)) {
        const delay = TRANSIENT_RETRY_DELAYS[attempt]!;
        log("HARNESS", `Transient error during ${label}, retrying in ${delay / 1000}s... (${err})`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw err; // Non-transient or exhausted retries
    }
  }
  throw new Error("Unreachable");
}

class HarnessFatalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HarnessFatalError";
  }
}

async function handleFatalError(
  err: unknown,
  config: HarnessConfig,
  progress: HarnessProgress,
  results: SprintResult[],
): Promise<never> {
  const msg = err instanceof Error ? err.message : String(err);
  logError("HARNESS", msg);

  // Save checkpoint before throwing
  progress.sprintResults = results.map(({ sprintNumber, passed, attempts, evalResult }) => ({
    sprintNumber,
    passed,
    attempts,
    evalResult,
  }));
  try {
    await writeProgress(config.workDir, progress);
    log("HARNESS", "Progress saved. Resume with: bun run claude-harness/index.ts --resume");
  } catch {
    logError("HARNESS", "Failed to save progress checkpoint");
  }

  throw new HarnessFatalError(msg);
}

// --- Pre-flight checks ---

async function checkDirtyTree(config: HarnessConfig): Promise<void> {
  let status: string;
  try {
    status = execSync("git status --porcelain", { cwd: config.workDir, encoding: "utf-8" }).trim();
  } catch {
    // Not a git repo — nothing to check
    return;
  }
  if (!status) return; // Clean tree

  const lines = status.split("\n");
  const modified = lines.filter((l) => l.startsWith(" M") || l.startsWith("M ") || l.startsWith("MM")).length;
  const untracked = lines.filter((l) => l.startsWith("??")).length;
  const other = lines.length - modified - untracked;

  let summary = "";
  if (modified > 0) summary += `${modified} modified file(s)`;
  if (untracked > 0) summary += `${summary ? ", " : ""}${untracked} untracked file(s)`;
  if (other > 0) summary += `${summary ? ", " : ""}${other} other change(s)`;

  const result = await promptGate(
    `Working tree is dirty:\n  - ${summary}\nGenerator will modify files and commit. Uncommitted changes may be mixed into its commits.`,
    [
      { key: "c", label: "Continue anyway", isDefault: true },
      { key: "s", label: "Stash changes first (git stash), then continue", isDefault: false },
      { key: "a", label: "Abort", isDefault: false },
    ],
    0, // No timeout — blocking pre-flight check
    config.interactive ?? true,
  );

  if (result.key === "a") {
    log("HARNESS", "Aborted by user.");
    process.exit(0);
  }
  if (result.key === "s") {
    execSync("git stash", { cwd: config.workDir, stdio: "pipe" });
    log("HARNESS", "Changes stashed. Recover with: git stash pop");
  }
}

// --- Spec approval gate (A3) ---

async function specApprovalGate(
  config: HarnessConfig,
  spec: string,
  plannerSpan: Span,
  usage: UsageTracker,
): Promise<string> {
  const specPath = join(harnessDir(config.workDir), "spec.md");

  // --gate-timeout 0 means "skip all gates, auto-approve"
  if (config.gateTimeout === 0) {
    log("HARNESS", "Spec gate skipped (--gate-timeout 0). Auto-approved.");
    return spec;
  }

  // Non-interactive: auto-approve
  if (!(config.interactive ?? true)) {
    log("HARNESS", "Spec gate skipped (non-interactive mode). Auto-approved.");
    return spec;
  }

  const timeoutSec = config.gateTimeout ?? 120;

  // Build options — hide Edit if no editor configured
  const options: import("../shared/interaction.ts").GateOption[] = [
    { key: "a", label: "Approve — proceed to building", isDefault: false },
    ...(config.editor ? [{ key: "e", label: `Edit — open in ${config.editor.split(" ")[0]}`, isDefault: false }] : []),
    { key: "r", label: "Revise — give feedback, planner rewrites", isDefault: false },
    { key: "x", label: "Abort", isDefault: true }, // Default on timeout = abort (safe)
    { key: "w", label: "Wait — pause timer", isDefault: false },
  ];

  let currentSpec = spec;

  while (true) {
    const result = await promptGateWithText(
      `Spec written to .adhd/spec.md`,
      options,
      timeoutSec,
      config.interactive ?? true,
      "r", // "revise" triggers free-text input
    );

    if (result.key === "a") {
      return currentSpec;
    }

    if (result.key === "x" || result.timedOut) {
      log("HARNESS", "Spec gate: aborted. Spec saved at .adhd/spec.md");
      log("HARNESS", "To resume: adhd --resume");
      process.exit(0);
    }

    if (result.key === "e" && config.editor) {
      // Open editor, block until closed
      execSync(`${config.editor} ${JSON.stringify(specPath)}`, { stdio: "inherit" });
      // Read back the (possibly modified) spec
      currentSpec = await readFileRaw(specPath, "utf-8");
      await writeSpec(config.workDir, currentSpec);
      log("HARNESS", `Spec updated (${currentSpec.length} chars). Re-reviewing.`);
      continue;
    }

    if (result.key === "r" && result.freeText) {
      // Re-run planner with feedback
      log("HARNESS", "Re-running planner with your feedback...");
      const revisedSpec = await runPlanner(config, plannerSpan, result.freeText, usage);
      currentSpec = revisedSpec;
      await writeSpec(config.workDir, currentSpec);
      log("HARNESS", "Spec revised. Re-reviewing.");
    }
  }
}

// --- Contract negotiation ---

async function negotiateContract(
  workDir: string,
  spec: string,
  sprintNumber: number,
  proposalModel: string,
  reviewModel: string,
  parentSpan?: Span,
  usage?: UsageTracker,
): Promise<SprintContract> {
  const startTime = new Date();

  // Generator proposes contract
  const proposalPrompt = `## Product Spec\n\n${spec}\n\n## Sprint Number: ${sprintNumber}\n\nPropose a sprint contract for this sprint.`;

  const proposalOptions: Options = {
    cwd: workDir,
    systemPrompt: CONTRACT_NEGOTIATION_GENERATOR_PROMPT,
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    tools: ["Read", "Glob"],
    model: proposalModel,
    maxTurns: 10,
    persistSession: false,
  };

  const convLog = createConversationLog(workDir, "contract-negotiation", sprintNumber, undefined, {
    model: proposalModel,
    startTime,
  });

  let proposalText = "";
  for await (const msg of query({ prompt: proposalPrompt, options: proposalOptions })) {
    if (msg.type === "assistant") {
      const message = msg as {
        message: { content: Array<{ type: string; text?: string; name?: string; input?: unknown }> };
      };
      for (const block of message.message.content) {
        if (block.type === "text" && block.text) {
          proposalText += block.text;
          convLog.logAssistantText(`**[Generator Proposal]**\n\n${block.text}`);
          parentSpan?.logMessage("assistant:generator", block.text);
        } else if (block.type === "tool_use" && block.name) {
          convLog.logToolUse(block.name, block.input);
          parentSpan?.logToolCall(block.name, block.input);
        }
      }
    } else if (msg.type === "system") {
      const sysMsg = msg as { message?: string; session_id?: string };
      logDebug("HARNESS", `Contract proposal system: ${sysMsg.message ?? sysMsg.session_id ?? "(no content)"}`);
    } else if (msg.type === "user") {
      const userMsg = msg as {
        message: { content: Array<{ type: string; tool_use_id?: string; content?: string }> };
      };
      for (const block of userMsg.message.content) {
        if (block.type === "tool_result" && block.tool_use_id) {
          logDebug("HARNESS", `Contract proposal tool result: ${summarize(block.content ?? "")}`);
          convLog.logToolResult(block.content ?? "");
          parentSpan?.logMessage("user:generator", `tool_result: ${summarize(block.content ?? "")}`);
        }
      }
    } else if (msg.type === "tool_use_summary") {
      const summary = msg as { summary?: string };
      convLog.logToolResult(summary.summary ?? "");
    } else if (msg.type === "result") {
      const result = msg as {
        total_cost_usd?: number;
        duration_ms?: number;
        usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number };
      };
      usage?.recordStage(`sprint-${sprintNumber}-contract-proposal`, result);
    }
  }

  // Evaluator reviews contract
  const reviewPrompt = `## Proposed Sprint Contract\n\n${proposalText}\n\nReview this contract.`;

  const reviewOptions: Options = {
    cwd: workDir,
    systemPrompt: CONTRACT_NEGOTIATION_EVALUATOR_PROMPT,
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    tools: ["Read", "Glob"],
    model: reviewModel,
    maxTurns: 10,
    persistSession: false,
  };

  let reviewText = "";
  for await (const msg of query({ prompt: reviewPrompt, options: reviewOptions })) {
    if (msg.type === "assistant") {
      const message = msg as {
        message: { content: Array<{ type: string; text?: string; name?: string; input?: unknown }> };
      };
      for (const block of message.message.content) {
        if (block.type === "text" && block.text) {
          reviewText += block.text;
          convLog.logAssistantText(`**[Evaluator Review]**\n\n${block.text}`);
          parentSpan?.logMessage("assistant:evaluator", block.text);
        } else if (block.type === "tool_use" && block.name) {
          convLog.logToolUse(block.name, block.input);
          parentSpan?.logToolCall(block.name, block.input);
        }
      }
    } else if (msg.type === "system") {
      const sysMsg = msg as { message?: string; session_id?: string };
      logDebug("HARNESS", `Contract review system: ${sysMsg.message ?? sysMsg.session_id ?? "(no content)"}`);
    } else if (msg.type === "user") {
      const userMsg = msg as {
        message: { content: Array<{ type: string; tool_use_id?: string; content?: string }> };
      };
      for (const block of userMsg.message.content) {
        if (block.type === "tool_result" && block.tool_use_id) {
          logDebug("HARNESS", `Contract review tool result: ${summarize(block.content ?? "")}`);
          convLog.logToolResult(block.content ?? "");
          parentSpan?.logMessage("user:evaluator", `tool_result: ${summarize(block.content ?? "")}`);
        }
      }
    } else if (msg.type === "tool_use_summary") {
      const summary = msg as { summary?: string };
      convLog.logToolResult(summary.summary ?? "");
    } else if (msg.type === "result") {
      const result = msg as {
        total_cost_usd?: number;
        duration_ms?: number;
        usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number };
      };
      usage?.recordStage(`sprint-${sprintNumber}-contract-review`, result);
    }
  }

  const duration = Date.now() - startTime.getTime();
  await convLog.finalize(duration);

  // Parse the final contract (either the proposal if approved, or the revised version)
  const contractSource = reviewText.trim() === "APPROVED" ? proposalText : reviewText;
  return parseContract(contractSource, sprintNumber);
}

/**
 * Extract the first balanced {...} block from text that contains the required key.
 * Uses bracket-depth counting to handle nested JSON correctly.
 */
export function extractBalancedJson(text: string, requiredKey: string): string | null {
  let start = -1;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (text[i] === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        const candidate = text.slice(start, i + 1);
        if (candidate.includes(`"${requiredKey}"`)) {
          return candidate;
        }
        start = -1;
      }
    }
  }
  return null;
}

export function parseContract(text: string, sprintNumber: number): SprintContract {
  // Try multiple extraction strategies
  const candidates: string[] = [];
  const codeBlocks = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)];
  for (const match of codeBlocks.reverse()) {
    if (match[1]) candidates.push(match[1].trim());
  }
  const balanced = extractBalancedJson(text, "criteria");
  if (balanced) candidates.push(balanced);
  candidates.push(text.trim());

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as SprintContract;
      if (parsed.criteria && Array.isArray(parsed.criteria)) {
        parsed.sprintNumber = sprintNumber;
        return parsed;
      }
    } catch {
      // Try next candidate
    }
  }

  logError("HARNESS", "Failed to parse contract JSON, creating default");
  return {
    sprintNumber,
    features: [`Sprint ${sprintNumber} features`],
    criteria: [
      {
        name: "basic_functionality",
        description: "Core features for this sprint are implemented and working",
        threshold: 7,
      },
      {
        name: "code_quality",
        description: "Code is clean, well-structured, and follows best practices",
        threshold: 7,
      },
      {
        name: "error_handling",
        description: "Errors are handled gracefully with appropriate user feedback",
        threshold: 7,
      },
    ],
  };
}
