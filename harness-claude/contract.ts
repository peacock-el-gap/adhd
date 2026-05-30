import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { makeIdentity } from "../shared/agent-identity.ts";
import { createConversationLog } from "../shared/conversation-logger.ts";
import { harnessDir } from "../shared/files.ts";
import { log, logError } from "../shared/logger.ts";
import type { NegotiateContractOptions } from "../shared/orchestration/types.ts";
import { CONTRACT_NEGOTIATION_EVALUATOR_PROMPT, CONTRACT_NEGOTIATION_GENERATOR_PROMPT } from "../shared/prompts.ts";
import type { SprintContract } from "../shared/types.ts";
import { runAgent } from "./run-agent.ts";

export async function negotiateContract(opts: NegotiateContractOptions): Promise<SprintContract> {
  const { workDir, spec, sprintNumber, proposalModel, reviewModel, usage } = opts;
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
    systemPrompt: CONTRACT_NEGOTIATION_EVALUATOR_PROMPT,
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

  await convLog.finalize(Date.now() - startTime.getTime());

  // Parse the final contract (either the proposal if approved, or the revised version)
  const contractSource = reviewText.trim() === "APPROVED" ? proposalText : reviewText;
  return parseContract(contractSource, sprintNumber, workDir);
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
