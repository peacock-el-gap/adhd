/**
 * Pure composition helper for the Generator's supplementary context (Sprint 10 / F10).
 *
 * Layers a Scout digest alongside the existing codebase map and verification
 * baseline sections that already live in supplementaryContext. Follows the
 * never-throwing, SDK-free pattern established by shared/contract-parse.ts,
 * shared/scout-digest.ts, and shared/codebase-map.ts.
 *
 * Pure: zero SDK imports, never throws.
 */

import { boundScoutDigest } from "./scout-digest.ts";

/**
 * Heading that marks the Scout digest section in the Generator's prompt.
 * Defined as a named constant so tests and the call site share one source
 * of truth — never inline this string.
 */
export const SCOUT_SECTION_HEADING = "## Scout Digest — Codebase Conventions";

/**
 * Compose a Scout digest into the Generator's supplementary context.
 *
 * Layers the digest under SCOUT_SECTION_HEADING alongside the existing
 * codebase map and verification baseline sections already present in
 * supplementaryContext. Re-applies the MAX_SCOUT_DIGEST_CHARS ceiling
 * (via boundScoutDigest) so a hand-edited artifact cannot bloat the prompt.
 *
 * Returns the supplementaryContext unmodified when scoutDigest is null or
 * empty. Returns undefined when both inputs are absent or empty.
 * Never throws.
 *
 * @param supplementaryContext Existing context string (may be undefined).
 * @param scoutDigest          Digest from readScoutDigest, or null when absent.
 * @returns Composed context string, or undefined when both inputs are absent.
 */
export function composeGeneratorContext(
  supplementaryContext: string | undefined,
  scoutDigest: string | null,
): string | undefined {
  try {
    // boundScoutDigest is never-throwing and handles null/empty → returns ""
    const bounded = boundScoutDigest(scoutDigest);
    if (!bounded) {
      // No digest to inject — return existing context unchanged (including undefined)
      return supplementaryContext;
    }

    const scoutSection = `${SCOUT_SECTION_HEADING}\n\n${bounded}`;

    if (!supplementaryContext) {
      return scoutSection;
    }

    return `${supplementaryContext}\n\n${scoutSection}`;
  } catch {
    // Belt-and-suspenders: any unexpected error returns the context unchanged
    return supplementaryContext;
  }
}
