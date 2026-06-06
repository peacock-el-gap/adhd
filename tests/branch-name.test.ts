import { describe, expect, test } from "bun:test";
import { buildTopicBranchName, makeBranchSafeTimestamp, MAX_SLUG_LENGTH } from "../shared/branch-name.ts";

const STAMP = "2026.06.06-14.30.45";
const SAFE_STAMP = "20260606-143045";

describe("buildTopicBranchName", () => {
  test("produces adhd/<slug>-<timestamp> for a normal prompt", () => {
    const name = buildTopicBranchName("Add user authentication", STAMP);
    expect(name).toBe(`adhd/add-user-authentication-${SAFE_STAMP}`);
  });

  test("lowercases the slug", () => {
    const name = buildTopicBranchName("Add USER Auth", STAMP);
    expect(name).toMatch(/^adhd\/add-user-auth-/);
  });

  test("replaces spaces and punctuation with hyphens", () => {
    const name = buildTopicBranchName("Hello, World! Test: 123", STAMP);
    expect(name).toMatch(/^adhd\/hello-world-test-123-/);
  });

  test("collapses consecutive hyphens to one", () => {
    const name = buildTopicBranchName("a---b   c", STAMP);
    expect(name).toMatch(/^adhd\/a-b-c-/);
  });

  test("trims leading and trailing hyphens from slug", () => {
    const name = buildTopicBranchName("!!!hello!!!", STAMP);
    expect(name).toMatch(/^adhd\/hello-/);
  });

  test("two calls with same prompt but different timestamps differ by timestamp only", () => {
    const stampA = "2026.01.01-00.00.01";
    const stampB = "2026.12.31-23.59.59";
    const nameA = buildTopicBranchName("my prompt", stampA);
    const nameB = buildTopicBranchName("my prompt", stampB);
    expect(nameA).toBe("adhd/my-prompt-20260101-000001");
    expect(nameB).toBe("adhd/my-prompt-20261231-235959");
    // Names differ (different timestamps)
    expect(nameA).not.toBe(nameB);
    // Both start with the same slug prefix
    expect(nameA).toStartWith("adhd/my-prompt-");
    expect(nameB).toStartWith("adhd/my-prompt-");
  });

  test("empty string → default slug 'task'", () => {
    const name = buildTopicBranchName("", STAMP);
    expect(name).toBe(`adhd/task-${SAFE_STAMP}`);
  });

  test("whitespace-only input → default slug 'task'", () => {
    const name = buildTopicBranchName("   \t  ", STAMP);
    expect(name).toBe(`adhd/task-${SAFE_STAMP}`);
  });

  test("all-punctuation input → default slug 'task'", () => {
    const name = buildTopicBranchName("!!!! ??? ###", STAMP);
    expect(name).toBe(`adhd/task-${SAFE_STAMP}`);
  });

  test("does not throw on any input", () => {
    const inputs = ["", "   ", "a".repeat(500), "🎉🎉🎉", "123", "\n\n\n"];
    for (const input of inputs) {
      expect(() => buildTopicBranchName(input, STAMP)).not.toThrow();
    }
  });

  test("slug is bounded to MAX_SLUG_LENGTH characters", () => {
    const longPrompt = "word ".repeat(100); // 500 chars
    const name = buildTopicBranchName(longPrompt, STAMP);
    // Branch name format: "adhd/<slug>-<safeStamp>"
    // SAFE_STAMP = "20260606-143045" (15 chars); strip "adhd/" prefix and "-<safeStamp>" suffix
    const afterPrefix = name.slice("adhd/".length);
    const slug = afterPrefix.slice(0, afterPrefix.length - SAFE_STAMP.length - 1);
    expect(slug.length).toBeLessThanOrEqual(MAX_SLUG_LENGTH);
  });

  test("slug does not end with a hyphen after bounding", () => {
    // Craft a string where the MAX_SLUG_LENGTH cut falls mid-word on a hyphen boundary
    const prompt = "a-".repeat(25); // 50 chars, so cut at 40 = "a-a-a-a-a-a-a-a-a-a-a-a-a-a-a-a-a-a-a-a-"
    const name = buildTopicBranchName(prompt, STAMP);
    const afterPrefix = name.slice("adhd/".length);
    const slug = afterPrefix.slice(0, afterPrefix.lastIndexOf(`-${SAFE_STAMP}`));
    expect(slug.endsWith("-")).toBe(false);
  });

  test("returns a valid branch name (no spaces, no special chars)", () => {
    const name = buildTopicBranchName("some random prompt with $pecial ch@rs!", STAMP);
    // Should only contain adhd/, alphanumeric, and hyphens
    expect(name).toMatch(/^adhd\/[a-z0-9-]+-[0-9]+-[0-9]+$/);
  });
});

describe("makeBranchSafeTimestamp", () => {
  test("strips dots from a fileTimestamp", () => {
    expect(makeBranchSafeTimestamp("2026.06.06-14.30.45")).toBe("20260606-143045");
  });

  test("handles a stamp with no dots (already safe)", () => {
    expect(makeBranchSafeTimestamp("20260606-143045")).toBe("20260606-143045");
  });

  test("returns the input unchanged when there are no dots", () => {
    expect(makeBranchSafeTimestamp("abc-def")).toBe("abc-def");
  });
});
