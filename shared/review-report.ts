/**
 * Review report bounding/shaping helpers (Sprint 13 / F13).
 *
 * Pure: zero SDK imports, never throws. Shapes and bounds the structured
 * report produced by the Reviewer agent before it is persisted.
 *
 * Follows the same character-budget discipline as the codebase-map and scout
 * digest sibling modules — a dedicated constant rather than overloading any
 * existing ceiling.
 */

/**
 * Hard character ceiling for the assembled Reviewer report.
 * A dedicated sibling constant with the same discipline as the codebase-map
 * and scout-digest ceilings, but independently defined here.
 */
export const MAX_REVIEW_REPORT_CHARS = 16_000;

/** Truncation marker appended when the raw report exceeds the ceiling. */
const TRUNCATION_MARKER = "\n\n[... review report truncated to fit size limit ...]";

/**
 * Structured review report produced by the Reviewer agent.
 * A bounded string is the primary carrier; structured fields may be
 * added in future sprints.
 */
export interface ReviewReport {
  /** Bounded textual report on code craft. Empty string when absent. */
  report: string;
}

/** Safe empty report used as a fallback when parsing or bounding fails. */
export const EMPTY_REVIEW_REPORT: ReviewReport = Object.freeze({ report: "" });

/**
 * Bound a raw Reviewer report string to MAX_REVIEW_REPORT_CHARS.
 *
 * Appends a truncation marker when the input exceeds the ceiling.
 * Accepts any value; returns an empty string for null, undefined, or
 * non-stringifiable input. Never throws.
 *
 * @param raw Any value from the Reviewer agent response.
 * @returns A UTF-16 character-bounded string safe to persist.
 */
export function boundReviewReport(raw: unknown): string {
  try {
    if (raw === null || raw === undefined) return "";
    const str = typeof raw === "string" ? raw : String(raw);
    if (!str || str.trim().length === 0) return "";
    if (str.length <= MAX_REVIEW_REPORT_CHARS) return str;
    return str.slice(0, MAX_REVIEW_REPORT_CHARS - TRUNCATION_MARKER.length) + TRUNCATION_MARKER;
  } catch {
    return "";
  }
}

/**
 * Parse a raw Reviewer agent response into a ReviewReport.
 *
 * The Reviewer produces plain text. This helper wraps the bounded text in
 * the ReviewReport shape. Never throws — returns EMPTY_REVIEW_REPORT for
 * null, undefined, empty, or malformed input.
 *
 * @param raw Any value from the Reviewer agent response.
 * @returns A ReviewReport with a bounded report string.
 */
export function parseReviewReport(raw: unknown): ReviewReport {
  try {
    const bounded = boundReviewReport(raw);
    return { report: bounded };
  } catch {
    return { ...EMPTY_REVIEW_REPORT };
  }
}
