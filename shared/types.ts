export type LogLevel = "quiet" | "normal" | "verbose" | "debug";

export interface HarnessConfig {
  userPrompt: string;
  workDir: string;
  maxSprints: number;
  maxRetriesPerSprint: number;
  passThreshold: number;
  // Phase 1 additions (optional for backward compat with codex-harness)
  model?: string;
  isGreenfield?: boolean;
  isResume?: boolean;
  logLevel?: LogLevel;
  interactive?: boolean;
  harnessDir?: string; // resolved path to .adhd/
  // Phase 2 additions (optional for backward compat)
  tzDisplay?: string; // IANA timezone for terminal display (e.g. "Europe/Warsaw")
  langfusePublicKey?: string;
  langfuseSecretKey?: string;
  langfuseBaseUrl?: string;
  // Phase A additions
  editor?: string; // resolved from --editor / ADHD_EDITOR / $EDITOR
  gateTimeout?: number; // override all gate timeouts (seconds). 0 = skip all gates.
  // Phase B additions
  isDryRun?: boolean; // B1: run planner only, show spec, exit
  contextFiles?: string[]; // B2: files to inject into planner prompt as reference docs
  modelPlanner?: string; // B3: per-agent model overrides
  modelGenerator?: string;
  modelEvaluator?: string;
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
}

export interface HarnessProgress {
  status: "planning" | "spec-review" | "negotiating" | "building" | "evaluating" | "complete" | "failed";
  currentSprint: number;
  totalSprints: number;
  completedSprints: number;
  retryCount: number;
  // Phase 1 additions (optional for backward compat)
  lastPassedCommitSha?: string;
  sprintResults?: SprintResult[];
  // Phase A additions
  specApproved?: boolean;
}

export type CommitSource = "agent" | "resume" | "fallback" | "none";

export interface SprintResult {
  sprintNumber: number;
  passed: boolean;
  attempts: number;
  evalResult?: EvalResult;
  commitSource?: CommitSource;
}

export interface HarnessResult {
  success: boolean;
  sprints: SprintResult[];
  totalDurationMs: number;
}

// --- A1: Per-stage cost tracking ---

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
