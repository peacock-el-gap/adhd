import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { HarnessConfig, LogLevel, ResolvedConfig } from "./types.ts";

export const DEFAULT_CONFIG: Omit<HarnessConfig, "userPrompt" | "workDir"> = {
  maxSprints: 10,
  maxRetriesPerSprint: 3,
  passThreshold: 7,
};

export const CLAUDE_MODEL = "claude-opus-4-6";
export const CLAUDE_MAX_TURNS = 50;

// --- CLI Help Text ---

/** Human-readable descriptions for all CLI flags */
export const CLI_FLAG_HELP: Record<string, string> = {
  "--file, -f": "Path to a file containing the prompt",
  "--project": "Path to the project directory (default: cwd)",
  "--greenfield": "Create a new project in app/ with git init",
  "--resume": "Resume from the last checkpoint",
  "--model": "LLM model to use (default: claude-opus-4-6)",
  "--max-sprints": "Maximum number of sprints (default: 10)",
  "--max-retries": "Maximum retries per sprint (default: 3)",
  "--threshold": "Pass threshold score 1-10 (default: 7)",
  "--verbose": "Enable verbose logging",
  "--quiet": "Suppress non-essential output",
  "--no-interactive": "Disable interactive gates (auto-accept defaults)",
  "--debug": "Enable debug-level logging",
  "--editor": "Editor command for spec editing (e.g., 'code --wait')",
  "--gate-timeout": "Timeout in seconds for interactive gates (0 = skip all)",
  "--dry-run": "Run planner only, show spec, then exit",
  "--context": "Files to inject into the planner prompt (repeatable)",
  "--model-planner": "Model override for the Planner agent",
  "--model-generator": "Model override for the Generator agent",
  "--model-evaluator": "Model override for the Evaluator agent",
  "--model-documenter": "Model override for the Documenter agent",
  "--branch": "Create a git branch before the sprint loop",
  "--source-dir": "Source directory convention (default: src)",
  "--test-dir": "Test directory convention (default: tests)",
  "--no-bdd": "Disable BDD regression accumulation across sprints",
  "--no-tdd": "Disable TDD instructions in prompts",
  "--no-docs": "Skip post-run documentation generation",
  "--lint-gate": "Hard gate: lint/typecheck failure skips evaluator and counts as failed attempt",
  "--sprint N": "Run a specific sprint only (requires existing spec)",
  "--refine-spec": "Enable progressive spec refinement after passing sprints",
  "--notify": "Send desktop notifications at HITL gates and errors",
  "--commit-adhd": "Commit .adhd/ metadata (contracts, feedback, progress) after each sprint",
  "--commit-adhd-logs": "Commit .adhd/ metadata + logs after each sprint (implies --commit-adhd)",
};

/**
 * Print CLI usage/help text to stdout.
 * Lists all available flags with their descriptions.
 */
export function printHelp(): void {
  console.log("ADHD Harness — GAN-inspired adversarial coding tool\n");
  console.log("Usage: bun run harness-claude/index.ts [options] [prompt]\n");
  console.log("Options:\n");
  const maxKeyLen = Math.max(...Object.keys(CLI_FLAG_HELP).map((k) => k.length));
  for (const [flag, desc] of Object.entries(CLI_FLAG_HELP)) {
    console.log(`  ${flag.padEnd(maxKeyLen + 2)} ${desc}`);
  }
  console.log("");
}

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
  dryRun: boolean;
  context?: string[];
  modelPlanner?: string;
  modelGenerator?: string;
  modelEvaluator?: string;
  branch?: string;
  sourceDir?: string;
  testDir?: string;
  noBdd: boolean;
  noTdd: boolean;
  noDocs: boolean;
  modelDocumenter?: string;
  lintGate?: boolean;
  sprint?: number;
  refineSpec?: boolean;
  notify?: boolean;
  commitAdhd?: boolean;
  commitAdhdLogs?: boolean;
  help?: boolean;
}

/**
 * Parse CLI arguments into a structured ParsedCli object.
 * Handles all flags, options, and positional arguments for the ADHD harness.
 * @param argv - Array of CLI argument strings (defaults to process.argv.slice(2))
 * @returns Parsed CLI options and positional arguments
 */
export function parseCli(argv: string[] = process.argv.slice(2)): ParsedCli {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      help: { type: "boolean", default: false, short: "h" },
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
      "dry-run": { type: "boolean", default: false },
      context: { type: "string", multiple: true },
      "model-planner": { type: "string" },
      "model-generator": { type: "string" },
      "model-evaluator": { type: "string" },
      branch: { type: "string" },
      "source-dir": { type: "string" },
      "test-dir": { type: "string" },
      "no-bdd": { type: "boolean", default: false },
      "no-tdd": { type: "boolean", default: false },
      "no-docs": { type: "boolean", default: false },
      "model-documenter": { type: "string" },
      "lint-gate": { type: "boolean", default: false },
      sprint: { type: "string" },
      "refine-spec": { type: "boolean", default: false },
      notify: { type: "boolean", default: false },
      "commit-adhd": { type: "boolean", default: false },
      "commit-adhd-logs": { type: "boolean", default: false },
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
    dryRun: values["dry-run"] as boolean,
    context: values.context as string[] | undefined,
    modelPlanner: values["model-planner"] as string | undefined,
    modelGenerator: values["model-generator"] as string | undefined,
    modelEvaluator: values["model-evaluator"] as string | undefined,
    branch: values.branch as string | undefined,
    sourceDir: values["source-dir"] as string | undefined,
    testDir: values["test-dir"] as string | undefined,
    noBdd: values["no-bdd"] as boolean,
    noTdd: values["no-tdd"] as boolean,
    noDocs: values["no-docs"] as boolean,
    modelDocumenter: values["model-documenter"] as string | undefined,
    lintGate: values["lint-gate"] as boolean,
    sprint: values.sprint ? parseInt(values.sprint as string, 10) : undefined,
    refineSpec: values["refine-spec"] as boolean,
    notify: values.notify as boolean,
    commitAdhd: values["commit-adhd"] as boolean,
    commitAdhdLogs: values["commit-adhd-logs"] as boolean,
    help: values.help as boolean,
  };
}

/**
 * Load .adhd/.env from the project directory into process.env.
 * Only sets vars that aren't already set (preserving real env > .env precedence).
 * @param projectDir - The project root directory containing .adhd/.env
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
 * @param cli - Parsed CLI arguments from parseCli()
 * @returns Fully resolved and validated HarnessConfig
 */
export function resolveConfig(cli: ParsedCli): ResolvedConfig {
  // Resolve project directory
  const projectDir = cli.project ? resolve(cli.project) : process.cwd();

  // Sprint selection: mutual exclusion with --resume
  if (cli.sprint !== undefined && cli.resume) {
    throw new Error("Cannot use --sprint and --resume together.");
  }

  // Sprint selection: validate sprint number
  if (cli.sprint !== undefined) {
    if (!Number.isInteger(cli.sprint) || cli.sprint < 1) {
      throw new Error(`Invalid --sprint value: ${cli.sprint}. Must be a positive integer.`);
    }
  }

  // Resolve user prompt
  let userPrompt = "";
  if (cli.file) {
    userPrompt = readFileSync(resolve(cli.file), "utf-8");
  } else if (cli.prompt) {
    userPrompt = cli.prompt;
  }
  // --resume and --sprint don't require a prompt (they read spec from disk)
  if (!userPrompt && !cli.resume && cli.sprint === undefined) {
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

  const modelPlanner = cli.modelPlanner ?? process.env.MODEL_PLANNER ?? undefined;
  const modelGenerator = cli.modelGenerator ?? process.env.MODEL_GENERATOR ?? undefined;
  const modelEvaluator = cli.modelEvaluator ?? process.env.MODEL_EVALUATOR ?? undefined;
  const modelDocumenter = cli.modelDocumenter ?? process.env.MODEL_DOCUMENTER ?? undefined;

  const config: ResolvedConfig = {
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
    isDryRun: cli.dryRun || false,
    sourceDir: cli.sourceDir ?? process.env.SOURCE_DIR ?? "src",
    testDir: cli.testDir ?? process.env.TEST_DIR ?? "tests",
    noBdd: cli.noBdd || false,
    noTdd: cli.noTdd || false,
    noDocs: cli.noDocs || isTruthy(process.env.ADHD_NO_DOCS),
    lintGate: cli.lintGate || false,
    refineSpec: cli.refineSpec || false,
    // Per-agent resolved models
    resolvedModelPlanner: modelPlanner ?? model,
    resolvedModelGenerator: modelGenerator ?? model,
    resolvedModelEvaluator: modelEvaluator ?? model,
    resolvedModelDocumenter: modelDocumenter ?? model,
    // Genuinely optional
    tzDisplay,
    langfusePublicKey,
    langfuseSecretKey,
    langfuseBaseUrl,
    editor,
    gateTimeout,
    contextFiles: cli.context,
    modelPlanner,
    modelGenerator,
    modelEvaluator,
    modelDocumenter,
    branch: cli.branch,
    sprint: cli.sprint,
    notify: cli.notify || false,
    commitAdhd: cli.commitAdhd || cli.commitAdhdLogs || false,
    commitAdhdLogs: cli.commitAdhdLogs || false,
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

/**
 * Validate a HarnessConfig object, throwing on invalid values.
 * Checks that threshold, maxSprints, and maxRetries are within valid ranges.
 * @param config - The harness configuration to validate
 * @throws Error if any configuration value is out of range
 */
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
