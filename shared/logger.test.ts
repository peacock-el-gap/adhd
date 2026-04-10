import { describe, expect, it } from "bun:test";
import { shouldLog, summarize } from "./logger.ts";

describe("logger", () => {
  describe("shouldLog", () => {
    it("shows normal messages at normal level", () => {
      expect(shouldLog("normal", "normal")).toBe(true);
    });

    it("hides verbose messages at normal level", () => {
      expect(shouldLog("verbose", "normal")).toBe(false);
    });

    it("hides debug messages at normal level", () => {
      expect(shouldLog("debug", "normal")).toBe(false);
    });

    it("shows debug messages at debug level", () => {
      expect(shouldLog("debug", "debug")).toBe(true);
    });

    it("shows quiet messages at all levels", () => {
      expect(shouldLog("quiet", "normal")).toBe(true);
      expect(shouldLog("quiet", "quiet")).toBe(true);
      expect(shouldLog("quiet", "verbose")).toBe(true);
      expect(shouldLog("quiet", "debug")).toBe(true);
    });

    it("shows normal and verbose at verbose level", () => {
      expect(shouldLog("normal", "verbose")).toBe(true);
      expect(shouldLog("verbose", "verbose")).toBe(true);
    });
  });

  describe("summarize", () => {
    it("replaces newlines with escaped newlines", () => {
      expect(summarize("line1\nline2\nline3")).toBe("line1\\nline2\\nline3");
    });

    it("truncates to maxLen", () => {
      const long = "a".repeat(300);
      const result = summarize(long, 100);
      expect(result.length).toBe(100);
    });

    it("uses default maxLen of 200", () => {
      const long = "a".repeat(300);
      const result = summarize(long);
      expect(result.length).toBe(200);
    });

    it("returns short strings unchanged", () => {
      expect(summarize("hello")).toBe("hello");
    });
  });
});
