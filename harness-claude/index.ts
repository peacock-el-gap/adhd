#!/usr/bin/env bun
import { resolve } from "node:path";
import { loadHarnessEnv, parseCli, printHelp, resolveConfig } from "../shared/config.ts";
import {
  fileTimestamp,
  log,
  logDebug,
  logDivider,
  logError,
  logWarn,
  setDisplayTimezone,
  setLogLevel,
} from "../shared/logger.ts";
import { notify } from "../shared/notifications.ts";
import { runHarness } from "../shared/orchestration/harness.ts";
import type { AgentRunners } from "../shared/orchestration/types.ts";
import { compareRuns, formatComparison } from "../shared/run-comparison.ts";
import { listRunStamps, readRunRecord } from "../shared/run-history.ts";
import { negotiateContract } from "./contract.ts";
import { ensureDocumenterCommit, runDocumenter } from "./documenter.ts";
import { runEvaluator } from "./evaluator.ts";
import { ensureGeneratorCommit, runGenerator } from "./generator.ts";
import { runPlanner } from "./planner.ts";
import { runReviewer } from "./reviewer.ts";
import { runScout } from "./scout.ts";
import { initTracing } from "./tracing-claude.ts";

// ---------------------------------------------------------------------------
// compare subcommand — handled before the normal run path
// ---------------------------------------------------------------------------

/**
 * Extract the project directory from raw CLI args without invoking parseCli.
 * Looks for --project <dir> and resolves it; falls back to cwd.
 */
function extractProjectDir(args: string[]): string {
  const idx = args.indexOf("--project");
  if (idx !== -1 && idx + 1 < args.length) {
    return resolve(args[idx + 1] as string);
  }
  return process.cwd();
}

/**
 * Extract non-flag positional arguments from a list (after the subcommand name).
 * Skips flags (--foo) and their values (the token immediately after a --flag=value-less flag).
 */
function extractPositionals(args: string[]): string[] {
  const positionals: string[] = [];
  let skipNext = false;
  for (const arg of args) {
    if (skipNext) {
      skipNext = false;
      continue;
    }
    if (arg.startsWith("--")) {
      // If it has no = sign, its value is the next token
      if (!arg.includes("=")) skipNext = true;
      continue;
    }
    positionals.push(arg);
  }
  return positionals;
}

const _cliArgs = process.argv.slice(2);
if (_cliArgs[0] === "compare") {
  const compareArgs = _cliArgs.slice(1);
  const projectDir = extractProjectDir(compareArgs);
  loadHarnessEnv(projectDir);

  const stamps = extractPositionals(compareArgs);

  if (stamps.length < 2) {
    // List available runs and exit
    const available = await listRunStamps(projectDir);
    if (stamps.length === 1) {
      logWarn("HARNESS", `Two run stamps required for comparison — got: "${stamps[0] as string}".`);
    } else {
      log("HARNESS", "Usage: adhd compare <run-a> <run-b>");
    }
    if (available.length === 0) {
      log("HARNESS", "No preserved runs found. Run the harness to generate run history.");
    } else {
      log("HARNESS", "Available runs (newest first):");
      for (const stamp of available) {
        log("HARNESS", `  ${stamp}`);
      }
    }
    process.exit(0);
  }

  const stampA = stamps[0] as string;
  const stampB = stamps[1] as string;
  const recordA = readRunRecord(projectDir, stampA);
  const recordB = readRunRecord(projectDir, stampB);

  let missingAny = false;
  if (!recordA) {
    logWarn("HARNESS", `Run "${stampA}" not found — showing partial comparison.`);
    missingAny = true;
  }
  if (!recordB) {
    logWarn("HARNESS", `Run "${stampB}" not found — showing partial comparison.`);
    missingAny = true;
  }

  const comparison = compareRuns(stampA, stampB, recordA, recordB);
  const report = formatComparison(comparison);

  logDivider();
  for (const line of report.split("\n")) {
    log("HARNESS", line);
  }
  logDivider();

  if (missingAny) {
    const available = await listRunStamps(projectDir);
    if (available.length > 0) {
      log("HARNESS", "Available runs (newest first):");
      for (const stamp of available) {
        log("HARNESS", `  ${stamp}`);
      }
    }
  }

  process.exit(0);
}

// ---------------------------------------------------------------------------
// Normal run path
// ---------------------------------------------------------------------------

let notifyEnabled = false;
try {
  const cli = parseCli();

  if (cli.help) {
    printHelp();
    process.exit(0);
  }

  // Resolve project dir early so we can load .adhd/.env
  const projectDir = cli.project ? (await import("node:path")).resolve(cli.project) : process.cwd();
  loadHarnessEnv(projectDir);

  const baseConfig = resolveConfig(cli);
  // Capture exactly one session-start stamp per run and thread it through config
  // so all agent conversation logs land in the same .adhd/logs/<sessionDir>/ folder.
  const sessionDir = fileTimestamp();
  const config = { ...baseConfig, sessionDir };
  notifyEnabled = config.notify;

  // Configure logger early so debug output works from here on
  setLogLevel(config.logLevel);
  if (config.tzDisplay) {
    setDisplayTimezone(config.tzDisplay);
  }

  logDebug("HARNESS", `CLI flags: ${JSON.stringify(cli)}`);
  logDebug("HARNESS", `Project dir: ${projectDir}`);
  logDebug("HARNESS", `ANTHROPIC_API_KEY set? ${!!process.env.ANTHROPIC_API_KEY}`);
  logDebug(
    "HARNESS",
    `Config: workDir=${config.workDir} prompt=${config.userPrompt.length} chars model=${config.model}`,
  );

  logDivider();
  log("HARNESS", "ADHD - Claude Agent SDK Harness");
  if (config.userPrompt) {
    log("HARNESS", `Prompt: "${config.userPrompt.slice(0, 120)}${config.userPrompt.length > 120 ? "..." : ""}"`);
  }
  log("HARNESS", `Mode: ${config.isGreenfield ? "greenfield" : "existing project"} | Project: ${config.workDir}`);
  if (config.isResume) {
    log("HARNESS", "Resuming from checkpoint");
  }
  logDivider();

  // Construct AgentRunners — wires Claude-specific implementations into the shared orchestration
  const agents: AgentRunners = {
    initTracing,
    runPlanner,
    runGenerator,
    runEvaluator,
    runDocumenter,
    negotiateContract,
    ensureGeneratorCommit,
    ensureDocumenterCommit,
    runScout,
    runReviewer,
  };

  logDebug("HARNESS", "Calling runHarness...");
  const result = await runHarness(config, agents);

  logDivider();
  if (result.success) {
    log("HARNESS", "All sprints completed successfully!");
  } else {
    logError("HARNESS", "Harness completed with failures.");
  }

  log("HARNESS", `Total time: ${(result.totalDurationMs / 1000 / 60).toFixed(1)} minutes`);
  log("HARNESS", `Sprints passed: ${result.sprints.filter((s) => s.passed).length}/${result.sprints.length}`);

  for (const sprint of result.sprints) {
    const status = sprint.passed ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m";
    log("HARNESS", `  Sprint ${sprint.sprintNumber}: [${status}] (${sprint.attempts} attempts)`);
  }

  process.exit(result.success ? 0 : 1);
} catch (error) {
  if (error instanceof Error && error.name === "UserAbortError") {
    // User chose to abort at a gate — clean exit, not an error
    process.exit(0);
  }
  const fatalMsg = error instanceof Error ? error.message : String(error);
  logError("HARNESS", `Fatal error: ${fatalMsg}`);
  notify(`Fatal error: ${fatalMsg.slice(0, 100)}`, { notify: notifyEnabled });
  // Exit code 2 for infrastructure errors (distinguishes from test failure = 1)
  process.exit(error instanceof Error && error.name === "HarnessFatalError" ? 2 : 1);
}
