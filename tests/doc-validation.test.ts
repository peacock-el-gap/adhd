import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
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

  // Channel-asserting tests: degradation messages must go to console.warn (logWarn),
  // not console.log (log), so severity-based filters capture them.
  describe("warning channel routing", () => {
    let warnSpy: ReturnType<typeof spyOn>;
    let logSpy: ReturnType<typeof spyOn>;

    beforeEach(() => {
      warnSpy = spyOn(console, "warn").mockImplementation(() => {});
      logSpy = spyOn(console, "log").mockImplementation(() => {});
    });

    afterEach(() => {
      warnSpy.mockRestore();
      logSpy.mockRestore();
    });

    it("emits missing-README warning via console.warn (not console.log)", async () => {
      const dir = await mkdtemp(join(tmpdir(), "doc-val-warn-"));
      validateDocumentation(dir);

      // Must appear on warn channel
      const warnCalls = warnSpy.mock.calls.map((args: unknown[]) => String(args[0]));
      expect(warnCalls.some((m: string) => m.includes("README.md"))).toBe(true);

      // Must NOT appear on log channel
      const logCalls = logSpy.mock.calls.map((args: unknown[]) => String(args[0]));
      expect(logCalls.some((m: string) => m.includes("README.md"))).toBe(false);
    });

    it("emits missing-CHANGELOG warning via console.warn (not console.log)", async () => {
      const dir = await mkdtemp(join(tmpdir(), "doc-val-warn-"));
      const longContent = "x".repeat(MIN_README_LENGTH + 100);
      await writeFile(join(dir, "README.md"), longContent, "utf-8");
      // No CHANGELOG
      validateDocumentation(dir);

      const warnCalls = warnSpy.mock.calls.map((args: unknown[]) => String(args[0]));
      expect(warnCalls.some((m: string) => m.includes("CHANGELOG.md"))).toBe(true);

      const logCalls = logSpy.mock.calls.map((args: unknown[]) => String(args[0]));
      expect(logCalls.some((m: string) => m.includes("CHANGELOG.md"))).toBe(false);
    });

    it("emits short-README warning via console.warn (not console.log)", async () => {
      const dir = await mkdtemp(join(tmpdir(), "doc-val-warn-"));
      await writeFile(join(dir, "README.md"), "too short", "utf-8");
      validateDocumentation(dir);

      const warnCalls = warnSpy.mock.calls.map((args: unknown[]) => String(args[0]));
      expect(warnCalls.some((m: string) => m.includes("very short") || m.includes("README.md"))).toBe(true);

      const logCalls = logSpy.mock.calls.map((args: unknown[]) => String(args[0]));
      expect(logCalls.some((m: string) => m.includes("very short"))).toBe(false);
    });

    it("emits no warnings when documentation is complete and valid", async () => {
      const dir = await mkdtemp(join(tmpdir(), "doc-val-warn-"));
      const longContent = "x".repeat(MIN_README_LENGTH + 100);
      await writeFile(join(dir, "README.md"), longContent, "utf-8");
      await writeFile(join(dir, "CHANGELOG.md"), "# Changelog\n\n## 1.0.0\n- Initial", "utf-8");
      validateDocumentation(dir);

      expect(warnSpy.mock.calls.length).toBe(0);
    });
  });
});
