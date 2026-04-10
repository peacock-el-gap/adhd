import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { harnessDir, readContract, readProgress, readSpec, writeContract, writeProgress, writeSpec } from "./files.ts";
import type { HarnessProgress } from "./types.ts";

describe("files", () => {
  describe("harnessDir", () => {
    it("returns .adhd path under workDir", () => {
      expect(harnessDir("/my/project")).toBe("/my/project/.adhd");
    });
  });

  describe("writeSpec / readSpec", () => {
    it("round-trips a spec through .adhd/spec.md", async () => {
      const dir = await mkdtemp(join(tmpdir(), "files-"));
      await mkdir(join(dir, ".adhd"), { recursive: true });

      const specContent = "# My Spec\n\nSome features here";
      await writeSpec(dir, specContent);
      const result = await readSpec(dir);
      expect(result).toBe(specContent);
    });
  });

  describe("writeContract / readContract", () => {
    it("round-trips a contract through .adhd/contracts/", async () => {
      const dir = await mkdtemp(join(tmpdir(), "files-"));
      await mkdir(join(dir, ".adhd", "contracts"), { recursive: true });

      const contract = {
        sprintNumber: 1,
        features: ["feature A"],
        criteria: [{ name: "test-criterion", description: "Test", threshold: 7, type: "behavioral" as const }],
      };
      await writeContract(dir, contract);
      const result = await readContract(dir, 1);
      expect(result.sprintNumber).toBe(1);
      expect(result.features).toEqual(["feature A"]);
    });

    it("throws on invalid JSON in contract file", async () => {
      const dir = await mkdtemp(join(tmpdir(), "files-"));
      await mkdir(join(dir, ".adhd", "contracts"), { recursive: true });
      await writeFile(join(dir, ".adhd", "contracts", "sprint-1.json"), "not json", "utf-8");

      expect(readContract(dir, 1)).rejects.toThrow("Invalid JSON");
    });
  });

  describe("writeProgress / readProgress", () => {
    it("round-trips progress through .adhd/progress.json", async () => {
      const dir = await mkdtemp(join(tmpdir(), "files-"));
      await mkdir(join(dir, ".adhd"), { recursive: true });

      const progress: HarnessProgress = {
        status: "building",
        currentSprint: 2,
        totalSprints: 5,
        completedSprints: 1,
        retryCount: 0,
        sprintResults: [{ sprintNumber: 1, passed: true, attempts: 1 }],
      };
      await writeProgress(dir, progress);
      const result = await readProgress(dir);
      expect(result.currentSprint).toBe(2);
      expect(result.totalSprints).toBe(5);
    });

    it("throws on invalid JSON in progress file", async () => {
      const dir = await mkdtemp(join(tmpdir(), "files-"));
      await mkdir(join(dir, ".adhd"), { recursive: true });
      await writeFile(join(dir, ".adhd", "progress.json"), "{bad", "utf-8");

      expect(readProgress(dir)).rejects.toThrow("Invalid JSON");
    });
  });
});
