import { describe, expect, test } from "bun:test";
import { buildDocumenterPrompt } from "../shared/prompts.ts";
import { buildArtifactDigest, DEFAULT_DIGEST_BUDGET } from "../shared/artifact-digest.ts";
import type { AgentSkills } from "../shared/skills.ts";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const baseCtx = {
  workDir: "/tmp/test-project",
  isGreenfield: false,
};

// =====================================================
// buildDocumenterPrompt tests
// =====================================================

describe("buildDocumenterPrompt — greenfield vs existing", () => {
  test("greenfield prompt references app/ as documentation target", () => {
    const prompt = buildDocumenterPrompt({ ...baseCtx, isGreenfield: true });
    expect(prompt).toContain("`app/`");
    expect(prompt).toContain("the `app/` directory");
  });

  test("non-greenfield prompt references project root as documentation target", () => {
    const prompt = buildDocumenterPrompt({ ...baseCtx, isGreenfield: false });
    expect(prompt).toContain("the project root directory");
  });
});

describe("buildDocumenterPrompt — skills integration", () => {
  const injectedSkills: AgentSkills = {
    injected: "Always use JSDoc comments.",
    referenceManifest: "",
    additionalDirs: [],
  };

  const referenceSkills: AgentSkills = {
    injected: "",
    referenceManifest: "Available:\n- `/skills/style-guide.md` — Documentation style guide",
    additionalDirs: ["/skills"],
  };

  test("appends injected skill content under ## Skills", () => {
    const prompt = buildDocumenterPrompt({ ...baseCtx, skills: injectedSkills });
    expect(prompt).toContain("## Skills");
    expect(prompt).toContain("Always use JSDoc comments.");
  });

  test("appends reference manifest under ## Reference Materials", () => {
    const prompt = buildDocumenterPrompt({ ...baseCtx, skills: referenceSkills });
    expect(prompt).toContain("## Reference Materials");
    expect(prompt).toContain("`/skills/style-guide.md`");
  });

  test("no skills sections when skills is undefined", () => {
    const prompt = buildDocumenterPrompt(baseCtx);
    expect(prompt).not.toContain("## Skills");
    expect(prompt).not.toContain("## Reference Materials");
  });
});

describe("buildDocumenterPrompt — content requirements", () => {
  test("instructs agent to produce README.md", () => {
    const prompt = buildDocumenterPrompt(baseCtx);
    expect(prompt).toContain("README.md");
  });

  test("instructs agent to produce CHANGELOG.md", () => {
    const prompt = buildDocumenterPrompt(baseCtx);
    expect(prompt).toContain("CHANGELOG.md");
  });

  test("README sections include overview, setup, usage, architecture", () => {
    const prompt = buildDocumenterPrompt(baseCtx);
    expect(prompt).toContain("Overview");
    expect(prompt).toContain("Setup");
    expect(prompt).toContain("Usage");
    expect(prompt).toContain("Architecture");
  });

  test("CHANGELOG has sprint-per-section format", () => {
    const prompt = buildDocumenterPrompt(baseCtx);
    expect(prompt).toContain("one section per sprint");
  });

  test("instructs conditional API documentation", () => {
    const prompt = buildDocumenterPrompt(baseCtx);
    expect(prompt).toContain("API");
    expect(prompt).toContain("endpoint");
  });

  test("emphasizes accuracy over planned features", () => {
    const prompt = buildDocumenterPrompt(baseCtx);
    expect(prompt).toContain("what actually exists");
    expect(prompt).toContain("not what was planned");
  });

  test("instructs concise developer-friendly tone", () => {
    const prompt = buildDocumenterPrompt(baseCtx);
    expect(prompt).toContain("developer-friendly");
    expect(prompt.toLowerCase()).toContain("concise");
  });

  test("instructs to derive setup instructions from actual project", () => {
    const prompt = buildDocumenterPrompt(baseCtx);
    expect(prompt).toContain("Derive setup instructions");
  });
});

// =====================================================
// buildArtifactDigest tests
// =====================================================

function createTempWorkDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "adhd-test-"));
  mkdirSync(join(dir, ".adhd", "contracts"), { recursive: true });
  mkdirSync(join(dir, ".adhd", "feedback"), { recursive: true });
  mkdirSync(join(dir, ".adhd", "logs"), { recursive: true });
  return dir;
}

describe("buildArtifactDigest — basic assembly", () => {
  test("includes spec content when spec.md exists", () => {
    const workDir = createTempWorkDir();
    try {
      writeFileSync(join(workDir, ".adhd", "spec.md"), "# My Spec\n\nThis is the spec.");
      const digest = buildArtifactDigest({ workDir });
      expect(digest).toContain("## Product Spec");
      expect(digest).toContain("# My Spec");
      expect(digest).toContain("This is the spec.");
    } finally {
      rmSync(workDir, { recursive: true });
    }
  });

  test("includes all sprint contracts", () => {
    const workDir = createTempWorkDir();
    try {
      const contract1 = JSON.stringify({ sprintNumber: 1, features: ["f1"], criteria: [] });
      const contract2 = JSON.stringify({ sprintNumber: 2, features: ["f2"], criteria: [] });
      const contract3 = JSON.stringify({ sprintNumber: 3, features: ["f3"], criteria: [] });
      writeFileSync(join(workDir, ".adhd", "contracts", "sprint-1.json"), contract1);
      writeFileSync(join(workDir, ".adhd", "contracts", "sprint-2.json"), contract2);
      writeFileSync(join(workDir, ".adhd", "contracts", "sprint-3.json"), contract3);

      const digest = buildArtifactDigest({ workDir });
      expect(digest).toContain("## Sprint Contracts");
      expect(digest).toContain("Sprint 1 Contract");
      expect(digest).toContain("Sprint 2 Contract");
      expect(digest).toContain("Sprint 3 Contract");
    } finally {
      rmSync(workDir, { recursive: true });
    }
  });

  test("includes feedback entries", () => {
    const workDir = createTempWorkDir();
    try {
      const feedback = JSON.stringify({ passed: true, feedback: [], overallSummary: "Good" });
      writeFileSync(join(workDir, ".adhd", "feedback", "sprint-1-round-0.json"), feedback);

      const digest = buildArtifactDigest({ workDir });
      expect(digest).toContain("## Evaluation Feedback");
      expect(digest).toContain("Sprint 1 Final Feedback");
    } finally {
      rmSync(workDir, { recursive: true });
    }
  });
});

describe("buildArtifactDigest — final feedback selection", () => {
  test("picks only the final (passing) feedback per sprint when sprintResults provided", () => {
    const workDir = createTempWorkDir();
    try {
      // Sprint 1: 3 attempts, passed on attempt 2 (round 2)
      writeFileSync(
        join(workDir, ".adhd", "feedback", "sprint-1-round-0.json"),
        JSON.stringify({ passed: false, overallSummary: "Failed attempt 0" }),
      );
      writeFileSync(
        join(workDir, ".adhd", "feedback", "sprint-1-round-1.json"),
        JSON.stringify({ passed: false, overallSummary: "Failed attempt 1" }),
      );
      writeFileSync(
        join(workDir, ".adhd", "feedback", "sprint-1-round-2.json"),
        JSON.stringify({ passed: true, overallSummary: "Passed attempt 2" }),
      );

      const sprintResults = [
        { sprintNumber: 1, passed: true, attempts: 3 },
      ];

      const digest = buildArtifactDigest({ workDir, sprintResults });
      expect(digest).toContain("Passed attempt 2");
      expect(digest).not.toContain("Failed attempt 0");
      expect(digest).not.toContain("Failed attempt 1");
    } finally {
      rmSync(workDir, { recursive: true });
    }
  });

  test("picks highest round when no sprintResults provided", () => {
    const workDir = createTempWorkDir();
    try {
      writeFileSync(
        join(workDir, ".adhd", "feedback", "sprint-1-round-0.json"),
        JSON.stringify({ passed: false, overallSummary: "Round 0" }),
      );
      writeFileSync(
        join(workDir, ".adhd", "feedback", "sprint-1-round-1.json"),
        JSON.stringify({ passed: false, overallSummary: "Round 1" }),
      );
      writeFileSync(
        join(workDir, ".adhd", "feedback", "sprint-1-round-2.json"),
        JSON.stringify({ passed: true, overallSummary: "Round 2" }),
      );

      const digest = buildArtifactDigest({ workDir });
      expect(digest).toContain("Round 2");
      expect(digest).not.toContain("Round 0");
      expect(digest).not.toContain("Round 1");
    } finally {
      rmSync(workDir, { recursive: true });
    }
  });
});

describe("buildArtifactDigest — token budget truncation", () => {
  test("truncates contracts when budget is exceeded", () => {
    const workDir = createTempWorkDir();
    try {
      writeFileSync(join(workDir, ".adhd", "spec.md"), "Short spec");

      // Create contracts with large content
      for (let i = 1; i <= 5; i++) {
        const bigContent = JSON.stringify({
          sprintNumber: i,
          features: [`feature-${i}`],
          criteria: [{ name: "x".repeat(500), description: "y".repeat(500), threshold: 7 }],
        });
        writeFileSync(join(workDir, ".adhd", "contracts", `sprint-${i}.json`), bigContent);
      }

      // Use a very small budget
      const digest = buildArtifactDigest({ workDir, tokenBudget: 1000 });
      expect(digest).toContain("truncated");
    } finally {
      rmSync(workDir, { recursive: true });
    }
  });

  test("truncates feedback when budget is exceeded", () => {
    const workDir = createTempWorkDir();
    try {
      writeFileSync(join(workDir, ".adhd", "spec.md"), "Short spec");

      // Create feedback with large content
      for (let i = 1; i <= 5; i++) {
        const bigFeedback = JSON.stringify({
          passed: true,
          overallSummary: "z".repeat(500),
          feedback: [{ criterion: "a".repeat(200), score: 8, details: "b".repeat(200) }],
        });
        writeFileSync(join(workDir, ".adhd", "feedback", `sprint-${i}-round-0.json`), bigFeedback);
      }

      const digest = buildArtifactDigest({ workDir, tokenBudget: 1000 });
      expect(digest).toContain("truncated");
    } finally {
      rmSync(workDir, { recursive: true });
    }
  });

  test("does not truncate when within budget", () => {
    const workDir = createTempWorkDir();
    try {
      writeFileSync(join(workDir, ".adhd", "spec.md"), "Short spec");
      writeFileSync(
        join(workDir, ".adhd", "contracts", "sprint-1.json"),
        JSON.stringify({ sprintNumber: 1, features: ["f1"], criteria: [] }),
      );
      writeFileSync(
        join(workDir, ".adhd", "feedback", "sprint-1-round-0.json"),
        JSON.stringify({ passed: true, overallSummary: "Good" }),
      );

      const digest = buildArtifactDigest({ workDir, tokenBudget: DEFAULT_DIGEST_BUDGET });
      expect(digest).not.toContain("truncated");
    } finally {
      rmSync(workDir, { recursive: true });
    }
  });
});

describe("buildArtifactDigest — sprint results summary", () => {
  test("includes sprint results when provided", () => {
    const workDir = createTempWorkDir();
    try {
      writeFileSync(join(workDir, ".adhd", "spec.md"), "Spec");

      const sprintResults = [
        { sprintNumber: 1, passed: true, attempts: 1 },
        { sprintNumber: 2, passed: true, attempts: 2 },
        { sprintNumber: 3, passed: true, attempts: 1 },
      ];

      const digest = buildArtifactDigest({ workDir, sprintResults });
      expect(digest).toContain("## Sprint Results");
      expect(digest).toContain("Sprint 1: PASSED (1 attempt(s))");
      expect(digest).toContain("Sprint 2: PASSED (2 attempt(s))");
      expect(digest).toContain("Sprint 3: PASSED (1 attempt(s))");
    } finally {
      rmSync(workDir, { recursive: true });
    }
  });
});

describe("buildArtifactDigest — 3 sprint full assembly", () => {
  test("assembles spec, 3 contracts, and 3 final feedbacks", () => {
    const workDir = createTempWorkDir();
    try {
      writeFileSync(join(workDir, ".adhd", "spec.md"), "# Full Spec\nComplete spec here.");

      for (let i = 1; i <= 3; i++) {
        writeFileSync(
          join(workDir, ".adhd", "contracts", `sprint-${i}.json`),
          JSON.stringify({ sprintNumber: i, features: [`feature-${i}`], criteria: [] }),
        );
        writeFileSync(
          join(workDir, ".adhd", "feedback", `sprint-${i}-round-0.json`),
          JSON.stringify({ passed: true, overallSummary: `Sprint ${i} passed` }),
        );
      }

      const sprintResults = [
        { sprintNumber: 1, passed: true, attempts: 1 },
        { sprintNumber: 2, passed: true, attempts: 1 },
        { sprintNumber: 3, passed: true, attempts: 1 },
      ];

      const digest = buildArtifactDigest({ workDir, sprintResults });
      expect(digest).toContain("## Product Spec");
      expect(digest).toContain("## Sprint Contracts");
      expect(digest).toContain("## Evaluation Feedback");
      expect(digest).toContain("## Sprint Results");
      expect(digest).toContain("Sprint 1 Contract");
      expect(digest).toContain("Sprint 2 Contract");
      expect(digest).toContain("Sprint 3 Contract");
      expect(digest).toContain("Sprint 1 Final Feedback");
      expect(digest).toContain("Sprint 2 Final Feedback");
      expect(digest).toContain("Sprint 3 Final Feedback");
    } finally {
      rmSync(workDir, { recursive: true });
    }
  });
});
