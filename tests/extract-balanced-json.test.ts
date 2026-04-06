import { describe, expect, test } from "bun:test";
import { extractBalancedJson } from "../claude-harness/harness.ts";

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
});
