#!/usr/bin/env bun
import { loadHarnessEnv, parseCli, resolveConfig } from "../shared/config.ts";
import { log, logDebug, logDivider, logError, setDisplayTimezone, setLogLevel } from "../shared/logger.ts";
import { runHarness } from "./harness.ts";

try {
  const cli = parseCli();

  // Resolve project dir early so we can load .harness/.env
  const projectDir = cli.project ? (await import("node:path")).resolve(cli.project) : process.cwd();
  loadHarnessEnv(projectDir);

  const config = resolveConfig(cli);

  // Configure logger early so debug output works from here on
  setLogLevel(config.logLevel ?? "normal");
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

  logDebug("HARNESS", "Calling runHarness...");
  const result = await runHarness(config);

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
  logError("HARNESS", `Fatal error: ${error instanceof Error ? error.message : String(error)}`);
  // Exit code 2 for infrastructure errors (distinguishes from test failure = 1)
  process.exit(error instanceof Error && error.name === "HarnessFatalError" ? 2 : 1);
}
