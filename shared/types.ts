export type LogLevel = "quiet" | "normal" | "verbose" | "debug";

/** Input configuration — all optional fields use `?` for CLI/env flexibility. */
export interface HarnessConfig {
  userPrompt: string;
  workDir: string;
  maxSprints: number;
  maxRetriesPerSprint: number;
  passThreshold: number;
  maxFeatures: number;
  maxCriteria: number;
  maxSurfaces: number;
  model?: string;
  isGreenfield?: boolean;
  isResume?: boolean;
  logLevel?: LogLevel;
  interactive?: boolean;
  harnessDir?: string;
  tzDisplay?: string;
  langfusePublicKey?: string;
  langfuseSecretKey?: string;
  langfuseBaseUrl?: string;
  editor?: string;
  gateTimeout?: number;
  isDryRun?: boolean;
  contextFiles?: string[];
  modelPlanner?: string;
  modelGenerator?: string;
  modelEvaluator?: string;
  branch?: string;
  sourceDir?: string;
  testDir?: string;
  noBdd?: boolean;
  noTdd?: boolean;
  noDocs?: boolean;
  modelDocumenter?: string;
  /** Optional single model for ALL contract-negotiation SDK calls (F6). */
  modelContract?: string;
  lintGate?: boolean;
  testGate?: boolean;
  sprint?: number;
  refineSpec?: boolean;
  notify?: boolean;
  commitAdhd?: boolean;
  commitAdhdLogs?: boolean;
  /** Allow running on the default branch (main/master); the guard refuses by default. */
  allowMain?: boolean;
  /** Per-agent turn caps. Invalid values (non-numeric, ≤ 0) degrade to defaults. */
  plannerMaxTurns?: number;
  generatorMaxTurns?: number;
  evaluatorMaxTurns?: number;
  documenterMaxTurns?: number;
  /**
   * Disable MCP servers for all agents. Non-coding agents already receive no
   * MCP; this flag extends that restriction to coding agents too.
   * CLI: --disable-mcp / env: DISABLE_MCP
   */
  disableMcp?: boolean;
  /**
   * Additional MCP servers to inject into coding agents, serialised as a JSON
   * object (`{ "server-name": { ...config } }`). Ignored when disableMcp is true.
   * CLI: --mcp-servers / env: MCP_SERVERS
   */
  mcpServersJson?: string;
  /**
   * Optional per-sprint token ceiling. When set, the harness warns at 80% and
   * pauses (interactive) or logs a warning (non-interactive) at 100%.
   * CLI: --sprint-token-budget / env: SPRINT_TOKEN_BUDGET
   */
  sprintTokenBudget?: number;
}

/** Fully resolved config with all defaults applied. Used internally by the harness. */
export interface ResolvedConfig {
  userPrompt: string;
  workDir: string;
  maxSprints: number;
  maxRetriesPerSprint: number;
  passThreshold: number;
  maxFeatures: number;
  maxCriteria: number;
  maxSurfaces: number;
  model: string;
  isGreenfield: boolean;
  isResume: boolean;
  logLevel: LogLevel;
  interactive: boolean;
  harnessDir: string;
  isDryRun: boolean;
  sourceDir: string;
  testDir: string;
  noBdd: boolean;
  noTdd: boolean;
  noDocs: boolean;
  lintGate: boolean;
  testGate: boolean;
  refineSpec: boolean;
  // Per-agent resolved models — always a concrete string
  resolvedModelPlanner: string;
  resolvedModelGenerator: string;
  resolvedModelEvaluator: string;
  resolvedModelDocumenter: string;
  // Per-agent resolved turn caps — always a positive integer
  resolvedMaxTurnsPlanner: number;
  resolvedMaxTurnsGenerator: number;
  resolvedMaxTurnsEvaluator: number;
  resolvedMaxTurnsDocumenter: number;
  // Genuinely optional — no sensible default
  tzDisplay?: string;
  langfusePublicKey?: string;
  langfuseSecretKey?: string;
  langfuseBaseUrl?: string;
  editor?: string;
  gateTimeout?: number;
  contextFiles?: string[];
  modelPlanner?: string;
  modelGenerator?: string;
  modelEvaluator?: string;
  modelDocumenter?: string;
  /** Optional single model for ALL contract-negotiation SDK calls (F6). */
  modelContract?: string;
  branch?: string;
  sprint?: number;
  notify: boolean;
  commitAdhd: boolean;
  commitAdhdLogs: boolean;
  /** Allow running on the default branch (main/master); the guard refuses by default. */
  allowMain: boolean;
  /**
   * When true, all agents receive no MCP servers in their SDK Options.
   * Non-coding agents already have no MCP by default; this applies the
   * restriction to coding agents too. Set via --disable-mcp / DISABLE_MCP.
   */
  disableMcp: boolean;
  /**
   * Additional MCP server entries to inject into coding agents, keyed by
   * server name. Parsed from --mcp-servers / MCP_SERVERS JSON. Ignored when
   * disableMcp is true. Empty when no servers are configured.
   */
  addMcpServers: Record<string, Record<string, unknown>>;
  /**
   * The explicit uniform model string when the user passed --model/CLAUDE_MODEL,
   * or undefined when no uniform override was set. Used by the overspend
   * advisory check (F12) to detect when a uniform model exceeds the default matrix.
   */
  uniformModelOverride?: string;
  /**
   * Optional per-sprint token budget. When set, the harness warns at 80% and
   * pauses/logs at 100%. Inert (no checks) when absent or zero.
   * Set via --sprint-token-budget / SPRINT_TOKEN_BUDGET.
   */
  sprintTokenBudget?: number;
}

export interface SprintContract {
  sprintNumber: number;
  features: string[];
  criteria: SprintCriterion[];
  /**
   * The parts of the codebase this sprint intends to change, drawn only from
   * the surface vocabulary (see shared/surfaces.ts). Optional on read for
   * backward compatibility with legacy contracts; populated on write going
   * forward.
   */
  surfaces?: string[];
  /**
   * Names of prior regression criteria to permanently retire from the suite.
   * A retired name is durably blocked from re-entering via accumulation even if
   * a later contract introduces a behavioral criterion with the same name.
   * Optional; no-op when absent or empty.
   */
  retire?: string[];
}

export interface SprintCriterion {
  name: string;
  description: string;
  threshold: number;
  type?: "behavioral" | "implementation";
}

export interface RegressionCriterion {
  name: string;
  description: string;
  threshold: number;
  sprintNumber: number;
  /**
   * Classification for regression-section filtering. "core" criteria are always
   * included in the Evaluator's regression context regardless of the current
   * sprint's surfaces. "optional" criteria are included only when their declared
   * surfaces intersect the current sprint's contract surfaces. Absent on legacy
   * criteria (pre-Sprint-9 regression.json files) — those are treated as
   * always-checked, identical to "core".
   */
  tier?: "core" | "optional";
  /**
   * The surfaces this criterion is associated with, drawn from the originating
   * sprint contract's surface declarations. Used by the relevance filter in
   * `buildRegressionSection` to include/omit "optional" criteria based on
   * surface intersection with the current sprint. Absent on legacy criteria.
   */
  surfaces?: string[];
}

export interface EvalScore {
  criterion: string;
  score: number;
  details: string;
}

export interface EvalResult {
  passed: boolean;
  scores: Record<string, number>;
  feedback: EvalScore[];
  overallSummary: string;
  overridden?: boolean;
}

export interface HarnessProgress {
  status:
    | "planning"
    | "spec-review"
    | "negotiating"
    | "building"
    | "evaluating"
    | "documenting"
    | "complete"
    | "failed";
  currentSprint: number;
  totalSprints: number;
  completedSprints: number;
  retryCount: number;
  lastPassedCommitSha?: string;
  sprintResults?: SprintResult[];
  specApproved?: boolean;
  branch?: string;
  docsGenerated?: boolean;
}

export type CommitSource = "agent" | "resume" | "fallback" | "none";

export interface SprintResult {
  sprintNumber: number;
  passed: boolean;
  attempts: number;
  evalResult?: EvalResult;
  commitSource?: CommitSource;
  skipped?: boolean;
}

export interface HarnessResult {
  success: boolean;
  sprints: SprintResult[];
  totalDurationMs: number;
}

export interface StageUsage {
  stage: string; // "planner", "sprint-1-contract-negotiation", "sprint-1-attempt-0-generator", etc.
  model: string; // resolved model name that produced this stage's output
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUsd: number;
  durationMs: number;
}

export interface SessionUsage {
  startedAt: string; // ISO 8601 UTC
  stages: StageUsage[];
  totalCostUsd: number;
}

export interface RunUsage {
  sessions: SessionUsage[];
  runTotalCostUsd: number;
}
