/**
 * Sprint 10 / F10 — Unit tests for the pure composeGeneratorContext helper.
 *
 * Exercises all four paths specified by the acceptance criteria:
 *   (a) digest present and non-empty
 *   (b) digest is null
 *   (c) digest is an empty string
 *   (d) supplementaryContext is an empty string
 *
 * No SDK process is spawned; these tests are pure in-memory assertions.
 */

import { describe, expect, test } from "bun:test";
import { composeGeneratorContext, SCOUT_SECTION_HEADING } from "../shared/generator-context.ts";
import { MAX_SCOUT_DIGEST_CHARS } from "../shared/scout-digest.ts";

describe("composeGeneratorContext — pure composition helper (F10)", () => {
  // ── (a) digest present and non-empty ────────────────────────────────────────

  test("(a) inserts Scout section under labelled heading when digest is present", () => {
    const existing = "## Existing Section\n\nsome baseline content";
    const digest = "naming: camelCase\nerror-handling: try/catch";

    const result = composeGeneratorContext(existing, digest);

    expect(result).toBeDefined();
    // Heading appears exactly once
    const occurrences = (result ?? "").split(SCOUT_SECTION_HEADING).length - 1;
    expect(occurrences).toBe(1);
    // Scout section content is present
    expect(result).toContain(digest);
    // Heading appears after the existing content
    expect(result?.indexOf(SCOUT_SECTION_HEADING)).toBeGreaterThan(result?.indexOf("## Existing Section") ?? -1);
  });

  test("(a) existing sections are preserved and not reordered", () => {
    const codebaseMap = "## Codebase Map\n\nmap content";
    const baseline = "## Verification Baseline\n\nbaseline content";
    const existing = `${baseline}\n\n${codebaseMap}`;
    const digest = "testing: bun test";

    const result = composeGeneratorContext(existing, digest);

    expect(result).toBeDefined();
    // Both existing sections survive
    expect(result).toContain(baseline);
    expect(result).toContain(codebaseMap);
    // Scout heading appears exactly once, after both existing sections
    const scoutIdx = result?.indexOf(SCOUT_SECTION_HEADING) ?? -1;
    expect(scoutIdx).toBeGreaterThan(result?.indexOf(codebaseMap) ?? -1);
  });

  test("(a) Scout heading appears exactly once in the output", () => {
    const result = composeGeneratorContext("existing context", "some digest");
    const occurrences = (result ?? "").split(SCOUT_SECTION_HEADING).length - 1;
    expect(occurrences).toBe(1);
  });

  test("(a) returns the Scout section alone when supplementaryContext is undefined", () => {
    const digest = "conventions digest text";
    const result = composeGeneratorContext(undefined, digest);

    expect(result).toBeDefined();
    expect(result).toContain(SCOUT_SECTION_HEADING);
    expect(result).toContain(digest);
  });

  // ── (b) digest is null ───────────────────────────────────────────────────────

  test("(b) returns existing context unmodified when digest is null", () => {
    const existing = "## Codebase Map\n\nexisting content";
    const result = composeGeneratorContext(existing, null);
    expect(result).toBe(existing);
    expect(result).not.toContain(SCOUT_SECTION_HEADING);
  });

  test("(b) returns undefined when digest is null and supplementaryContext is undefined", () => {
    const result = composeGeneratorContext(undefined, null);
    expect(result).toBeUndefined();
  });

  // ── (c) digest is an empty string ────────────────────────────────────────────

  test("(c) returns existing context unmodified when digest is empty string", () => {
    const existing = "baseline and map content";
    const result = composeGeneratorContext(existing, "");
    expect(result).toBe(existing);
    expect(result).not.toContain(SCOUT_SECTION_HEADING);
  });

  test("(c) returns undefined when digest is empty string and supplementaryContext is undefined", () => {
    const result = composeGeneratorContext(undefined, "");
    expect(result).toBeUndefined();
  });

  test("(c) returns undefined when digest is whitespace-only", () => {
    const result = composeGeneratorContext(undefined, "   \n  ");
    expect(result).toBeUndefined();
  });

  // ── (d) supplementaryContext is an empty string ──────────────────────────────

  test("(d) returns Scout section alone when supplementaryContext is empty string and digest is present", () => {
    const digest = "naming: PascalCase for types";
    const result = composeGeneratorContext("", digest);

    expect(result).toBeDefined();
    expect(result).toContain(SCOUT_SECTION_HEADING);
    expect(result).toContain(digest);
    // No stray empty-string prefix separator
    expect(result?.startsWith(SCOUT_SECTION_HEADING)).toBe(true);
  });

  // ── ceiling re-application ───────────────────────────────────────────────────

  test("oversized digest is bounded to MAX_SCOUT_DIGEST_CHARS before injection", () => {
    const oversized = "x".repeat(MAX_SCOUT_DIGEST_CHARS + 5_000);
    const result = composeGeneratorContext("existing", oversized);

    expect(result).toBeDefined();
    // The raw oversized string is NOT present verbatim
    expect(result).not.toContain(oversized);
    // But the heading is present (it was bounded, not dropped)
    expect(result).toContain(SCOUT_SECTION_HEADING);
    // The total length of the scout section component stays within reason
    const scoutIdx = (result ?? "").indexOf(SCOUT_SECTION_HEADING);
    const scoutPart = (result ?? "").slice(scoutIdx);
    // heading + newlines + bounded digest + truncation marker
    expect(scoutPart.length).toBeLessThan(MAX_SCOUT_DIGEST_CHARS + 200);
  });

  // ── never throws ─────────────────────────────────────────────────────────────

  test("never throws for any combination of inputs", () => {
    const cases: Array<[string | undefined, string | null]> = [
      [undefined, null],
      [undefined, ""],
      [undefined, "valid digest"],
      ["", null],
      ["", ""],
      ["", "valid digest"],
      ["existing", null],
      ["existing", ""],
      ["existing", "valid digest"],
    ];
    for (const [ctx, digest] of cases) {
      expect(() => composeGeneratorContext(ctx, digest)).not.toThrow();
    }
  });
});
