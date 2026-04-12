import { describe, expect, test } from "bun:test";
import { extractBalancedJson, extractUnclosedFence } from "../harness-claude/contract.ts";

describe("extractBalancedJson", () => {
  test("extracts simple JSON object", () => {
    const text = 'Here is: {"name": "test", "criteria": [1, 2]}';
    expect(extractBalancedJson(text, "criteria")).toBe('{"name": "test", "criteria": [1, 2]}');
  });

  test("handles nested braces", () => {
    const json = '{"outer": {"inner": true}, "criteria": [{"a": 1}]}';
    const text = `prefix ${json} suffix`;
    expect(extractBalancedJson(text, "criteria")).toBe(json);
  });

  test("returns null when key not found", () => {
    const text = '{"name": "test"}';
    expect(extractBalancedJson(text, "criteria")).toBeNull();
  });

  test("returns null for empty string", () => {
    expect(extractBalancedJson("", "criteria")).toBeNull();
  });

  test("returns null for text without braces", () => {
    expect(extractBalancedJson("no braces here", "criteria")).toBeNull();
  });

  test("skips objects that don't contain the required key", () => {
    const text = '{"irrelevant": true} and then {"criteria": [1]}';
    expect(extractBalancedJson(text, "criteria")).toBe('{"criteria": [1]}');
  });

  test("handles deeply nested JSON", () => {
    const json = '{"criteria": [{"name": "x", "nested": {"deep": {"value": 1}}}]}';
    expect(extractBalancedJson(json, "criteria")).toBe(json);
  });

  describe("fromEnd option", () => {
    test("picks trailing verdict JSON past earlier JSX-like braces", () => {
      // Earlier text has function-body braces that forward-scan would match
      // first (without the key → skip, but then continue greedily). The real
      // verdict is at the end.
      const verdict = '{"feedback": [{"criterion": "x", "score": 9, "details": "ok"}]}';
      const text = `function foo() { return { a: 1 }; }\n\nAnalysis: looks good.\n${verdict}`;
      expect(extractBalancedJson(text, "feedback", { fromEnd: true })).toBe(verdict);
    });

    test("picks LAST matching block when multiple balanced blocks exist", () => {
      const first = '{"feedback": [{"score": 1}]}';
      const second = '{"feedback": [{"score": 9}]}';
      const text = `${first}\nthen\n${second}`;
      expect(extractBalancedJson(text, "feedback", { fromEnd: true })).toBe(second);
    });

    test("returns null when key absent", () => {
      expect(extractBalancedJson('{"other": 1}', "feedback", { fromEnd: true })).toBeNull();
    });
  });
});

describe("extractUnclosedFence", () => {
  test("returns trailing content when ```json fence is not closed", () => {
    const text = 'Analysis:\n```json\n{"feedback": [{"score": 9}]';
    const result = extractUnclosedFence(text);
    expect(result).toBe('{"feedback": [{"score": 9}]');
  });

  test("returns null when fence is properly closed", () => {
    const text = 'Analysis:\n```json\n{"feedback": []}\n```';
    expect(extractUnclosedFence(text)).toBeNull();
  });

  test("returns null when there is no fence at all", () => {
    expect(extractUnclosedFence("no fences here")).toBeNull();
  });

  test("handles plain ``` (no language) opener", () => {
    const text = 'Output:\n```\n{"feedback": []';
    const result = extractUnclosedFence(text);
    expect(result).toBe('{"feedback": []');
  });
});
