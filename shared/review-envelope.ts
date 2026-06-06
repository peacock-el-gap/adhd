/**
 * Structured envelope for contract-reviewer responses (Sprint 8 / F8).
 *
 * Before Sprint 8 the reviewer returned either the bare string "APPROVED" or a
 * raw contract JSON object. Going forward it returns a structured envelope so
 * the caller can see what changed and receive the revised contract in one
 * well-typed object. The parser accepts all three forms to maintain backward
 * compatibility during transition.
 *
 * All helpers are pure, zero-SDK, and never-throwing — mirroring the style of
 * `shared/contract-limits.ts` and `shared/verification.ts`.
 */

import { logVerbose } from "./logger.ts";
import type { SprintContract } from "./types.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The structured envelope a reviewer emits (Sprint 8 format).
 * `verdict` drives the caller's contract-source selection;
 * `changes` is a free-text summary of what was altered;
 * `contract` carries the revised contract object when verdict is 'REVISED'.
 */
export interface ReviewEnvelope {
  verdict: "APPROVED" | "REVISED";
  changes: string;
  contract?: SprintContract;
}

/**
 * The normalized result returned by {@link parseReviewEnvelope}.
 *
 * - `verdict: 'approved'` → the reviewer accepted the proposal unchanged;
 *   the caller should use the original proposal text as the contract source.
 * - `verdict: 'revised'` → the reviewer produced a new contract;
 *   `contract` holds the parsed object (null when extraction failed, in which
 *   case the caller may fall back to the raw response text).
 * - `changes` is the human-readable description of revisions (empty string
 *   when approval was signalled or no changes field was present).
 */
export interface ParsedReviewEnvelope {
  verdict: "approved" | "revised";
  /** Parsed contract when verdict is 'revised'; null when approved or on parse failure. */
  contract: SprintContract | null;
  /** Free-text summary of what changed (empty on approval or when unavailable). */
  changes: string;
}

// ---------------------------------------------------------------------------
// Public parser
// ---------------------------------------------------------------------------

/**
 * Parse a contract-reviewer response into a normalized {@link ParsedReviewEnvelope}.
 *
 * Accepted input forms (in order of precedence):
 *
 * 1. **Legacy literal `APPROVED` string** — `text.trim() === 'APPROVED'`.
 *    Returns `{ verdict: 'approved', contract: null, changes: '' }`.
 *
 * 2. **Sprint 8 envelope JSON** — a JSON object with a `verdict` field.
 *    - `verdict === 'APPROVED'` → approved, `contract` is null.
 *    - `verdict === 'REVISED'` → revised; `contract` is taken from the envelope's
 *      `contract` field (if present and contains `criteria`).
 *
 * 3. **Legacy bare-contract JSON** — a JSON object with a `criteria` array but
 *    no `verdict` field. Returns `{ verdict: 'revised', contract: parsed, changes: '' }`.
 *
 * 4. **Unrecognised input** — logs a verbose warning and returns
 *    `{ verdict: 'revised', contract: null, changes: '' }` so the caller can
 *    apply its own fallback (e.g. pass the raw text to `parseContract`).
 *
 * Never throws. Always returns a defined `ParsedReviewEnvelope`.
 */
export function parseReviewEnvelope(text: string): ParsedReviewEnvelope {
  try {
    const trimmed = (text ?? "").trim();

    // Form 1 — legacy literal APPROVED string.
    if (trimmed === "APPROVED") {
      return { verdict: "approved", contract: null, changes: "" };
    }

    // Try to extract a JSON object from the text (handles fenced code blocks,
    // inline JSON, and plain JSON).
    const jsonText = extractJson(trimmed);
    if (jsonText !== null) {
      try {
        const parsed: unknown = JSON.parse(jsonText);

        if (isObject(parsed)) {
          // Form 2 — Sprint 8 envelope: has a `verdict` field.
          if ("verdict" in parsed && typeof (parsed as Record<string, unknown>).verdict === "string") {
            const verdict = ((parsed as Record<string, unknown>).verdict as string).trim().toUpperCase();
            const changes =
              typeof (parsed as Record<string, unknown>).changes === "string"
                ? ((parsed as Record<string, unknown>).changes as string)
                : "";

            if (verdict === "APPROVED") {
              return { verdict: "approved", contract: null, changes };
            }

            // verdict === 'REVISED' (or any other non-APPROVED string)
            const rawContract = (parsed as Record<string, unknown>).contract;
            const contract = extractContractFromValue(rawContract);
            return { verdict: "revised", contract, changes };
          }

          // Form 3 — legacy bare-contract JSON: has `criteria` but no `verdict`.
          if (hasCriteria(parsed)) {
            const contract = parsed as unknown as SprintContract;
            return { verdict: "revised", contract, changes: "" };
          }
        }
      } catch {
        // Fall through to unrecognised-input handling below.
      }
    }

    // Form 4 — unrecognised input.
    const preview = trimmed.length > 200 ? `${trimmed.slice(0, 200)}… (${trimmed.length} chars total)` : trimmed;
    logVerbose(
      "HARNESS",
      `parseReviewEnvelope: could not recognise input format — treating as unresolved revision ` +
        `and letting the caller apply its fallback. Input preview: ${preview}`,
    );
    return { verdict: "revised", contract: null, changes: "" };
  } catch {
    // Absolute last resort — never throw.
    logVerbose("HARNESS", "parseReviewEnvelope: unexpected error during parsing; returning safe fallback.");
    return { verdict: "revised", contract: null, changes: "" };
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** True when `value` is a non-null plain object. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True when the value looks like a SprintContract (has a `criteria` array). */
function hasCriteria(value: unknown): boolean {
  return isObject(value) && Array.isArray((value as Record<string, unknown>).criteria);
}

/**
 * Try to coerce an unknown value from an envelope's `contract` field into a
 * `SprintContract`. Accepts an already-parsed object or a JSON string.
 * Returns null when the value cannot be coerced.
 */
function extractContractFromValue(value: unknown): SprintContract | null {
  try {
    if (hasCriteria(value)) return value as SprintContract;
    if (typeof value === "string") {
      const parsed: unknown = JSON.parse(value);
      if (hasCriteria(parsed)) return parsed as SprintContract;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Extract a JSON string candidate from free-form text. Handles:
 * - Fenced code blocks (``` ```json … ``` ``` or ``` ``` … ``` ```)
 * - Plain JSON (text that starts with `{` after trimming)
 * - Balanced `{…}` block containing "criteria" or "verdict" key
 *
 * Returns null when no candidate is found.
 * Never throws.
 */
function extractJson(text: string): string | null {
  try {
    // Fenced code block — prefer the last one (most specific).
    const fenceMatches = [...text.matchAll(/```(?:json)?\s*\n?([\s\S]*?)```/g)];
    if (fenceMatches.length > 0) {
      const last = fenceMatches[fenceMatches.length - 1];
      if (last?.[1]) return last[1].trim();
    }

    // Plain JSON starting at root.
    const plainTrimmed = text.trim();
    if (plainTrimmed.startsWith("{")) return plainTrimmed;

    // Balanced brace extraction — scan for "verdict" or "criteria" key first.
    const balanced = extractBalancedBrace(text, "verdict") ?? extractBalancedBrace(text, "criteria");
    if (balanced !== null) return balanced;

    return null;
  } catch {
    return null;
  }
}

/**
 * Scan `text` for the first balanced `{…}` block containing `requiredKey`.
 * Returns null when none is found. Never throws.
 */
function extractBalancedBrace(text: string, requiredKey: string): string | null {
  try {
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
  } catch {
    return null;
  }
}
