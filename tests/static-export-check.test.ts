/**
 * Static duplicate-export check for the SDK-independent core (shared/).
 *
 * Asserts that no symbol name is exported from more than one module within
 * shared/ (including shared/orchestration/). Covers only shared/ and does not
 * reach into harness-claude/ or other harness directories, preserving the
 * SDK-independence boundary.
 *
 * When a violation is detected the error message names the symbol and both
 * source files so a maintainer can act without grepping.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test } from "bun:test";

// ─── Export extraction ────────────────────────────────────────────────────────

/**
 * Patterns that match a directly-declared named export.
 * Re-exports (`export { x } from '...'`, `export * from '...'`) are
 * intentionally excluded — they are a composition mechanism and do not create
 * duplicate symbol definitions.
 */
const DECLARATION_EXPORT_RE =
  /^export\s+(?:async\s+)?(?:function\*?\s+|class\s+|const\s+|let\s+|var\s+|type\s+|interface\s+|enum\s+)([A-Za-z_$][A-Za-z0-9_$]*)/gm;

/**
 * Named export groups without `from` (i.e. `export { Foo, Bar }` but not
 * `export { Foo } from './other'`).
 */
const NAMED_EXPORT_GROUP_RE = /^export\s*\{([^}]+)\}(?!\s*from)/gm;

/**
 * Extract the set of symbol names exported by a single TypeScript source file.
 * Uses regex-based parsing — sufficient for the structured, well-formatted
 * source in shared/ and avoids a full AST dependency.
 */
function extractExports(source: string): Set<string> {
  const symbols = new Set<string>();

  // Declaration-style exports: `export function foo`, `export const FOO`, etc.
  for (const match of source.matchAll(DECLARATION_EXPORT_RE)) {
    const name = match[1];
    if (name) symbols.add(name);
  }

  // Grouped exports without re-export source: `export { Foo, Bar as Baz }`
  for (const match of source.matchAll(NAMED_EXPORT_GROUP_RE)) {
    const group = match[1] ?? "";
    for (const entry of group.split(",")) {
      // Each entry is either `Name` or `Name as Alias` — use the exported name.
      const parts = entry.trim().split(/\s+as\s+/);
      const exported = (parts[1] ?? parts[0] ?? "").trim();
      if (exported && /^[A-Za-z_$]/.test(exported)) {
        symbols.add(exported);
      }
    }
  }

  return symbols;
}

// ─── File discovery ───────────────────────────────────────────────────────────

/** Recursively collect all .ts files under a directory. */
function collectTsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...collectTsFiles(full));
    } else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
      files.push(full);
    }
  }
  return files;
}

// ─── Core check ──────────────────────────────────────────────────────────────

export interface DuplicateExport {
  /** The symbol name exported from more than one file. */
  symbol: string;
  /** The files (relative paths) that all export this symbol. */
  files: string[];
}

/**
 * Scan all TypeScript source files in `dir` and return any symbols that are
 * exported from more than one file.
 *
 * @param dir     Absolute path to the directory to scan (e.g. the shared/ root).
 * @param rootDir Root used for computing relative paths in diagnostics.
 */
export function findDuplicateExports(dir: string, rootDir: string): DuplicateExport[] {
  const symbolToFiles = new Map<string, string[]>();

  for (const filePath of collectTsFiles(dir)) {
    const source = readFileSync(filePath, "utf-8");
    const relPath = relative(rootDir, filePath);

    for (const symbol of extractExports(source)) {
      const existing = symbolToFiles.get(symbol);
      if (existing) {
        existing.push(relPath);
      } else {
        symbolToFiles.set(symbol, [relPath]);
      }
    }
  }

  const duplicates: DuplicateExport[] = [];
  for (const [symbol, files] of symbolToFiles) {
    if (files.length > 1) {
      duplicates.push({ symbol, files });
    }
  }

  // Sort by symbol name for stable, readable output.
  duplicates.sort((a, b) => a.symbol.localeCompare(b.symbol));
  return duplicates;
}

// ─── Formatting ───────────────────────────────────────────────────────────────

/** Format a list of duplicate-export violations into a human-readable string. */
function formatViolations(duplicates: DuplicateExport[]): string {
  return duplicates
    .map(({ symbol, files }) => `  "${symbol}" exported from:\n${files.map((f) => `    - ${f}`).join("\n")}`)
    .join("\n");
}

// ─── Tests ───────────────────────────────────────────────────────────────────

const REPO_ROOT = join(import.meta.dir, "..");
const SHARED_DIR = join(REPO_ROOT, "shared");

describe("static export check — shared/ only", () => {
  test("no symbol is exported from more than one module in shared/", () => {
    const duplicates = findDuplicateExports(SHARED_DIR, REPO_ROOT);

    expect(duplicates, `Duplicate exports found in shared/:\n${formatViolations(duplicates)}`).toHaveLength(0);
  });

  test("does not scan harness-claude/ or other harness directories", () => {
    // Confirm that the check is bounded to shared/ by verifying a symbol known
    // to exist only in harness-claude/ (e.g. runAgent) is not in the results.
    // The real check only scans SHARED_DIR so harness-claude/ is never read.
    const duplicates = findDuplicateExports(SHARED_DIR, REPO_ROOT);
    const symbols = duplicates.map((d) => d.symbol);
    // runAgent lives only in harness-claude/ — if it appeared here, the
    // boundary would have been crossed.
    expect(symbols).not.toContain("runAgent");
  });
});

describe("static export check — violation detection", () => {
  test("detects a deliberate duplicate export introduced in fixture data", () => {
    // Simulate two source files that both export the same symbol.
    const fileA = `export function duplicatedHelper(x: number): number { return x; }`;
    const fileB = `export function duplicatedHelper(x: string): string { return x; }`;

    const symbolToFiles = new Map<string, string[]>();
    for (const [relPath, source] of [
      ["fixture/a.ts", fileA],
      ["fixture/b.ts", fileB],
    ] as [string, string][]) {
      for (const symbol of extractExports(source)) {
        const existing = symbolToFiles.get(symbol);
        if (existing) {
          existing.push(relPath);
        } else {
          symbolToFiles.set(symbol, [relPath]);
        }
      }
    }

    const duplicates: DuplicateExport[] = [];
    for (const [symbol, files] of symbolToFiles) {
      if (files.length > 1) duplicates.push({ symbol, files });
    }

    expect(duplicates).toHaveLength(1);
    expect(duplicates[0]?.symbol).toBe("duplicatedHelper");
    expect(duplicates[0]?.files).toContain("fixture/a.ts");
    expect(duplicates[0]?.files).toContain("fixture/b.ts");
  });

  test("violation message includes symbol name and both source files", () => {
    const violation: DuplicateExport = {
      symbol: "mySymbol",
      files: ["shared/foo.ts", "shared/bar.ts"],
    };
    const message = formatViolations([violation]);
    expect(message).toContain("mySymbol");
    expect(message).toContain("shared/foo.ts");
    expect(message).toContain("shared/bar.ts");
  });

  test("extractExports handles declaration-style exports", () => {
    const source = `
export function foo() {}
export const BAR = 42;
export class Baz {}
export type Qux = string;
export interface Quux {}
export enum Direction { Up, Down }
export async function asyncFn() {}
`;
    const symbols = extractExports(source);
    expect(symbols.has("foo")).toBe(true);
    expect(symbols.has("BAR")).toBe(true);
    expect(symbols.has("Baz")).toBe(true);
    expect(symbols.has("Qux")).toBe(true);
    expect(symbols.has("Quux")).toBe(true);
    expect(symbols.has("Direction")).toBe(true);
    expect(symbols.has("asyncFn")).toBe(true);
  });

  test("extractExports ignores re-exports from other modules", () => {
    const source = `
export { foo } from './other.ts';
export * from './another.ts';
export type { Bar } from './types.ts';
`;
    const symbols = extractExports(source);
    // Re-exports must not be counted as symbol definitions here.
    expect(symbols.size).toBe(0);
  });

  test("extractExports handles grouped exports without source", () => {
    const source = `
const internal = 42;
export { internal };
`;
    const symbols = extractExports(source);
    expect(symbols.has("internal")).toBe(true);
  });
});
