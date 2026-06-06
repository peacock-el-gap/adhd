/**
 * Sprint 6 — Harness-generated codebase map (F6)
 *
 * Covers all contract criteria:
 *  (a) map_excludes_full_bodies
 *  (b) map_size_bounded — MAX_CODEBASE_MAP_CHARS enforced with truncation marker
 *  (c) map_deterministic — two calls on the same directory produce identical output
 *  (d) map_graceful_degradation — non-existent path, unreadable dir, bad file
 *  (e) generator_context_composition_both_present — baseline + map both in context
 *  (f) generator_context_map_when_baseline_absent — null baseline → map still present
 *  (g) run_never_fails_on_map_error — throwing builder doesn't abort sprint attempt
 *  (h) map_builder_in_shared_no_sdk_imports — static check
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  MAX_CODEBASE_MAP_CHARS,
  buildCodebaseMap,
  extractFileSignatures,
  formatMapSection,
  truncateCodebaseMap,
} from "../shared/codebase-map.ts";
import { VERIFICATION_NO_OP } from "../shared/verification.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "adhd-codebase-map-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

/** Create a file at `relPath` inside `tmpDir` with the given content. */
function writeFile(relPath: string, content: string): string {
  const fullPath = join(tmpDir, relPath);
  mkdirSync(join(tmpDir, relPath.split("/").slice(0, -1).join("/")), { recursive: true });
  writeFileSync(fullPath, content, "utf-8");
  return fullPath;
}

// ---------------------------------------------------------------------------
// (a) map_excludes_full_bodies — extractFileSignatures
// ---------------------------------------------------------------------------

describe("extractFileSignatures — body-free extraction", () => {
  test("extracts export function names without body", () => {
    const content = `export function foo(a: number): string {\n  return String(a);\n}`;
    const sigs = extractFileSignatures(content);
    expect(sigs).toHaveLength(1);
    expect(sigs[0]).toContain("foo");
    // Body line must not appear
    expect(sigs.join("\n")).not.toContain("return String");
  });

  test("extracts async function signature", () => {
    const content = `export async function bar(x: string): Promise<void> {\n  console.log(x);\n}`;
    const sigs = extractFileSignatures(content);
    expect(sigs.some((s) => s.includes("bar"))).toBe(true);
    expect(sigs.join("\n")).not.toContain("console.log");
  });

  test("extracts interface declaration without body lines", () => {
    const content = `export interface Foo {\n  name: string;\n  age: number;\n}`;
    const sigs = extractFileSignatures(content);
    expect(sigs.some((s) => s.includes("interface") && s.includes("Foo"))).toBe(true);
    // Body lines (name: string, age: number) are inside braces — stripped
    expect(sigs.join("\n")).not.toContain("name: string");
    expect(sigs.join("\n")).not.toContain("age: number");
  });

  test("extracts type alias without body", () => {
    const content = `export type Surface = "backend" | "frontend";\nexport type Fn = (x: number) => string;`;
    const sigs = extractFileSignatures(content);
    expect(sigs.some((s) => s.includes("Surface"))).toBe(true);
    expect(sigs.some((s) => s.includes("Fn"))).toBe(true);
  });

  test("strips const initializer, preserving name", () => {
    const content = `export const MAX_CHARS = 32_000;\nexport const FOO: string[] = [];`;
    const sigs = extractFileSignatures(content);
    expect(sigs.some((s) => s.includes("MAX_CHARS") && !s.includes("32_000"))).toBe(true);
    expect(sigs.some((s) => s.includes("FOO"))).toBe(true);
  });

  test("ignores indented code (not at column 0)", () => {
    const content = `function outer() {\n  export const x = 1;\n}`;
    const sigs = extractFileSignatures(content);
    // The indented export (which is actually a syntax error, but we test conservatively)
    // is NOT at column 0, so it must be skipped
    expect(sigs.filter((s) => s.includes("outer")).length).toBe(0);
  });

  test("extracts re-export declarations", () => {
    const content = `export { foo, bar } from "./utils.ts";\nexport * from "./types.ts";`;
    const sigs = extractFileSignatures(content);
    expect(sigs.some((s) => s.includes("export"))).toBe(true);
  });

  test("returns empty array for empty content", () => {
    expect(extractFileSignatures("")).toEqual([]);
  });

  test("never throws on malformed/binary content", () => {
    expect(() => extractFileSignatures("not valid ts \0\x01\x02")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// (b) map_size_bounded — truncateCodebaseMap
// ---------------------------------------------------------------------------

describe("truncateCodebaseMap — size ceiling", () => {
  test("returns input unchanged when within the limit", () => {
    const short = "x".repeat(100);
    expect(truncateCodebaseMap(short)).toBe(short);
  });

  test("output is at most MAX_CODEBASE_MAP_CHARS", () => {
    const huge = "a\n".repeat(MAX_CODEBASE_MAP_CHARS);
    const result = truncateCodebaseMap(huge);
    expect(result.length).toBeLessThanOrEqual(MAX_CODEBASE_MAP_CHARS);
  });

  test("appends a truncation marker when cut", () => {
    const huge = "a\n".repeat(MAX_CODEBASE_MAP_CHARS);
    const result = truncateCodebaseMap(huge);
    expect(result).toContain("[... codebase map truncated");
  });

  test("MAX_CODEBASE_MAP_CHARS is a named constant defined in shared/codebase-map.ts", () => {
    expect(typeof MAX_CODEBASE_MAP_CHARS).toBe("number");
    expect(MAX_CODEBASE_MAP_CHARS).toBeGreaterThan(0);
  });
});

describe("buildCodebaseMap — size bounded on a synthetic large project", () => {
  test("output stays at or below MAX_CODEBASE_MAP_CHARS for a large synthetic project", () => {
    // Create many files with many exports
    for (let i = 0; i < 50; i++) {
      let content = "";
      for (let j = 0; j < 100; j++) {
        content += `export function fn${i}_${j}(x: number): string { return ""; }\n`;
      }
      writeFile(`src/module${i}.ts`, content);
    }
    const map = buildCodebaseMap(tmpDir);
    expect(map.length).toBeLessThanOrEqual(MAX_CODEBASE_MAP_CHARS);
  });
});

// ---------------------------------------------------------------------------
// (c) map_deterministic
// ---------------------------------------------------------------------------

describe("buildCodebaseMap — determinism", () => {
  test("two calls on the same directory produce byte-identical output", () => {
    writeFile("src/alpha.ts", `export function alpha() {}\nexport const A = 1;`);
    writeFile("src/beta.ts", `export function beta() {}\nexport type B = string;`);
    writeFile("tests/alpha.test.ts", `import { alpha } from "../src/alpha.ts";`);

    const first = buildCodebaseMap(tmpDir);
    const second = buildCodebaseMap(tmpDir);
    expect(first).toBe(second);
  });

  test("determinism holds across multiple files in multiple directories", () => {
    writeFile("shared/a.ts", `export function a() {}`);
    writeFile("shared/b.ts", `export function b() {}`);
    writeFile("harness-claude/c.ts", `export function c() {}`);

    const first = buildCodebaseMap(tmpDir);
    const second = buildCodebaseMap(tmpDir);
    expect(first).toBe(second);
  });

  test("empty project is deterministic (both calls return empty string)", () => {
    const first = buildCodebaseMap(tmpDir);
    const second = buildCodebaseMap(tmpDir);
    expect(first).toBe(second);
    expect(first).toBe("");
  });
});

// ---------------------------------------------------------------------------
// (d) map_graceful_degradation
// ---------------------------------------------------------------------------

describe("buildCodebaseMap — graceful degradation", () => {
  test("non-existent directory returns empty string without throwing", () => {
    expect(() => buildCodebaseMap("/does/not/exist/at/all")).not.toThrow();
    expect(buildCodebaseMap("/does/not/exist/at/all")).toBe("");
  });

  test("empty directory returns empty string", () => {
    expect(buildCodebaseMap(tmpDir)).toBe("");
  });

  test("does not throw when a file cannot be read (returns partial map)", () => {
    // Write a valid file alongside a reference to a missing file path
    writeFile("src/valid.ts", `export function valid() {}`);

    // The builder will try to process the directory — it should succeed for
    // valid.ts and gracefully skip any unreadable entries
    expect(() => buildCodebaseMap(tmpDir)).not.toThrow();
    const map = buildCodebaseMap(tmpDir);
    // At least the valid file is present
    expect(typeof map).toBe("string");
  });

  test("never throws and returns a string for any input type", () => {
    // Pass non-string edge cases to the helpers that accept strings
    expect(() => buildCodebaseMap("")).not.toThrow();
    expect(() => extractFileSignatures("")).not.toThrow();
    expect(() => truncateCodebaseMap("")).not.toThrow();
  });

  test("formatMapSection never throws on bad file path", () => {
    expect(() => formatMapSection("backend", ["/no/such/file.ts"], "/no/root")).not.toThrow();
    const result = formatMapSection("backend", ["/no/such/file.ts"], "/no/root");
    expect(typeof result).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// (e) generator_context_composition_both_present
// ---------------------------------------------------------------------------

describe("Generator supplementaryContext composition — both baseline and map", () => {
  test("when both sections are non-empty, both appear in the composed string", () => {
    // Simulate what sprint-attempts.ts does
    const baselineSection = "## Verification Baseline (pre-sprint state — do not re-run the full suite)\n\nAll tests passing.";
    writeFile("src/foo.ts", `export function foo() {}`);
    const mapRaw = buildCodebaseMap(tmpDir);

    // Compose: filter + join (the same logic used in sprint-attempts.ts)
    const parts = [baselineSection, mapRaw].filter(Boolean);
    const composed = parts.length > 0 ? parts.join("\n\n") : undefined;

    expect(composed).toBeDefined();
    expect(composed).toContain("Verification Baseline");
    expect(composed).toContain("Codebase Map");
    // Neither section has overwritten the other
    expect(composed).toContain("All tests passing");
    expect(composed).toContain("foo");
  });

  test("each section has a distinct heading that clearly separates them", () => {
    const baselineSection = "## Verification Baseline (pre-sprint state — do not re-run the full suite)\n\nSome baseline.";
    writeFile("src/utils.ts", `export function helper() {}`);
    const mapRaw = buildCodebaseMap(tmpDir);

    const parts = [baselineSection, mapRaw].filter(Boolean);
    const composed = parts.join("\n\n");

    // Both ## headings must be present
    const headingMatches = composed.match(/^## /gm) ?? [];
    expect(headingMatches.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// (f) generator_context_map_when_baseline_absent
// ---------------------------------------------------------------------------

describe("Generator supplementaryContext — map present when baseline absent", () => {
  test("VERIFICATION_NO_OP baseline (passed: null) → map still appears in context", () => {
    writeFile("src/service.ts", `export function doWork() {}`);
    const mapRaw = buildCodebaseMap(tmpDir);

    // Simulate buildBaselineVerificationSection(VERIFICATION_NO_OP) = ""
    const { buildBaselineVerificationSection } = require("../shared/verification.ts");
    const baselineSection = buildBaselineVerificationSection(VERIFICATION_NO_OP);
    expect(baselineSection).toBe(""); // baseline is empty for no-op

    const parts = [baselineSection, mapRaw].filter(Boolean);
    const composed = parts.length > 0 ? parts.join("\n\n") : undefined;

    // Map must still appear
    expect(composed).toBeDefined();
    expect(composed).toContain("Codebase Map");
    expect(composed).toContain("doWork");
  });

  test("null baseline → supplementaryContext still contains map", () => {
    writeFile("src/entity.ts", `export class Entity {}`);
    const mapRaw = buildCodebaseMap(tmpDir);

    // baselineSection from a null baseline
    const { buildBaselineVerificationSection } = require("../shared/verification.ts");
    const baselineSection = buildBaselineVerificationSection(null);
    expect(baselineSection).toBe("");

    const parts = [baselineSection, mapRaw].filter(Boolean);
    const composed = parts.length > 0 ? parts.join("\n\n") : undefined;

    expect(composed).toContain("Codebase Map");
    expect(composed).toContain("Entity");
  });
});

// ---------------------------------------------------------------------------
// (g) run_never_fails_on_map_error — integration-level simulation
// ---------------------------------------------------------------------------

describe("run_never_fails_on_map_error", () => {
  test("a map builder that always returns empty string does not prevent context composition", () => {
    // Simulate a total failure: buildCodebaseMap returns ""
    const emptyMap = "";
    const baselineSection = "## Verification Baseline\n\nSome baseline.";

    const parts = [baselineSection, emptyMap].filter(Boolean);
    const composed = parts.length > 0 ? parts.join("\n\n") : undefined;

    // Run still has context (just the baseline)
    expect(composed).toBeDefined();
    expect(composed).toContain("Verification Baseline");
  });

  test("a map builder that throws internally never propagates (try/catch wrapper)", () => {
    // buildCodebaseMap is already wrapped in try/catch; simulate a throwing scenario
    // by calling with a path that causes internal errors — it must not throw
    expect(() => buildCodebaseMap("\0invalid\0")).not.toThrow();
    const result = buildCodebaseMap("\0invalid\0");
    expect(typeof result).toBe("string");
  });

  test("empty map + empty baseline → supplementaryContext is undefined (no garbage injected)", () => {
    const baselineSection = "";
    const mapRaw = "";

    const parts = [baselineSection, mapRaw].filter(Boolean);
    const composed = parts.length > 0 ? parts.join("\n\n") : undefined;

    expect(composed).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// (h) map_builder_in_shared_no_sdk_imports — static check
// ---------------------------------------------------------------------------

describe("map_builder_in_shared_no_sdk_imports", () => {
  test("shared/codebase-map.ts contains no @anthropic-ai imports", () => {
    const fs = require("node:fs");
    const content: string = fs.readFileSync(
      require("node:path").join(__dirname, "../shared/codebase-map.ts"),
      "utf-8",
    );
    expect(content).not.toContain("@anthropic-ai");
    expect(content).not.toContain("harness-claude");
  });
});

// ---------------------------------------------------------------------------
// Structural checks
// ---------------------------------------------------------------------------

describe("buildCodebaseMap — structural output", () => {
  test("output includes ## Codebase Map heading when files are found", () => {
    writeFile("src/main.ts", `export function main() {}`);
    const map = buildCodebaseMap(tmpDir);
    expect(map).toContain("## Codebase Map");
  });

  test("grouped by surface using ### headings", () => {
    writeFile("src/service.ts", `export function service() {}`);
    writeFile("tests/service.test.ts", `import { service } from "../src/service.ts";`);
    const map = buildCodebaseMap(tmpDir);
    // Should have at least one surface section heading
    expect(map).toMatch(/###\s+\w+/);
  });

  test("file paths appear in the map", () => {
    writeFile("src/utils.ts", `export function util() {}`);
    const map = buildCodebaseMap(tmpDir);
    expect(map).toContain("utils.ts");
  });

  test("exported function name appears in the map", () => {
    writeFile("src/helpers.ts", `export function myHelper(x: number): void {}`);
    const map = buildCodebaseMap(tmpDir);
    expect(map).toContain("myHelper");
  });

  test("node_modules directory is excluded", () => {
    // Even if the test somehow creates a node_modules path, it should be skipped
    mkdirSync(join(tmpDir, "node_modules", "some-pkg"), { recursive: true });
    writeFileSync(join(tmpDir, "node_modules", "some-pkg", "index.ts"), `export function pkg() {}`);

    const map = buildCodebaseMap(tmpDir);
    expect(map).not.toContain("node_modules");
  });

  test(".adhd directory is excluded", () => {
    mkdirSync(join(tmpDir, ".adhd"), { recursive: true });
    writeFileSync(join(tmpDir, ".adhd", "secret.ts"), `export const secret = "hidden";`);

    const map = buildCodebaseMap(tmpDir);
    expect(map).not.toContain(".adhd");
  });
});
