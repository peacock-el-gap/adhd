/**
 * Tests for shared/review-envelope.ts (Sprint 8 / F8).
 *
 * Covers all four acceptance scenarios from the sprint contract:
 *   - parse_approved_envelope
 *   - parse_revised_envelope
 *   - parse_legacy_approved_string
 *   - parse_legacy_bare_contract
 *   - parse_envelope_never_throws
 *   - parse_failure_error_visibility (verbose-level warning — not directly
 *     assertable in unit tests, but the function must not throw and must return
 *     a safe fallback)
 */

import { describe, expect, it } from "bun:test";
import { parseReviewEnvelope } from "../shared/review-envelope.ts";
import type { SprintContract } from "../shared/types.ts";

const SAMPLE_CONTRACT: SprintContract = {
  sprintNumber: 3,
  features: ["feat-a", "feat-b"],
  criteria: [
    { name: "crit_one", description: "criterion one", threshold: 8 },
    { name: "crit_two", description: "criterion two", threshold: 7 },
  ],
  surfaces: ["backend"],
};

// ---------------------------------------------------------------------------
// Criterion: parse_approved_envelope
// ---------------------------------------------------------------------------
describe("parseReviewEnvelope — new envelope APPROVED verdict", () => {
  it("returns verdict=approved and null contract for { verdict: 'APPROVED', changes: '' }", () => {
    const input = JSON.stringify({ verdict: "APPROVED", changes: "" });
    const result = parseReviewEnvelope(input);
    expect(result.verdict).toBe("approved");
    expect(result.contract).toBeNull();
  });

  it("returns approved even when changes field has content", () => {
    const input = JSON.stringify({ verdict: "APPROVED", changes: "No changes needed." });
    const result = parseReviewEnvelope(input);
    expect(result.verdict).toBe("approved");
    expect(result.contract).toBeNull();
    expect(result.changes).toBe("No changes needed.");
  });

  it("preserves changes text from an APPROVED envelope", () => {
    const input = JSON.stringify({ verdict: "APPROVED", changes: "LGTM" });
    const result = parseReviewEnvelope(input);
    expect(result.changes).toBe("LGTM");
  });

  it("is case-insensitive on verdict field", () => {
    const input = JSON.stringify({ verdict: "approved", changes: "" });
    const result = parseReviewEnvelope(input);
    expect(result.verdict).toBe("approved");
  });
});

// ---------------------------------------------------------------------------
// Criterion: parse_revised_envelope
// ---------------------------------------------------------------------------
describe("parseReviewEnvelope — new envelope REVISED verdict", () => {
  it("returns verdict=revised and the contract object from the envelope", () => {
    const input = JSON.stringify({
      verdict: "REVISED",
      changes: "Changed threshold for foo from 6 to 8",
      contract: SAMPLE_CONTRACT,
    });
    const result = parseReviewEnvelope(input);
    expect(result.verdict).toBe("revised");
    expect(result.contract).not.toBeNull();
    expect(result.contract?.criteria).toHaveLength(2);
    expect(result.changes).toBe("Changed threshold for foo from 6 to 8");
  });

  it("returns verdict=revised even when contract field is absent in REVISED envelope", () => {
    const input = JSON.stringify({ verdict: "REVISED", changes: "some change" });
    const result = parseReviewEnvelope(input);
    expect(result.verdict).toBe("revised");
    // contract is null because no contract field was present
    expect(result.contract).toBeNull();
  });

  it("parses contract from a REVISED envelope wrapped in a code fence", () => {
    const envelope = { verdict: "REVISED", changes: "trimmed criteria", contract: SAMPLE_CONTRACT };
    const input = `Here is my review:\n\`\`\`json\n${JSON.stringify(envelope)}\n\`\`\``;
    const result = parseReviewEnvelope(input);
    expect(result.verdict).toBe("revised");
    expect(result.contract?.criteria).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Criterion: parse_legacy_approved_string
// ---------------------------------------------------------------------------
describe("parseReviewEnvelope — legacy literal APPROVED string", () => {
  it("returns verdict=approved for the bare literal string 'APPROVED'", () => {
    const result = parseReviewEnvelope("APPROVED");
    expect(result.verdict).toBe("approved");
    expect(result.contract).toBeNull();
    expect(result.changes).toBe("");
  });

  it("handles leading/trailing whitespace around APPROVED", () => {
    const result = parseReviewEnvelope("  APPROVED  ");
    expect(result.verdict).toBe("approved");
  });

  it("handles APPROVED with a trailing newline", () => {
    const result = parseReviewEnvelope("APPROVED\n");
    expect(result.verdict).toBe("approved");
  });
});

// ---------------------------------------------------------------------------
// Criterion: parse_legacy_bare_contract
// ---------------------------------------------------------------------------
describe("parseReviewEnvelope — legacy bare-contract JSON", () => {
  it("returns verdict=revised and the parsed contract for a raw contract JSON string", () => {
    const input = JSON.stringify(SAMPLE_CONTRACT);
    const result = parseReviewEnvelope(input);
    expect(result.verdict).toBe("revised");
    expect(result.contract).not.toBeNull();
    expect(result.contract?.criteria).toHaveLength(2);
    expect(result.changes).toBe("");
  });

  it("extracts a bare contract from within a code fence", () => {
    const input = `Some preamble.\n\`\`\`json\n${JSON.stringify(SAMPLE_CONTRACT)}\n\`\`\`\nEnd.`;
    const result = parseReviewEnvelope(input);
    expect(result.verdict).toBe("revised");
    expect(result.contract).not.toBeNull();
  });

  it("returns changes as empty string for legacy bare-contract form", () => {
    const input = JSON.stringify(SAMPLE_CONTRACT);
    const result = parseReviewEnvelope(input);
    expect(result.changes).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Criterion: parse_envelope_never_throws
// ---------------------------------------------------------------------------
describe("parseReviewEnvelope — never throws", () => {
  const badInputs: Array<[string, unknown]> = [
    ["empty string", ""],
    ["whitespace only", "   "],
    ["invalid JSON", "{ not valid json ]{"],
    ["plain text prose", "I think the contract looks good overall."],
    ["JSON array instead of object", "[1, 2, 3]"],
    ["null JSON value", "null"],
    ["number string", "42"],
    ["boolean string", "true"],
    ["deeply nested garbage", "{{{{{{"],
    ["object without criteria or verdict", JSON.stringify({ foo: "bar" })],
  ];

  for (const [label, input] of badInputs) {
    it(`does not throw for: ${label}`, () => {
      expect(() => parseReviewEnvelope(input as string)).not.toThrow();
    });

    it(`returns a defined fallback for: ${label}`, () => {
      const result = parseReviewEnvelope(input as string);
      expect(result).toBeDefined();
      expect(result.verdict).toMatch(/^(approved|revised)$/);
      expect(typeof result.changes).toBe("string");
    });
  }

  it("returns verdict=revised (not approved) for unrecognised input", () => {
    const result = parseReviewEnvelope("definitely not a valid response");
    expect(result.verdict).toBe("revised");
  });
});

// ---------------------------------------------------------------------------
// Edge cases and regression guards
// ---------------------------------------------------------------------------
describe("parseReviewEnvelope — edge cases", () => {
  it("prefers the last fenced code block when multiple fences are present", () => {
    const firstBlock = JSON.stringify({ verdict: "APPROVED", changes: "" });
    const secondBlock = JSON.stringify({ verdict: "REVISED", changes: "updated", contract: SAMPLE_CONTRACT });
    const input = `\`\`\`json\n${firstBlock}\n\`\`\`\nSome text.\n\`\`\`json\n${secondBlock}\n\`\`\``;
    const result = parseReviewEnvelope(input);
    // The last code block is the REVISED one
    expect(result.verdict).toBe("revised");
  });

  it("handles an envelope where contract is a JSON string rather than an object", () => {
    // Some reviewers might stringify the nested contract
    const envelope = {
      verdict: "REVISED",
      changes: "adjusted",
      contract: JSON.stringify(SAMPLE_CONTRACT),
    };
    const result = parseReviewEnvelope(JSON.stringify(envelope));
    expect(result.verdict).toBe("revised");
    // contract should be extracted from the nested JSON string
    expect(result.contract).not.toBeNull();
  });

  it("returns null contract (not undefined) when approved", () => {
    const result = parseReviewEnvelope("APPROVED");
    // contract must be explicitly null, not undefined, for safe callers
    expect(result.contract).toBeNull();
  });
});
