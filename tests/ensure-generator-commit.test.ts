import { afterEach, describe, expect, mock, test } from "bun:test";
import type { SprintContract } from "../shared/types.ts";

// --- Mocks ---

const execSyncMock = mock();
const queryMock = mock();

mock.module("node:child_process", () => ({
  execSync: execSyncMock,
}));

mock.module("@anthropic-ai/claude-agent-sdk", () => ({
  query: queryMock,
}));

mock.module("../harness-claude/tracing-claude.ts", () => ({
  query: queryMock,
  initTracing: () => ({ flush: async () => {} }),
}));

// Import after mocking so the module picks up the mocked dependencies
const { ensureGeneratorCommit } = await import("../harness-claude/generator.ts");

// --- Helpers ---

const CONTRACT: SprintContract = {
  sprintNumber: 2,
  features: ["JWT auth", "user profile endpoint"],
  criteria: [{ name: "auth_works", description: "Auth works", threshold: 7 }],
};

/** Configure execSync responses for a sequence of calls */
function setupExecSync(responses: string[]) {
  let callIndex = 0;
  execSyncMock.mockImplementation(() => {
    if (callIndex < responses.length) {
      return responses[callIndex++];
    }
    return "";
  });
}

/** Create an async generator that yields nothing (simulates an empty SDK session) */
function emptyQueryResult() {
  queryMock.mockReturnValue(
    (async function* () {
      // No messages
    })(),
  );
}

afterEach(() => {
  execSyncMock.mockReset();
  queryMock.mockReset();
});

// --- Tests ---

describe("ensureGeneratorCommit", () => {
  test("returns 'agent' when HEAD moved and tree is clean", async () => {
    // git rev-parse HEAD → new SHA, git status --porcelain → empty
    setupExecSync(["def456\n", ""]);

    const result = await ensureGeneratorCommit({ workDir: "/work", gitDir: "/work", beforeSha: "abc123", sessionId: "sess-1", contract: CONTRACT, isRetry: false, model: "test-model" });

    expect(result).toBe("agent");
    expect(queryMock).not.toHaveBeenCalled();
  });

  test("returns 'none' when HEAD unchanged and tree is clean", async () => {
    // git rev-parse HEAD → same SHA, git status --porcelain → empty
    setupExecSync(["abc123\n", ""]);

    const result = await ensureGeneratorCommit({ workDir: "/work", gitDir: "/work", beforeSha: "abc123", sessionId: "sess-1", contract: CONTRACT, isRetry: false, model: "test-model" });

    expect(result).toBe("none");
    expect(queryMock).not.toHaveBeenCalled();
  });

  test("returns 'resume' when agent commits after resume prompt", async () => {
    // Initial check: HEAD same, dirty tree
    // After resume: clean tree
    setupExecSync(["abc123\n", "M file.ts\n", ""]);
    emptyQueryResult();

    const result = await ensureGeneratorCommit({ workDir: "/work", gitDir: "/work", beforeSha: "abc123", sessionId: "sess-1", contract: CONTRACT, isRetry: false, model: "test-model" });

    expect(result).toBe("resume");
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  test("returns 'resume' when HEAD moved but dirty tree, then resume cleans it", async () => {
    // Initial check: HEAD moved, dirty tree (partial commit)
    // After resume: clean tree
    setupExecSync(["def456\n", "M leftover.ts\n", ""]);
    emptyQueryResult();

    const result = await ensureGeneratorCommit({ workDir: "/work", gitDir: "/work", beforeSha: "abc123", sessionId: "sess-1", contract: CONTRACT, isRetry: false, model: "test-model" });

    expect(result).toBe("resume");
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  test("returns 'fallback' when resume fails to commit", async () => {
    // Initial check: HEAD same, dirty tree
    // After resume: still dirty
    // Fallback: git add + commit
    setupExecSync(["abc123\n", "M file.ts\n", "M file.ts\n", ""]);
    emptyQueryResult();

    const result = await ensureGeneratorCommit({ workDir: "/work", gitDir: "/work", beforeSha: "abc123", sessionId: "sess-1", contract: CONTRACT, isRetry: false, model: "test-model" });

    expect(result).toBe("fallback");
    // Last execSync call should be the fallback git add + commit
    const lastCall = execSyncMock.mock.calls.at(-1);
    expect(lastCall?.[0]).toContain("git add -A && git commit");
    expect(lastCall?.[0]).toContain("[auto-commit] Sprint 2");
    expect(lastCall?.[0]).toContain("JWT auth");
  });

  test("fallback message uses 'fixes for' on retry", async () => {
    setupExecSync(["abc123\n", "M file.ts\n", "M file.ts\n", ""]);
    emptyQueryResult();

    await ensureGeneratorCommit({ workDir: "/work", gitDir: "/work", beforeSha: "abc123", sessionId: "sess-1", contract: CONTRACT, isRetry: true, model: "test-model" });

    const lastCall = execSyncMock.mock.calls.at(-1);
    expect(lastCall?.[0]).toContain("fixes for");
  });

  test("fallback message uses 'work on' on initial attempt", async () => {
    setupExecSync(["abc123\n", "M file.ts\n", "M file.ts\n", ""]);
    emptyQueryResult();

    await ensureGeneratorCommit({ workDir: "/work", gitDir: "/work", beforeSha: "abc123", sessionId: "sess-1", contract: CONTRACT, isRetry: false, model: "test-model" });

    const lastCall = execSyncMock.mock.calls.at(-1);
    expect(lastCall?.[0]).toContain("work on");
  });

  test("returns 'fallback' when resume query throws", async () => {
    // Initial check: dirty tree
    // Resume throws
    // Post-resume check: still dirty (needs fallback)
    setupExecSync(["abc123\n", "M file.ts\n", "M file.ts\n", ""]);
    queryMock.mockReturnValue(
      (async function* () {
        throw new Error("SDK connection failed");
      })(),
    );

    const result = await ensureGeneratorCommit({ workDir: "/work", gitDir: "/work", beforeSha: "abc123", sessionId: "sess-1", contract: CONTRACT, isRetry: false, model: "test-model" });

    expect(result).toBe("fallback");
  });

  test("passes sessionId to resume query options when available", async () => {
    setupExecSync(["abc123\n", "M file.ts\n", ""]);
    emptyQueryResult();

    await ensureGeneratorCommit({ workDir: "/work", gitDir: "/work", beforeSha: "abc123", sessionId: "sess-42", contract: CONTRACT, isRetry: false, model: "test-model" });

    const queryCall = queryMock.mock.calls[0]?.[0];
    expect(queryCall?.options?.sessionId).toBe("sess-42");
  });

  test("omits sessionId from resume query when undefined", async () => {
    setupExecSync(["abc123\n", "M file.ts\n", ""]);
    emptyQueryResult();

    await ensureGeneratorCommit({ workDir: "/work", gitDir: "/work", beforeSha: "abc123", sessionId: undefined, contract: CONTRACT, isRetry: false, model: "test-model" });

    const queryCall = queryMock.mock.calls[0]?.[0];
    expect(queryCall?.options?.sessionId).toBeUndefined();
  });

  test("resume query uses Bash-only tools with maxTurns 3", async () => {
    setupExecSync(["abc123\n", "M file.ts\n", ""]);
    emptyQueryResult();

    await ensureGeneratorCommit({ workDir: "/work", gitDir: "/work", beforeSha: "abc123", sessionId: "sess-1", contract: CONTRACT, isRetry: false, model: "test-model" });

    const queryCall = queryMock.mock.calls[0]?.[0];
    expect(queryCall?.options?.tools).toEqual(["Bash"]);
    expect(queryCall?.options?.maxTurns).toBe(3);
  });

  test("uses retry-specific prompt when isRetry is true", async () => {
    setupExecSync(["abc123\n", "M file.ts\n", ""]);
    emptyQueryResult();

    await ensureGeneratorCommit({ workDir: "/work", gitDir: "/work", beforeSha: "abc123", sessionId: "sess-1", contract: CONTRACT, isRetry: true, model: "test-model" });

    const queryCall = queryMock.mock.calls[0]?.[0];
    expect(queryCall?.prompt).toContain("evaluation feedback");
  });

  test("uses initial prompt when isRetry is false", async () => {
    setupExecSync(["abc123\n", "M file.ts\n", ""]);
    emptyQueryResult();

    await ensureGeneratorCommit({ workDir: "/work", gitDir: "/work", beforeSha: "abc123", sessionId: "sess-1", contract: CONTRACT, isRetry: false, model: "test-model" });

    const queryCall = queryMock.mock.calls[0]?.[0];
    expect(queryCall?.prompt).toContain("built features");
  });

  test("fallback message includes all feature names", async () => {
    setupExecSync(["abc123\n", "M file.ts\n", "M file.ts\n", ""]);
    emptyQueryResult();

    await ensureGeneratorCommit({ workDir: "/work", gitDir: "/work", beforeSha: "abc123", sessionId: "sess-1", contract: CONTRACT, isRetry: false, model: "test-model" });

    const lastCall = execSyncMock.mock.calls.at(-1);
    expect(lastCall?.[0]).toContain("JWT auth, user profile endpoint");
  });
});
