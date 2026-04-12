import type { AgentSkills, AllAgentSkills } from "../skills.ts";
import type { Span, Tracer } from "../tracing.ts";
import type {
  CommitSource,
  EvalResult,
  HarnessProgress,
  HarnessResult,
  ResolvedConfig,
  SprintContract,
  SprintResult,
} from "../types.ts";
import type { SDKResultFields, UsageTracker } from "../usage.ts";

// --- Agent option types (SDK-independent, used by orchestration) ---

export interface RunGeneratorOptions {
  config: ResolvedConfig;
  spec: string;
  contract: SprintContract;
  previousFeedback?: EvalResult;
  attempt?: number;
  skills?: AgentSkills;
  /** Pre-generated timestamp for log filename alignment with span names. */
  logTimestamp?: string;
}

export interface GeneratorResult {
  response: string;
  sessionId?: string;
  sdkResult?: SDKResultFields;
}

export interface RunEvaluatorOptions {
  config: ResolvedConfig;
  contract: SprintContract;
  attempt?: number;
  skills?: AgentSkills;
  supplementaryContext?: string;
  /** Pre-generated timestamp for log filename alignment with span names. */
  logTimestamp?: string;
}

export interface RunDocumenterOptions {
  config: ResolvedConfig;
  skills?: AgentSkills;
  sprintResults?: SprintResult[];
  /** Pre-generated timestamp for log filename alignment with span names. */
  logTimestamp?: string;
}

export interface EnsureCommitOptions {
  workDir: string;
  gitDir: string;
  beforeSha: string;
  sessionId: string | undefined;
  contract: SprintContract;
  isRetry: boolean;
  model: string;
}

export interface EnsureDocumenterCommitOptions {
  workDir: string;
  gitDir: string;
  beforeSha: string;
  sessionId: string | undefined;
  sprintResults: SprintResult[];
  model: string;
}

// --- AgentRunners: dependency-injected interface for SDK-specific agent implementations ---

export interface AgentRunners {
  initTracing(config: ResolvedConfig): Tracer;
  runPlanner(
    config: ResolvedConfig,
    feedback?: string,
    usage?: UsageTracker,
    skills?: AgentSkills,
    logTimestamp?: string,
  ): Promise<string>;
  runGenerator(opts: RunGeneratorOptions): Promise<GeneratorResult>;
  runEvaluator(opts: RunEvaluatorOptions): Promise<EvalResult & { sdkResult?: SDKResultFields }>;
  runDocumenter(opts: RunDocumenterOptions): Promise<{ sdkResult?: SDKResultFields; sessionId?: string }>;
  negotiateContract(
    workDir: string,
    spec: string,
    sprint: number,
    proposalModel: string,
    reviewModel: string,
    usage?: UsageTracker,
    logTimestamp?: string,
  ): Promise<SprintContract>;
  ensureGeneratorCommit(opts: EnsureCommitOptions): Promise<CommitSource>;
  ensureDocumenterCommit(opts: EnsureDocumenterCommitOptions): Promise<CommitSource>;
}

/** Convenience type for the planner function signature, used by gates and spec-refinement. */
export type PlannerFn = AgentRunners["runPlanner"];

// --- Orchestration context types ---

export interface SprintLoopContext {
  config: ResolvedConfig;
  spec: string;
  progress: HarnessProgress;
  results: SprintResult[];
  startSprint: number;
  totalSprints: number;
  startTime: number;
  parentSpan: Span;
  usage: UsageTracker;
  skills?: AllAgentSkills;
  agents: AgentRunners;
}

export interface SprintAttemptContext {
  config: ResolvedConfig;
  spec: string;
  contract: SprintContract;
  sprint: number;
  gDir: string;
  sprintSpan: Span;
  progress: HarnessProgress;
  usage: UsageTracker;
  skills?: AllAgentSkills;
  results: SprintResult[];
  agents: AgentRunners;
}

export interface SprintAttemptResult {
  passed: boolean;
  attempts: number;
  lastEval: EvalResult | undefined;
  lastCommitSource: CommitSource;
  fatalResult?: HarnessResult;
}

export interface SprintSuccessContext {
  config: ResolvedConfig;
  contract: SprintContract;
  spec: string;
  sprint: number;
  totalSprints: number;
  gDir: string;
  progress: HarnessProgress;
  results: SprintResult[];
  parentSpan: Span;
  usage: UsageTracker;
  skills?: AllAgentSkills;
  agents: AgentRunners;
}

export interface SprintSuccessResult {
  spec: string;
  totalSprints: number;
  skipNextSprint?: boolean;
}

export interface DocumenterPhaseContext {
  config: ResolvedConfig;
  parentSpan: Span;
  usage: UsageTracker;
  documenterSkills?: AgentSkills;
  results: SprintResult[];
  progress: HarnessProgress;
  agents: AgentRunners;
}
