import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildArtifactDigest, DEFAULT_DIGEST_BUDGET } from "../shared/artifact-digest.ts";

describe("artifact-digest", () => {
  it("exports DEFAULT_DIGEST_BUDGET as a positive number", () => {
    expect(DEFAULT_DIGEST_BUDGET).toBeGreaterThan(0);
    expect(typeof DEFAULT_DIGEST_BUDGET).toBe("number");
  });

  it("returns empty string when no artifacts exist", async () => {
    const dir = await mkdtemp(join(tmpdir(), "digest-"));
    const result = buildArtifactDigest({ workDir: dir });
    expect(result).toBe("");
  });

  it("includes the spec when it exists", async () => {
    const dir = await mkdtemp(join(tmpdir(), "digest-"));
    await mkdir(join(dir, ".adhd"), { recursive: true });
    await writeFile(join(dir, ".adhd", "spec.md"), "# My Project\n\nA great project", "utf-8");

    const result = buildArtifactDigest({ workDir: dir });
    expect(result).toContain("Product Spec");
    expect(result).toContain("My Project");
  });

  it("includes contracts when they exist", async () => {
    const dir = await mkdtemp(join(tmpdir(), "digest-"));
    await mkdir(join(dir, ".adhd", "contracts"), { recursive: true });
    await writeFile(
      join(dir, ".adhd", "contracts", "sprint-1.json"),
      JSON.stringify({ sprintNumber: 1, features: ["feat1"], criteria: [] }),
      "utf-8",
    );

    const result = buildArtifactDigest({ workDir: dir });
    expect(result).toContain("Sprint Contracts");
    expect(result).toContain("Sprint 1 Contract");
  });

  it("includes sprint results summary when provided", async () => {
    const dir = await mkdtemp(join(tmpdir(), "digest-"));
    await mkdir(join(dir, ".adhd"), { recursive: true });
    await writeFile(join(dir, ".adhd", "spec.md"), "# Spec", "utf-8");

    const result = buildArtifactDigest({
      workDir: dir,
      sprintResults: [
        { sprintNumber: 1, passed: true, attempts: 1 },
        { sprintNumber: 2, passed: false, attempts: 3 },
      ],
    });
    expect(result).toContain("Sprint Results");
    expect(result).toContain("PASSED");
    expect(result).toContain("FAILED");
  });

  it("truncates contracts when budget is exceeded", async () => {
    const dir = await mkdtemp(join(tmpdir(), "digest-"));
    await mkdir(join(dir, ".adhd", "contracts"), { recursive: true });

    // Create large contracts
    for (let i = 1; i <= 10; i++) {
      const largeContent = JSON.stringify({
        sprintNumber: i,
        features: ["x".repeat(500)],
        criteria: [],
      });
      await writeFile(join(dir, ".adhd", "contracts", `sprint-${i}.json`), largeContent, "utf-8");
    }

    const result = buildArtifactDigest({ workDir: dir, tokenBudget: 1000 });
    expect(result).toContain("truncated");
  });
});
