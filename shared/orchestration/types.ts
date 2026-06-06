import type { AgentIdentity } from "../agent-identity.ts";
import type { ReviewReport } from "../review-report.ts";
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
  /**
   * Optional supplementary context injected after the main prompt sections.
   * Used to pass the harness-generated codebase map (Sprint 6) so the Planner
   * does not need to re-explore the project from scratch during refinement.
   */
  supplementaryContext?: string;
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
  /**
   * Optional supplementary context injected after the sprint contract and
   * feedback sections. Used to pass the pre-sprint verification baseline so
   * the Generator knows which tests were already failing before it ran.
   */
  supplementaryContext?: string;
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

export interface RunScoutOptions {
  config: ResolvedConfig;
  identity: AgentIdentity;
}

export interface ScoutResult {
  /** Bounded semantic digest of codebase conventions, or undefined on failure. */
  digest?: string;
  /** SDK result for cost recording; undefined when the Scout was skipped or failed. */
  sdkResult?: SDKResultFields;
}

export interface RunReviewerOptions {
  config: ResolvedConfig;
  identity: AgentIdentity;
  /** Sprint number currently under review. */
  sprint: number;
  /** Optional policy skills injected into the Reviewer system prompt. */
  skills?: AgentSkills;
}

export interface ReviewerResult {
  /** Structured review report on code craft; undefined on failure or skip. */
  report?: ReviewReport;
  /** SDK result for cost recording; undefined when the Reviewer was skipped or failed. */
  sdkResult?: SDKResultFields;
}

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
  /**
   * Optional Scout agent. Runs a read-only pre-Generator pass to produce a
   * bounded semantic digest of codebase conventions. Absent in harnesses that
   * do not support the Scout (treated as a no-op by the orchestrator).
   * Gated behind --scout; skipped in greenfield mode.
   */
  runScout?: (opts: RunScoutOptions) => Promise<ScoutResult>;
  /**
   * Optional Reviewer agent. Runs a read-only code-craft review after each
   * passing sprint. Absent in harnesses that do not support the Reviewer
   * (treated as a no-op by the orchestrator).
   * Gated behind --review; non-fatal and advisory only.
   */
  runReviewer?: (opts: RunReviewerOptions) => Promise<ReviewerResult>;
}

export interface NegotiateContractOptions {
  workDir: string;
  spec: string;
  sprintNumber: number;
  proposalModel: string;
  reviewModel: string;
  usage?: UsageTracker;
  /** Maximum features the finalized contract may declare (F5 ceiling enforcement). */
  maxFeatures: number;
  /** Maximum criteria the finalized contract may declare (F5 ceiling enforcement). */
  maxCriteria: number;
  /** Maximum surfaces the finalized contract may declare (F5 ceiling enforcement). */
  maxSurfaces: number;
  /**
   * Optional single model for ALL negotiation SDK calls (F6). When set, it
   * overrides both `proposalModel` and `reviewModel` (and therefore the bounded
   * narrowing round, which runs on the review model). When unset, the inherited
   * Generator-propose / Evaluator-review split is used.
   */
  modelContract?: string;
  /**
   * When true, MCP servers are disabled for the contract-negotiation calls.
   * Contract negotiation is a non-coding role and already receives no MCP by
   * default; this field is present for policy completeness.
   */
  disableMcp?: boolean;
  /**
   * Additional MCP server entries (for policy completeness; not used for
   * non-coding roles like contract negotiation).
   */
  addMcpServers?: Record<string, Record<string, unknown>>;
  /**
   * Session-start stamp for per-run log subdirectory routing.
   * When set, the contract-negotiation conversation log is written under
   * .adhd/logs/<sessionDir>/ rather than directly in .adhd/logs/.
   */
  sessionDir?: string;
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
