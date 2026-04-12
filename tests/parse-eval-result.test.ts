import { describe, expect, test } from "bun:test";
import { parseEvalResult } from "../harness-claude/evaluator.ts";
import type { SprintContract } from "../shared/types.ts";

const contract: SprintContract = {
  sprintNumber: 1,
  features: ["auth"],
  criteria: [
    { name: "auth_works", description: "Auth works", threshold: 7 },
    { name: "error_handling", description: "Errors handled", threshold: 7 },
  ],
};

const validEval = {
  passed: true,
  scores: { auth_works: 9, error_handling: 8 },
  feedback: [
    { criterion: "auth_works", score: 9, details: "Works great" },
    { criterion: "error_handling", score: 8, details: "Good coverage" },
  ],
  overallSummary: "Solid work",
};

describe("parseEvalResult", () => {
  test("extracts from a JSON code block", () => {
    const response = `Analysis:\n\`\`\`json\n${JSON.stringify(validEval)}\n\`\`\``;
    const result = parseEvalResult(response, contract, 7);
    expect(result.passed).toBe(true);
    expect(result.feedback).toHaveLength(2);
    expect(result.feedback[0]!.score).toBe(9);
  });

  test("extracts from bare JSON without code block", () => {
    const response = `Here are my scores:\n${JSON.stringify(validEval)}`;
    const result = parseEvalResult(response, contract, 7);
    expect(result.passed).toBe(true);
  });

  test("extracts from bare JSON with surrounding text", () => {
    const response = `Here are my scores: ${JSON.stringify(validEval)} That's all.`;
    const result = parseEvalResult(response, contract, 7);
    expect(result.passed).toBe(true);
  });

  test("parses raw JSON", () => {
    const result = parseEvalResult(JSON.stringify(validEval), contract, 7);
    expect(result.passed).toBe(true);
    expect(result.feedback).toHaveLength(2);
  });

  test("recalculates passed based on threshold", () => {
    const evalWithHighThreshold = { ...validEval, passed: true };
    const result = parseEvalResult(JSON.stringify(evalWithHighThreshold), contract, 10);
    expect(result.passed).toBe(false);
  });

  test("returns zeros when parsing fails completely", () => {
    const result = parseEvalResult("This is nonsense.", contract, 7);
    expect(result.passed).toBe(false);
    expect(result.feedback).toHaveLength(2);
    expect(result.feedback[0]!.score).toBe(0);
    expect(result.feedback[0]!.criterion).toBe("auth_works");
  });

  test("returns zeros for JSON without feedback array", () => {
    const result = parseEvalResult('{"passed": true, "scores": {}}', contract, 7);
    expect(result.passed).toBe(false);
    expect(result.feedback).toHaveLength(2);
    expect(result.feedback[0]!.score).toBe(0);
  });

  test("prefers last code block over earlier ones", () => {
    const old = { ...validEval, feedback: [{ criterion: "auth_works", score: 3, details: "Bad" }] };
    const latest = { ...validEval };
    const response = `\`\`\`json\n${JSON.stringify(old)}\n\`\`\`\nRevised:\n\`\`\`json\n${JSON.stringify(latest)}\n\`\`\``;
    const result = parseEvalResult(response, contract, 7);
    expect(result.feedback).toHaveLength(2);
    expect(result.feedback[0]!.score).toBe(9);
  });

  test("picks trailing verdict past earlier JSX-like braces in prose", () => {
    // Simulates a response where the evaluator pasted a code excerpt (with
    // function braces) in its prose before emitting the verdict JSON.
    const response = `Read app/auth.py:\n  def check(user) { if (user) { return true; } }\n\nFinal verdict:\n${JSON.stringify(validEval)}`;
    const result = parseEvalResult(response, contract, 7);
    expect(result.passed).toBe(true);
    expect(result.feedback).toHaveLength(2);
  });

  test("recovers JSON from unclosed ```json fence (truncation case)", () => {
    // Simulates max_tokens truncation: opening fence but no closing fence.
    const truncated = `Analysis: the app works.\n\n\`\`\`json\n${JSON.stringify(validEval)}`;
    const result = parseEvalResult(truncated, contract, 7);
    expect(result.passed).toBe(true);
    expect(result.feedback[0]!.score).toBe(9);
  });
});
