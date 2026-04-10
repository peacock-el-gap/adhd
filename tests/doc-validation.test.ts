import { describe, expect, it } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MIN_README_LENGTH, validateDocumentation } from "../shared/doc-validation.ts";

describe("doc-validation", () => {
  it("exports MIN_README_LENGTH as a positive number", () => {
    expect(MIN_README_LENGTH).toBeGreaterThan(0);
    expect(typeof MIN_README_LENGTH).toBe("number");
  });

  it("does not throw when README.md is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "doc-val-"));
    expect(() => validateDocumentation(dir)).not.toThrow();
  });

  it("does not throw when README.md is short", async () => {
    const dir = await mkdtemp(join(tmpdir(), "doc-val-"));
    await writeFile(join(dir, "README.md"), "Short readme", "utf-8");
    expect(() => validateDocumentation(dir)).not.toThrow();
  });

  it("does not throw when CHANGELOG.md is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "doc-val-"));
    const longContent = "x".repeat(MIN_README_LENGTH + 100);
    await writeFile(join(dir, "README.md"), longContent, "utf-8");
    expect(() => validateDocumentation(dir)).not.toThrow();
  });

  it("does not throw when both files exist and are valid", async () => {
    const dir = await mkdtemp(join(tmpdir(), "doc-val-"));
    const longContent = "x".repeat(MIN_README_LENGTH + 100);
    await writeFile(join(dir, "README.md"), longContent, "utf-8");
    await writeFile(join(dir, "CHANGELOG.md"), "# Changelog\n\n## 1.0.0\n- Initial", "utf-8");
    expect(() => validateDocumentation(dir)).not.toThrow();
  });
});
