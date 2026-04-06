import { describe, expect, test } from "bun:test";
import { shouldLog } from "../shared/logger.ts";

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
