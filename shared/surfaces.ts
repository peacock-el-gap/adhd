/**
 * Surface taxonomy — the fixed vocabulary naming the parts of a codebase a
 * sprint can touch. This is the single source of truth for surface names; no
 * other module should redeclare the six values.
 *
 * A "surface" is one slice of the code: backend logic, frontend/UI, the
 * database layer, tests, documentation, or configuration. Contracts declare
 * which surfaces a sprint intends to change so the harness can later check
 * that the work actually touched everything it promised.
 *
 * This module is pure: it has zero LLM SDK imports and performs no I/O, so it
 * lives in shared/ and is trivially unit-testable.
 */

/** The six allowed surface names, in their canonical documented order. */
export const SURFACE_VOCABULARY = ["backend", "frontend", "db", "tests", "docs", "config"] as const;

/** A single valid surface name drawn from {@link SURFACE_VOCABULARY}. */
export type Surface = (typeof SURFACE_VOCABULARY)[number];

/** Fast membership lookup for the vocabulary; built once from the source list. */
const SURFACE_SET: ReadonlySet<string> = new Set(SURFACE_VOCABULARY);

/** True when `value` is one of the allowed surface vocabulary tokens. */
export function isSurface(value: unknown): value is Surface {
  return typeof value === "string" && SURFACE_SET.has(value);
}

/**
 * Best-effort, never-throwing normalization of a stored or proposed `surfaces`
 * value into a clean list of known surface names.
 *
 * - `undefined` stays `undefined`: the field is genuinely absent (e.g. a legacy
 *   contract), and we never inject spurious values for it.
 * - Any non-array value (null, a string, an object, a number) degrades to
 *   `undefined` — treated as unspecified rather than crashing the run.
 * - An array is filtered to allowed vocabulary tokens only, with non-string and
 *   unknown entries dropped, duplicates removed, and first-seen order preserved.
 *
 * Mirrors the harness's graceful-degradation policy: malformed input never
 * aborts a run, it simply yields the best clean interpretation available.
 */
export function normalizeSurfaces(value: unknown): Surface[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return undefined;

  const seen = new Set<Surface>();
  const result: Surface[] = [];
  for (const item of value) {
    if (isSurface(item) && !seen.has(item)) {
      seen.add(item);
      result.push(item);
    }
  }
  return result;
}

/**
 * One classification rule: a target surface and the path patterns that map to
 * it. A path is assigned to the first rule (in {@link SURFACE_PATTERNS} order)
 * with any matching pattern, so the rule order encodes precedence.
 */
interface SurfaceRule {
  readonly surface: Surface;
  readonly patterns: readonly RegExp[];
}

/**
 * Ordered table mapping path patterns to surfaces. The order IS the precedence:
 * earlier rules win, so a path matching more than one rule resolves to the
 * first one. This is why `tests` precedes `frontend` and `backend` — a test
 * file with a frontend extension (e.g. `Button.test.tsx`) classifies as
 * `tests`, never `frontend`. The catch-all `backend` rule is last so it only
 * claims source files the more specific rules left untouched.
 *
 * Patterns run against a normalized path (lowercased, backslashes converted to
 * forward slashes), so they need not worry about case or OS separators. Rules
 * are expressed purely as data to keep the mapping readable and extendable;
 * per-project overrides are intentionally out of scope.
 */
const SURFACE_PATTERNS: readonly SurfaceRule[] = [
  {
    // Test directories and test-named files across TS/JS, Python, Go, Ruby.
    surface: "tests",
    patterns: [
      /(^|\/)(tests?|__tests__|specs?|testing)\//,
      /\.(test|spec)\.[^/]+$/,
      /(^|\/)test_[^/]*\.py$/,
      /_test\.(go|py|rb|ts|js)$/,
    ],
  },
  {
    // Migrations, seed data, and schema/SQL/ORM definition files.
    surface: "db",
    patterns: [/(^|\/)migrations?\//, /(^|\/)seeds?\//, /\.sql$/, /\.prisma$/, /(^|\/)schema\.[^/]+$/],
  },
  {
    // Package manifests, lockfiles, dotfiles, CI config, and config formats.
    surface: "config",
    patterns: [
      /(^|\/)(package\.json|package-lock\.json|bun\.lockb?|yarn\.lock|pnpm-lock\.yaml|tsconfig[^/]*\.json|biome\.json|go\.mod|go\.sum|cargo\.toml|cargo\.lock|gemfile(\.lock)?|requirements\.txt|pyproject\.toml|poetry\.lock|setup\.(py|cfg)|makefile|dockerfile)$/,
      /(^|\/)\.github\//,
      /(^|\/)\.circleci\//,
      /(^|\/)\.[^/]+$/,
      /\.(ya?ml|toml|ini|cfg|conf|env)$/,
    ],
  },
  {
    // Markdown and other prose documentation, plus dedicated docs directories.
    surface: "docs",
    patterns: [/\.(md|mdx|markdown|rst|adoc|txt)$/, /(^|\/)docs?\//],
  },
  {
    // UI source: component extensions and conventional client/UI directories.
    surface: "frontend",
    patterns: [
      /\.(tsx|jsx|vue|svelte|css|scss|sass|less|html)$/,
      /(^|\/)(components?|frontend|client|web|ui|pages|views)\//,
    ],
  },
  {
    // Catch-all for server-side source not already claimed above.
    surface: "backend",
    patterns: [/\.(ts|js|mjs|cjs|py|go|rs|java|rb|php|cs|kt|kts|scala|c|cc|cpp|h|hpp|ex|exs|clj)$/],
  },
];

/** Normalize a raw path for matching: trim, unify separators, lowercase. */
function normalizePath(raw: string): string {
  return raw.trim().replace(/\\/g, "/").toLowerCase();
}

/** The single surface a path maps to, or `undefined` if none applies. */
function classifyPath(raw: unknown): Surface | undefined {
  if (typeof raw !== "string") return undefined;
  const path = normalizePath(raw);
  if (path === "") return undefined;

  for (const rule of SURFACE_PATTERNS) {
    for (const pattern of rule.patterns) {
      if (pattern.test(path)) return rule.surface;
    }
  }
  return undefined;
}

/**
 * Classify a list of changed file paths into the deduplicated set of surfaces
 * they touch — the engine that later lets the harness compare what a sprint
 * actually changed against the surfaces its contract declared.
 *
 * Properties (all unit-tested):
 * - Pure: no git, filesystem, or network access — it reads only the strings
 *   passed in, so it is trivially testable and side-effect free.
 * - Single surface per path: each path maps to at most one surface via the
 *   documented {@link SURFACE_PATTERNS} precedence (e.g. `Button.test.tsx`
 *   resolves to `tests`, not `frontend`).
 * - Deterministic and order-independent: the result is the same set regardless
 *   of input order, returned in the canonical {@link SURFACE_VOCABULARY} order.
 * - Never throws: like {@link normalizeSurfaces}, degenerate input (empty list,
 *   empty/whitespace strings, non-strings, extension-less or unrecognized
 *   paths) is silently omitted rather than raising.
 */
export function classifySurfaces(paths: readonly unknown[]): Surface[] {
  const found = new Set<Surface>();
  if (!Array.isArray(paths)) return [];

  for (const path of paths) {
    const surface = classifyPath(path);
    if (surface !== undefined) found.add(surface);
  }

  // Return in canonical vocabulary order so the result is stable and
  // order-independent regardless of how the input paths were arranged.
  return SURFACE_VOCABULARY.filter((surface) => found.has(surface));
}

/** The outcome of comparing declared surfaces against the surfaces touched. */
export interface SurfaceCoverage {
  /** Surfaces actually touched by the changed files, in canonical order. */
  readonly covered: Surface[];
  /**
   * Declared surfaces NOT touched by the changed files, in canonical order.
   * Empty when every declared surface was covered.
   */
  readonly missing: Surface[];
}

/**
 * Compare the surfaces a contract declared against the surfaces actually
 * touched by a list of changed file paths — the heart of the surface coverage
 * gate, which fails an attempt cheaply when the Generator dropped a declared
 * surface.
 *
 * Pure and never-throwing: it reuses {@link normalizeSurfaces} to clean the
 * declared list (so legacy/odd values degrade gracefully) and the existing
 * {@link classifySurfaces} engine (F2) to derive the touched surfaces — it does
 * NOT reimplement classification. Both result lists are returned in canonical
 * {@link SURFACE_VOCABULARY} order so messages are deterministic.
 *
 * @param declared - the contract's declared surfaces (already normalized on
 *   read, but re-normalized here for safety); `undefined`/empty yields no
 *   missing surfaces
 * @param changedPaths - the changed file paths for the attempt
 */
export function checkSurfaceCoverage(
  declared: readonly string[] | undefined,
  changedPaths: readonly unknown[],
): SurfaceCoverage {
  const declaredSet = new Set<Surface>(normalizeSurfaces(declared) ?? []);
  const coveredSet = new Set<Surface>(classifySurfaces(changedPaths));
  const covered = SURFACE_VOCABULARY.filter((surface) => coveredSet.has(surface));
  const missing = SURFACE_VOCABULARY.filter((surface) => declaredSet.has(surface) && !coveredSet.has(surface));
  return { covered, missing };
}
