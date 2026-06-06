/**
 * Pure topic-branch name builder.
 *
 * Derives a collision-free git branch name from a prompt or spec text plus a
 * timestamp, following the project naming convention `adhd/<slug>-<timestamp>`.
 *
 * Design:
 *   - No side effects, no I/O, no logging — a pure transformation.
 *   - Never throws; degenerate / empty / null input degrades to a safe default.
 *   - The timestamp may be supplied as an argument so tests stay deterministic.
 *   - Reuses the `YYYY.MM.DD-HH.MM.SS` timestamp shape produced by
 *     `fileTimestamp()` in `shared/logger.ts` — the same stamp used for
 *     log filenames and per-session directories, so branch names and logs
 *     share one identity when both are created at the same session start.
 *
 * Branch name anatomy:
 *   adhd/<slug>-<timestamp>
 *   └ prefix ┘└  slug   ┘└   YYYY.MM.DD-HH.MM.SS  ┘
 */

import { fileTimestamp } from "./logger.ts";

/** Maximum number of characters the slug portion may occupy. */
export const TOPIC_BRANCH_SLUG_MAX_LENGTH = 50;

/** Fallback slug used when the input is empty, whitespace-only, or unusable. */
export const TOPIC_BRANCH_DEFAULT_SLUG = "run";

/**
 * Sanitize a raw string into a git-safe, URL-safe slug:
 *   - Lowercased
 *   - Any character that is not a-z, 0-9 replaced with a hyphen
 *   - Consecutive hyphens collapsed to one
 *   - Leading and trailing hyphens removed
 */
export function sanitizeSlug(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Bound a slug to `TOPIC_BRANCH_SLUG_MAX_LENGTH` characters, never cutting
 * mid-hyphen (no trailing hyphen after bounding).
 */
export function boundSlug(slug: string): string {
  if (slug.length <= TOPIC_BRANCH_SLUG_MAX_LENGTH) {
    return slug;
  }
  const truncated = slug.slice(0, TOPIC_BRANCH_SLUG_MAX_LENGTH);
  // Remove any trailing hyphen left by the cut.
  return truncated.replace(/-+$/, "");
}

/**
 * Build a topic-branch name from a prompt or spec text.
 *
 * @param promptText  - The prompt or spec text to derive the slug from.
 *                      Any value (including null / undefined) is safe to pass.
 * @param timestamp   - Optional pre-computed timestamp in `YYYY.MM.DD-HH.MM.SS`
 *                      format.  When omitted the current wall-clock time is used.
 *                      Supply a fixed value in tests to keep assertions deterministic.
 * @returns           A string matching `adhd/<slug>-<timestamp>`, always valid.
 */
export function buildTopicBranchName(promptText: string | null | undefined, timestamp?: string): string {
  const stamp = timestamp ?? fileTimestamp();

  const raw = typeof promptText === "string" ? promptText : "";
  const sanitized = sanitizeSlug(raw);
  const slug = sanitized.length > 0 ? boundSlug(sanitized) : TOPIC_BRANCH_DEFAULT_SLUG;

  return `adhd/${slug}-${stamp}`;
}
