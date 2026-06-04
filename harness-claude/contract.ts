import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { makeIdentity } from "../shared/agent-identity.ts";
import { type ContractLimits, exceedsContractLimits, trimContractToLimits } from "../shared/contract-limits.ts";
import { type ConversationLogger, createConversationLog } from "../shared/conversation-logger.ts";
import { harnessDir } from "../shared/files.ts";
import { log, logError } from "../shared/logger.ts";
import type { NegotiateContractOptions } from "../shared/orchestration/types.ts";
import { buildContractReviewPrompt, CONTRACT_NEGOTIATION_GENERATOR_PROMPT } from "../shared/prompts.ts";
import { normalizeSurfaces } from "../shared/surfaces.ts";
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

  const convLog = createConversationLog(workDir, negotiationIdentity, { model: proposalModel, startTime });

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
  });
  if (proposalResult.sdkResult) {
    usage?.recordStage(`sprint-${sprintNumber}-contract-proposal`, proposalModel, proposalResult.sdkResult);
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
  });
  if (reviewResult.sdkResult) {
    usage?.recordStage(`sprint-${sprintNumber}-contract-review`, reviewModel, reviewResult.sdkResult);
  }
  const reviewText = reviewResult.response;

  // Parse the final contract (either the proposal if approved, or the revised
  // version). Enforcement runs AFTER this selection so an oversized proposal the
  // reviewer returned "APPROVED" on is still caught.
  const contractSource = reviewText.trim() === "APPROVED" ? proposalText : reviewText;
  const parsed = parseContract(contractSource, sprintNumber, workDir);

  const finalContract = await enforceContractCeiling(parsed, limits, {
    workDir,
    sprintNumber,
    reviewModel,
    reviewPrompt,
    usage,
    convLog,
    timestamp: negotiationIdentity.timestamp,
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
  usage?: UsageTracker;
  convLog: ConversationLogger;
  timestamp: string;
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
    ctx.usage?.recordStage(`sprint-${ctx.sprintNumber}-contract-narrowing`, ctx.reviewModel, result.sdkResult);
  }

  // "APPROVED" means the reviewer declined to narrow; keep the current contract
  // and let the deterministic trim handle it.
  if (result.response.trim() === "APPROVED") {
    return contract;
  }
  return parseContract(result.response, ctx.sprintNumber, ctx.workDir);
}

/**
 * Extract a balanced {...} block from text that contains the required key.
 *
 * Default: forward scan, returns the first balanced block containing the key.
 *
 * With `{ fromEnd: true }`: scans backward from the last `}`, returning the
 * innermost-to-outermost balanced block. This is the right strategy for
 * verdict-shaped responses where the real JSON is always the trailing balanced
 * block and earlier text may contain JSX/Python braces from Read tool output.
 */
export function extractBalancedJson(text: string, requiredKey: string, opts?: { fromEnd?: boolean }): string | null {
  if (opts?.fromEnd) {
    let end = -1;
    let depth = 0;
    for (let i = text.length - 1; i >= 0; i--) {
      if (text[i] === "}") {
        if (depth === 0) end = i;
        depth++;
      } else if (text[i] === "{") {
        depth--;
        if (depth === 0 && end >= 0) {
          const candidate = text.slice(i, end + 1);
          if (candidate.includes(`"${requiredKey}"`)) {
            return candidate;
          }
          end = -1;
        }
      }
    }
    return null;
  }

  let start = -1;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (text[i] === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        const candidate = text.slice(start, i + 1);
        if (candidate.includes(`"${requiredKey}"`)) {
          return candidate;
        }
        start = -1;
      }
    }
  }
  return null;
}

/**
 * If `text` contains an opening ``` ```json ``` or ``` ``` ``` fence with no
 * matching closing fence (truncation case), return everything from the opener
 * to end-of-text. Returns null if fences are balanced or no opener exists.
 */
export function extractUnclosedFence(text: string): string | null {
  const fenceRegex = /```(?:json)?\s*\n/g;
  const openers: number[] = [];
  for (const m of text.matchAll(fenceRegex)) {
    if (m.index !== undefined) openers.push(m.index + m[0].length);
  }
  if (openers.length === 0) return null;
  // Count all fences (opening or closing) to see if the last opener has a closer
  const allFences = [...text.matchAll(/```/g)];
  if (allFences.length % 2 === 0) return null; // balanced
  const lastOpener = openers[openers.length - 1]!;
  return text.slice(lastOpener).trim();
}

/** Maximum characters to show in the console preview on parse failure. */
const PARSE_ERROR_PREVIEW_LENGTH = 500;

export function parseContract(text: string, sprintNumber: number, workDir?: string): SprintContract {
  // Try multiple extraction strategies
  const candidates: string[] = [];
  const codeBlocks = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)];
  for (const match of codeBlocks.reverse()) {
    if (match[1]) candidates.push(match[1].trim());
  }
  const balancedFromEnd = extractBalancedJson(text, "criteria", { fromEnd: true });
  if (balancedFromEnd) candidates.push(balancedFromEnd);
  const balanced = extractBalancedJson(text, "criteria");
  if (balanced && balanced !== balancedFromEnd) candidates.push(balanced);
  const unclosed = extractUnclosedFence(text);
  if (unclosed) candidates.push(unclosed);
  candidates.push(text.trim());

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as SprintContract;
      if (parsed.criteria && Array.isArray(parsed.criteria)) {
        parsed.sprintNumber = sprintNumber;
        // Filter surfaces to the allowed vocabulary; malformed input degrades
        // gracefully rather than propagating unknown tokens downstream.
        parsed.surfaces = normalizeSurfaces(parsed.surfaces);
        return parsed;
      }
    } catch {
      // Try next candidate
    }
  }

  // Parse failure — log truncated preview and write diagnostic file
  const preview =
    text.length > PARSE_ERROR_PREVIEW_LENGTH
      ? `${text.slice(0, PARSE_ERROR_PREVIEW_LENGTH)}... (truncated, ${text.length} chars total)`
      : text;
  logError(
    "HARNESS",
    `Failed to parse contract JSON for sprint ${sprintNumber}, creating default. Raw text preview:\n${preview}`,
  );

  if (workDir) {
    writeParseErrorDiagnostic(workDir, sprintNumber, text);
  }

  return {
    sprintNumber,
    features: [`Sprint ${sprintNumber} features`],
    criteria: [
      {
        name: "basic_functionality",
        description: "Core features for this sprint are implemented and working",
        threshold: 7,
      },
      {
        name: "code_quality",
        description: "Code is clean, well-structured, and follows best practices",
        threshold: 7,
      },
      {
        name: "error_handling",
        description: "Errors are handled gracefully with appropriate user feedback",
        threshold: 7,
      },
    ],
  };
}

/**
 * Write the full raw text from a failed contract parse to a diagnostic file.
 * Errors during writing are logged but never mask the original parse failure.
 */
async function writeParseErrorDiagnostic(workDir: string, sprintNumber: number, rawText: string): Promise<void> {
  try {
    const logsDir = join(harnessDir(workDir), "logs");
    await mkdir(logsDir, { recursive: true });
    const diagnosticPath = join(logsDir, `sprint-${sprintNumber}-contract-parse-error.txt`);
    await writeFile(diagnosticPath, rawText, "utf-8");
    log("HARNESS", `Wrote contract parse error diagnostic to ${diagnosticPath}`);
  } catch (err) {
    logError("HARNESS", `Failed to write contract parse error diagnostic: ${err}`);
  }
}
