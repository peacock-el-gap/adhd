import { describe, expect, test } from "bun:test";
import { isTransientError } from "../shared/orchestration/error-handling.ts";

describe("isTransientError", () => {
  // --- Should be transient (retryable) ---

  test("treats HTTP 429 as transient", () => {
    expect(isTransientError(new Error("HTTP 429 Too Many Requests"))).toBe(true);
  });

  test("treats HTTP 500 as transient", () => {
    expect(isTransientError(new Error("HTTP 500 Internal Server Error"))).toBe(true);
  });

  test("treats HTTP 502 as transient", () => {
    expect(isTransientError(new Error("502 Bad Gateway"))).toBe(true);
  });

  test("treats HTTP 503 as transient", () => {
    expect(isTransientError(new Error("503 Service Unavailable"))).toBe(true);
  });

  test("treats timeout as transient", () => {
    expect(isTransientError(new Error("Request timeout"))).toBe(true);
  });

  test("treats ECONNRESET as transient", () => {
    expect(isTransientError(new Error("read ECONNRESET"))).toBe(true);
  });

  test("treats ECONNREFUSED as transient", () => {
    expect(isTransientError(new Error("connect ECONNREFUSED"))).toBe(true);
  });

  test("treats network error as transient", () => {
    expect(isTransientError(new Error("network error"))).toBe(true);
  });

  test("treats socket hang up as transient", () => {
    expect(isTransientError(new Error("socket hang up"))).toBe(true);
  });

  test("handles plain strings", () => {
    expect(isTransientError("socket hang up")).toBe(true);
  });

  // --- Should NOT be transient ---

  test("treats 429 with quota as non-transient", () => {
    expect(isTransientError(new Error("429 quota exceeded"))).toBe(false);
  });

  test("treats 429 with daily as non-transient", () => {
    expect(isTransientError(new Error("429 daily limit reached"))).toBe(false);
  });

  test("treats HTTP 400 as non-transient", () => {
    expect(isTransientError(new Error("HTTP 400 Bad Request"))).toBe(false);
  });

  test("treats HTTP 401 as non-transient", () => {
    expect(isTransientError(new Error("HTTP 401 Unauthorized"))).toBe(false);
  });

  test("treats HTTP 403 as non-transient", () => {
    expect(isTransientError(new Error("HTTP 403 Forbidden"))).toBe(false);
  });

  test("treats generic errors as non-transient", () => {
    expect(isTransientError(new Error("Cannot read property 'x' of undefined"))).toBe(false);
  });

  test("treats empty error as non-transient", () => {
    expect(isTransientError(new Error(""))).toBe(false);
  });
});
