#!/usr/bin/env bun
import { loadHarnessEnv, parseCli, printHelp, resolveConfig } from "../shared/config.ts";
import { log, logDebug, logDivider, logError, setDisplayTimezone, setLogLevel } from "../shared/logger.ts";
import { notify } from "../shared/notifications.ts";
import { runHarness } from "../shared/orchestration/harness.ts";
import type { AgentRunners } from "../shared/orchestration/types.ts";
import { negotiateContract } from "./contract.ts";
import { runDocumenter } from "./documenter.ts";
import { runEvaluator } from "./evaluator.ts";
import { ensureGeneratorCommit, runGenerator } from "./generator.ts";
import { runPlanner } from "./planner.ts";
import { initTracing } from "./tracing-claude.ts";

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

  const config = resolveConfig(cli);
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
