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
  harnessDir?: string; // resolved path to .harness/
  // Phase 2 additions (optional for backward compat)
  tzDisplay?: string; // IANA timezone for terminal display (e.g. "Europe/Warsaw")
  langfusePublicKey?: string;
  langfuseSecretKey?: string;
  langfuseBaseUrl?: string;
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
  status: "planning" | "negotiating" | "building" | "evaluating" | "complete" | "failed";
  currentSprint: number;
  totalSprints: number;
  completedSprints: number;
  retryCount: number;
  // Phase 1 additions (optional for backward compat)
  lastPassedCommitSha?: string;
  sprintResults?: SprintResult[];
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
