import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { HarnessConfig, LogLevel } from "./types.ts";

// --- Backward-compatible exports for codex-harness ---

export const DEFAULT_CONFIG: Omit<HarnessConfig, "userPrompt" | "workDir"> = {
  maxSprints: 10,
  maxRetriesPerSprint: 3,
  passThreshold: 7,
};

export const CLAUDE_MODEL = "claude-opus-4-6";
export const CODEX_MODEL = "gpt-5.4";

export const CLAUDE_MAX_TURNS = 50;
export const CODEX_NETWORK_ACCESS = true;

// --- Phase 1: Configuration system ---

interface ParsedCli {
  prompt?: string;
  file?: string;
  project?: string;
  greenfield: boolean;
  resume: boolean;
  model?: string;
  maxSprints?: number;
  maxRetries?: number;
  threshold?: number;
  verbose: boolean;
  quiet: boolean;
  noInteractive: boolean;
  debug: boolean;
}

export function parseCli(argv: string[] = process.argv.slice(2)): ParsedCli {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      file: { type: "string", short: "f" },
      project: { type: "string" },
      greenfield: { type: "boolean", default: false },
      resume: { type: "boolean", default: false },
      model: { type: "string" },
      "max-sprints": { type: "string" },
      "max-retries": { type: "string" },
      threshold: { type: "string" },
      verbose: { type: "boolean", default: false },
      quiet: { type: "boolean", default: false },
      "no-interactive": { type: "boolean", default: false },
      debug: { type: "boolean", default: false },
    },
    allowPositionals: true,
    strict: true,
  });

  return {
    prompt: positionals[0],
    file: values.file as string | undefined,
    project: values.project as string | undefined,
    greenfield: values.greenfield as boolean,
    resume: values.resume as boolean,
    model: values.model as string | undefined,
    maxSprints: values["max-sprints"] ? parseInt(values["max-sprints"] as string, 10) : undefined,
    maxRetries: values["max-retries"] ? parseInt(values["max-retries"] as string, 10) : undefined,
    threshold: values.threshold ? parseInt(values.threshold as string, 10) : undefined,
    verbose: values.verbose as boolean,
    quiet: values.quiet as boolean,
    noInteractive: values["no-interactive"] as boolean,
    debug: values.debug as boolean,
  };
}

/**
 * Load .harness/.env from the project directory into process.env.
 * Only sets vars that aren't already set (preserving real env > .env precedence).
 */
export function loadHarnessEnv(projectDir: string): void {
  const envPath = join(projectDir, ".harness", ".env");
  if (!existsSync(envPath)) return;

  const content = readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    // Strip surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    // Only set if not already in env (env > .env file)
    if (process.env[key] === undefined) {
      process.env[key] = val;
    }
  }
}

/**
 * Merge CLI flags, env vars, .harness/.env defaults, and hardcoded defaults
 * into a fully resolved HarnessConfig.
 *
 * Precedence: CLI flag > env var > .harness/.env > default
 * (loadHarnessEnv must be called before this to populate process.env from .env file)
 */
export function resolveConfig(cli: ParsedCli): HarnessConfig {
  // Resolve project directory
  const projectDir = cli.project ? resolve(cli.project) : process.cwd();

  // Resolve user prompt
  let userPrompt = "";
  if (cli.file) {
    userPrompt = readFileSync(resolve(cli.file), "utf-8");
  } else if (cli.prompt) {
    userPrompt = cli.prompt;
  }
  // --resume doesn't require a prompt (it reads spec from disk)
  if (!userPrompt && !cli.resume) {
    throw new Error("A prompt is required. Provide one as a positional argument, with --file, or use --resume.");
  }

  // Resolve individual settings: CLI > env > default
  const model = cli.model ?? process.env.CLAUDE_MODEL ?? CLAUDE_MODEL;

  const maxSprints =
    cli.maxSprints ??
    (process.env.MAX_SPRINTS ? parseInt(process.env.MAX_SPRINTS, 10) : undefined) ??
    DEFAULT_CONFIG.maxSprints;

  const maxRetriesPerSprint =
    cli.maxRetries ??
    (process.env.MAX_RETRIES ? parseInt(process.env.MAX_RETRIES, 10) : undefined) ??
    DEFAULT_CONFIG.maxRetriesPerSprint;

  const passThreshold =
    cli.threshold ??
    (process.env.PASS_THRESHOLD ? parseInt(process.env.PASS_THRESHOLD, 10) : undefined) ??
    DEFAULT_CONFIG.passThreshold;

  // Determine log level
  let logLevel: LogLevel = "normal";
  if (cli.debug) logLevel = "debug";
  else if (cli.verbose) logLevel = "verbose";
  else if (cli.quiet) logLevel = "quiet";
  else if (process.env.LOG_LEVEL) {
    const envLevel = process.env.LOG_LEVEL.toLowerCase();
    if (envLevel === "quiet" || envLevel === "verbose" || envLevel === "normal" || envLevel === "debug") {
      logLevel = envLevel;
    }
  }

  const harnessDir = join(projectDir, ".harness");

  // Timezone display
  const tzDisplay = process.env.TZ_DISPLAY || undefined;

  // Langfuse config
  const langfusePublicKey = process.env.LANGFUSE_PUBLIC_KEY || undefined;
  const langfuseSecretKey = process.env.LANGFUSE_SECRET_KEY || undefined;
  const langfuseBaseUrl = process.env.LANGFUSE_BASEURL || undefined;

  const config: HarnessConfig = {
    userPrompt,
    workDir: projectDir,
    maxSprints,
    maxRetriesPerSprint,
    passThreshold,
    model,
    isGreenfield: cli.greenfield,
    isResume: cli.resume,
    logLevel,
    interactive: !cli.noInteractive,
    harnessDir,
    tzDisplay,
    langfusePublicKey,
    langfuseSecretKey,
    langfuseBaseUrl,
  };

  // Validate
  validateConfig(config);

  return config;
}

export function validateConfig(config: HarnessConfig): void {
  if (config.passThreshold < 1 || config.passThreshold > 10) {
    throw new Error(`Invalid threshold: ${config.passThreshold}. Must be between 1 and 10.`);
  }
  if (config.maxSprints < 1) {
    throw new Error(`Invalid max-sprints: ${config.maxSprints}. Must be greater than 0.`);
  }
  if (config.maxRetriesPerSprint < 0) {
    throw new Error(`Invalid max-retries: ${config.maxRetriesPerSprint}. Must be >= 0.`);
  }
}
