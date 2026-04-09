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
  editor?: string;
  gateTimeout?: number;
  // Phase B additions
  dryRun: boolean;
  context?: string[];
  modelPlanner?: string;
  modelGenerator?: string;
  modelEvaluator?: string;
  // Phase C additions
  branch?: string;
  // WP2: directory conventions
  sourceDir?: string;
  testDir?: string;
  // WP1: BDD/TDD flags
  noBdd: boolean;
  noTdd: boolean;
  // OPP-13-A: Documenter agent
  noDocs: boolean;
  modelDocumenter?: string;
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
      editor: { type: "string" },
      "gate-timeout": { type: "string" },
      // Phase B
      "dry-run": { type: "boolean", default: false },
      context: { type: "string", multiple: true },
      "model-planner": { type: "string" },
      "model-generator": { type: "string" },
      "model-evaluator": { type: "string" },
      // Phase C
      branch: { type: "string" },
      // WP2: directory conventions
      "source-dir": { type: "string" },
      "test-dir": { type: "string" },
      // WP1: BDD/TDD flags
      "no-bdd": { type: "boolean", default: false },
      "no-tdd": { type: "boolean", default: false },
      // OPP-13-A: Documenter agent
      "no-docs": { type: "boolean", default: false },
      "model-documenter": { type: "string" },
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
    editor: values.editor as string | undefined,
    gateTimeout: values["gate-timeout"] ? parseInt(values["gate-timeout"] as string, 10) : undefined,
    // Phase B
    dryRun: values["dry-run"] as boolean,
    context: values.context as string[] | undefined,
    modelPlanner: values["model-planner"] as string | undefined,
    modelGenerator: values["model-generator"] as string | undefined,
    modelEvaluator: values["model-evaluator"] as string | undefined,
    // Phase C
    branch: values.branch as string | undefined,
    // WP2: directory conventions
    sourceDir: values["source-dir"] as string | undefined,
    testDir: values["test-dir"] as string | undefined,
    // WP1: BDD/TDD flags
    noBdd: values["no-bdd"] as boolean,
    noTdd: values["no-tdd"] as boolean,
    // OPP-13-A: Documenter agent
    noDocs: values["no-docs"] as boolean,
    modelDocumenter: values["model-documenter"] as string | undefined,
  };
}

/**
 * Load .adhd/.env from the project directory into process.env.
 * Only sets vars that aren't already set (preserving real env > .env precedence).
 */
export function loadHarnessEnv(projectDir: string): void {
  const envPath = join(projectDir, ".adhd", ".env");
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
 * Merge CLI flags, env vars, .adhd/.env defaults, and hardcoded defaults
 * into a fully resolved HarnessConfig.
 *
 * Precedence: CLI flag > env var > .adhd/.env > default
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

  // Resolve editor: CLI > ADHD_EDITOR > $EDITOR
  const editor = cli.editor ?? process.env.ADHD_EDITOR ?? process.env.EDITOR ?? undefined;

  // Resolve gate timeout
  const gateTimeout =
    cli.gateTimeout ?? (process.env.ADHD_GATE_TIMEOUT ? parseInt(process.env.ADHD_GATE_TIMEOUT, 10) : undefined);

  const harnessDir = join(projectDir, ".adhd");

  // Timezone display
  const tzDisplay = process.env.TZ_DISPLAY || undefined;

  // Langfuse config
  const langfusePublicKey = process.env.LANGFUSE_PUBLIC_KEY || undefined;
  const langfuseSecretKey = process.env.LANGFUSE_SECRET_KEY || undefined;
  const langfuseBaseUrl = process.env.LANGFUSE_BASE_URL || undefined;

  // Phase B: per-agent model overrides
  const modelPlanner = cli.modelPlanner ?? process.env.MODEL_PLANNER ?? undefined;
  const modelGenerator = cli.modelGenerator ?? process.env.MODEL_GENERATOR ?? undefined;
  const modelEvaluator = cli.modelEvaluator ?? process.env.MODEL_EVALUATOR ?? undefined;
  // OPP-13-A: Documenter model override
  const modelDocumenter = cli.modelDocumenter ?? process.env.MODEL_DOCUMENTER ?? undefined;

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
    editor,
    gateTimeout,
    // Phase B
    isDryRun: cli.dryRun || false,
    contextFiles: cli.context,
    modelPlanner,
    modelGenerator,
    modelEvaluator,
    // Phase C
    branch: cli.branch,
    // WP2: directory conventions
    sourceDir: cli.sourceDir ?? process.env.SOURCE_DIR ?? "src",
    testDir: cli.testDir ?? process.env.TEST_DIR ?? "tests",
    // WP1: BDD/TDD flags
    noBdd: cli.noBdd || false,
    noTdd: cli.noTdd || false,
    // OPP-13-A: Documenter agent
    noDocs: cli.noDocs || isTruthy(process.env.ADHD_NO_DOCS),
    modelDocumenter,
  };

  // Validate
  validateConfig(config);

  return config;
}

/** Check if a string env var is truthy (1, true, yes) */
function isTruthy(val: string | undefined): boolean {
  if (!val) return false;
  return ["1", "true", "yes"].includes(val.toLowerCase());
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
