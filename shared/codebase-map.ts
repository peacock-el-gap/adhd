/**
 * Harness-generated codebase map (Sprint 6 / F6).
 *
 * Builds a deterministic, body-free snapshot of the project's key files and
 * their exported names/signatures, grouped by surface classification, for
 * injection into the Generator and Planner/refinement so those sessions do
 * not re-explore the codebase from scratch each run.
 *
 * Pure: zero SDK imports, no network I/O. All filesystem reads are
 * synchronous for determinism. Never throws — degraded or partial maps are
 * returned rather than propagating errors, consistent with the never-throwing
 * style of shared/contract-limits.ts, shared/surfaces.ts, and resolveAgentCap.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import type { Surface } from "./surfaces.ts";
import { classifySurfaces, SURFACE_VOCABULARY } from "./surfaces.ts";

/**
 * Hard character ceiling for the assembled codebase map.
 * Consistent in style with MAX_SYSTEM_PROMPT_CHARS in shared/prompts.ts.
 */
export const MAX_CODEBASE_MAP_CHARS = 32_000;

/** Truncation marker appended when the raw map exceeds the ceiling. */
const TRUNCATION_MARKER = "\n\n[... codebase map truncated to fit size limit ...]";

/** Directories that are never useful to map (binary output, VCS, harness state). */
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".adhd",
  "dist",
  "build",
  ".turbo",
  "coverage",
  "__pycache__",
  ".cache",
  ".next",
  ".nuxt",
  "out",
  "target",
  "vendor",
]);

/** File extensions whose contents are analyzed for exported names/signatures. */
const ANALYZABLE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

/** Maximum file size in bytes to analyze. Larger files are noted but not parsed. */
const MAX_FILE_BYTES = 100_000;

/** Maximum files to include per surface, keeping each section bounded. */
const MAX_FILES_PER_SURFACE = 20;

// ---------------------------------------------------------------------------
// Signature extraction
// ---------------------------------------------------------------------------

/**
 * Extract exported names and signatures from TypeScript/JavaScript source text.
 *
 * Only top-level export declarations (lines starting with `export ` at column 0)
 * are captured. Body content is stripped: everything at and after an opening
 * brace `{` is removed from the signature line, and const/let/var initializers
 * (the `= <value>` part) are removed so only the name and type annotation remain.
 *
 * This ensures no line that is clearly inside a function body appears in the map.
 * Never throws.
 */
export function extractFileSignatures(content: string): string[] {
  try {
    const signatures: string[] = [];

    for (const line of content.split("\n")) {
      // Only top-level exports at column 0 (not indented inside a class/function)
      if (!line.startsWith("export ")) continue;

      let sig = line.trim();

      // Strip body: remove `{` and everything after it on the same line
      const braceIdx = sig.indexOf("{");
      if (braceIdx >= 0) {
        sig = sig.slice(0, braceIdx).trimEnd();
      }

      // Strip const/let/var initializers: remove `=` and the value that follows.
      // This preserves type annotations like `export const FOO: Foo` while
      // omitting the runtime value (`= 42`, `= { ... }`, etc.).
      if (/^export\s+(const|let|var)\s/.test(sig)) {
        const eqIdx = sig.indexOf("=");
        if (eqIdx >= 0) {
          sig = sig.slice(0, eqIdx).trimEnd();
        }
      }

      sig = sig.trim();
      if (sig) signatures.push(sig);
    }

    return signatures;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Directory walking
// ---------------------------------------------------------------------------

/**
 * Recursively collect analyzable file paths relative to `projectRoot`.
 * Entries are sorted alphabetically within each directory so the output is
 * deterministic across identical directory trees regardless of filesystem order.
 * Never throws — an unreadable directory returns whatever was collected so far.
 */
function collectFiles(dir: string, projectRoot: string): string[] {
  const result: string[] = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });

    // Sort entries alphabetically for determinism
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;

      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        result.push(...collectFiles(fullPath, projectRoot));
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();
        if (ANALYZABLE_EXTENSIONS.has(ext)) {
          result.push(relative(projectRoot, fullPath));
        }
      }
    }
  } catch {
    // Unreadable directory — return whatever we collected before the error
  }
  return result;
}

// ---------------------------------------------------------------------------
// Section formatting
// ---------------------------------------------------------------------------

/**
 * Format one surface's section of the map: a `### surface` heading followed
 * by each file path and its extracted signatures. Each file path is bolded;
 * signatures are indented two spaces beneath it.
 *
 * Never throws.
 */
export function formatMapSection(surface: string, filePaths: readonly string[], projectRoot: string): string {
  try {
    const lines: string[] = [`### ${surface}`];

    for (const relPath of filePaths) {
      lines.push("");
      lines.push(`**${relPath}**`);

      try {
        const fullPath = join(projectRoot, relPath);
        const stats = statSync(fullPath);
        if (stats.size <= MAX_FILE_BYTES) {
          const content = readFileSync(fullPath, "utf-8");
          const sigs = extractFileSignatures(content);
          if (sigs.length > 0) {
            for (const sig of sigs) {
              lines.push(`  ${sig}`);
            }
          } else {
            lines.push("  (no top-level exports detected)");
          }
        } else {
          lines.push(`  (file too large to analyze — ${stats.size} bytes)`);
        }
      } catch {
        lines.push("  (could not read file)");
      }
    }

    return lines.join("\n");
  } catch {
    return `### ${surface}\n\n  (section unavailable)`;
  }
}

// ---------------------------------------------------------------------------
// Truncation
// ---------------------------------------------------------------------------

/**
 * Truncate the map to MAX_CODEBASE_MAP_CHARS, appending a visible truncation
 * marker when cut. Cuts at the most recent newline before the limit to avoid
 * breaking mid-line. Never throws.
 */
export function truncateCodebaseMap(raw: string): string {
  try {
    if (raw.length <= MAX_CODEBASE_MAP_CHARS) return raw;

    const cutAt = MAX_CODEBASE_MAP_CHARS - TRUNCATION_MARKER.length;
    // Prefer a clean line boundary
    const lastNewline = raw.lastIndexOf("\n", cutAt);
    const splitAt = lastNewline > 0 ? lastNewline : cutAt;
    return raw.slice(0, splitAt) + TRUNCATION_MARKER;
  } catch {
    return raw.slice(0, MAX_CODEBASE_MAP_CHARS);
  }
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

/**
 * Build a deterministic, body-free map of the project's key files and their
 * exported names/signatures, grouped by surface classification from
 * `shared/surfaces.ts`. The output is a markdown string suitable for
 * injection into agent prompts via supplementaryContext.
 *
 * Properties:
 * - **Deterministic**: identical output for identical directory trees.
 * - **Body-free**: no function body or implementation code appears.
 * - **Bounded**: output length ≤ MAX_CODEBASE_MAP_CHARS.
 * - **Never throws**: any error at any stage returns the best partial map
 *   available, possibly an empty string.
 *
 * @param projectDir - The project root directory to map.
 * @returns A markdown string, or an empty string when nothing could be analyzed.
 */
export function buildCodebaseMap(projectDir: string): string {
  try {
    const files = collectFiles(projectDir, projectDir);
    if (files.length === 0) return "";

    // Group files by their primary surface (first match from classifySurfaces)
    const bySurface = new Map<Surface, string[]>();
    for (const relPath of files) {
      const surfaces = classifySurfaces([relPath]);
      const surface = surfaces[0];
      if (surface === undefined) continue; // unclassified files are omitted
      const group = bySurface.get(surface);
      if (group) {
        group.push(relPath);
      } else {
        bySurface.set(surface, [relPath]);
      }
    }

    if (bySurface.size === 0) return "";

    const sectionParts: string[] = [];

    // Emit sections in canonical SURFACE_VOCABULARY order for determinism
    for (const surface of SURFACE_VOCABULARY) {
      const surfaceFiles = bySurface.get(surface);
      if (!surfaceFiles || surfaceFiles.length === 0) continue;

      // Cap files per surface so no single surface can dominate the map
      const capped = surfaceFiles.slice(0, MAX_FILES_PER_SURFACE);
      const section = formatMapSection(surface, capped, projectDir);
      if (section) sectionParts.push(section);
    }

    if (sectionParts.length === 0) return "";

    const body = sectionParts.join("\n\n");
    const raw = `## Codebase Map\n\n${body}`;

    return truncateCodebaseMap(raw);
  } catch {
    return "";
  }
}
