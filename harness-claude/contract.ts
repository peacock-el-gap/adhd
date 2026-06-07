import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { makeIdentity } from "../shared/agent-identity.ts";
import { type ContractLimits, exceedsContractLimits, trimContractToLimits } from "../shared/contract-limits.ts";
import { parseContractText } from "../shared/contract-parse.ts";
import { type ConversationLogger, createConversationLog } from "../shared/conversation-logger.ts";
import { harnessDir } from "../shared/files.ts";
import { log, logError, logVerbose, logWarn } from "../shared/logger.ts";
import type { NegotiateContractOptions } from "../shared/orchestration/types.ts";
import { buildContractReviewPrompt, CONTRACT_NEGOTIATION_GENERATOR_PROMPT } from "../shared/prompts.ts";
import { parseReviewEnvelope } from "../shared/review-envelope.ts";
import { normalizeSurfaces } from "../shared/surfaces.ts";
import { buildToolPolicyInput, resolveToolPolicy } from "../shared/tool-policy.ts";
import type { SprintContract } from "../shared/types.ts";
import type { UsageTracker } from "../shared/usage.ts";
import { runAgent } from "./run-agent.ts";

export async function negotiateContract(opts: NegotiateContractOptions): Promise<SprintContract> {
  const { workDir, spec, sprintNumber, usage, maxFeatures, maxCriteria, maxSurfaces, modelContract } = opts;
  // When --model-contract is set it overrides ALL negotiation calls (proposal,
  // review, and the F5 narrowing round); otherwise keep the inherited
  // Generator-propose / Evaluator-review split.
  const proposalModel = modelContract ?? opts.proposalModel;
  const reviewModel = modelContract ?? opts.reviewModel;
  const limits: ContractLimits = { maxFeatures, maxCriteria, maxSurfaces };
  const reviewPrompt = buildContractReviewPrompt(limits);
  const startTime = new Date();

  // Contract negotiation is a non-coding role → no MCP, project settings only.
  const contractToolPolicy = resolveToolPolicy(
    "HARNESS",
    buildToolPolicyInput({ disableMcp: opts.disableMcp, addMcpServers: opts.addMcpServers }),
  );

  // Three identities at play:
  //   - one for the shared conversation log (negotiation as a whole)
  //   - one for the proposal SDK call (its own cost row and trace name)
  //   - one for the review SDK call (its own cost row and trace name)
  // All three share a single conversation log file via inheritConvLog.
  const negotiationIdentity = makeIdentity({ role: "contract-negotiation", sprint: sprintNumber });
  const proposalIdentity = makeIdentity({
    role: "contract-proposal",
    sprint: sprintNumber,
    timestamp: negotiationIdentity.timestamp,
  });
  const reviewIdentity = makeIdentity({
    role: "contract-review",
    sprint: sprintNumber,
    timestamp: negotiationIdentity.timestamp,
  });

  const convLog = createConversationLog(
    workDir,
    negotiationIdentity,
    { model: proposalModel, startTime },
    opts.sessionDir,
  );

  const proposalResult = await runAgent({
    identity: proposalIdentity,
    role: "HARNESS",
    workDir,
    prompt: `## Product Spec\n\n${spec}\n\n## Sprint Number: ${sprintNumber}\n\nPropose a sprint contract for this sprint.`,
    systemPrompt: CONTRACT_NEGOTIATION_GENERATOR_PROMPT,
    model: proposalModel,
    tools: [],
    maxTurns: 1,
    persistSession: false,
    logLevel: "quiet",
    inheritConvLog: convLog,
    toolPolicy: contractToolPolicy,
  });
  if (proposalResult.sdkResult) {
    usage.recordStage(`sprint-${sprintNumber}-contract-proposal`, proposalModel, proposalResult.sdkResult);
  }
  const proposalText = proposalResult.response;

  const reviewResult = await runAgent({
    identity: reviewIdentity,
    role: "HARNESS",
    workDir,
    prompt: `## Proposed Sprint Contract\n\n${proposalText}\n\nReview this contract.`,
    systemPrompt: reviewPrompt,
    model: reviewModel,
    tools: [],
    maxTurns: 1,
    persistSession: false,
    logLevel: "quiet",
    inheritConvLog: convLog,
    toolPolicy: contractToolPolicy,
  });
  if (reviewResult.sdkResult) {
    usage.recordStage(`sprint-${sprintNumber}-contract-review`, reviewModel, reviewResult.sdkResult);
  }
  const reviewText = reviewResult.response;

  // Parse the final contract (either the proposal if approved, or the revised
  // version). Enforcement runs AFTER this selection so an oversized proposal the
  // reviewer returned "APPROVED" on is still caught.
  const reviewEnvelope = parseReviewEnvelope(reviewText);
  let parsed: SprintContract;
  if (reviewEnvelope.verdict === "approved") {
    // Reviewer accepted the proposal unchanged — use the proposal text.
    parsed = parseContract(proposalText, sprintNumber, workDir, opts.sessionDir);
  } else if (reviewEnvelope.contract !== null) {
    // Reviewer returned a structured revised contract — use it directly.
    parsed = { ...reviewEnvelope.contract, sprintNumber };
    parsed.surfaces = normalizeSurfaces(parsed.surfaces);
  } else {
    // Unrecognised or unparseable revision — fall back to parseContract on
    // the raw review text (legacy bare-contract or malformed output).
    parsed = parseContract(reviewText, sprintNumber, workDir, opts.sessionDir);
  }

  const finalContract = await enforceContractCeiling(parsed, limits, {
    workDir,
    sprintNumber,
    reviewModel,
    reviewPrompt,
    usage,
    convLog,
    timestamp: negotiationIdentity.timestamp,
    sessionDir: opts.sessionDir,
  });

  await convLog.finalize(Date.now() - startTime.getTime());
  return finalContract;
}

/** Dependencies the bounded ceiling-enforcement round needs for its SDK call. */
interface CeilingEnforcementContext {
  workDir: string;
  sprintNumber: number;
  reviewModel: string;
  reviewPrompt: string;
  /** F7: required usage tracker — inherited from the required NegotiateContractOptions.usage. */
  usage: UsageTracker;
  convLog: ConversationLogger;
  timestamp: string;
  /** Session-start stamp for routing the diagnostic file into the run's log subdirectory. */
  sessionDir?: string;
}

/** Compact "F<features> C<criteria> S<surfaces>" size summary for logging. */
function sizeSummary(contract: SprintContract): string {
  const surfaces = normalizeSurfaces(contract.surfaces) ?? [];
  return `${contract.features?.length ?? 0} features, ${contract.criteria?.length ?? 0} criteria, ${surfaces.length} surfaces`;
}

/**
 * Bound a negotiated contract to the configured size ceilings (F5).
 *
 * If the parsed contract already fits, it is returned untouched. Otherwise we
 * trigger EXACTLY ONE additional reviewer narrowing round (reusing the same
 * limit-aware prompt) — never a loop. If the result is still over a limit, the
 * deterministic pure trim ({@link trimContractToLimits}) guarantees an in-budget
 * contract so the Generator never receives over-budget work. Both narrowing and
 * trimming are logged with before/after counts in the plain HARNESS voice.
 */
async function enforceContractCeiling(
  parsed: SprintContract,
  limits: ContractLimits,
  ctx: CeilingEnforcementContext,
): Promise<SprintContract> {
  if (!exceedsContractLimits(parsed, limits)) {
    return parsed;
  }

  const before = sizeSummary(parsed);
  log(
    "HARNESS",
    `Contract exceeds size limits (${before}; caps: ${limits.maxFeatures} features, ${limits.maxCriteria} criteria, ${limits.maxSurfaces} surfaces) — requesting one narrowing round.`,
  );

  let contract = await runNarrowingRound(parsed, ctx);

  if (exceedsContractLimits(contract, limits)) {
    // The reviewer did not bring it within budget after its single chance.
    // Apply the deterministic trim so enforcement always terminates in-budget.
    const result = trimContractToLimits(contract, limits);
    contract = result.contract;
    logError(
      "HARNESS",
      `Contract still over limits after the narrowing round — trimmed to the highest-priority items (${before} -> ${sizeSummary(contract)}).`,
    );
  } else {
    log("HARNESS", `Contract narrowed to within limits (${before} -> ${sizeSummary(contract)}).`);
  }

  return contract;
}

/**
 * Run a single reviewer narrowing round on an over-budget contract. Returns the
 * reviewer's narrowed contract, or the original if the reviewer answered
 * "APPROVED" or produced unparseable output (the deterministic trim is the
 * safety net for those cases).
 */
async function runNarrowingRound(contract: SprintContract, ctx: CeilingEnforcementContext): Promise<SprintContract> {
  const narrowIdentity = makeIdentity({
    role: "contract-review",
    sprint: ctx.sprintNumber,
    variant: "narrowing",
    timestamp: ctx.timestamp,
  });

  const result = await runAgent({
    identity: narrowIdentity,
    role: "HARNESS",
    workDir: ctx.workDir,
    prompt: `## Proposed Sprint Contract\n\n${JSON.stringify(contract, null, 2)}\n\nThis contract exceeds the configured size limits. Return a narrowed JSON contract that keeps only the highest-priority items within every limit.`,
    systemPrompt: ctx.reviewPrompt,
    model: ctx.reviewModel,
    tools: [],
    maxTurns: 1,
    persistSession: false,
    logLevel: "quiet",
    inheritConvLog: ctx.convLog,
  });
  if (result.sdkResult) {
    ctx.usage.recordStage(`sprint-${ctx.sprintNumber}-contract-narrowing`, ctx.reviewModel, result.sdkResult);
  }

  // Parse the narrowing-round response via the envelope parser so both legacy
  // and structured responses are handled uniformly.
  const narrowEnvelope = parseReviewEnvelope(result.response);
  if (narrowEnvelope.verdict === "approved") {
    // Reviewer declined to narrow — keep the current (over-budget) contract
    // and let the deterministic trim handle it.
    return contract;
  }
  if (narrowEnvelope.contract !== null) {
    // Reviewer returned a structured narrowed contract — use it directly.
    const narrowed = { ...narrowEnvelope.contract, sprintNumber: ctx.sprintNumber };
    narrowed.surfaces = normalizeSurfaces(narrowed.surfaces);
    return narrowed;
  }
  // Fall back to parseContract on the raw text (legacy bare-contract path).
  return parseContract(result.response, ctx.sprintNumber, ctx.workDir, ctx.sessionDir);
}

/**
 * Re-exports of the extraction helpers from shared/contract-parse.ts.
 *
 * These are preserved here so existing callers and tests that import from
 * harness-claude/contract.ts continue to work unchanged.
 */
export {
  extractBalancedJson,
  extractUnclosedFence,
} from "../shared/contract-parse.ts";

/**
 * Parse raw LLM text into a SprintContract, handling all side effects.
 *
 * Delegates the pure parse decision to {@link parseContractText} from
 * `shared/contract-parse.ts`. On failure this wrapper:
 * - Logs a human-readable warning (handled degradation — run continues)
 * - Optionally writes the full raw text to a diagnostic file
 *
 * When `sessionDir` is provided the diagnostic is written under
 * `.adhd/logs/<sessionDir>/` so it sits alongside that run's conversation
 * logs. When absent it falls back to the flat `.adhd/logs/` root.
 *
 * Returns either the successfully parsed contract or the generic default.
 */
export function parseContract(
  text: string,
  sprintNumber: number,
  workDir?: string,
  sessionDir?: string,
): SprintContract {
  const result = parseContractText(text, sprintNumber);
  if (result.ok) {
    return result.contract;
  }

  // Parse failure — emit an amber warning and write the diagnostic file.
  // This is a handled degradation, not a crash: the run continues with the
  // generic default contract, so warning severity is correct here.
  logWarn("HARNESS", `Contract for sprint ${sprintNumber} wasn't valid JSON — using a generic default contract`);

  if (workDir) {
    writeParseErrorDiagnostic(workDir, sprintNumber, text, sessionDir);
  }

  return result.contract;
}

/**
 * Write the full raw text from a failed contract parse to a diagnostic file.
 *
 * The file lands under `.adhd/logs/<sessionDir>/` when a session stamp is
 * provided, or under the flat `.adhd/logs/` root when it is absent. This
 * keeps the diagnostic co-located with the run's conversation logs.
 *
 * I/O failures are caught and logged at warning severity so they never mask
 * the original parse failure or crash the run.
 */
async function writeParseErrorDiagnostic(
  workDir: string,
  sprintNumber: number,
  rawText: string,
  sessionDir?: string,
): Promise<void> {
  try {
    const logsBase = join(harnessDir(workDir), "logs");
    const logDir = sessionDir ? join(logsBase, sessionDir) : logsBase;
    await mkdir(logDir, { recursive: true });
    const diagnosticPath = join(logDir, `sprint-${sprintNumber}-contract-parse-error.txt`);
    await writeFile(diagnosticPath, rawText, "utf-8");
    logVerbose("HARNESS", `Wrote contract parse diagnostic to ${diagnosticPath}`);
  } catch (err) {
    logWarn("HARNESS", `Failed to write contract parse diagnostic: ${err}`);
  }
}
