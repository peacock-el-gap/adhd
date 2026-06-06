import { afterEach, describe, expect, mock, test } from "bun:test";
import { ensureTopicBranch } from "../shared/orchestration/git-ops.ts";

const execMock = mock();

function makeExec(responses: (string | Error)[]) {
  let i = 0;
  execMock.mockImplementation(() => {
    const r = i < responses.length ? responses[i] : "";
    i++;
    if (r instanceof Error) throw r;
    return r;
  });
  return execMock;
}

afterEach(() => {
  execMock.mockReset();
});

describe("ensureTopicBranch", () => {
  test("creates a new branch when it does not yet exist", () => {
    // git branch --list → "" (not found), then git checkout -b → success
    const exec = makeExec(["", ""]);
    expect(() =>
      ensureTopicBranch({
        branchName: "adhd/my-feature-20260606-143045",
        gitDir: "/repo",
        exec,
      }),
    ).not.toThrow();
    // Second call should be git checkout -b
    const secondCall = (execMock.mock.calls[1] as [string])[0];
    expect(secondCall).toContain("checkout -b");
    expect(secondCall).toContain("adhd/my-feature-20260606-143045");
  });

  test("checks out an existing branch rather than creating a new one", () => {
    // git branch --list → non-empty (branch exists), then git checkout → success
    const exec = makeExec(["  adhd/my-feature-20260606-143045\n", ""]);
    expect(() =>
      ensureTopicBranch({
        branchName: "adhd/my-feature-20260606-143045",
        gitDir: "/repo",
        exec,
      }),
    ).not.toThrow();
    const secondCall = (execMock.mock.calls[1] as [string])[0];
    // Should NOT contain "-b" (not creating, just checking out)
    expect(secondCall).not.toContain("-b");
    expect(secondCall).toContain("checkout");
    expect(secondCall).toContain("adhd/my-feature-20260606-143045");
  });

  test("throws a meaningful error when branch creation fails", () => {
    // git branch --list → "" (not found), then git checkout -b → throws
    const exec = makeExec(["", new Error("fatal: not a git repository")]);
    expect(() =>
      ensureTopicBranch({
        branchName: "adhd/my-task-20260606-000000",
        gitDir: "/not-a-repo",
        exec,
      }),
    ).toThrow(/Failed to create topic branch 'adhd\/my-task-20260606-000000'/);
  });

  test("throws a meaningful error when checkout of existing branch fails", () => {
    const exec = makeExec(["  adhd/existing\n", new Error("error: pathspec did not match")]);
    expect(() =>
      ensureTopicBranch({
        branchName: "adhd/existing",
        gitDir: "/repo",
        exec,
      }),
    ).toThrow(/Failed to check out existing topic branch 'adhd\/existing'/);
  });

  test("throws when the branch-list command itself fails", () => {
    const exec = makeExec([new Error("fatal: not a git repo")]);
    expect(() =>
      ensureTopicBranch({
        branchName: "adhd/my-task-20260606-000000",
        gitDir: "/not-a-repo",
        exec,
      }),
    ).toThrow(/Unable to list branches/);
  });

  test("propagates the original error message for diagnostics", () => {
    const exec = makeExec(["", new Error("git: command not found")]);
    let caught: Error | undefined;
    try {
      ensureTopicBranch({ branchName: "adhd/x", gitDir: "/repo", exec });
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).toBeDefined();
    expect(caught?.message).toContain("git: command not found");
  });
});
