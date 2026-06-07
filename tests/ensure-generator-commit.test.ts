import { afterEach, describe, expect, mock, test } from "bun:test";
import { ensureGeneratorCommit } from "../harness-claude/generator.ts";
import type { SprintContract } from "../shared/types.ts";

// --- Mocks ---
//
// Both subprocess and SDK access are injected via the `deps` seam, so this file
// runs process-globally without `mock.module` poisoning sibling tests.

const execSyncMock = mock();
const queryMock = mock();

const deps = { exec: execSyncMock, queryFn: queryMock };

// --- Helpers ---

const CONTRACT: SprintContract = {
  sprintNumber: 2,
  features: ["JWT auth", "user profile endpoint"],
  criteria: [{ name: "auth_works", description: "Auth works", threshold: 7 }],
};

/**
 * Set up the mock to return specific responses based on command patterns.
 * The fallback path in ensureAgentCommit now issues separate commands
 * (add, diff --cached --quiet, commit) so pattern-based matching is
 * more resilient than positional indexing.
 */
function setupExecByCommand(handlers: Record<string, string | (() => string)>) {
  execSyncMock.mockImplementation((cmd: string) => {
    for (const [pattern, response] of Object.entries(handlers)) {
      if (cmd.includes(pattern)) {
        return typeof response === "function" ? response() : response;
      }
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
    setupExecByCommand({
      "rev-parse HEAD": "def456\n",
      "git status --porcelain": "",
    });

    const result = await ensureGeneratorCommit({ workDir: "/work", gitDir: "/work", beforeSha: "abc123", sessionId: "sess-1", contract: CONTRACT, isRetry: false, model: "test-model" }, deps);

    expect(result).toBe("agent");
    expect(queryMock).not.toHaveBeenCalled();
  });

  test("returns 'none' when HEAD unchanged and tree is clean", async () => {
    setupExecByCommand({
      "rev-parse HEAD": "abc123\n",
      "git status --porcelain": "",
    });

    const result = await ensureGeneratorCommit({ workDir: "/work", gitDir: "/work", beforeSha: "abc123", sessionId: "sess-1", contract: CONTRACT, isRetry: false, model: "test-model" }, deps);

    expect(result).toBe("none");
    expect(queryMock).not.toHaveBeenCalled();
  });

  test("returns 'resume' when agent commits after resume prompt", async () => {
    let statusCallCount = 0;
    setupExecByCommand({
      "rev-parse HEAD": "abc123\n",
      "git status --porcelain": () => {
        statusCallCount++;
        return statusCallCount === 1 ? "M file.ts\n" : "";
      },
    });
    emptyQueryResult();

    const result = await ensureGeneratorCommit({ workDir: "/work", gitDir: "/work", beforeSha: "abc123", sessionId: "sess-1", contract: CONTRACT, isRetry: false, model: "test-model" }, deps);

    expect(result).toBe("resume");
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  test("returns 'resume' when HEAD moved but dirty tree, then resume cleans it", async () => {
    let statusCallCount = 0;
    setupExecByCommand({
      "rev-parse HEAD": "def456\n",
      "git status --porcelain": () => {
        statusCallCount++;
        return statusCallCount === 1 ? "M leftover.ts\n" : "";
      },
    });
    emptyQueryResult();

    const result = await ensureGeneratorCommit({ workDir: "/work", gitDir: "/work", beforeSha: "abc123", sessionId: "sess-1", contract: CONTRACT, isRetry: false, model: "test-model" }, deps);

    expect(result).toBe("resume");
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  test("returns 'fallback' when resume fails to commit", async () => {
    setupExecByCommand({
      "rev-parse HEAD": "abc123\n",
      "git status --porcelain": "M file.ts\n",
      "git add -A": "",
      "diff --cached --quiet": () => {
        throw new Error("exit 1");
      },
      "git commit": "",
    });
    emptyQueryResult();

    const result = await ensureGeneratorCommit({ workDir: "/work", gitDir: "/work", beforeSha: "abc123", sessionId: "sess-1", contract: CONTRACT, isRetry: false, model: "test-model" }, deps);

    expect(result).toBe("fallback");
    // The commit command should contain the fallback message
    const commitCall = execSyncMock.mock.calls.find((c: unknown[]) => (c[0] as string).includes("git commit"));
    expect(commitCall).toBeDefined();
    expect((commitCall![0] as string)).toContain("[auto-commit] Sprint 2");
    expect((commitCall![0] as string)).toContain("JWT auth");
  });

  test("fallback message uses 'fixes for' on retry", async () => {
    setupExecByCommand({
      "rev-parse HEAD": "abc123\n",
      "git status --porcelain": "M file.ts\n",
      "git add -A": "",
      "diff --cached --quiet": () => {
        throw new Error("exit 1");
      },
      "git commit": "",
    });
    emptyQueryResult();

    await ensureGeneratorCommit({ workDir: "/work", gitDir: "/work", beforeSha: "abc123", sessionId: "sess-1", contract: CONTRACT, isRetry: true, model: "test-model" }, deps);

    const commitCall = execSyncMock.mock.calls.find((c: unknown[]) => (c[0] as string).includes("git commit"));
    expect(commitCall).toBeDefined();
    expect((commitCall![0] as string)).toContain("fixes for");
  });

  test("fallback message uses 'work on' on initial attempt", async () => {
    setupExecByCommand({
      "rev-parse HEAD": "abc123\n",
      "git status --porcelain": "M file.ts\n",
      "git add -A": "",
      "diff --cached --quiet": () => {
        throw new Error("exit 1");
      },
      "git commit": "",
    });
    emptyQueryResult();

    await ensureGeneratorCommit({ workDir: "/work", gitDir: "/work", beforeSha: "abc123", sessionId: "sess-1", contract: CONTRACT, isRetry: false, model: "test-model" }, deps);

    const commitCall = execSyncMock.mock.calls.find((c: unknown[]) => (c[0] as string).includes("git commit"));
    expect(commitCall).toBeDefined();
    expect((commitCall![0] as string)).toContain("work on");
  });

  test("returns 'fallback' when resume query throws", async () => {
    setupExecByCommand({
      "rev-parse HEAD": "abc123\n",
      "git status --porcelain": "M file.ts\n",
      "git add -A": "",
      "diff --cached --quiet": () => {
        throw new Error("exit 1");
      },
      "git commit": "",
    });
    queryMock.mockReturnValue(
      (async function* () {
        throw new Error("SDK connection failed");
      })(),
    );

    const result = await ensureGeneratorCommit({ workDir: "/work", gitDir: "/work", beforeSha: "abc123", sessionId: "sess-1", contract: CONTRACT, isRetry: false, model: "test-model" }, deps);

    expect(result).toBe("fallback");
  });

  test("passes resume (not sessionId) to query options when available", async () => {
    let statusCallCount = 0;
    setupExecByCommand({
      "rev-parse HEAD": "abc123\n",
      "git status --porcelain": () => {
        statusCallCount++;
        return statusCallCount === 1 ? "M file.ts\n" : "";
      },
    });
    emptyQueryResult();

    await ensureGeneratorCommit({ workDir: "/work", gitDir: "/work", beforeSha: "abc123", sessionId: "sess-42", contract: CONTRACT, isRetry: false, model: "test-model" }, deps);

    const queryCall = queryMock.mock.calls[0]?.[0];
    expect(queryCall?.options?.resume).toBe("sess-42");
    expect(queryCall?.options?.sessionId).toBeUndefined();
  });

  test("skips resume query entirely when sessionId is undefined", async () => {
    // Without a session to resume, we jump straight to fallback.
    setupExecByCommand({
      "rev-parse HEAD": "abc123\n",
      "git status --porcelain": "M file.ts\n",
      "git add -A": "",
      "diff --cached --quiet": () => {
        throw new Error("exit 1");
      },
      "git commit": "",
    });
    emptyQueryResult();

    await ensureGeneratorCommit({ workDir: "/work", gitDir: "/work", beforeSha: "abc123", sessionId: undefined, contract: CONTRACT, isRetry: false, model: "test-model" }, deps);

    expect(queryMock).not.toHaveBeenCalled();
  });

  test("resume query uses Bash-only tools with maxTurns 3", async () => {
    let statusCallCount = 0;
    setupExecByCommand({
      "rev-parse HEAD": "abc123\n",
      "git status --porcelain": () => {
        statusCallCount++;
        return statusCallCount === 1 ? "M file.ts\n" : "";
      },
    });
    emptyQueryResult();

    await ensureGeneratorCommit({ workDir: "/work", gitDir: "/work", beforeSha: "abc123", sessionId: "sess-1", contract: CONTRACT, isRetry: false, model: "test-model" }, deps);

    const queryCall = queryMock.mock.calls[0]?.[0];
    expect(queryCall?.options?.tools).toEqual(["Bash"]);
    expect(queryCall?.options?.maxTurns).toBe(3);
  });

  test("uses retry-specific prompt when isRetry is true", async () => {
    let statusCallCount = 0;
    setupExecByCommand({
      "rev-parse HEAD": "abc123\n",
      "git status --porcelain": () => {
        statusCallCount++;
        return statusCallCount === 1 ? "M file.ts\n" : "";
      },
    });
    emptyQueryResult();

    await ensureGeneratorCommit({ workDir: "/work", gitDir: "/work", beforeSha: "abc123", sessionId: "sess-1", contract: CONTRACT, isRetry: true, model: "test-model" }, deps);

    const queryCall = queryMock.mock.calls[0]?.[0];
    expect(queryCall?.prompt).toContain("evaluation feedback");
  });

  test("uses initial prompt when isRetry is false", async () => {
    let statusCallCount = 0;
    setupExecByCommand({
      "rev-parse HEAD": "abc123\n",
      "git status --porcelain": () => {
        statusCallCount++;
        return statusCallCount === 1 ? "M file.ts\n" : "";
      },
    });
    emptyQueryResult();

    await ensureGeneratorCommit({ workDir: "/work", gitDir: "/work", beforeSha: "abc123", sessionId: "sess-1", contract: CONTRACT, isRetry: false, model: "test-model" }, deps);

    const queryCall = queryMock.mock.calls[0]?.[0];
    expect(queryCall?.prompt).toContain("built features");
  });

  test("fallback message includes all feature names", async () => {
    setupExecByCommand({
      "rev-parse HEAD": "abc123\n",
      "git status --porcelain": "M file.ts\n",
      "git add -A": "",
      "diff --cached --quiet": () => {
        throw new Error("exit 1");
      },
      "git commit": "",
    });
    emptyQueryResult();

    await ensureGeneratorCommit({ workDir: "/work", gitDir: "/work", beforeSha: "abc123", sessionId: "sess-1", contract: CONTRACT, isRetry: false, model: "test-model" }, deps);

    const commitCall = execSyncMock.mock.calls.find((c: unknown[]) => (c[0] as string).includes("git commit"));
    expect(commitCall).toBeDefined();
    expect((commitCall![0] as string)).toContain("JWT auth, user profile endpoint");
  });
});
