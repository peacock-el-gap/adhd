/**
 * Unit tests for the pure contract-parse decision in shared/contract-parse.ts.
 *
 * These tests run against a function that has no logger, no file-system access,
 * and no console calls — so the suite must produce no red [HARNESS] lines when
 * all tests pass.
 */

import { describe, expect, test } from "bun:test";
import {
  PARSE_ERROR_PREVIEW_MAX_LENGTH,
  makeGenericDefaultContract,
  parseContractText,
} from "../shared/contract-parse.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

function minimalContract(sprintNumber = 1) {
  return {
    sprintNumber,
    features: ["do the thing"],
    criteria: [{ name: "works", description: "It works", threshold: 7 }],
  };
}

// ── Discriminated-union shape ──────────────────────────────────────────────────

describe("ContractParseResult discriminated union", () => {
  test("success result has ok:true and no rawText/preview fields", () => {
    const text = JSON.stringify(minimalContract());
    const result = parseContractText(text, 1);

    expect(result.ok).toBe(true);
    // TypeScript narrowing: rawText and preview must NOT be present on the
    // success branch (no optional fields collapsing the two shapes together)
    expect("rawText" in result).toBe(false);
    expect("preview" in result).toBe(false);
  });

  test("failure result has ok:false and rawText+preview fields", () => {
    const result = parseContractText("totally invalid", 3);

    expect(result.ok).toBe(false);
    // Both rawText and preview must be present and typed as strings
    expect(typeof (result as { rawText: unknown }).rawText).toBe("string");
    expect(typeof (result as { preview: unknown }).preview).toBe("string");
  });
});

// ── Success path ──────────────────────────────────────────────────────────────

describe("parseContractText — success cases", () => {
  test("parses valid JSON with criteria array", () => {
    const contract = minimalContract(2);
    const result = parseContractText(JSON.stringify(contract), 2);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("narrowing");

    expect(result.contract.sprintNumber).toBe(2);
    expect(result.contract.criteria).toHaveLength(1);
    expect(result.contract.criteria[0]!.name).toBe("works");
  });

  test("sets sprintNumber from the argument, overriding any value in the JSON", () => {
    const contract = { ...minimalContract(99) }; // sprintNumber = 99 in JSON
    const result = parseContractText(JSON.stringify(contract), 5); // caller says 5

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("narrowing");
    expect(result.contract.sprintNumber).toBe(5);
  });

  test("normalizes surfaces — unknown tokens are dropped", () => {
    const contract = { ...minimalContract(), surfaces: ["backend", "UNKNOWN", "tests"] };
    const result = parseContractText(JSON.stringify(contract), 1);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("narrowing");
    expect(result.contract.surfaces).toEqual(["backend", "tests"]);
  });

  // ── Strategy 1: code-fenced JSON ──────────────────────────────────────────

  test("strategy 1 — extracts contract from ```json fence", () => {
    const contract = minimalContract(3);
    const text = `Here is the proposed contract:\n\`\`\`json\n${JSON.stringify(contract)}\n\`\`\`\nEnjoy.`;
    const result = parseContractText(text, 3);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("narrowing");
    expect(result.contract.criteria[0]!.name).toBe("works");
  });

  test("strategy 1 — extracts contract from plain ``` fence", () => {
    const contract = minimalContract(4);
    const text = `Contract:\n\`\`\`\n${JSON.stringify(contract)}\n\`\`\``;
    const result = parseContractText(text, 4);

    expect(result.ok).toBe(true);
  });

  // ── Strategy 2: balanced-brace extraction ─────────────────────────────────

  test("strategy 2 — balanced-brace extraction from end", () => {
    const contract = minimalContract(5);
    // Prefix with a non-JSON block that balanced-from-start would pick up first
    const earlier = '{"irrelevant": true}';
    const text = `${earlier} some prose ${JSON.stringify(contract)}`;
    const result = parseContractText(text, 5);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("narrowing");
    expect(result.contract.criteria[0]!.name).toBe("works");
  });

  test("strategy 3 — balanced-brace extraction from start (forward scan)", () => {
    const contract = minimalContract(6);
    const text = `${JSON.stringify(contract)} some trailing text without criteria`;
    const result = parseContractText(text, 6);

    expect(result.ok).toBe(true);
  });

  // ── Strategy 4: unclosed-fence recovery ───────────────────────────────────

  test("strategy 4 — unclosed fence recovery (truncated output)", () => {
    const contract = minimalContract(7);
    // Fence is opened but never closed — simulates model truncation
    const text = `Analysis:\n\`\`\`json\n${JSON.stringify(contract)}`;
    const result = parseContractText(text, 7);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("narrowing");
    expect(result.contract.criteria[0]!.name).toBe("works");
  });
});

// ── Failure path ──────────────────────────────────────────────────────────────

describe("parseContractText — failure cases", () => {
  test("returns failure for non-JSON text", () => {
    const result = parseContractText("This is completely unparseable garbage", 1);
    expect(result.ok).toBe(false);
  });

  test("returns failure when criteria array is missing", () => {
    const noCriteria = JSON.stringify({ sprintNumber: 1, features: ["x"] });
    const result = parseContractText(noCriteria, 1);
    expect(result.ok).toBe(false);
  });

  test("failure result contains rawText equal to the full input", () => {
    const input = "not valid json at all";
    const result = parseContractText(input, 1);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("narrowing");
    expect(result.rawText).toBe(input);
  });

  // ── Generic default contract ───────────────────────────────────────────────

  test("failure contract matches makeGenericDefaultContract exactly", () => {
    const result = parseContractText("garbage", 8);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("narrowing");

    const expected = makeGenericDefaultContract(8);
    expect(result.contract).toEqual(expected);
  });

  test("failure contract has correct sprintNumber", () => {
    const result = parseContractText("garbage", 42);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("narrowing");
    expect(result.contract.sprintNumber).toBe(42);
  });

  test("default contract has three criteria with the canonical names", () => {
    const result = parseContractText("garbage", 1);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("narrowing");

    const names = result.contract.criteria.map((c) => c.name);
    expect(names).toEqual(["basic_functionality", "code_quality", "error_handling"]);
  });

  test("default contract criteria each have threshold 7", () => {
    const result = parseContractText("garbage", 1);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("narrowing");

    for (const criterion of result.contract.criteria) {
      expect(criterion.threshold).toBe(7);
    }
  });

  // ── Bounded preview ────────────────────────────────────────────────────────

  test("preview is bounded — 10,000-character input yields exactly 200 chars", () => {
    const longInput = "x".repeat(10_000);
    const result = parseContractText(longInput, 1);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("narrowing");
    expect(result.preview.length).toBe(PARSE_ERROR_PREVIEW_MAX_LENGTH);
    expect(result.preview.length).toBe(200);
  });

  test("preview is bounded — empty string yields empty preview (not truncated)", () => {
    const result = parseContractText("", 1);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("narrowing");
    expect(result.preview).toBe("");
    expect(result.preview.length).toBe(0);
  });

  test("preview is bounded — input shorter than 200 chars is returned in full", () => {
    const shortInput = "bad json: only 30 chars here!!";
    expect(shortInput.length).toBeLessThan(200);

    const result = parseContractText(shortInput, 1);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("narrowing");
    expect(result.preview).toBe(shortInput);
    expect(result.preview.length).toBe(shortInput.length);
  });

  test("preview is bounded — input of exactly 200 chars is returned in full", () => {
    const exactInput = "z".repeat(200);
    const result = parseContractText(exactInput, 1);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("narrowing");
    expect(result.preview.length).toBe(200);
  });

  test("preview never exceeds PARSE_ERROR_PREVIEW_MAX_LENGTH", () => {
    const inputs = ["", "short", "x".repeat(199), "x".repeat(200), "x".repeat(201), "x".repeat(10_000)];

    for (const input of inputs) {
      const result = parseContractText(input, 1);
      if (!result.ok) {
        expect(result.preview.length).toBeLessThanOrEqual(PARSE_ERROR_PREVIEW_MAX_LENGTH);
      }
    }
  });
});

// ── makeGenericDefaultContract ────────────────────────────────────────────────

describe("makeGenericDefaultContract", () => {
  test("returns a contract with the given sprintNumber", () => {
    expect(makeGenericDefaultContract(7).sprintNumber).toBe(7);
    expect(makeGenericDefaultContract(1).sprintNumber).toBe(1);
  });

  test("always has exactly three criteria", () => {
    expect(makeGenericDefaultContract(1).criteria).toHaveLength(3);
  });

  test("criteria names are basic_functionality, code_quality, error_handling", () => {
    const names = makeGenericDefaultContract(1).criteria.map((c) => c.name);
    expect(names).toEqual(["basic_functionality", "code_quality", "error_handling"]);
  });

  test("criteria all have threshold 7", () => {
    for (const c of makeGenericDefaultContract(1).criteria) {
      expect(c.threshold).toBe(7);
    }
  });

  test("returns independent objects — mutation does not affect subsequent calls", () => {
    const a = makeGenericDefaultContract(1);
    a.criteria.push({ name: "extra", description: "extra", threshold: 9 });
    const b = makeGenericDefaultContract(1);
    expect(b.criteria).toHaveLength(3);
  });
});
