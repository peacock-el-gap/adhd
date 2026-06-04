import { describe, expect, test } from "bun:test";
import {
  checkSurfaceCoverage,
  classifySurfaces,
  isSurface,
  normalizeSurfaces,
  SURFACE_VOCABULARY,
} from "../shared/surfaces.ts";

describe("SURFACE_VOCABULARY", () => {
  test("is exactly the six documented values in order", () => {
    expect([...SURFACE_VOCABULARY]).toEqual(["backend", "frontend", "db", "tests", "docs", "config"]);
  });
});

describe("isSurface", () => {
  test("accepts every vocabulary value", () => {
    for (const value of SURFACE_VOCABULARY) {
      expect(isSurface(value)).toBe(true);
    }
  });

  test("rejects unknown tokens and non-strings", () => {
    expect(isSurface("api")).toBe(false);
    expect(isSurface("")).toBe(false);
    expect(isSurface(null)).toBe(false);
    expect(isSurface(42)).toBe(false);
    expect(isSurface(undefined)).toBe(false);
  });
});

describe("normalizeSurfaces", () => {
  test("keeps an absent field absent (undefined stays undefined)", () => {
    expect(normalizeSurfaces(undefined)).toBeUndefined();
  });

  test("preserves a valid array exactly (order and membership)", () => {
    expect(normalizeSurfaces(["backend", "tests"])).toEqual(["backend", "tests"]);
  });

  test("drops unknown tokens, keeping only allowed values", () => {
    expect(normalizeSurfaces(["backend", "api", "frontend"])).toEqual(["backend", "frontend"]);
  });

  test("deduplicates while preserving first-seen order", () => {
    expect(normalizeSurfaces(["tests", "backend", "tests"])).toEqual(["tests", "backend"]);
  });

  test("returns an empty array when an array contains no valid tokens", () => {
    expect(normalizeSurfaces(["api", "service"])).toEqual([]);
  });

  test("degrades non-array values to undefined without throwing", () => {
    expect(normalizeSurfaces(null)).toBeUndefined();
    expect(normalizeSurfaces("backend")).toBeUndefined();
    expect(normalizeSurfaces({ backend: true })).toBeUndefined();
    expect(normalizeSurfaces(7)).toBeUndefined();
  });

  test("ignores non-string elements inside an array", () => {
    expect(normalizeSurfaces(["backend", 1, null, { x: 1 }, "docs"])).toEqual(["backend", "docs"]);
  });
});

describe("classifySurfaces", () => {
  test("classifies backend source plus a test path to exactly {backend, tests}", () => {
    const result = classifySurfaces(["shared/orchestration/harness.ts", "src/server.py", "tests/harness.test.ts"]);
    expect(result.sort()).toEqual(["backend", "tests"]);
  });

  test("classifies frontend UI files plus a markdown file to exactly {frontend, docs}", () => {
    const result = classifySurfaces(["app/components/Button.tsx", "styles/main.css", "README.md"]);
    expect(result.sort()).toEqual(["docs", "frontend"]);
  });

  test("classifies migration/schema/seed files to db", () => {
    expect(classifySurfaces(["db/migrations/0001_init.sql"])).toEqual(["db"]);
    expect(classifySurfaces(["prisma/schema.prisma"])).toEqual(["db"]);
    expect(classifySurfaces(["db/seeds/users.ts"])).toEqual(["db"]);
    expect(classifySurfaces(["app/models/schema.rb"])).toEqual(["db"]);
  });

  test("classifies package manifests, lockfiles, dotfiles and CI config to config", () => {
    expect(classifySurfaces(["package.json"])).toEqual(["config"]);
    expect(classifySurfaces(["bun.lock"])).toEqual(["config"]);
    expect(classifySurfaces(["go.mod"])).toEqual(["config"]);
    expect(classifySurfaces(["pyproject.toml"])).toEqual(["config"]);
    expect(classifySurfaces([".gitignore"])).toEqual(["config"]);
    expect(classifySurfaces([".github/workflows/ci.yml"])).toEqual(["config"]);
  });

  test("classifies representative tests, frontend, backend and docs paths", () => {
    expect(classifySurfaces(["__tests__/foo.ts"])).toEqual(["tests"]);
    expect(classifySurfaces(["pkg/handler_test.go"])).toEqual(["tests"]);
    expect(classifySurfaces(["tests/test_app.py"])).toEqual(["tests"]);
    expect(classifySurfaces(["web/views/home.vue"])).toEqual(["frontend"]);
    expect(classifySurfaces(["cmd/main.go"])).toEqual(["backend"]);
    expect(classifySurfaces(["app/service.py"])).toEqual(["backend"]);
    expect(classifySurfaces(["docs/guide.md"])).toEqual(["docs"]);
  });

  test("covers all six surfaces in one mixed list", () => {
    const result = classifySurfaces([
      "shared/files.ts", // backend
      "ui/App.tsx", // frontend
      "migrations/2024_add.sql", // db
      "tests/files.test.ts", // tests
      "README.md", // docs
      "package.json", // config
    ]);
    expect(result.sort()).toEqual(["backend", "config", "db", "docs", "frontend", "tests"]);
  });

  test("a test file with a frontend extension resolves to tests only", () => {
    expect(classifySurfaces(["src/components/Button.test.tsx"])).toEqual(["tests"]);
    expect(classifySurfaces(["src/components/Button.spec.jsx"])).toEqual(["tests"]);
  });

  test("returns an empty set for an empty path list", () => {
    expect(classifySurfaces([])).toEqual([]);
  });

  test("deduplicates multiple paths of the same surface to a single entry", () => {
    expect(classifySurfaces(["a/one.ts", "b/two.ts", "c/three.ts"])).toEqual(["backend"]);
  });

  test("is order-independent: same set regardless of input ordering", () => {
    const a = classifySurfaces(["server.ts", "App.tsx", "schema.sql", "x.test.ts", "README.md", "package.json"]);
    const b = classifySurfaces(["package.json", "README.md", "x.test.ts", "schema.sql", "App.tsx", "server.ts"]);
    expect(a).toEqual(b);
    // Canonical vocabulary order is stable across calls.
    expect(a).toEqual(["backend", "frontend", "db", "tests", "docs", "config"]);
  });

  test("never throws on odd input; silently omits what it cannot classify", () => {
    expect(classifySurfaces(["", "   ", "no-extension-file", "weird.xyz"])).toEqual([]);
    // Non-string and nullish entries are ignored without throwing.
    expect(classifySurfaces(["server.ts", 42, null, undefined, { path: "x" }] as unknown[])).toEqual(["backend"]);
    // A non-array argument degrades to an empty set.
    expect(classifySurfaces(undefined as unknown as string[])).toEqual([]);
  });
});

describe("checkSurfaceCoverage", () => {
  test("reports a declared surface that was not touched as missing", () => {
    // Declared backend + frontend, but only backend files changed.
    const result = checkSurfaceCoverage(["backend", "frontend"], ["shared/server.ts"]);
    expect(result.covered).toEqual(["backend"]);
    expect(result.missing).toEqual(["frontend"]);
  });

  test("reports no missing surfaces when all declared surfaces are touched", () => {
    const result = checkSurfaceCoverage(["backend", "frontend"], ["shared/server.ts", "ui/App.tsx"]);
    expect(result.missing).toEqual([]);
    expect(result.covered).toEqual(["backend", "frontend"]);
  });

  test("ignores surfaces touched but not declared (extra coverage is fine)", () => {
    const result = checkSurfaceCoverage(["backend"], ["shared/server.ts", "README.md"]);
    expect(result.missing).toEqual([]);
    expect(result.covered).toEqual(["backend", "docs"]);
  });

  test("returns missing surfaces in canonical vocabulary order, deterministically", () => {
    // Declared in a non-canonical order; none touched.
    const result = checkSurfaceCoverage(["docs", "backend", "frontend"], []);
    expect(result.missing).toEqual(["backend", "frontend", "docs"]);
  });

  test("yields no missing surfaces when nothing was declared", () => {
    expect(checkSurfaceCoverage(undefined, ["shared/server.ts"]).missing).toEqual([]);
    expect(checkSurfaceCoverage([], ["shared/server.ts"]).missing).toEqual([]);
  });

  test("never throws on odd input", () => {
    expect(() => checkSurfaceCoverage(["backend", "bogus"], ["", null as unknown as string])).not.toThrow();
    const result = checkSurfaceCoverage(["backend", "bogus"], ["shared/server.ts"]);
    expect(result.missing).toEqual([]); // unknown "bogus" token is dropped
    expect(result.covered).toEqual(["backend"]);
  });
});
