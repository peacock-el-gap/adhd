/**
 * Sprint 8 integration tests — F8: Structured reviewer output envelope.
 *
 * Verifies:
 *   - negotiate_contract_uses_envelope_parser
 *   - narrowing_round_uses_envelope_parser
 *   - approved_branch_deduplication (structural / grep-level assertion)
 *   - shared_parser_zero_sdk_boundary (import-level assertion)
 *
 * The contract-negotiation SDK calls (negotiateContract, runNarrowingRound)
 * are not invoked here — those require a live SDK. Instead the tests verify:
 *   1. The envelope parser produces identical outcomes to the former literal
 *      APPROVED branches for all legacy inputs.
 *   2. The new envelope JSON inputs are handled correctly.
 *   3. The contract.ts source no longer contains bare `=== "APPROVED"` guards
 *      outside of comments.
 *   4. shared/review-envelope.ts has zero SDK imports.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, spyOn } from "bun:test";
import { parseContract } from "../harness-claude/contract.ts";
import { parseReviewEnvelope } from "../shared/review-envelope.ts";
import type { SprintContract } from "../shared/types.ts";

const SAMPLE_CONTRACT: SprintContract = {
  sprintNumber: 5,
  features: ["feature-x"],
  criteria: [
    { name: "c1", description: "criterion one", threshold: 8 },
    { name: "c2", description: "criterion two", threshold: 7 },
  ],
  surfaces: ["backend"],
};

// ---------------------------------------------------------------------------
// Criterion: negotiate_contract_uses_envelope_parser
// — the envelope parser must select the same contract source as the old branch
// ---------------------------------------------------------------------------
describe("negotiate_contract_uses_envelope_parser — parity with old APPROVED branch", () => {
  it("legacy 'APPROVED' → verdict=approved, so caller would use proposalText (same as old branch)", () => {
    const envelope = parseReviewEnvelope("APPROVED");
    // Old code: reviewText.trim() === "APPROVED" → use proposalText
    // New code: envelope.verdict === "approved" → use proposalText
    expect(envelope.verdict).toBe("approved");
    expect(envelope.contract).toBeNull();
  });

  it("new envelope { verdict: 'APPROVED' } → approved, caller uses proposalText", () => {
    const reviewText = JSON.stringify({ verdict: "APPROVED", changes: "" });
    const envelope = parseReviewEnvelope(reviewText);
    expect(envelope.verdict).toBe("approved");
    expect(envelope.contract).toBeNull();
  });

  it("legacy bare-contract JSON → revised, contract extracted; same source as old 'use reviewText' branch", () => {
    const reviewText = JSON.stringify(SAMPLE_CONTRACT);
    const envelope = parseReviewEnvelope(reviewText);
    // Old code: reviewText was not "APPROVED" → contractSource = reviewText → parseContract(reviewText, ...)
    // New code: envelope.verdict === "revised", envelope.contract has the parsed object
    expect(envelope.verdict).toBe("revised");
    expect(envelope.contract).not.toBeNull();
    expect(envelope.contract?.criteria).toHaveLength(2);
  });

  it("new REVISED envelope → revised, contract from envelope field (same final contract as old path)", () => {
    const reviewText = JSON.stringify({
      verdict: "REVISED",
      changes: "narrowed criteria",
      contract: SAMPLE_CONTRACT,
    });
    const envelope = parseReviewEnvelope(reviewText);
    expect(envelope.verdict).toBe("revised");
    expect(envelope.contract?.criteria).toHaveLength(2);
    expect(envelope.changes).toBe("narrowed criteria");
  });

  it("parseContract still works on proposalText when envelope is approved (end-to-end contract parse)", () => {
    const proposalText = JSON.stringify(SAMPLE_CONTRACT);
    const reviewText = "APPROVED";

    const envelope = parseReviewEnvelope(reviewText);
    // When approved, caller uses proposalText with parseContract
    const finalContract = envelope.verdict === "approved" ? parseContract(proposalText, 5) : parseContract(reviewText, 5);

    expect(finalContract.sprintNumber).toBe(5);
    expect(finalContract.criteria).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Criterion: narrowing_round_uses_envelope_parser
// — loop exits correctly on APPROVED; continues on REVISED
// ---------------------------------------------------------------------------
describe("narrowing_round_uses_envelope_parser — parity with old APPROVED guard", () => {
  it("legacy 'APPROVED' → approved verdict → narrowing round returns original contract", () => {
    const response = "APPROVED";
    const envelope = parseReviewEnvelope(response);
    // Old code: result.response.trim() === "APPROVED" → return contract (original)
    // New code: envelope.verdict === "approved" → return contract (original)
    expect(envelope.verdict).toBe("approved");
  });

  it("new envelope { verdict: 'APPROVED' } → approved → loop exits, original contract kept", () => {
    const response = JSON.stringify({ verdict: "APPROVED", changes: "" });
    const envelope = parseReviewEnvelope(response);
    expect(envelope.verdict).toBe("approved");
  });

  it("new envelope { verdict: 'REVISED', contract } → revised → loop uses narrowed contract", () => {
    const narrowedContract: SprintContract = {
      ...SAMPLE_CONTRACT,
      criteria: [SAMPLE_CONTRACT.criteria[0]!], // narrowed to 1 criterion
    };
    const response = JSON.stringify({
      verdict: "REVISED",
      changes: "dropped criterion 2 to fit within limits",
      contract: narrowedContract,
    });
    const envelope = parseReviewEnvelope(response);
    expect(envelope.verdict).toBe("revised");
    expect(envelope.contract?.criteria).toHaveLength(1);
  });

  it("legacy bare-contract JSON in narrowing → revised → parseContract parses it (old fallback path)", () => {
    const response = JSON.stringify(SAMPLE_CONTRACT);
    const envelope = parseReviewEnvelope(response);
    // envelope.verdict === "revised", envelope.contract !== null
    // New code uses envelope.contract directly; old code used parseContract(response, ...)
    // Both yield the same contract.
    const viaEnvelope = envelope.contract;
    const viaParseContract = parseContract(response, 5);

    expect(viaEnvelope?.criteria).toHaveLength(2);
    expect(viaParseContract.criteria).toHaveLength(2);
    // The final contract is the same either way.
    expect(viaEnvelope?.features).toEqual(viaParseContract.features);
  });

  it("unrecognised narrowing response → revised, null contract → caller falls back to parseContract", () => {
    const response = "I cannot produce a valid narrowed contract right now.";
    const envelope = parseReviewEnvelope(response);
    expect(envelope.verdict).toBe("revised");
    expect(envelope.contract).toBeNull();
    // Caller falls back: parseContract(response, sprintNumber) → default contract
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    const fallback = parseContract(response, 5);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const call = warnSpy.mock.calls[0]?.[0] as string;
    expect(call).toContain("sprint 5");
    expect(call).toContain("generic default contract");
    warnSpy.mockRestore();
    expect(fallback.sprintNumber).toBe(5);
    expect(fallback.criteria).toHaveLength(3); // default criteria
  });
});

// ---------------------------------------------------------------------------
// Criterion: approved_branch_deduplication
// — contract.ts must not contain bare === "APPROVED" comparison branches
// ---------------------------------------------------------------------------
describe("approved_branch_deduplication — no literal APPROVED comparisons in contract.ts", () => {
  it('contract.ts contains no === "APPROVED" outside of comments', () => {
    const contractSrc = readFileSync(
      join(import.meta.dir, "../harness-claude/contract.ts"),
      "utf-8",
    );

    // Strip single-line comments, then check for literal === "APPROVED" comparisons.
    const noComments = contractSrc
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("//"))
      .join("\n");

    // The literal guard `=== "APPROVED"` must not appear in non-comment code.
    expect(noComments).not.toContain('=== "APPROVED"');
  });

  it('contract.ts contains no .trim() === "APPROVED" comparisons', () => {
    const contractSrc = readFileSync(
      join(import.meta.dir, "../harness-claude/contract.ts"),
      "utf-8",
    );
    const noComments = contractSrc
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("//"))
      .join("\n");

    expect(noComments).not.toContain('.trim() === "APPROVED"');
  });
});

// ---------------------------------------------------------------------------
// Criterion: shared_parser_zero_sdk_boundary
// — shared/review-envelope.ts must not import from SDK packages
// ---------------------------------------------------------------------------
describe("shared_parser_zero_sdk_boundary — no SDK imports in shared/review-envelope.ts", () => {
  it("review-envelope.ts does not import from @anthropic-ai/ or harness-claude/", () => {
    const src = readFileSync(
      join(import.meta.dir, "../shared/review-envelope.ts"),
      "utf-8",
    );

    // No SDK imports.
    expect(src).not.toMatch(/@anthropic-ai\//);
    // No harness-claude imports.
    expect(src).not.toMatch(/from ["']\.\.\/harness-claude\//);
    expect(src).not.toMatch(/from ["']harness-claude\//);
  });

  it("review-envelope.ts exports ReviewEnvelope type and parseReviewEnvelope function", () => {
    // Import-level check — if these don't exist, the import at the top of this
    // file would already have failed. But we verify the function is callable.
    expect(typeof parseReviewEnvelope).toBe("function");
    const result = parseReviewEnvelope("APPROVED");
    expect(result).toBeDefined();
  });
});
