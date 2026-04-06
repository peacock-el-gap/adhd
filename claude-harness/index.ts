import { parseCli, loadHarnessEnv, resolveConfig } from "../shared/config.ts";
import { log, logError, logDivider, setDisplayTimezone } from "../shared/logger.ts";
import { runHarness } from "./harness.ts";

try {
  const cli = parseCli();

  // Resolve project dir early so we can load .harness/.env
  const projectDir = cli.project ? (await import("path")).resolve(cli.project) : process.cwd();
  loadHarnessEnv(projectDir);

  const config = resolveConfig(cli);

  // Configure timezone for terminal display
  if (config.tzDisplay) {
    setDisplayTimezone(config.tzDisplay);
  }

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
