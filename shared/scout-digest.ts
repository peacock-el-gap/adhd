/**
 * Scout digest bounding/shaping helper (Sprint 9 / F9).
 *
 * Pure: zero SDK imports, never throws. Shapes and bounds the semantic digest
 * produced by the Scout agent before it is persisted and later injected into
 * the Generator (Sprint 10 will handle injection).
 *
 * Follows the same character-budget discipline as MAX_CODEBASE_MAP_CHARS in
 * shared/codebase-map.ts — a sibling constant rather than overloading the map's
 * ceiling.
 */

/**
 * Hard character ceiling for the assembled Scout digest.
 * Consistent in style with MAX_CODEBASE_MAP_CHARS in shared/codebase-map.ts.
 */
export const MAX_SCOUT_DIGEST_CHARS = 16_000;

/** Truncation marker appended when the raw digest exceeds the ceiling. */
const TRUNCATION_MARKER = "\n\n[... scout digest truncated to fit size limit ...]";

/**
 * Bound a raw Scout digest to MAX_SCOUT_DIGEST_CHARS.
 *
 * Appends a truncation marker when the input exceeds the ceiling.
 * Accepts any value; returns an empty string for null, undefined, or
 * non-stringifiable input. Never throws.
 *
 * @param raw Any value from the Scout agent response.
 * @returns A UTF-16 character-bounded string safe to persist and inject.
 */
export function boundScoutDigest(raw: unknown): string {
  try {
    if (raw === null || raw === undefined) return "";
    const str = typeof raw === "string" ? raw : String(raw);
    if (!str || str.trim().length === 0) return "";
    if (str.length <= MAX_SCOUT_DIGEST_CHARS) return str;
    return str.slice(0, MAX_SCOUT_DIGEST_CHARS) + TRUNCATION_MARKER;
  } catch {
    return "";
  }
}
