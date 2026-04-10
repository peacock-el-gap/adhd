export type LogLevel = "quiet" | "normal" | "verbose" | "debug";

/** Input configuration — all optional fields use `?` for CLI/env flexibility. */
export interface HarnessConfig {
  userPrompt: string;
  workDir: string;
  maxSprints: number;
  maxRetriesPerSprint: number;
  passThreshold: number;
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
  lintGate?: boolean;
  sprint?: number;
  refineSpec?: boolean;
}

/** Fully resolved config with all defaults applied. Used internally by the harness. */
export interface ResolvedConfig {
  userPrompt: string;
  workDir: string;
  maxSprints: number;
  maxRetriesPerSprint: number;
  passThreshold: number;
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
  branch?: string;
  sprint?: number;
}

export interface SprintContract {
  sprintNumber: number;
  features: string[];
  criteria: SprintCriterion[];
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
  status: "planning" | "spec-review" | "negotiating" | "building" | "evaluating" | "complete" | "failed";
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
