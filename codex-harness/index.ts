import { readFile } from "fs/promises";
import { resolve } from "path";
import { DEFAULT_CONFIG } from "../shared/config.ts";
import { log, logDivider, logError } from "../shared/logger.ts";
import type { HarnessConfig } from "../shared/types.ts";
import { runHarness } from "./harness.ts";

let userPrompt: string | undefined;

const arg = process.argv[2];
if (arg === "--file" || arg === "-f") {
  const filePath = process.argv[3];
  if (!filePath) {
    console.error("Error: --file requires a path argument");
    process.exit(1);
  }
  userPrompt = await readFile(resolve(filePath), "utf-8");
} else {
  userPrompt = arg;
}

if (!userPrompt) {
  console.error("Usage: bun run codex-harness/index.ts <prompt>");
  console.error("       bun run codex-harness/index.ts --file <path-to-prompt.md>");
  console.error('Example: bun run codex-harness/index.ts "Build a task manager with REST API and dashboard"');
  process.exit(1);
}

const config: HarnessConfig = {
  ...DEFAULT_CONFIG,
  userPrompt,
  workDir: resolve("workspace/codex"),
};

logDivider();
log("HARNESS", "ADHD - Codex SDK Harness");
log("HARNESS", `Prompt: "${userPrompt}"`);
logDivider();

try {
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
  process.exit(1);
}
