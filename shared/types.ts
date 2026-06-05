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
  sprint?: number;
  refineSpec?: boolean;
  notify?: boolean;
  commitAdhd?: boolean;
  commitAdhdLogs?: boolean;
  /** Allow running on the default branch (main/master); the guard refuses by default. */
  allowMain?: boolean;
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
  refineSpec: boolean;
  // Per-agent resolved models — always a concrete string
  resolvedModelPlanner: string;
  resolvedModelGenerator: string;
  resolvedModelEvaluator: string;
  resolvedModelDocumenter: string;
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
