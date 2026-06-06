/**
 * Pure contract-parse decision — no side effects.
 *
 * This module contains the logic that decides whether raw LLM text contains a
 * valid SprintContract. It intentionally imports NO logger, NO file-system
 * module, and makes NO console calls so that it can be exercised in unit tests
 * without triggering alarming output or disk writes.
 *
 * The side-effectful wrapper (`parseContract` in harness-claude/contract.ts)
 * calls {@link parseContractText} and handles logging and diagnostics on
 * failure.
 */

import { normalizeSurfaces } from "./surfaces.ts";
import type { SprintContract } from "./types.ts";

// ── Result types ─────────────────────────────────────────────────────────────

/** A successful contract parse: the parsed, normalized contract. */
export interface ContractParseSuccess {
  readonly ok: true;
  readonly contract: SprintContract;
}

/**
 * A failed contract parse: the generic default contract plus the information
 * needed to report and diagnose the failure.
 */
export interface ContractParseFailure {
  readonly ok: false;
  /** The generic default contract used as a fallback. */
  readonly contract: SprintContract;
  /** The full raw text that failed to parse. */
  readonly rawText: string;
  /**
   * A bounded preview of the raw text — at most
   * {@link PARSE_ERROR_PREVIEW_MAX_LENGTH} characters. Inputs shorter than the
   * limit are returned in full and are never truncated.
   */
  readonly preview: string;
}

/** Discriminated union result of {@link parseContractText}. */
export type ContractParseResult = ContractParseSuccess | ContractParseFailure;

// ── Constants ─────────────────────────────────────────────────────────────────

/** Maximum characters included in the bounded preview for a failed parse. */
export const PARSE_ERROR_PREVIEW_MAX_LENGTH = 200;

// ── Default contract ──────────────────────────────────────────────────────────

/**
 * Build the harness's generic default contract for a given sprint number.
 *
 * This is the canonical fallback used whenever contract parsing fails. Its
 * shape and values are the established harness defaults; they must stay in sync
 * with any downstream validation the rest of the harness applies to contracts.
 */
export function makeGenericDefaultContract(sprintNumber: number): SprintContract {
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

// ── Extraction helpers ────────────────────────────────────────────────────────

/**
 * Extract a balanced `{...}` block from `text` that contains `requiredKey`.
 *
 * Default: forward scan, returning the first balanced block that contains the
 * key.
 *
 * With `{ fromEnd: true }`: scans backward from the last `}`, returning the
 * innermost-to-outermost balanced block. This is the right strategy for
 * verdict-shaped responses where the real JSON is always the trailing balanced
 * block and earlier text may contain JSX/Python braces from Read-tool output.
 */
export function extractBalancedJson(text: string, requiredKey: string, opts?: { fromEnd?: boolean }): string | null {
  if (opts?.fromEnd) {
    let end = -1;
    let depth = 0;
    for (let i = text.length - 1; i >= 0; i--) {
      if (text[i] === "}") {
        if (depth === 0) end = i;
        depth++;
      } else if (text[i] === "{") {
        depth--;
        if (depth === 0 && end >= 0) {
          const candidate = text.slice(i, end + 1);
          if (candidate.includes(`"${requiredKey}"`)) {
            return candidate;
          }
          end = -1;
        }
      }
    }
    return null;
  }

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

/**
 * If `text` contains an opening ` ```json ` or ` ``` ` fence with no matching
 * closing fence (truncation case), return everything from the opener to
 * end-of-text. Returns `null` if fences are balanced or no opener exists.
 */
export function extractUnclosedFence(text: string): string | null {
  const fenceRegex = /```(?:json)?\s*\n/g;
  const openers: number[] = [];
  for (const m of text.matchAll(fenceRegex)) {
    if (m.index !== undefined) openers.push(m.index + m[0].length);
  }
  if (openers.length === 0) return null;
  // Count all fences (opening or closing) to see if the last opener has a closer
  const allFences = [...text.matchAll(/```/g)];
  if (allFences.length % 2 === 0) return null; // balanced
  const lastOpener = openers[openers.length - 1] ?? 0;
  return text.slice(lastOpener).trim();
}

// ── Pure decision ─────────────────────────────────────────────────────────────

/**
 * Pure contract-parse decision.
 *
 * Attempts to extract a valid {@link SprintContract} from raw LLM text using
 * four strategies in priority order:
 *
 * 1. Code-fenced JSON blocks (` ```json … ``` ` or ` ``` … ``` `)
 * 2. Balanced `{…}` block scan from the end of the text
 * 3. Balanced `{…}` block scan from the start of the text
 * 4. Unclosed-fence recovery (truncated output)
 * 5. The raw text itself
 *
 * On success the contract has its `sprintNumber` set and `surfaces`
 * normalized. On failure the generic default contract is returned alongside
 * the full raw text and a bounded preview.
 *
 * **This function performs no console output and no file I/O.** All side
 * effects (logging, diagnostic writes) are handled by the caller.
 */
export function parseContractText(text: string, sprintNumber: number): ContractParseResult {
  const candidates: string[] = [];

  // Strategy 1: code-fenced JSON blocks (most specific; try in reverse order
  // so the last fence in the text wins, matching the reviewer's closing block)
  const codeBlocks = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)];
  for (const match of codeBlocks.reverse()) {
    if (match[1]) candidates.push(match[1].trim());
  }

  // Strategy 2: balanced-brace extraction from end (best for verdict responses)
  const balancedFromEnd = extractBalancedJson(text, "criteria", { fromEnd: true });
  if (balancedFromEnd) candidates.push(balancedFromEnd);

  // Strategy 3: balanced-brace extraction from start (forward scan)
  const balanced = extractBalancedJson(text, "criteria");
  if (balanced && balanced !== balancedFromEnd) candidates.push(balanced);

  // Strategy 4: unclosed-fence recovery (truncated model output)
  const unclosed = extractUnclosedFence(text);
  if (unclosed) candidates.push(unclosed);

  // Strategy 5: raw text as-is
  candidates.push(text.trim());

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as SprintContract;
      if (parsed.criteria && Array.isArray(parsed.criteria)) {
        parsed.sprintNumber = sprintNumber;
        parsed.surfaces = normalizeSurfaces(parsed.surfaces);
        return { ok: true, contract: parsed };
      }
    } catch {
      // Try next candidate
    }
  }

  // All strategies failed — return the generic default with diagnostic info
  const preview = text.slice(0, PARSE_ERROR_PREVIEW_MAX_LENGTH);
  return {
    ok: false,
    contract: makeGenericDefaultContract(sprintNumber),
    rawText: text,
    preview,
  };
}
