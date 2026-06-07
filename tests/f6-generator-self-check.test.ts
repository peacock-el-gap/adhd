/**
 * F6 — Deterministic checks before the expensive evaluation
 *
 * Verifies that the Generator's self-check guidance explicitly directs it to
 * run the deterministic checks in order: auto-fix → lint → type-check → test.
 * The sequence must appear as an ordered list, not as unordered suggestions.
 *
 * This test is designed to be RED against the pre-F6 code (which has no
 * self-check section) and GREEN once the section is added.
 */

import { describe, expect, test } from "bun:test";
import { buildGeneratorPrompt } from "../shared/prompts.ts";

const baseCtx = {
  workDir: "/tmp/test-project",
  isGreenfield: false,
};

describe("F6 — buildGeneratorPrompt self-check section", () => {
  test("contains a self-check section heading", () => {
    const prompt = buildGeneratorPrompt(baseCtx);
    // Must have a recognisable self-check heading
    expect(prompt).toMatch(/self.?check/i);
  });

  test("lists auto-fix as step 1", () => {
    const prompt = buildGeneratorPrompt(baseCtx);
    // Ordered list item 1 mentions auto-fix (case-insensitive)
    expect(prompt).toMatch(/1\.[^\n]*auto.?fix/i);
  });

  test("lists lint as step 2", () => {
    const prompt = buildGeneratorPrompt(baseCtx);
    expect(prompt).toMatch(/2\.[^\n]*lint/i);
  });

  test("lists type-check as step 3", () => {
    const prompt = buildGeneratorPrompt(baseCtx);
    expect(prompt).toMatch(/3\.[^\n]*(type.?check|typecheck)/i);
  });

  test("lists test as step 4", () => {
    const prompt = buildGeneratorPrompt(baseCtx);
    expect(prompt).toMatch(/4\.[^\n]*test/i);
  });

  test("auto-fix step appears before lint step in the text", () => {
    const prompt = buildGeneratorPrompt(baseCtx);
    const autoFixPos = prompt.search(/1\.[^\n]*auto.?fix/i);
    const lintPos = prompt.search(/2\.[^\n]*lint/i);
    expect(autoFixPos).toBeGreaterThanOrEqual(0);
    expect(lintPos).toBeGreaterThanOrEqual(0);
    expect(autoFixPos).toBeLessThan(lintPos);
  });

  test("lint step appears before type-check step in the text", () => {
    const prompt = buildGeneratorPrompt(baseCtx);
    const lintPos = prompt.search(/2\.[^\n]*lint/i);
    const typeCheckPos = prompt.search(/3\.[^\n]*(type.?check|typecheck)/i);
    expect(lintPos).toBeLessThan(typeCheckPos);
  });

  test("type-check step appears before test step in the text", () => {
    const prompt = buildGeneratorPrompt(baseCtx);
    const typeCheckPos = prompt.search(/3\.[^\n]*(type.?check|typecheck)/i);
    const testPos = prompt.search(/4\.[^\n]*test/i);
    expect(typeCheckPos).toBeLessThan(testPos);
  });

  test("self-check section is present for greenfield projects too", () => {
    const prompt = buildGeneratorPrompt({ ...baseCtx, isGreenfield: true });
    expect(prompt).toMatch(/self.?check/i);
    expect(prompt).toMatch(/1\.[^\n]*auto.?fix/i);
  });

  test("skills are still appended after the self-check section", () => {
    const prompt = buildGeneratorPrompt({
      ...baseCtx,
      skills: { injected: "Always use snake_case.", referenceManifest: "", additionalDirs: [] },
    });
    expect(prompt).toContain("Always use snake_case.");
    expect(prompt).toMatch(/self.?check/i);
  });
});
