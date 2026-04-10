/**
 * Progressive Spec Refinement (Feature 1.6)
 *
 * After each passing sprint (when --refine-spec is set), the Planner is re-invoked
 * to propose adjustments for remaining sprints. Completed sprints are frozen.
 */

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
 * @param currentSpec - The current spec markdown content
 * @param completedSprints - Array of completed sprint numbers
 * @param remainingSprints - Array of remaining sprint numbers to be refined
 * @returns Formatted prompt string for the Planner agent
 */
export function buildRefinementPrompt(
  currentSpec: string,
  completedSprints: number[],
  remainingSprints: number[],
): string {
  return `## Current Spec

${currentSpec}

## Sprint Status

Completed sprints: ${completedSprints.join(", ")}
Remaining sprints: ${remainingSprints.join(", ")}

## Instructions

You are refining the product spec after sprint ${completedSprints[completedSprints.length - 1]} has passed.

1. Read the actual codebase to understand what was built so far.
2. Propose adjustments to the REMAINING sprints (${remainingSprints.join(", ")}) based on what was actually built.
3. You MUST preserve all completed sprint sections (${completedSprints.map((n) => `## Sprint ${n}`).join(", ")}) EXACTLY as they are — do not modify a single character in completed sprint sections.
4. Only modify not-yet-started sprint sections and any non-sprint content that needs updating.
5. You may add new sprints or remove sprints if the scope has changed.
6. Write the complete revised spec to .adhd/spec.md. Include ALL sections — both the preserved completed sprints and the revised remaining sprints.

CRITICAL: The completed sprint sections must be preserved verbatim. Do not rewrite, reformat, or change them in any way.`;
}
