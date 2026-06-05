import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  blankToUndefined,
  DEFAULT_MODEL,
  DEFAULT_MODEL_DOCUMENTER,
  DEFAULT_MODEL_EVALUATOR,
  DEFAULT_MODEL_GENERATOR,
  DEFAULT_MODEL_PLANNER,
  resolveAgentModel,
} from "./models.ts";
import type { HarnessConfig, LogLevel, ResolvedConfig } from "./types.ts";

export const DEFAULT_CONFIG: Omit<HarnessConfig, "userPrompt" | "workDir"> = {
  maxSprints: 10,
  maxRetriesPerSprint: 3,
  passThreshold: 7,
  maxFeatures: 3,
  maxCriteria: 10,
  maxSurfaces: 2,
};

export const CLAUDE_MAX_TURNS = 50;

// --- CLI Help Text ---

/** Human-readable descriptions for all CLI flags */
export const CLI_FLAG_HELP: Record<string, string> = {
  "--file, -f": "Path to a file containing the prompt",
  "--project": "Path to the project directory (default: cwd)",
  "--greenfield": "Create a new project in app/ with git init",
  "--resume": "Resume from the last checkpoint",
  "--model": "Uniform model for all four agents (env: CLAUDE_MODEL); overrides the per-agent matrix below",
  "--max-sprints": "Maximum number of sprints (default: 10)",
  "--max-retries": "Maximum retries per sprint (default: 3)",
  "--threshold": "Pass threshold score 1-10 (default: 7)",
  "--max-features": "Maximum features per sprint contract (default: 3)",
  "--max-criteria": "Maximum criteria per sprint contract (default: 10)",
  "--max-surfaces": "Maximum surfaces per sprint contract (default: 2)",
  "--verbose": "Enable verbose logging",
  "--quiet": "Suppress non-essential output",
  "--no-interactive": "Disable interactive gates (auto-accept defaults)",
  "--debug": "Enable debug-level logging",
  "--editor": "Editor command for spec editing (e.g., 'code --wait')",
  "--gate-timeout": "Timeout in seconds for interactive gates (0 = skip all)",
  "--dry-run": "Run planner only, show spec, then exit",
  "--context": "Files to inject into the planner prompt (repeatable)",
  "--model-planner": "Model override for the Planner agent (default tier: Opus)",
  "--model-generator": "Model override for the Generator agent (default tier: Sonnet)",
  "--model-evaluator": "Model override for the Evaluator agent (default tier: Opus)",
  "--model-documenter": "Model override for the Documenter agent (default tier: Haiku)",
  "--model-contract":
    "Single model for all contract-negotiation calls — proposal, review, and narrowing (env: MODEL_CONTRACT)",
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
  "--allow-main":
    "Allow running on the default branch (main/master); by default the harness refuses, since it commits to the checked-out branch",
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
  console.log("Per-agent model defaults (used when neither --model nor a per-agent flag is set):");
  console.log(`  Planner     ${DEFAULT_MODEL_PLANNER}    (Opus tier — runs once; its spec drives everything)`);
  console.log(`  Generator   ${DEFAULT_MODEL_GENERATOR}    (Sonnet tier — cost-dominant; mistakes are recoverable)`);
  console.log(`  Evaluator   ${DEFAULT_MODEL_EVALUATOR}    (Opus tier — the sole gate; must out-judge the Generator)`);
  console.log(`  Documenter  ${DEFAULT_MODEL_DOCUMENTER}    (Haiku tier — lowest stakes; advisory output)`);
  console.log("");
  console.log("Invariant: keep the Evaluator tier at or above the Generator tier — the judge must");
  console.log("never be weaker than the producer. A weaker Evaluator only triggers a warning, not a stop.");
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
  maxFeatures?: number;
  maxCriteria?: number;
  maxSurfaces?: number;
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
  modelContract?: string;
  lintGate?: boolean;
  sprint?: number;
  refineSpec?: boolean;
  notify?: boolean;
  commitAdhd?: boolean;
  commitAdhdLogs?: boolean;
  allowMain?: boolean;
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
      "max-features": { type: "string" },
      "max-criteria": { type: "string" },
      "max-surfaces": { type: "string" },
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
      "model-contract": { type: "string" },
      "lint-gate": { type: "boolean", default: false },
      sprint: { type: "string" },
      "refine-spec": { type: "boolean", default: false },
      notify: { type: "boolean", default: false },
      "commit-adhd": { type: "boolean", default: false },
      "commit-adhd-logs": { type: "boolean", default: false },
      "allow-main": { type: "boolean", default: false },
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
    maxFeatures: values["max-features"] ? parseInt(values["max-features"] as string, 10) : undefined,
    maxCriteria: values["max-criteria"] ? parseInt(values["max-criteria"] as string, 10) : undefined,
    maxSurfaces: values["max-surfaces"] ? parseInt(values["max-surfaces"] as string, 10) : undefined,
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
    modelContract: values["model-contract"] as string | undefined,
    lintGate: values["lint-gate"] as boolean,
    sprint: values.sprint ? parseInt(values.sprint as string, 10) : undefined,
    refineSpec: values["refine-spec"] as boolean,
    notify: values.notify as boolean,
    commitAdhd: values["commit-adhd"] as boolean,
    commitAdhdLogs: values["commit-adhd-logs"] as boolean,
    allowMain: values["allow-main"] as boolean,
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

  // Resolve the uniform model. We must distinguish "the user explicitly set a
  // uniform model" (which should apply to all agents, preserving old behavior)
  // from "nothing was set" (which lets the per-agent matrix apply). A blank
  // value counts as unset so odd input never produces an empty model string.
  const userUniformModel = blankToUndefined(cli.model ?? process.env.CLAUDE_MODEL);
  // `model` stays a concrete string for run-level metadata/logging; it falls
  // back to the base default tier when the user supplied no uniform model.
  const model = userUniformModel ?? DEFAULT_MODEL;

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

  const maxFeatures =
    cli.maxFeatures ??
    (process.env.MAX_FEATURES ? parseInt(process.env.MAX_FEATURES, 10) : undefined) ??
    DEFAULT_CONFIG.maxFeatures;

  const maxCriteria =
    cli.maxCriteria ??
    (process.env.MAX_CRITERIA ? parseInt(process.env.MAX_CRITERIA, 10) : undefined) ??
    DEFAULT_CONFIG.maxCriteria;

  const maxSurfaces =
    cli.maxSurfaces ??
    (process.env.MAX_SURFACES ? parseInt(process.env.MAX_SURFACES, 10) : undefined) ??
    DEFAULT_CONFIG.maxSurfaces;

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

  // Per-agent overrides: CLI flag > env var. Blank values degrade to undefined
  // so they fall through to the uniform model / matrix default cleanly.
  const modelPlanner = blankToUndefined(cli.modelPlanner ?? process.env.MODEL_PLANNER);
  const modelGenerator = blankToUndefined(cli.modelGenerator ?? process.env.MODEL_GENERATOR);
  const modelEvaluator = blankToUndefined(cli.modelEvaluator ?? process.env.MODEL_EVALUATOR);
  const modelDocumenter = blankToUndefined(cli.modelDocumenter ?? process.env.MODEL_DOCUMENTER);
  // Optional single model for the whole contract negotiation (proposal, review,
  // narrowing). When unset, negotiation keeps the inherited Generator/Evaluator split.
  const modelContract = blankToUndefined(cli.modelContract ?? process.env.MODEL_CONTRACT);

  const config: ResolvedConfig = {
    userPrompt,
    workDir: projectDir,
    maxSprints,
    maxRetriesPerSprint,
    passThreshold,
    maxFeatures,
    maxCriteria,
    maxSurfaces,
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
    // Per-agent resolved models. Precedence per agent:
    //   explicit per-agent override > explicit uniform model > per-agent tier default.
    // The matrix only applies when the user set neither an override nor --model.
    resolvedModelPlanner: resolveAgentModel(modelPlanner, userUniformModel, DEFAULT_MODEL_PLANNER),
    resolvedModelGenerator: resolveAgentModel(modelGenerator, userUniformModel, DEFAULT_MODEL_GENERATOR),
    resolvedModelEvaluator: resolveAgentModel(modelEvaluator, userUniformModel, DEFAULT_MODEL_EVALUATOR),
    resolvedModelDocumenter: resolveAgentModel(modelDocumenter, userUniformModel, DEFAULT_MODEL_DOCUMENTER),
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
    modelContract,
    branch: cli.branch,
    sprint: cli.sprint,
    notify: cli.notify || false,
    commitAdhd: cli.commitAdhd || cli.commitAdhdLogs || false,
    commitAdhdLogs: cli.commitAdhdLogs || false,
    allowMain: cli.allowMain || false,
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
  if (!Number.isInteger(config.maxFeatures) || config.maxFeatures < 1) {
    throw new Error(`Invalid max-features: ${config.maxFeatures}. Must be an integer >= 1.`);
  }
  if (!Number.isInteger(config.maxCriteria) || config.maxCriteria < 1) {
    throw new Error(`Invalid max-criteria: ${config.maxCriteria}. Must be an integer >= 1.`);
  }
  if (!Number.isInteger(config.maxSurfaces) || config.maxSurfaces < 1) {
    throw new Error(`Invalid max-surfaces: ${config.maxSurfaces}. Must be an integer >= 1.`);
  }
}
