import { processAgentStream } from "../shared/agent-stream.ts";
import { createConversationLog } from "../shared/conversation-logger.ts";
import { logError } from "../shared/logger.ts";
import { CONTRACT_NEGOTIATION_EVALUATOR_PROMPT, CONTRACT_NEGOTIATION_GENERATOR_PROMPT } from "../shared/prompts.ts";
import type { Options } from "../shared/tracing.ts";
import type { SprintContract } from "../shared/types.ts";
import type { UsageTracker } from "../shared/usage.ts";

export async function negotiateContract(
  workDir: string,
  spec: string,
  sprintNumber: number,
  proposalModel: string,
  reviewModel: string,
  usage?: UsageTracker,
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

  const convLog = createConversationLog(workDir, "contract-negotiation", sprintNumber, undefined, {
    model: proposalModel,
    startTime,
  });

  const proposalResult = await processAgentStream(proposalPrompt, proposalOptions, "HARNESS", "quiet", convLog, {
    onResult(result) {
      usage?.recordStage(`sprint-${sprintNumber}-contract-proposal`, result);
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
      usage?.recordStage(`sprint-${sprintNumber}-contract-review`, result);
    },
  });
  const reviewText = reviewResult.response;

  const duration = Date.now() - startTime.getTime();
  await convLog.finalize(duration);

  // Parse the final contract (either the proposal if approved, or the revised version)
  const contractSource = reviewText.trim() === "APPROVED" ? proposalText : reviewText;
  return parseContract(contractSource, sprintNumber);
}

/**
 * Extract the first balanced {...} block from text that contains the required key.
 * Uses bracket-depth counting to handle nested JSON correctly.
 */
export function extractBalancedJson(text: string, requiredKey: string): string | null {
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

export function parseContract(text: string, sprintNumber: number): SprintContract {
  // Try multiple extraction strategies
  const candidates: string[] = [];
  const codeBlocks = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)];
  for (const match of codeBlocks.reverse()) {
    if (match[1]) candidates.push(match[1].trim());
  }
  const balanced = extractBalancedJson(text, "criteria");
  if (balanced) candidates.push(balanced);
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

  logError("HARNESS", "Failed to parse contract JSON, creating default");
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
