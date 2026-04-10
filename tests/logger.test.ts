import { describe, expect, test } from "bun:test";
import { shouldLog, summarize } from "../shared/logger.ts";

describe("shouldLog", () => {
  test("quiet messages shown at all levels", () => {
    expect(shouldLog("quiet", "quiet")).toBe(true);
    expect(shouldLog("quiet", "normal")).toBe(true);
    expect(shouldLog("quiet", "verbose")).toBe(true);
    expect(shouldLog("quiet", "debug")).toBe(true);
  });

  test("normal messages hidden at quiet level", () => {
    expect(shouldLog("normal", "quiet")).toBe(false);
    expect(shouldLog("normal", "normal")).toBe(true);
    expect(shouldLog("normal", "verbose")).toBe(true);
    expect(shouldLog("normal", "debug")).toBe(true);
  });

  test("verbose messages only shown at verbose or debug level", () => {
    expect(shouldLog("verbose", "quiet")).toBe(false);
    expect(shouldLog("verbose", "normal")).toBe(false);
    expect(shouldLog("verbose", "verbose")).toBe(true);
    expect(shouldLog("verbose", "debug")).toBe(true);
  });

  test("debug messages only shown at debug level", () => {
    expect(shouldLog("debug", "quiet")).toBe(false);
    expect(shouldLog("debug", "normal")).toBe(false);
    expect(shouldLog("debug", "verbose")).toBe(false);
    expect(shouldLog("debug", "debug")).toBe(true);
  });
});

describe("summarize", () => {
  test("replaces newlines with escaped newlines", () => {
    expect(summarize("line1\nline2\nline3")).toBe("line1\\nline2\\nline3");
  });

  test("truncates to maxLen", () => {
    const long = "a".repeat(300);
    const result = summarize(long, 100);
    expect(result.length).toBe(100);
  });

  test("uses default maxLen of 200", () => {
    const long = "a".repeat(300);
    const result = summarize(long);
    expect(result.length).toBe(200);
  });

  test("returns short strings unchanged", () => {
    expect(summarize("hello")).toBe("hello");
  });
});
