import { describe, expect, test } from "bun:test";
import { shouldLog } from "../shared/logger.ts";

describe("shouldLog", () => {
  test("quiet messages shown at all levels", () => {
    expect(shouldLog("quiet", "quiet")).toBe(true);
    expect(shouldLog("quiet", "normal")).toBe(true);
    expect(shouldLog("quiet", "verbose")).toBe(true);
  });

  test("normal messages hidden at quiet level", () => {
    expect(shouldLog("normal", "quiet")).toBe(false);
    expect(shouldLog("normal", "normal")).toBe(true);
    expect(shouldLog("normal", "verbose")).toBe(true);
  });

  test("verbose messages only shown at verbose level", () => {
    expect(shouldLog("verbose", "quiet")).toBe(false);
    expect(shouldLog("verbose", "normal")).toBe(false);
    expect(shouldLog("verbose", "verbose")).toBe(true);
  });
});
