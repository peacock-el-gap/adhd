import { describe, expect, test } from "bun:test";
import {
  TOPIC_BRANCH_DEFAULT_SLUG,
  TOPIC_BRANCH_SLUG_MAX_LENGTH,
  boundSlug,
  buildTopicBranchName,
  sanitizeSlug,
} from "../shared/topic-branch.ts";

// A fixed timestamp that appears in branch names assembled by tests below.
const FIXED_STAMP = "2026.06.06-10.00.00";

// Pattern every valid branch name from this builder must match.
const BRANCH_NAME_PATTERN =
  /^adhd\/[a-z0-9-]+-\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2}$/;

// ─── sanitizeSlug ────────────────────────────────────────────────────────────

describe("sanitizeSlug", () => {
  test("lowercases input", () => {
    expect(sanitizeSlug("HELLO")).toBe("hello");
  });

  test("replaces spaces with hyphens", () => {
    expect(sanitizeSlug("hello world")).toBe("hello-world");
  });

  test("collapses consecutive special characters to a single hyphen", () => {
    expect(sanitizeSlug("foo   ---  bar")).toBe("foo-bar");
  });

  test("strips leading and trailing hyphens", () => {
    expect(sanitizeSlug("!hello!")).toBe("hello");
  });

  test("preserves digits", () => {
    expect(sanitizeSlug("OAuth2")).toBe("oauth2");
  });

  test("strips punctuation", () => {
    expect(sanitizeSlug("Add OAuth2 Support!")).toBe("add-oauth2-support");
  });

  test("returns empty string for all-punctuation input", () => {
    expect(sanitizeSlug("!!!")).toBe("");
  });

  test("returns empty string for empty input", () => {
    expect(sanitizeSlug("")).toBe("");
  });
});

// ─── boundSlug ───────────────────────────────────────────────────────────────

describe("boundSlug", () => {
  test("passes through short slugs unchanged", () => {
    expect(boundSlug("short-slug")).toBe("short-slug");
  });

  test(`truncates to ${TOPIC_BRANCH_SLUG_MAX_LENGTH} characters`, () => {
    const long = "a".repeat(100);
    const result = boundSlug(long);
    expect(result.length).toBeLessThanOrEqual(TOPIC_BRANCH_SLUG_MAX_LENGTH);
  });

  test("does not leave a trailing hyphen after truncation", () => {
    // Craft a string whose 50th character lands inside a hyphen run.
    const slug = "a".repeat(48) + "--extra-text";
    const result = boundSlug(slug);
    expect(result.endsWith("-")).toBe(false);
  });

  test("exact-length slug is returned unchanged", () => {
    const exact = "a".repeat(TOPIC_BRANCH_SLUG_MAX_LENGTH);
    expect(boundSlug(exact)).toBe(exact);
  });
});

// ─── buildTopicBranchName — format ──────────────────────────────────────────

describe("buildTopicBranchName — format", () => {
  test("returns a string matching the branch name pattern for a normal prompt", () => {
    const name = buildTopicBranchName("Add OAuth2 Support!", FIXED_STAMP);
    expect(BRANCH_NAME_PATTERN.test(name)).toBe(true);
  });

  test("embeds the supplied timestamp exactly", () => {
    const name = buildTopicBranchName("my feature", FIXED_STAMP);
    expect(name.endsWith(`-${FIXED_STAMP}`)).toBe(true);
  });

  test("starts with adhd/ prefix", () => {
    const name = buildTopicBranchName("anything", FIXED_STAMP);
    expect(name.startsWith("adhd/")).toBe(true);
  });

  test("slug portion contains only lowercase letters, digits, and hyphens", () => {
    const name = buildTopicBranchName("Add OAuth2 Support!", FIXED_STAMP);
    // Extract slug portion: strip "adhd/" prefix and "-<timestamp>" suffix.
    const withoutPrefix = name.slice("adhd/".length);
    const slug = withoutPrefix.slice(0, withoutPrefix.lastIndexOf(`-${FIXED_STAMP}`));
    expect(/^[a-z0-9-]+$/.test(slug)).toBe(true);
  });

  test("slug portion has no leading hyphen", () => {
    const name = buildTopicBranchName("Add OAuth2 Support!", FIXED_STAMP);
    const withoutPrefix = name.slice("adhd/".length);
    const slug = withoutPrefix.slice(0, withoutPrefix.lastIndexOf(`-${FIXED_STAMP}`));
    expect(slug.startsWith("-")).toBe(false);
  });

  test("slug portion has no trailing hyphen (before timestamp)", () => {
    const name = buildTopicBranchName("Add OAuth2 Support!", FIXED_STAMP);
    const withoutPrefix = name.slice("adhd/".length);
    const slug = withoutPrefix.slice(0, withoutPrefix.lastIndexOf(`-${FIXED_STAMP}`));
    expect(slug.endsWith("-")).toBe(false);
  });
});

// ─── buildTopicBranchName — slug length bound ────────────────────────────────

describe("buildTopicBranchName — slug length bound", () => {
  test("slug derived from a 500-character prompt does not exceed max length", () => {
    const long = "word ".repeat(100).trimEnd(); // 500 chars
    const name = buildTopicBranchName(long, FIXED_STAMP);
    const withoutPrefix = name.slice("adhd/".length);
    const slug = withoutPrefix.slice(0, withoutPrefix.lastIndexOf(`-${FIXED_STAMP}`));
    expect(slug.length).toBeLessThanOrEqual(TOPIC_BRANCH_SLUG_MAX_LENGTH);
    expect(slug.endsWith("-")).toBe(false);
  });
});

// ─── buildTopicBranchName — two timestamps produce different names ───────────

describe("buildTopicBranchName — timestamp collision avoidance", () => {
  test("same prompt but different timestamps produce different branch names", () => {
    const a = buildTopicBranchName("same prompt", "2026.01.01-10.00.00");
    const b = buildTopicBranchName("same prompt", "2026.01.01-10.00.01");
    expect(a).not.toBe(b);
  });
});

// ─── buildTopicBranchName — empty / whitespace / null / undefined input ──────

describe("buildTopicBranchName — empty and whitespace input", () => {
  test("empty string returns a valid branch name with the safe default slug", () => {
    const name = buildTopicBranchName("", FIXED_STAMP);
    expect(BRANCH_NAME_PATTERN.test(name)).toBe(true);
    expect(name).toContain(TOPIC_BRANCH_DEFAULT_SLUG);
  });

  test("whitespace-only string returns a valid branch name", () => {
    const name = buildTopicBranchName("   \t\n  ", FIXED_STAMP);
    expect(BRANCH_NAME_PATTERN.test(name)).toBe(true);
  });

  test("null returns a valid branch name", () => {
    const name = buildTopicBranchName(null, FIXED_STAMP);
    expect(BRANCH_NAME_PATTERN.test(name)).toBe(true);
  });

  test("undefined returns a valid branch name", () => {
    const name = buildTopicBranchName(undefined, FIXED_STAMP);
    expect(BRANCH_NAME_PATTERN.test(name)).toBe(true);
  });

  test("default slug is non-empty and matches /^[a-z0-9-]+$/", () => {
    expect(TOPIC_BRANCH_DEFAULT_SLUG.length).toBeGreaterThan(0);
    expect(/^[a-z0-9-]+$/.test(TOPIC_BRANCH_DEFAULT_SLUG)).toBe(true);
  });
});

// ─── buildTopicBranchName — no-throw guarantee ───────────────────────────────

describe("buildTopicBranchName — no-throw guarantee", () => {
  const tricky: Array<[string, string | null | undefined]> = [
    ["null", null],
    ["undefined", undefined],
    ["empty string", ""],
    ["only punctuation", "!@#$%^&*()"],
    ["10 000-character string", "a".repeat(10_000)],
  ];

  for (const [label, input] of tricky) {
    test(`does not throw for: ${label}`, () => {
      expect(() => buildTopicBranchName(input, FIXED_STAMP)).not.toThrow();
    });

    test(`returns a valid branch name for: ${label}`, () => {
      const name = buildTopicBranchName(input, FIXED_STAMP);
      expect(BRANCH_NAME_PATTERN.test(name)).toBe(true);
    });
  }
});

// ─── buildTopicBranchName — valid git ref rules ──────────────────────────────

describe("buildTopicBranchName — valid git ref", () => {
  const prompts = [
    "normal feature",
    "Add OAuth2 Support!",
    "",
    null,
    "   ",
    "abc...def",
    "feat~branch",
    "name^1",
    "has:colon",
    "back\\slash",
  ];

  for (const prompt of prompts) {
    test(`branch name is a valid git ref for prompt: ${JSON.stringify(prompt)}`, () => {
      const name = buildTopicBranchName(prompt, FIXED_STAMP);

      // No consecutive dots
      expect(name.includes("..")).toBe(false);
      // No trailing dot
      expect(name.endsWith(".")).toBe(false);
      // No space
      expect(name.includes(" ")).toBe(false);
      // No tilde
      expect(name.includes("~")).toBe(false);
      // No caret
      expect(name.includes("^")).toBe(false);
      // No colon
      expect(name.includes(":")).toBe(false);
      // No backslash
      expect(name.includes("\\")).toBe(false);
      // No component starts with a hyphen (adhd/ prefix doesn't, slug won't after sanitization)
      const components = name.split("/");
      for (const component of components) {
        expect(component.startsWith("-")).toBe(false);
      }
    });
  }
});

// ─── no SDK imports ──────────────────────────────────────────────────────────

describe("shared/topic-branch.ts — zero SDK imports", () => {
  test("file contains no @anthropic-ai imports", async () => {
    const src = await Bun.file("shared/topic-branch.ts").text();
    expect(src).not.toMatch(/@anthropic-ai/);
  });
});
