import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { logWarn } from "./logger.ts";
import {
  blankToUndefined,
  DEFAULT_MODEL,
  DEFAULT_MODEL_DOCUMENTER,
  DEFAULT_MODEL_EVALUATOR,
  DEFAULT_MODEL_GENERATOR,
  DEFAULT_MODEL_PLANNER,
  DEFAULT_MODEL_REVIEWER,
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

/** @deprecated Use the per-agent defaults (DEFAULT_MAX_TURNS_*) and resolvedMaxTurns* fields. */
export const CLAUDE_MAX_TURNS = 50;

// Per-agent turn cap defaults — all set to 50 to preserve the prior single-ceiling behavior.
/** Default turn cap for the Planner agent. */
export const DEFAULT_MAX_TURNS_PLANNER = 50;
/** Default turn cap for the Generator agent. Must stay 50 to preserve prior behavior. */
export const DEFAULT_MAX_TURNS_GENERATOR = 50;
/** Default turn cap for the Evaluator agent. */
export const DEFAULT_MAX_TURNS_EVALUATOR = 50;
/** Default turn cap for the Documenter agent. */
export const DEFAULT_MAX_TURNS_DOCUMENTER = 50;

/**
 * Resolve a per-agent turn cap from a raw value (CLI number or env-var string),
 * degrading gracefully to `defaultCap` when the value is absent or invalid.
 * A valid cap is a finite integer ≥ 1. Never throws — invalid values degrade to
 * the default and emit a one-line warning naming the flag/env var and fallback,
 * mirroring the safeCap style in shared/contract-limits.ts.
 *
 * @param raw       Raw value from CLI (number) or env var (string).
 * @param defaultCap Fallback when raw is absent or invalid.
 * @param flagLabel Human-readable identifier for the source, e.g.
 *                  "--generator-max-turns / GENERATOR_MAX_TURNS". When
 *                  provided, an invalid value emits a console warning.
 */
export function resolveAgentCap(raw: number | string | undefined, defaultCap: number, flagLabel?: string): number {
  if (raw === undefined) return defaultCap;
  const n = typeof raw === "string" ? parseInt(raw, 10) : raw;
  if (!Number.isInteger(n) || n < 1) {
    if (flagLabel !== undefined) {
      console.warn(
        `[HARNESS] ${flagLabel}: "${String(raw)}" is not a valid turn cap (must be a positive integer); using default ${defaultCap}`,
      );
    }
    return defaultCap;
  }
  return n;
}

// --- CLI Help Text ---

/** Human-readable descriptions for all CLI flags */
export const CLI_FLAG_HELP: Record<string, string> = {
  "--file, -f": "Path to a file containing the prompt",
  "--project": "Path to the project directory (default: cwd)",
  "--greenfield": "Create a new project in app/ with git init",
  "--resume": "Resume from the last checkpoint",
  "--model": "Uniform model for all four agents (env: CLAUDE_MODEL); overrides the per-agent matrix below",
  "--max-sprints": "Maximum number of sprints (default: 10; env: MAX_SPRINTS)",
  "--max-retries": "Maximum retries per sprint (default: 3; env: MAX_RETRIES)",
  "--threshold": "Pass threshold score 1-10 (default: 7; env: PASS_THRESHOLD)",
  "--max-features": "Maximum features per sprint contract (default: 3; env: MAX_FEATURES)",
  "--max-criteria": "Maximum criteria per sprint contract (default: 10; env: MAX_CRITERIA)",
  "--max-surfaces": "Maximum surfaces per sprint contract (default: 2; env: MAX_SURFACES)",
  "--verbose": "Enable verbose logging (env: LOG_LEVEL=verbose)",
  "--quiet": "Suppress non-essential output (env: LOG_LEVEL=quiet)",
  "--no-interactive": "Disable interactive gates (auto-accept defaults)",
  "--debug": "Enable debug-level logging (env: LOG_LEVEL=debug)",
  "--editor": "Editor command for spec editing, e.g. 'code --wait' (env: ADHD_EDITOR; fallback: $EDITOR)",
  "--gate-timeout": "Timeout in seconds for interactive gates (0 = skip all; env: ADHD_GATE_TIMEOUT)",
  "--dry-run": "Run planner only, show spec, then exit",
  "--context": "Files to inject into the planner prompt (repeatable)",
  "--model-planner": "Model override for the Planner agent (default tier: Opus; env: MODEL_PLANNER)",
  "--model-generator": "Model override for the Generator agent (default tier: Sonnet; env: MODEL_GENERATOR)",
  "--model-evaluator": "Model override for the Evaluator agent (default tier: Opus; env: MODEL_EVALUATOR)",
  "--model-documenter": "Model override for the Documenter agent (default tier: Haiku; env: MODEL_DOCUMENTER)",
  "--model-reviewer": "Model override for the Reviewer agent (default tier: Opus; env: MODEL_REVIEWER)",
  "--model-contract":
    "Single model for all contract-negotiation calls — proposal, review, and narrowing (env: MODEL_CONTRACT)",
  "--branch": "Create a git branch before the sprint loop",
  "--source-dir": "Source directory convention (default: src; env: SOURCE_DIR)",
  "--test-dir": "Test directory convention (default: tests; env: TEST_DIR)",
  "--no-bdd": "Disable BDD regression accumulation across sprints",
  "--no-tdd": "Disable TDD instructions in prompts",
  "--no-docs": "Skip post-run documentation generation (env: ADHD_NO_DOCS)",
  "--lint-gate": "Hard gate: lint/typecheck failure skips evaluator and counts as failed attempt",
  "--test-gate":
    "Hard gate: newly-introduced test failures skip evaluator and count as failed attempt (env: TEST_GATE)",
  "--sprint N": "Run a specific sprint only (requires existing spec)",
  "--refine-spec": "Enable progressive spec refinement after passing sprints",
  "--notify": "Send desktop notifications at HITL gates and errors",
  "--commit-adhd": "Commit .adhd/ metadata (contracts, feedback, progress) after each sprint",
  "--commit-adhd-logs": "Commit .adhd/ metadata + logs after each sprint (implies --commit-adhd)",
  "--allow-main":
    "Skip auto-branching and run on the current branch (whatever it is). By default the harness creates a topic branch before the sprint loop so commits never land on main.",
  "--planner-max-turns":
    "Maximum turns for the Planner agent (env: PLANNER_MAX_TURNS; default: 50); invalid values degrade to default",
  "--generator-max-turns":
    "Maximum turns for the Generator agent (env: GENERATOR_MAX_TURNS; default: 50); invalid values degrade to default",
  "--evaluator-max-turns":
    "Maximum turns for the Evaluator agent (env: EVALUATOR_MAX_TURNS; default: 50); invalid values degrade to default",
  "--documenter-max-turns":
    "Maximum turns for the Documenter agent (env: DOCUMENTER_MAX_TURNS; default: 50); invalid values degrade to default",
  "--disable-mcp":
    "Disable MCP servers for all agents, including coding agents (env: DISABLE_MCP). Non-coding agents already receive no MCP by default.",
  "--mcp-servers":
    'JSON object of MCP server configs to inject into coding agents, e.g. \'{"my-server":{"command":"node","args":["server.js"]}}\' (env: MCP_SERVERS). Ignored when --disable-mcp is set.',
  "--sprint-token-budget":
    "Optional per-sprint token ceiling (input+output tokens). Soft warn at 80%; pause (interactive) or log (non-interactive) at 100% (env: SPRINT_TOKEN_BUDGET). Inert when not set.",
  "--scout":
    "Run a read-only Scout pass before the sprint loop to surface codebase conventions for the Generator. Skipped in greenfield mode (env: ADHD_SCOUT).",
  "--review":
    "Run a read-only Reviewer agent after each passing sprint to produce a code-craft report. Advisory only — does not affect pass/fail (env: ADHD_REVIEW).",
};

/**
 * Print CLI usage/help text to stdout.
 * Lists all available flags with their descriptions.
 */
export function printHelp(): void {
  console.log("ADHD Harness — GAN-inspired adversarial coding tool\n");
  console.log("Usage: adhd [options] [prompt]");
  console.log("       adhd --file <spec.md>");
  console.log("       adhd compare <run-a> <run-b>  # compare two preserved run records\n");
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
  console.log(
    `  Reviewer    ${DEFAULT_MODEL_REVIEWER}    (Opus tier — advisory code-craft review; enable with --review)`,
  );
  console.log("");
  console.log("Invariant: keep the Evaluator tier at or above the Generator tier — the judge must");
  console.log("never be weaker than the producer. A weaker Evaluator only triggers a warning, not a stop.");
  console.log("");
  console.log("Environment-variable-only settings (no corresponding flag):");
  console.log(
    "  LOG_LEVEL          Log level when no --verbose/--quiet/--debug flag is set (quiet|normal|verbose|debug; default: normal)",
  );
  console.log("  TZ_DISPLAY         IANA timezone name for terminal timestamps (e.g. America/New_York)");
  console.log("  LANGFUSE_PUBLIC_KEY  Langfuse tracing public key");
  console.log("  LANGFUSE_SECRET_KEY  Langfuse tracing secret key");
  console.log("  LANGFUSE_BASE_URL    Langfuse tracing base URL");
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
  modelReviewer?: string;
  modelContract?: string;
  lintGate?: boolean;
  testGate?: boolean;
  sprint?: number;
  refineSpec?: boolean;
  notify?: boolean;
  commitAdhd?: boolean;
  commitAdhdLogs?: boolean;
  allowMain?: boolean;
  plannerMaxTurns?: number;
  generatorMaxTurns?: number;
  evaluatorMaxTurns?: number;
  documenterMaxTurns?: number;
  disableMcp?: boolean;
  mcpServers?: string;
  sprintTokenBudget?: number;
  useScout?: boolean;
  useReview?: boolean;
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
      "model-reviewer": { type: "string" },
      "model-contract": { type: "string" },
      "lint-gate": { type: "boolean", default: false },
      "test-gate": { type: "boolean", default: false },
      sprint: { type: "string" },
      "refine-spec": { type: "boolean", default: false },
      notify: { type: "boolean", default: false },
      "commit-adhd": { type: "boolean", default: false },
      "commit-adhd-logs": { type: "boolean", default: false },
      "allow-main": { type: "boolean", default: false },
      "planner-max-turns": { type: "string" },
      "generator-max-turns": { type: "string" },
      "evaluator-max-turns": { type: "string" },
      "documenter-max-turns": { type: "string" },
      "disable-mcp": { type: "boolean", default: false },
      "mcp-servers": { type: "string" },
      "sprint-token-budget": { type: "string" },
      scout: { type: "boolean", default: false },
      review: { type: "boolean", default: false },
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
    modelReviewer: values["model-reviewer"] as string | undefined,
    modelContract: values["model-contract"] as string | undefined,
    lintGate: values["lint-gate"] as boolean,
    testGate: values["test-gate"] as boolean,
    sprint: values.sprint ? parseInt(values.sprint as string, 10) : undefined,
    refineSpec: values["refine-spec"] as boolean,
    notify: values.notify as boolean,
    commitAdhd: values["commit-adhd"] as boolean,
    commitAdhdLogs: values["commit-adhd-logs"] as boolean,
    allowMain: values["allow-main"] as boolean,
    plannerMaxTurns: values["planner-max-turns"] ? parseInt(values["planner-max-turns"] as string, 10) : undefined,
    generatorMaxTurns: values["generator-max-turns"]
      ? parseInt(values["generator-max-turns"] as string, 10)
      : undefined,
    evaluatorMaxTurns: values["evaluator-max-turns"]
      ? parseInt(values["evaluator-max-turns"] as string, 10)
      : undefined,
    documenterMaxTurns: values["documenter-max-turns"]
      ? parseInt(values["documenter-max-turns"] as string, 10)
      : undefined,
    disableMcp: values["disable-mcp"] as boolean,
    mcpServers: values["mcp-servers"] as string | undefined,
    sprintTokenBudget: values["sprint-token-budget"]
      ? parseInt(values["sprint-token-budget"] as string, 10)
      : undefined,
    useScout: values.scout as boolean,
    useReview: values.review as boolean,
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

  // Each of these uses parseNumericFlag so a malformed value (NaN, float, or
  // a non-numeric string from an env var) throws immediately at the parse
  // boundary with a message that names the specific flag/env-var pair.
  const maxSprints =
    parseNumericFlag(cli.maxSprints, "--max-sprints / MAX_SPRINTS") ??
    parseNumericFlag(process.env.MAX_SPRINTS, "--max-sprints / MAX_SPRINTS") ??
    DEFAULT_CONFIG.maxSprints;

  const maxRetriesPerSprint =
    parseNumericFlag(cli.maxRetries, "--max-retries / MAX_RETRIES") ??
    parseNumericFlag(process.env.MAX_RETRIES, "--max-retries / MAX_RETRIES") ??
    DEFAULT_CONFIG.maxRetriesPerSprint;

  const passThreshold =
    parseNumericFlag(cli.threshold, "--threshold / PASS_THRESHOLD") ??
    parseNumericFlag(process.env.PASS_THRESHOLD, "--threshold / PASS_THRESHOLD") ??
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
      logLevel = envLevel as LogLevel;
    } else {
      logWarn(
        "HARNESS",
        `LOG_LEVEL: "${process.env.LOG_LEVEL}" is not a recognised log level ` +
          `(expected: quiet, normal, verbose, debug); using default "normal".`,
      );
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

  // Per-agent turn caps: CLI flag > env var > default.
  // Invalid values (non-numeric, zero, negative) degrade to the agent's default
  // without throwing — mirroring the safeCap style in shared/contract-limits.ts.
  // Resolution: prefer the CLI numeric value when valid, then the env-var string,
  // then the hardcoded default.
  const resolvedMaxTurnsPlanner = resolveAgentCap(
    cli.plannerMaxTurns !== undefined && !Number.isNaN(cli.plannerMaxTurns)
      ? cli.plannerMaxTurns
      : process.env.PLANNER_MAX_TURNS,
    DEFAULT_MAX_TURNS_PLANNER,
    "--planner-max-turns / PLANNER_MAX_TURNS",
  );
  const resolvedMaxTurnsGenerator = resolveAgentCap(
    cli.generatorMaxTurns !== undefined && !Number.isNaN(cli.generatorMaxTurns)
      ? cli.generatorMaxTurns
      : process.env.GENERATOR_MAX_TURNS,
    DEFAULT_MAX_TURNS_GENERATOR,
    "--generator-max-turns / GENERATOR_MAX_TURNS",
  );
  const resolvedMaxTurnsEvaluator = resolveAgentCap(
    cli.evaluatorMaxTurns !== undefined && !Number.isNaN(cli.evaluatorMaxTurns)
      ? cli.evaluatorMaxTurns
      : process.env.EVALUATOR_MAX_TURNS,
    DEFAULT_MAX_TURNS_EVALUATOR,
    "--evaluator-max-turns / EVALUATOR_MAX_TURNS",
  );
  const resolvedMaxTurnsDocumenter = resolveAgentCap(
    cli.documenterMaxTurns !== undefined && !Number.isNaN(cli.documenterMaxTurns)
      ? cli.documenterMaxTurns
      : process.env.DOCUMENTER_MAX_TURNS,
    DEFAULT_MAX_TURNS_DOCUMENTER,
    "--documenter-max-turns / DOCUMENTER_MAX_TURNS",
  );

  // Tool/MCP governance (F11): CLI flag > env var > .adhd/.env > default.
  const disableMcp = cli.disableMcp || isTruthy(process.env.DISABLE_MCP) || false;

  // Parse addMcpServers from JSON (--mcp-servers / MCP_SERVERS).
  // Invalid JSON degrades to empty (no servers) — never throws.
  let addMcpServers: Record<string, Record<string, unknown>> = {};
  const rawMcpServers = cli.mcpServers ?? process.env.MCP_SERVERS;
  if (rawMcpServers) {
    try {
      const parsed = JSON.parse(rawMcpServers);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        addMcpServers = parsed as Record<string, Record<string, unknown>>;
      } else {
        console.warn("[HARNESS] --mcp-servers / MCP_SERVERS: expected a JSON object; ignoring.");
      }
    } catch {
      console.warn("[HARNESS] --mcp-servers / MCP_SERVERS: invalid JSON; ignoring.");
    }
  }

  // Per-sprint token budget (F12): CLI flag > env var > .adhd/.env > default.
  // Invalid values degrade to undefined (inert).
  let sprintTokenBudget: number | undefined;
  const rawBudget =
    cli.sprintTokenBudget ??
    (process.env.SPRINT_TOKEN_BUDGET ? parseInt(process.env.SPRINT_TOKEN_BUDGET, 10) : undefined);
  if (rawBudget !== undefined && Number.isInteger(rawBudget) && rawBudget > 0) {
    sprintTokenBudget = rawBudget;
  } else if (rawBudget !== undefined) {
    console.warn(
      `[HARNESS] --sprint-token-budget / SPRINT_TOKEN_BUDGET: "${String(rawBudget)}" is not a valid positive integer; budget enforcement disabled.`,
    );
  }

  // Per-agent overrides: CLI flag > env var. Blank values degrade to undefined
  // so they fall through to the uniform model / matrix default cleanly.
  const modelPlanner = blankToUndefined(cli.modelPlanner ?? process.env.MODEL_PLANNER);
  const modelGenerator = blankToUndefined(cli.modelGenerator ?? process.env.MODEL_GENERATOR);
  const modelEvaluator = blankToUndefined(cli.modelEvaluator ?? process.env.MODEL_EVALUATOR);
  const modelDocumenter = blankToUndefined(cli.modelDocumenter ?? process.env.MODEL_DOCUMENTER);
  const modelReviewer = blankToUndefined(cli.modelReviewer ?? process.env.MODEL_REVIEWER);
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
    testGate: cli.testGate || isTruthy(process.env.TEST_GATE) || false,
    refineSpec: cli.refineSpec || false,
    // Per-agent resolved models. Precedence per agent:
    //   explicit per-agent override > explicit uniform model > per-agent tier default.
    // The matrix only applies when the user set neither an override nor --model.
    resolvedModelPlanner: resolveAgentModel(modelPlanner, userUniformModel, DEFAULT_MODEL_PLANNER),
    resolvedModelGenerator: resolveAgentModel(modelGenerator, userUniformModel, DEFAULT_MODEL_GENERATOR),
    resolvedModelEvaluator: resolveAgentModel(modelEvaluator, userUniformModel, DEFAULT_MODEL_EVALUATOR),
    resolvedModelDocumenter: resolveAgentModel(modelDocumenter, userUniformModel, DEFAULT_MODEL_DOCUMENTER),
    resolvedModelReviewer: resolveAgentModel(modelReviewer, userUniformModel, DEFAULT_MODEL_REVIEWER),
    // Per-agent resolved turn caps. Invalid values degrade to defaults; never throw.
    resolvedMaxTurnsPlanner,
    resolvedMaxTurnsGenerator,
    resolvedMaxTurnsEvaluator,
    resolvedMaxTurnsDocumenter,
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
    modelReviewer,
    modelContract,
    branch: cli.branch,
    sprint: cli.sprint,
    notify: cli.notify || false,
    commitAdhd: cli.commitAdhd || cli.commitAdhdLogs || false,
    commitAdhdLogs: cli.commitAdhdLogs || false,
    allowMain: cli.allowMain || false,
    disableMcp,
    addMcpServers,
    uniformModelOverride: userUniformModel,
    sprintTokenBudget,
    useScout: (cli.useScout ?? false) || isTruthy(process.env.ADHD_SCOUT) || false,
    useReview: (cli.useReview ?? false) || isTruthy(process.env.ADHD_REVIEW) || false,
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
 * Parse and validate a numeric flag or environment variable.
 *
 * Returns `undefined` when the value is absent or an empty string.
 * Throws a named error when the value is present but not a valid integer
 * (including NaN, Infinity, and fractional values), naming both the flag and
 * the environment variable so the developer can locate the exact problem.
 *
 * @param raw      Raw value: a number already parsed by parseCli, a string
 *                 from an env var, or undefined when not supplied.
 * @param flagName Human-readable name used in the error, e.g.
 *                 "--max-sprints / MAX_SPRINTS".
 */
function parseNumericFlag(raw: number | string | undefined, flagName: string): number | undefined {
  if (raw === undefined || raw === "") return undefined;
  const n = typeof raw === "number" ? raw : parseInt(String(raw), 10);
  if (!Number.isInteger(n)) {
    throw new Error(
      `Invalid ${flagName}: "${String(raw)}" is not a valid integer. ` +
        `Check the flag or environment variable and supply a whole number.`,
    );
  }
  return n;
}

/**
 * Validate a HarnessConfig object, throwing on invalid values.
 * Checks that threshold, maxSprints, and maxRetries are within valid ranges.
 * @param config - The harness configuration to validate
 * @throws Error if any configuration value is out of range
 */
export function validateConfig(config: HarnessConfig): void {
  // Number.isInteger guards act as a backstop against NaN and non-integer values
  // that can arrive when validateConfig is called directly (bypassing resolveConfig).
  // They complement the parse-boundary checks in resolveConfig/parseNumericFlag.
  if (!Number.isInteger(config.passThreshold) || config.passThreshold < 1 || config.passThreshold > 10) {
    throw new Error(`Invalid threshold: ${config.passThreshold}. Must be an integer between 1 and 10.`);
  }
  if (!Number.isInteger(config.maxSprints) || config.maxSprints < 1) {
    throw new Error(`Invalid max-sprints: ${config.maxSprints}. Must be a positive integer.`);
  }
  if (!Number.isInteger(config.maxRetriesPerSprint) || config.maxRetriesPerSprint < 0) {
    throw new Error(`Invalid max-retries: ${config.maxRetriesPerSprint}. Must be an integer >= 0.`);
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
