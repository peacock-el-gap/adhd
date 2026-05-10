import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createConversationLog } from "../shared/conversation-logger.ts";
import { harnessDir } from "../shared/files.ts";
import { log, logError } from "../shared/logger.ts";
import { CONTRACT_NEGOTIATION_EVALUATOR_PROMPT, CONTRACT_NEGOTIATION_GENERATOR_PROMPT } from "../shared/prompts.ts";
import type { SprintContract } from "../shared/types.ts";
import type { UsageTracker } from "../shared/usage.ts";
import { processAgentStream } from "./agent-stream.ts";
import type { Options } from "./tracing-claude.ts";

export async function negotiateContract(
  workDir: string,
  spec: string,
  sprintNumber: number,
  proposalModel: string,
  reviewModel: string,
  usage?: UsageTracker,
  logTimestamp?: string,
): Promise<SprintContract> {
  const startTime = new Date();

  // Generator proposes contract
  const proposalPrompt = `## Product Spec\n\n${spec}\n\n## Sprint Number: ${sprintNumber}\n\nPropose a sprint contract for this sprint.`;

  const proposalOptions: Options = {
    cwd: workDir,
    systemPrompt: CONTRACT_NEGOTIATION_GENERATOR_PROMPT,
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    tools: [],
    model: proposalModel,
    maxTurns: 1,
    persistSession: false,
  };

  const convLog = createConversationLog(
    workDir,
    "contract-negotiation",
    sprintNumber,
    undefined,
    {
      model: proposalModel,
      startTime,
    },
    logTimestamp,
  );

  const proposalResult = await processAgentStream(proposalPrompt, proposalOptions, "HARNESS", "quiet", convLog, {
    onResult(result) {
      usage?.recordStage(`sprint-${sprintNumber}-contract-proposal`, proposalModel, result);
    },
  });
  const proposalText = proposalResult.response;

  // Evaluator reviews contract
  const reviewPrompt = `## Proposed Sprint Contract\n\n${proposalText}\n\nReview this contract.`;

  const reviewOptions: Options = {
    cwd: workDir,
    systemPrompt: CONTRACT_NEGOTIATION_EVALUATOR_PROMPT,
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    tools: [],
    model: reviewModel,
    maxTurns: 1,
    persistSession: false,
  };

  const reviewResult = await processAgentStream(reviewPrompt, reviewOptions, "HARNESS", "quiet", convLog, {
    onResult(result) {
      usage?.recordStage(`sprint-${sprintNumber}-contract-review`, reviewModel, result);
    },
  });
  const reviewText = reviewResult.response;

  const duration = Date.now() - startTime.getTime();
  await convLog.finalize(duration);

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
