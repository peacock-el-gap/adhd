import { afterEach, describe, expect, mock, test } from "bun:test";

const execSyncMock = mock();

mock.module("node:child_process", () => ({
  execSync: execSyncMock,
  exec: () => {},
}));

const { ensureAgentCommit } = await import("../shared/orchestration/git-ops.ts");

function setupExecSync(responses: string[]) {
  let i = 0;
  execSyncMock.mockImplementation(() => {
    const r = i < responses.length ? responses[i] : "";
    i++;
    return r;
  });
}

afterEach(() => {
  execSyncMock.mockReset();
});

describe("ensureAgentCommit", () => {
  test('returns "agent" when HEAD advanced and tree is clean', async () => {
    setupExecSync(["newsha", ""]); // rev-parse, status
    const result = await ensureAgentCommit({
      workDir: "/x",
      gitDir: "/x",
      agentLabel: "generator",
      beforeSha: "oldsha",
      fallbackMessage: "[auto-commit] Sprint 1: fallback",
    });
    expect(result).toBe("agent");
  });

  test('returns "none" when HEAD unchanged and tree clean', async () => {
    setupExecSync(["oldsha", ""]);
    const result = await ensureAgentCommit({
      workDir: "/x",
      gitDir: "/x",
      agentLabel: "generator",
      beforeSha: "oldsha",
      fallbackMessage: "fallback",
    });
    expect(result).toBe("none");
  });

  test('returns "resume" when tree dirty but resume runner fixes it', async () => {
    // rev-parse, status(dirty), status(clean after resume)
    setupExecSync(["oldsha", " M file.ts", ""]);
    const runResume = mock(async () => {});
    const result = await ensureAgentCommit({
      workDir: "/x",
      gitDir: "/x",
      agentLabel: "generator",
      beforeSha: "oldsha",
      fallbackMessage: "fallback",
      runResume,
    });
    expect(result).toBe("resume");
    expect(runResume).toHaveBeenCalledTimes(1);
  });

  test('returns "fallback" when resume does not clean tree → commits with fallback message', async () => {
    // rev-parse, status(dirty), status(still dirty), fallback add+commit
    setupExecSync(["oldsha", " M file.ts", " M file.ts", ""]);
    const runResume = mock(async () => {});
    const result = await ensureAgentCommit({
      workDir: "/x",
      gitDir: "/x",
      agentLabel: "documenter",
      beforeSha: "oldsha",
      fallbackMessage: "[docs] fallback msg",
      runResume,
    });
    expect(result).toBe("fallback");
    // Last execSync call should be the add+commit with fallback message
    const lastCall = execSyncMock.mock.calls[execSyncMock.mock.calls.length - 1]![0] as string;
    expect(lastCall).toContain("git add -A");
    expect(lastCall).toContain("[docs] fallback msg");
  });

  test('returns "fallback" directly when no runResume is provided and tree dirty', async () => {
    setupExecSync(["oldsha", " M file.ts", ""]);
    const result = await ensureAgentCommit({
      workDir: "/x",
      gitDir: "/x",
      agentLabel: "documenter",
      beforeSha: "oldsha",
      fallbackMessage: "fallback",
    });
    expect(result).toBe("fallback");
  });

  test("resume runner exception surfaces stderr in log but does not throw", async () => {
    setupExecSync(["oldsha", " M file.ts", ""]); // rev-parse, dirty, clean-after-resume
    const runResume = mock(async () => {
      const err = new Error("subprocess exited");
      (err as unknown as { stderr: string }).stderr = "CLI: invalid option";
      throw err;
    });
    const result = await ensureAgentCommit({
      workDir: "/x",
      gitDir: "/x",
      agentLabel: "generator",
      beforeSha: "oldsha",
      fallbackMessage: "fallback",
      runResume,
    });
    // Even though resume threw, tree is now clean → resume tier "succeeded"
    // (matches documented behavior: re-check tree after runResume returns/throws)
    expect(result).toBe("resume");
  });
});
