/**
 * Pure, side-effect-free topic-branch name builder.
 *
 * Produces a branch name of the form `adhd/<slug>-<timestamp>` from a prompt
 * or spec text and a session-start timestamp. The timestamp comes from the
 * same session-start moment used elsewhere in the run (the `fileTimestamp()`
 * shape from `shared/logger.ts`), formatted branch-safe (dots stripped so the
 * git ref contains only alphanumeric characters and hyphens).
 *
 * Design invariants (mirroring `shared/contract-parse.ts` and peers):
 * - Never throws.
 * - Empty or unusable input degrades to the default slug "task".
 * - The slug is bounded to MAX_SLUG_LENGTH characters.
 * - The timestamp argument is injectable so callers stay deterministic under test.
 */

/** Maximum length for the slug portion of the generated branch name. */
export const MAX_SLUG_LENGTH = 40;

/** Safe fallback slug when the input is empty or produces no usable characters. */
const DEFAULT_SLUG = "task";

/**
 * Derive a git-safe topic branch name from a prompt/spec text and a session
 * timestamp.
 *
 * Produces: `adhd/<slug>-<timestamp>`
 *
 * - **slug**: lowercased; non-alphanumeric runs replaced with a single hyphen;
 *   leading/trailing hyphens trimmed; bounded to {@link MAX_SLUG_LENGTH}.
 * - **timestamp**: dots stripped from the `YYYY.MM.DD-HH.MM.SS` fileTimestamp
 *   format → `YYYYMMDD-HHMMSS`, safe as a git ref segment.
 *
 * @param text      The prompt or spec text from which to derive the slug.
 * @param timestamp A session-start stamp in fileTimestamp format (`YYYY.MM.DD-HH.MM.SS`).
 */
export function buildTopicBranchName(text: string, timestamp: string): string {
  const slug = slugifyText(text);
  const safeStamp = makeBranchSafeTimestamp(timestamp);
  return `adhd/${slug}-${safeStamp}`;
}

/**
 * Convert a `fileTimestamp()` string (`YYYY.MM.DD-HH.MM.SS`) to a git-ref-safe
 * form by stripping dots: `YYYYMMDD-HHMMSS`.
 *
 * Exported for callers that need only the timestamp conversion, and to keep
 * the function unit-testable in isolation.
 */
export function makeBranchSafeTimestamp(timestamp: string): string {
  return timestamp.replace(/\./g, "");
}

/**
 * Convert arbitrary text to a lowercase, hyphenated, length-bounded slug
 * suitable for use in a git branch name.
 *
 * Pure and never-throwing — empty or whitespace-only input returns
 * {@link DEFAULT_SLUG}.
 */
function slugifyText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return DEFAULT_SLUG;

  const slug = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-") // non-alphanumeric runs → single hyphen
    .replace(/-+/g, "-") // collapse consecutive hyphens
    .replace(/^-+|-+$/g, ""); // trim leading / trailing hyphens

  if (!slug) return DEFAULT_SLUG;

  // Bound length; re-trim any trailing hyphen exposed by the cut.
  return slug.slice(0, MAX_SLUG_LENGTH).replace(/-+$/, "");
}
