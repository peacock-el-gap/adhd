import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SprintResult } from "./types.ts";

/** Default token budget (in characters) for the artifact digest. */
export const DEFAULT_DIGEST_BUDGET = 100_000;

export interface ArtifactDigestOptions {
  workDir: string;
  sprintResults?: SprintResult[];
  /** Maximum character budget for the digest. Defaults to DEFAULT_DIGEST_BUDGET. */
  tokenBudget?: number;
}

/**
 * Build a structured digest of .adhd/ artifacts for the Documenter agent.
 *
 * Includes: the spec, all sprint contracts, and the final (passing) feedback
 * per sprint. When the combined content exceeds the token budget, contracts
 * and feedback are truncated with a note.
 */
export function buildArtifactDigest(options: ArtifactDigestOptions): string {
  const { workDir, sprintResults, tokenBudget = DEFAULT_DIGEST_BUDGET } = options;
  const hDir = join(workDir, ".adhd");

  // --- 1. Read spec ---
  let spec = "";
  const specPath = join(hDir, "spec.md");
  if (existsSync(specPath)) {
    spec = readFileSync(specPath, "utf-8");
  }

  // --- 2. Read contracts ---
  const contracts: { sprint: number; content: string }[] = [];
  const contractsDir = join(hDir, "contracts");
  if (existsSync(contractsDir)) {
    const files = readdirSync(contractsDir)
      .filter((f) => f.startsWith("sprint-") && f.endsWith(".json"))
      .sort();
    for (const file of files) {
      const match = file.match(/^sprint-(\d+)\.json$/);
      if (match) {
        const sprint = parseInt(match[1], 10);
        contracts.push({
          sprint,
          content: readFileSync(join(contractsDir, file), "utf-8"),
        });
      }
    }
  }

  // --- 3. Read final feedback per sprint ---
  const feedbackEntries: { sprint: number; content: string }[] = [];
  const feedbackDir = join(hDir, "feedback");
  if (existsSync(feedbackDir)) {
    const files = readdirSync(feedbackDir)
      .filter((f) => f.startsWith("sprint-") && f.endsWith(".json"))
      .sort();

    // Group by sprint, pick the highest round per sprint
    const bySprintMax = new Map<number, { round: number; file: string }>();
    for (const file of files) {
      const match = file.match(/^sprint-(\d+)-round-(\d+)\.json$/);
      if (match) {
        const sprint = parseInt(match[1], 10);
        const round = parseInt(match[2], 10);
        const existing = bySprintMax.get(sprint);

        // If we have sprintResults, only include feedback for the final passing attempt
        if (sprintResults) {
          const result = sprintResults.find((r) => r.sprintNumber === sprint);
          if (result && result.passed) {
            // The final passing attempt is at round = (attempts - 1)
            const finalRound = result.attempts - 1;
            if (round === finalRound) {
              bySprintMax.set(sprint, { round, file });
            }
          } else {
            // Sprint didn't pass — include highest round as best effort
            if (!existing || round > existing.round) {
              bySprintMax.set(sprint, { round, file });
            }
          }
        } else {
          // No sprint results — just pick highest round
          if (!existing || round > existing.round) {
            bySprintMax.set(sprint, { round, file });
          }
        }
      }
    }

    const sortedSprints = [...bySprintMax.entries()].sort((a, b) => a[0] - b[0]);
    for (const [sprint, { file }] of sortedSprints) {
      feedbackEntries.push({
        sprint,
        content: readFileSync(join(feedbackDir, file), "utf-8"),
      });
    }
  }

  // --- 4. Build sprint results summary ---
  let resultsSummary = "";
  if (sprintResults && sprintResults.length > 0) {
    resultsSummary = sprintResults
      .map((r) => `- Sprint ${r.sprintNumber}: ${r.passed ? "PASSED" : "FAILED"} (${r.attempts} attempt(s))`)
      .join("\n");
  }

  // --- 5. Assemble with budget enforcement ---
  const specSection = spec ? `## Product Spec\n\n${spec}` : "";

  // Reserve space for spec (always included in full) and headers
  const headerOverhead = 500; // approximate overhead for section headers
  const specSize = specSection.length + headerOverhead;
  const remainingBudget = Math.max(0, tokenBudget - specSize);

  // Build contracts and feedback sections, truncating if needed
  let contractsSection = "";
  let feedbackSection = "";
  let resultsSection = "";

  if (resultsSummary) {
    resultsSection = `## Sprint Results\n\n${resultsSummary}`;
  }

  const resultsSize = resultsSection.length;
  const budgetForContractsAndFeedback = Math.max(0, remainingBudget - resultsSize);

  // Split budget 50/50 between contracts and feedback
  const halfBudget = Math.floor(budgetForContractsAndFeedback / 2);

  // Build contracts section
  if (contracts.length > 0) {
    let contractsText = "";
    let truncated = false;
    for (const c of contracts) {
      const entry = `### Sprint ${c.sprint} Contract\n\n\`\`\`json\n${c.content}\n\`\`\`\n\n`;
      if (contractsText.length + entry.length > halfBudget) {
        truncated = true;
        break;
      }
      contractsText += entry;
    }
    if (truncated) {
      contractsText += `\n> **Note**: Some contracts were truncated due to context size limits.\n`;
    }
    contractsSection = `## Sprint Contracts\n\n${contractsText}`;
  }

  // Build feedback section
  if (feedbackEntries.length > 0) {
    let feedbackText = "";
    let truncated = false;
    for (const f of feedbackEntries) {
      const entry = `### Sprint ${f.sprint} Final Feedback\n\n\`\`\`json\n${f.content}\n\`\`\`\n\n`;
      if (feedbackText.length + entry.length > halfBudget) {
        truncated = true;
        break;
      }
      feedbackText += entry;
    }
    if (truncated) {
      feedbackText += `\n> **Note**: Some feedback was truncated due to context size limits.\n`;
    }
    feedbackSection = `## Evaluation Feedback\n\n${feedbackText}`;
  }

  // Assemble final digest
  const sections = [specSection, contractsSection, feedbackSection, resultsSection].filter(Boolean);
  return sections.join("\n\n");
}
