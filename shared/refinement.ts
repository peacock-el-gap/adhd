/**
 * Progressive Spec Refinement (Feature 1.6 / Sprint 7)
 *
 * After each passing sprint (when --refine-spec is set), the Planner is re-invoked
 * to propose adjustments for remaining sprints. Completed sprints are frozen.
 *
 * Sprint 7 upgrade: refinement is now patch-based. The Planner emits only the
 * revised remaining-sprint sections; spliceRefinementSections assembles the full
 * spec by prepending the frozen completed sections from the original.
 */

import { log } from "./logger.ts";

/**
 * Extract a specific sprint section from a spec.
 * Returns the content of "## Sprint N" through to the next "## Sprint" or end of string.
 * @param spec - The full spec markdown content
 * @param sprintNumber - The sprint number to extract (e.g. 1, 2, 3)
 * @returns The sprint section content, or null if not found
 */
export function extractSprintSection(spec: string, sprintNumber: number): string | null {
  const pattern = new RegExp(`(##\\s*Sprint\\s+${sprintNumber}\\b[^\\n]*\\n)([\\s\\S]*?)(?=##\\s*Sprint\\s+\\d|$)`);
  const match = spec.match(pattern);
  if (!match) return null;
  return ((match[1] ?? "") + (match[2] ?? "")).trimEnd();
}

/**
 * Extract all completed sprint sections (sprints 1..completedSprint) from a spec.
 * Returns a map of sprint number -> section content.
 * @param spec - The full spec markdown content
 * @param completedSprint - The highest completed sprint number
 * @returns Map of sprint number to section content for all completed sprints
 */
export function extractCompletedSprintSections(spec: string, completedSprint: number): Map<number, string> {
  const sections = new Map<number, string>();
  for (let i = 1; i <= completedSprint; i++) {
    const section = extractSprintSection(spec, i);
    if (section) {
      sections.set(i, section);
    }
  }
  return sections;
}

/**
 * Freeze completed sprint sections in a proposed spec by replacing them
 * with the original sections. This ensures completed sprints cannot be modified.
 * @param proposedSpec - The proposed revised spec content
 * @param originalSections - Map of sprint number to original section content to preserve
 * @returns The spec with completed sprint sections restored to their original content
 */
export function freezeCompletedSprints(proposedSpec: string, originalSections: Map<number, string>): string {
  let result = proposedSpec;
  for (const [sprintNumber, originalContent] of originalSections) {
    const proposedSection = extractSprintSection(result, sprintNumber);
    if (proposedSection && proposedSection !== originalContent) {
      result = result.replace(proposedSection, originalContent);
    }
  }
  return result;
}

/**
 * Assemble a complete revised spec from the frozen completed sections and the
 * Planner's partial output (remaining-sprint sections only).
 *
 * This is the Sprint 7 patch-based assembly path. The Planner is instructed to
 * emit only the revised remaining-sprint sections; this function prepends the
 * original preamble and the verbatim completed sections, then appends the
 * Planner's output starting from the first remaining ## Sprint N heading.
 *
 * Fallback contract (never-throwing):
 * - If revisedRemainingContent is empty or blank → returns originalSpec unchanged.
 * - If no ## Sprint N heading is found in revisedRemainingContent → returns
 *   originalSpec unchanged.
 * - On any unexpected error → returns originalSpec unchanged.
 * In every fallback case, exactly one line is logged at normal level.
 *
 * @param originalSpec - The full original spec (used as fallback and for preamble)
 * @param completedSections - Map of sprint number → verbatim section (from extractCompletedSprintSections)
 * @param revisedRemainingContent - The Planner's output (remaining sections only)
 * @param completedSprint - The highest completed sprint number
 * @returns Assembled full spec, or originalSpec on any unresolvable input
 */
export function spliceRefinementSections(
  originalSpec: string,
  completedSections: Map<number, string>,
  revisedRemainingContent: string,
  completedSprint: number,
): string {
  try {
    // Empty Planner response → fallback
    if (!revisedRemainingContent || revisedRemainingContent.trim().length === 0) {
      log("HARNESS", "Spec refinement splice: Planner returned no content — preserving original spec.");
      return originalSpec;
    }

    // Locate the first remaining-sprint heading (## Sprint completedSprint+1).
    // Fall back to a fuzzy search for any ## Sprint N where N > completedSprint
    // to handle cases where the Planner returned the full spec or headed drift.
    const firstRemaining = completedSprint + 1;
    const exactPattern = new RegExp(`^##\\s*Sprint\\s+${firstRemaining}\\b`, "im");
    let sprintMatch: RegExpExecArray | null = exactPattern.exec(revisedRemainingContent);

    if (!sprintMatch) {
      // Fuzzy: find all ## Sprint N headings and pick the first one with N > completedSprint
      const fuzzyPattern = /^##\s*Sprint\s+(\d+)/gim;
      const allMatches = [...revisedRemainingContent.matchAll(fuzzyPattern)];
      for (const candidate of allMatches) {
        const n = parseInt(candidate[1] ?? "0", 10);
        if (n > completedSprint) {
          sprintMatch = candidate as RegExpExecArray;
          break;
        }
      }
    }

    if (!sprintMatch) {
      log(
        "HARNESS",
        "Spec refinement splice: no remaining-sprint heading found in Planner output — preserving original spec.",
      );
      return originalSpec;
    }

    // Extract preamble from the original spec (everything before ## Sprint 1)
    const firstSprintInOriginal = /^##\s*Sprint\s+\d+/im.exec(originalSpec);
    const preamble = firstSprintInOriginal ? originalSpec.slice(0, firstSprintInOriginal.index).trimEnd() : "";

    // Assemble completed sections in ascending order
    const completedNumbers = Array.from(completedSections.keys()).sort((a, b) => a - b);
    const completedParts = completedNumbers.map((n) => completedSections.get(n) ?? "").filter(Boolean);

    // Remaining sections start at the located sprint heading
    const remainingContent = revisedRemainingContent.slice(sprintMatch.index).trimEnd();

    // Assemble: preamble (if any) + completed + remaining
    const parts: string[] = [];
    if (preamble) parts.push(preamble);
    parts.push(...completedParts);
    parts.push(remainingContent);

    return parts.join("\n\n");
  } catch {
    log("HARNESS", "Spec refinement splice: unexpected error during assembly — preserving original spec.");
    return originalSpec;
  }
}

/**
 * Count the number of sprint sections in a spec by matching ## Sprint N headings.
 * @param spec - The full spec markdown content
 * @returns The number of sprint sections found
 */
export function countSprints(spec: string): number {
  const matches = spec.match(/##\s*Sprint\s+\d+/gi);
  return matches ? matches.length : 0;
}

/**
 * Compute a line-level diff between two strings.
 * Returns lines prefixed with '+' for additions and '-' for removals.
 * Returns null if the strings are identical.
 * @param oldSpec - The original spec content
 * @param newSpec - The proposed new spec content
 * @returns Diff string with +/- prefixed lines, or null if strings are identical
 */
export function computeSpecDiff(oldSpec: string, newSpec: string): string | null {
  if (oldSpec === newSpec) return null;

  const oldLines = oldSpec.split("\n");
  const newLines = newSpec.split("\n");

  // Simple line-level diff using LCS approach
  const diffLines: string[] = [];
  const oldSet = new Map<string, number[]>();

  // Build index of old lines
  for (let i = 0; i < oldLines.length; i++) {
    const line = oldLines[i] ?? "";
    if (!oldSet.has(line)) oldSet.set(line, []);
    oldSet.get(line)?.push(i);
  }

  // Use a simple diff algorithm: walk both arrays
  let oi = 0;
  let ni = 0;

  while (oi < oldLines.length || ni < newLines.length) {
    if (oi >= oldLines.length) {
      // Remaining new lines are additions
      diffLines.push(`+ ${newLines[ni]}`);
      ni++;
    } else if (ni >= newLines.length) {
      // Remaining old lines are removals
      diffLines.push(`- ${oldLines[oi]}`);
      oi++;
    } else if (oldLines[oi] === newLines[ni]) {
      // Lines match — skip (context)
      oi++;
      ni++;
    } else {
      // Lines differ — look ahead to find the best match
      const lookAhead = 5;
      let foundInNew = -1;
      let foundInOld = -1;

      // Check if old line appears later in new
      for (let j = ni + 1; j < Math.min(ni + lookAhead, newLines.length); j++) {
        if (newLines[j] === oldLines[oi]) {
          foundInNew = j;
          break;
        }
      }

      // Check if new line appears later in old
      for (let j = oi + 1; j < Math.min(oi + lookAhead, oldLines.length); j++) {
        if (oldLines[j] === newLines[ni]) {
          foundInOld = j;
          break;
        }
      }

      if (foundInNew >= 0 && (foundInOld < 0 || foundInNew - ni <= foundInOld - oi)) {
        // New lines were added before the match
        while (ni < foundInNew) {
          diffLines.push(`+ ${newLines[ni]}`);
          ni++;
        }
      } else if (foundInOld >= 0) {
        // Old lines were removed
        while (oi < foundInOld) {
          diffLines.push(`- ${oldLines[oi]}`);
          oi++;
        }
      } else {
        // No match found in lookahead — treat as replacement
        diffLines.push(`- ${oldLines[oi]}`);
        diffLines.push(`+ ${newLines[ni]}`);
        oi++;
        ni++;
      }
    }
  }

  if (diffLines.length === 0) return null;
  return diffLines.join("\n");
}

/**
 * Build the Planner re-invocation prompt for spec refinement.
 *
 * Sprint 7: The Planner is instructed to emit ONLY the revised remaining-sprint
 * sections (starting with ## Sprint N, where N is the first remaining sprint).
 * The harness assembles the full spec by splicing these sections after the frozen
 * completed sections — so re-emitting completed content is explicitly forbidden.
 *
 * @param currentSpec - The current spec markdown content (provided as reference)
 * @param completedSprints - Array of completed sprint numbers
 * @param remainingSprints - Array of remaining sprint numbers to be refined
 * @returns Formatted prompt string for the Planner agent
 */
export function buildRefinementPrompt(
  currentSpec: string,
  completedSprints: number[],
  remainingSprints: number[],
): string {
  const firstRemaining = remainingSprints[0] ?? 1;
  const completedList = completedSprints.length > 0 ? completedSprints.map((n) => `## Sprint ${n}`).join(", ") : "none";

  return `## Current Spec (reference — do NOT re-emit this content)

${currentSpec}

## Sprint Status

Completed sprints: ${completedSprints.join(", ") || "none"}
Remaining sprints: ${remainingSprints.join(", ")}

## Instructions

You are refining the product spec after sprint ${completedSprints[completedSprints.length - 1] ?? 0} has passed.
The current spec above and the codebase map in your supplementary context give you full project context.

**Output only the revised remaining-sprint sections** — the harness will prepend the completed
sections automatically.

1. Propose adjustments to the REMAINING sprints (${remainingSprints.join(", ")}) based on what was actually built.
2. You may revise scope, content, or order of remaining sprints as needed. You may add or remove sprints.
3. Do NOT re-emit any completed sprint sections (${completedList}).
4. Do NOT include any preamble, overview, or non-sprint content.
5. Write your output to .adhd/spec.md starting with \`## Sprint ${firstRemaining}\`.

CRITICAL: Your output MUST start with \`## Sprint ${firstRemaining}\` and contain ONLY the remaining sprint sections.
Do NOT include ${completedList} — those sections are preserved verbatim by the harness.`;
}
