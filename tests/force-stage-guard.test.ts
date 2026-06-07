/**
 * Layer-1 force-stage guard — source-scan invariant.
 *
 * The harness runs against arbitrary target repositories. A project's
 * `.gitignore` is absolute: the harness must never override it by
 * force-staging a path. This test asserts that no `git add -f` or
 * `git add --force` invocation exists anywhere in `shared/` or
 * `harness-claude/`, so the invariant cannot silently regress.
 *
 * This is a pure source-file scan — it reads `.ts` files from disk and
 * does not shell out to git, create a temp repo, or depend on the test
 * runner being inside a git repository.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test } from "bun:test";

// ─── File discovery ──────────────────────────────────────────────────────────

/** Recursively collect all `.ts` files under a directory. */
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

// ─── Force-stage detection ───────────────────────────────────────────────────

/**
 * Matches `git add -f` or `git add --force` in source code.
 *
 * The pattern is deliberately narrow to avoid false positives:
 * - It requires `git add` followed (possibly with other flags/args) by
 *   `-f` or `--force` as a distinct token.
 * - It does NOT match unrelated uses of `-f` (e.g. `rm -f`) or `--force`
 *   on other git subcommands (e.g. `git push --force`).
 *
 * Each match captures the full line for diagnostic output.
 */
const GIT_ADD_FORCE_RE = /^.*\bgit\s+add\b[^;\n]*\s(?:-f|--force)\b.*$/gm;

interface ForceStageViolation {
  /** Relative file path from the repo root. */
  file: string;
  /** 1-based line number within the file. */
  line: number;
  /** The full text of the offending line (trimmed). */
  text: string;
}

/**
 * Scan all TypeScript source files under `dirs` and return any lines that
 * contain a `git add -f` or `git add --force` invocation.
 */
function findForceStageViolations(dirs: string[], rootDir: string): ForceStageViolation[] {
  const violations: ForceStageViolation[] = [];

  for (const dir of dirs) {
    for (const filePath of collectTsFiles(dir)) {
      const source = readFileSync(filePath, "utf-8");
      const relPath = relative(rootDir, filePath);

      for (const match of source.matchAll(GIT_ADD_FORCE_RE)) {
        // Compute the 1-based line number from the match index.
        const lineNumber = source.slice(0, match.index).split("\n").length;
        violations.push({
          file: relPath,
          line: lineNumber,
          text: match[0].trim(),
        });
      }
    }
  }

  return violations;
}

/** Format violations into a human-readable failure message. */
function formatViolations(violations: ForceStageViolation[]): string {
  const header =
    "Layer-1 invariant violated: the harness must never force-stage a path.\n" +
    "A project's .gitignore is absolute — `git add -f` / `git add --force`\n" +
    "can override it, allowing ignored files into git history.\n" +
    "Remove the force flag and use a non-forced `git add` instead.\n\n" +
    "Offending locations:\n";

  const details = violations
    .map((v) => `  ${v.file}:${v.line}  →  ${v.text}`)
    .join("\n");

  return header + details;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

const REPO_ROOT = join(import.meta.dir, "..");
const SHARED_DIR = join(REPO_ROOT, "shared");
const HARNESS_CLAUDE_DIR = join(REPO_ROOT, "harness-claude");
const SCANNED_DIRS = [SHARED_DIR, HARNESS_CLAUDE_DIR];

describe("Layer-1 force-stage guard", () => {
  test("no git add -f or git add --force exists in shared/ or harness-claude/", () => {
    const violations = findForceStageViolations(SCANNED_DIRS, REPO_ROOT);

    expect(violations, formatViolations(violations)).toHaveLength(0);
  });

  test("scans both shared/ and harness-claude/ directories", () => {
    // Verify that both directories are scanned by confirming files from
    // each directory are reachable. This is a structural sanity check.
    const sharedFiles = collectTsFiles(SHARED_DIR);
    const harnessFiles = collectTsFiles(HARNESS_CLAUDE_DIR);

    expect(sharedFiles.length).toBeGreaterThan(0);
    expect(harnessFiles.length).toBeGreaterThan(0);

    // The scan function accepts both dirs — verified by the passing
    // clean-tree test above. This test just confirms the dirs are not empty.
  });
});

describe("Layer-1 force-stage guard — violation detection", () => {
  test("detects git add -f in source content", () => {
    const source = `execSync("git add -f .", { cwd: dir, stdio: "pipe" });`;
    const matches = [...source.matchAll(GIT_ADD_FORCE_RE)];
    expect(matches).toHaveLength(1);
  });

  test("detects git add --force in source content", () => {
    const source = `exec(\`git add --force \${path}\`, { cwd: dir });`;
    const matches = [...source.matchAll(GIT_ADD_FORCE_RE)];
    expect(matches).toHaveLength(1);
  });

  test("detects git add with other flags before -f", () => {
    const source = `execSync("git add -A -f .", { cwd: dir });`;
    const matches = [...source.matchAll(GIT_ADD_FORCE_RE)];
    expect(matches).toHaveLength(1);
  });

  test("does not false-positive on rm -f", () => {
    const source = `execSync("rm -f old-file.txt", { cwd: dir });`;
    const matches = [...source.matchAll(GIT_ADD_FORCE_RE)];
    expect(matches).toHaveLength(0);
  });

  test("does not false-positive on git push --force", () => {
    const source = `execSync("git push --force origin main", { cwd: dir });`;
    const matches = [...source.matchAll(GIT_ADD_FORCE_RE)];
    expect(matches).toHaveLength(0);
  });

  test("does not false-positive on a plain git add (no force flag)", () => {
    const source = `execSync("git add -A && git commit -m 'test'", { cwd: dir });`;
    const matches = [...source.matchAll(GIT_ADD_FORCE_RE)];
    expect(matches).toHaveLength(0);
  });

  test("does not false-positive on git add with a path containing 'force'", () => {
    const source = `execSync("git add force-handler.ts", { cwd: dir });`;
    const matches = [...source.matchAll(GIT_ADD_FORCE_RE)];
    expect(matches).toHaveLength(0);
  });

  test("failure message names the offending file and explains the invariant", () => {
    const violations: ForceStageViolation[] = [
      {
        file: "shared/orchestration/git-ops.ts",
        line: 42,
        text: 'execSync("git add -f .", { cwd: dir });',
      },
    ];
    const message = formatViolations(violations);

    // Must name the file
    expect(message).toContain("shared/orchestration/git-ops.ts");
    // Must explain why force-staging is prohibited
    expect(message).toContain("must never force-stage");
    expect(message).toContain(".gitignore");
  });

  test("failure message names the file for --force variant in harness-claude/", () => {
    const violations: ForceStageViolation[] = [
      {
        file: "harness-claude/generator.ts",
        line: 99,
        text: 'exec(`git add --force ${path}`);',
      },
    ];
    const message = formatViolations(violations);

    expect(message).toContain("harness-claude/generator.ts");
    expect(message).toContain("must never force-stage");
  });
});
