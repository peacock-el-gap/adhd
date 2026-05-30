import type { AgentIdentity } from "../agent-identity.ts";
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

export interface RunPlannerOptions {
  config: ResolvedConfig;
  identity: AgentIdentity;
  /** When set, the planner re-runs with this revision feedback. The caller
   *  is expected to set `identity.variant = "revision"` so the cost row,
   *  log filename, and span name reflect that. */
  reviseFeedback?: string;
  skills?: AgentSkills;
}

export interface PlannerResult {
  spec: string;
  sdkResult?: SDKResultFields;
  sessionId?: string;
}

export interface RunGeneratorOptions {
  config: ResolvedConfig;
  identity: AgentIdentity;
  spec: string;
  contract: SprintContract;
  previousFeedback?: EvalResult;
  attempt?: number;
  skills?: AgentSkills;
}

export interface GeneratorResult {
  response: string;
  sessionId?: string;
  sdkResult?: SDKResultFields;
}

export interface RunEvaluatorOptions {
  config: ResolvedConfig;
  identity: AgentIdentity;
  contract: SprintContract;
  attempt?: number;
  skills?: AgentSkills;
  supplementaryContext?: string;
}

export interface RunDocumenterOptions {
  config: ResolvedConfig;
  identity: AgentIdentity;
  skills?: AgentSkills;
  sprintResults?: SprintResult[];
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
  runPlanner(opts: RunPlannerOptions): Promise<PlannerResult>;
  runGenerator(opts: RunGeneratorOptions): Promise<GeneratorResult>;
  runEvaluator(opts: RunEvaluatorOptions): Promise<EvalResult & { sdkResult?: SDKResultFields }>;
  runDocumenter(opts: RunDocumenterOptions): Promise<{ sdkResult?: SDKResultFields; sessionId?: string }>;
  /**
   * Two-step contract negotiation. Records cost rows internally for both the
   * proposal and review SDK calls, since `negotiateContract` is the orchestrator
   * for those two agent runs (the harness orchestrator only sees one phase).
   */
  negotiateContract(opts: NegotiateContractOptions): Promise<SprintContract>;
  ensureGeneratorCommit(opts: EnsureCommitOptions): Promise<CommitSource>;
  ensureDocumenterCommit(opts: EnsureDocumenterCommitOptions): Promise<CommitSource>;
}

export interface NegotiateContractOptions {
  workDir: string;
  spec: string;
  sprintNumber: number;
  proposalModel: string;
  reviewModel: string;
  usage?: UsageTracker;
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
