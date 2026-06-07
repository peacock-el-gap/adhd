import { afterEach, describe, expect, mock, test } from "bun:test";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureAgentCommit } from "../shared/orchestration/git-ops.ts";

const execSyncMock = mock();

/**
 * Set up the mock to return specific responses based on command patterns.
 * This is more resilient than positional indexing because the new fallback
 * path issues multiple git commands (add, diff --cached, commit).
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

afterEach(() => {
  execSyncMock.mockReset();
});

describe("ensureAgentCommit", () => {
  test('returns "agent" when HEAD advanced and tree is clean', async () => {
    setupExecByCommand({
      "rev-parse HEAD": "newsha",
      "git status --porcelain": "",
    });
    const result = await ensureAgentCommit({
      workDir: "/x",
      gitDir: "/x",
      agentLabel: "generator",
      beforeSha: "oldsha",
      fallbackMessage: "[auto-commit] Sprint 1: fallback",
      exec: execSyncMock,
    });
    expect(result).toBe("agent");
  });

  test('returns "none" when HEAD unchanged and tree clean', async () => {
    setupExecByCommand({
      "rev-parse HEAD": "oldsha",
      "git status --porcelain": "",
    });
    const result = await ensureAgentCommit({
      workDir: "/x",
      gitDir: "/x",
      agentLabel: "generator",
      beforeSha: "oldsha",
      fallbackMessage: "fallback",
      exec: execSyncMock,
    });
    expect(result).toBe("none");
  });

  test('returns "resume" when tree dirty but resume runner fixes it', async () => {
    let statusCallCount = 0;
    setupExecByCommand({
      "rev-parse HEAD": "oldsha",
      "git status --porcelain": () => {
        statusCallCount++;
        // First call: dirty; second call (post-resume): clean
        return statusCallCount === 1 ? " M file.ts" : "";
      },
    });
    const runResume = mock(async () => {});
    const result = await ensureAgentCommit({
      workDir: "/x",
      gitDir: "/x",
      agentLabel: "generator",
      beforeSha: "oldsha",
      fallbackMessage: "fallback",
      runResume,
      exec: execSyncMock,
    });
    expect(result).toBe("resume");
    expect(runResume).toHaveBeenCalledTimes(1);
  });

  test('returns "fallback" when resume does not clean tree — commits product only', async () => {
    setupExecByCommand({
      "rev-parse HEAD": "oldsha",
      "git status --porcelain": " M file.ts",
      "git add -A": "",
      // diff --cached --quiet throws (non-zero) when something is staged
      "diff --cached --quiet": () => {
        throw new Error("exit 1");
      },
      "git commit": "",
    });
    const runResume = mock(async () => {});
    const result = await ensureAgentCommit({
      workDir: "/x",
      gitDir: "/x",
      agentLabel: "documenter",
      beforeSha: "oldsha",
      fallbackMessage: "[docs] fallback msg",
      runResume,
      exec: execSyncMock,
    });
    expect(result).toBe("fallback");
    // Verify the add command uses exclude pathspec (no -f / --force)
    const addCall = execSyncMock.mock.calls.find((c: unknown[]) => (c[0] as string).includes("git add"));
    expect(addCall).toBeDefined();
    const addCmd = addCall![0] as string;
    expect(addCmd).toContain(":(exclude).adhd");
    expect(addCmd).not.toContain("-f");
    expect(addCmd).not.toContain("--force");
    // Verify commit message
    const commitCall = execSyncMock.mock.calls.find((c: unknown[]) => (c[0] as string).includes("git commit"));
    expect(commitCall).toBeDefined();
    expect((commitCall![0] as string)).toContain("[docs] fallback msg");
  });

  test('returns "fallback" directly when no runResume is provided and tree dirty', async () => {
    setupExecByCommand({
      "rev-parse HEAD": "oldsha",
      "git status --porcelain": " M file.ts",
      "git add -A": "",
      "diff --cached --quiet": () => {
        throw new Error("exit 1");
      },
      "git commit": "",
    });
    const result = await ensureAgentCommit({
      workDir: "/x",
      gitDir: "/x",
      agentLabel: "documenter",
      beforeSha: "oldsha",
      fallbackMessage: "fallback",
      exec: execSyncMock,
    });
    expect(result).toBe("fallback");
  });

  test("resume runner exception surfaces stderr in log but does not throw", async () => {
    let statusCallCount = 0;
    setupExecByCommand({
      "rev-parse HEAD": "oldsha",
      "git status --porcelain": () => {
        statusCallCount++;
        return statusCallCount === 1 ? " M file.ts" : "";
      },
    });
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
      exec: execSyncMock,
    });
    // Even though resume threw, tree is now clean → resume tier "succeeded"
    expect(result).toBe("resume");
  });

  // ── OPP-54 Sprint 2: .adhd/ exclusion scenarios ──

  test("dirty check excludes .adhd/ from pre-check via pathspec", async () => {
    setupExecByCommand({
      "rev-parse HEAD": "oldsha",
      "git status --porcelain": "",
    });
    await ensureAgentCommit({
      workDir: "/x",
      gitDir: "/x",
      agentLabel: "generator",
      beforeSha: "oldsha",
      fallbackMessage: "fallback",
      exec: execSyncMock,
    });
    // The status call should include the exclude pathspec
    const statusCall = execSyncMock.mock.calls.find((c: unknown[]) =>
      (c[0] as string).includes("git status --porcelain"),
    );
    expect(statusCall).toBeDefined();
    expect((statusCall![0] as string)).toContain(":(exclude).adhd");
  });

  test("dirty check excludes .adhd/ from post-resume check via pathspec", async () => {
    let statusCallCount = 0;
    setupExecByCommand({
      "rev-parse HEAD": "oldsha",
      "git status --porcelain": () => {
        statusCallCount++;
        return statusCallCount === 1 ? " M file.ts" : "";
      },
    });
    const runResume = mock(async () => {});
    await ensureAgentCommit({
      workDir: "/x",
      gitDir: "/x",
      agentLabel: "generator",
      beforeSha: "oldsha",
      fallbackMessage: "fallback",
      runResume,
      exec: execSyncMock,
    });
    // Both status calls should include the exclude pathspec
    const statusCalls = execSyncMock.mock.calls.filter((c: unknown[]) =>
      (c[0] as string).includes("git status --porcelain"),
    );
    expect(statusCalls.length).toBe(2);
    for (const call of statusCalls) {
      expect((call[0] as string)).toContain(":(exclude).adhd");
    }
  });

  test('returns "agent" when generator committed and only .adhd/ stray remains', async () => {
    // HEAD moved (agent committed), but .adhd/ files are in the tree.
    // With the exclude pathspec, status reports clean → "agent".
    setupExecByCommand({
      "rev-parse HEAD": "newsha",
      "git status --porcelain": "", // .adhd/ excluded by pathspec
    });
    const result = await ensureAgentCommit({
      workDir: "/x",
      gitDir: "/x",
      agentLabel: "generator",
      beforeSha: "oldsha",
      fallbackMessage: "fallback",
      exec: execSyncMock,
    });
    expect(result).toBe("agent");
  });

  test('returns "none" when HEAD did not move and only .adhd/ stray present', async () => {
    // HEAD unchanged, only .adhd/ files present. With exclude, status is clean → "none".
    setupExecByCommand({
      "rev-parse HEAD": "oldsha",
      "git status --porcelain": "", // .adhd/ excluded by pathspec
    });
    const result = await ensureAgentCommit({
      workDir: "/x",
      gitDir: "/x",
      agentLabel: "generator",
      beforeSha: "oldsha",
      fallbackMessage: "fallback",
      exec: execSyncMock,
    });
    expect(result).toBe("none");
  });

  test("fallback stages product only — no .adhd/ path in committed tree", async () => {
    setupExecByCommand({
      "rev-parse HEAD": "oldsha",
      "git status --porcelain": " M src/app.ts",
      "git add -A": "",
      "diff --cached --quiet": () => {
        throw new Error("exit 1");
      },
      "git commit": "",
    });
    const result = await ensureAgentCommit({
      workDir: "/x",
      gitDir: "/x",
      agentLabel: "generator",
      beforeSha: "oldsha",
      fallbackMessage: "[auto-commit] product changes",
      exec: execSyncMock,
    });
    expect(result).toBe("fallback");
    // The add command must exclude .adhd/
    const addCall = execSyncMock.mock.calls.find((c: unknown[]) => (c[0] as string).includes("git add"));
    expect(addCall).toBeDefined();
    expect((addCall![0] as string)).toContain(":(exclude).adhd");
  });

  test("fallback tolerates gitignored .adhd/ without short-circuiting", async () => {
    // When .adhd/ is gitignored, git add might return non-zero for "nothing to add"
    // after excluding .adhd/. The fallback tolerates this and still commits product.
    setupExecByCommand({
      "rev-parse HEAD": "oldsha",
      "git status --porcelain": " M src/index.ts",
      "git add -A": () => {
        // Simulate git add returning non-zero (but we catch this)
        throw new Error("nothing to add");
      },
      "diff --cached --quiet": () => {
        // But something IS staged (from before)
        throw new Error("exit 1");
      },
      "git commit": "",
    });
    const result = await ensureAgentCommit({
      workDir: "/x",
      gitDir: "/x",
      agentLabel: "generator",
      beforeSha: "oldsha",
      fallbackMessage: "[auto-commit] fallback",
      exec: execSyncMock,
    });
    expect(result).toBe("fallback");
  });

  test("fallback returns 'none' when only .adhd/ changes present and nothing stages", async () => {
    // Tree appears dirty to the raw check but after excluding .adhd/, the product
    // status is dirty (this scenario shouldn't happen in practice because the
    // pre-check already excludes .adhd/, but test the fallback's own guard).
    setupExecByCommand({
      "rev-parse HEAD": "oldsha",
      "git status --porcelain": " M src/app.ts", // product dirty triggers fallback
      "git add -A": "",
      "diff --cached --quiet": "", // exit 0 → nothing staged
    });
    const result = await ensureAgentCommit({
      workDir: "/x",
      gitDir: "/x",
      agentLabel: "generator",
      beforeSha: "oldsha",
      fallbackMessage: "fallback",
      exec: execSyncMock,
    });
    // Nothing was actually staged → returns "none"
    expect(result).toBe("none");
  });

  test("no -f or --force flag appears anywhere in fallback staging", async () => {
    setupExecByCommand({
      "rev-parse HEAD": "oldsha",
      "git status --porcelain": " M file.ts",
      "git add -A": "",
      "diff --cached --quiet": () => {
        throw new Error("exit 1");
      },
      "git commit": "",
    });
    await ensureAgentCommit({
      workDir: "/x",
      gitDir: "/x",
      agentLabel: "generator",
      beforeSha: "oldsha",
      fallbackMessage: "fallback",
      exec: execSyncMock,
    });
    for (const call of execSyncMock.mock.calls) {
      const cmd = call[0] as string;
      if (cmd.includes("git add")) {
        expect(cmd).not.toMatch(/\s-f\b/);
        expect(cmd).not.toContain("--force");
      }
    }
  });
});

// ── Real-git fallback regression (OPP-54 §6 step 2 / spec Feature 2) ──────────
//
// The mock-based tests above prescribe the staged outcome themselves, so they
// cannot catch a regression to the old combined `git add -A && git commit` form
// or a dropped `:(exclude).adhd`. commit-governance.md §6 step 2 and the product
// spec explicitly require a GIT-SEMANTICS test that runs the fallback against
// real git with `.adhd/` actually gitignored and asserts a product commit is
// still made containing no `.adhd/` path — locking the exit-1 short-circuit fix.
describe("ensureAgentCommit — real-git fallback (locks the exit-1 short-circuit fix)", () => {
  const tmpDir = join(import.meta.dir, "__ensure_agent_fallback_tmp");

  function initRepo(gitignoreAdhd: boolean): void {
    rmSync(tmpDir, { recursive: true, force: true });
    mkdirSync(tmpDir, { recursive: true });
    execSync("git init", { cwd: tmpDir, stdio: "pipe" });
    execSync("git config user.email test@test.local", { cwd: tmpDir, stdio: "pipe" });
    execSync("git config user.name Test", { cwd: tmpDir, stdio: "pipe" });
    writeFileSync(join(tmpDir, "product.ts"), "export const v = 1;\n");
    execSync("git add -A", { cwd: tmpDir, stdio: "pipe" });
    execSync("git commit -m base", { cwd: tmpDir, stdio: "pipe" });
    if (gitignoreAdhd) {
      writeFileSync(join(tmpDir, ".gitignore"), ".adhd/\n");
      execSync("git add .gitignore", { cwd: tmpDir, stdio: "pipe" });
      execSync("git commit -m ignore", { cwd: tmpDir, stdio: "pipe" });
    }
  }

  const headSha = (): string => execSync("git rev-parse HEAD", { cwd: tmpDir, encoding: "utf-8" }).trim();
  const committedFiles = (): string =>
    execSync("git diff-tree --no-commit-id --name-only -r HEAD", { cwd: tmpDir, encoding: "utf-8" }).trim();

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  async function runFallbackScenario(gitignoreAdhd: boolean): Promise<void> {
    initRepo(gitignoreAdhd);
    const beforeSha = headSha();
    // The "agent" left an uncommitted product change AND .adhd/ churn, no commit.
    writeFileSync(join(tmpDir, "product.ts"), "export const v = 2;\n");
    mkdirSync(join(tmpDir, ".adhd"), { recursive: true });
    writeFileSync(join(tmpDir, ".adhd", "progress.json"), '{"sprint":1}');

    // No exec override → real execSync; no runResume → the fallback path runs.
    const result = await ensureAgentCommit({
      workDir: tmpDir,
      gitDir: tmpDir,
      agentLabel: "generator",
      beforeSha,
      fallbackMessage: "[auto-commit] Sprint 1: fallback",
    });

    expect(result).toBe("fallback");
    expect(headSha()).not.toBe(beforeSha); // a real commit was made
    const files = committedFiles();
    expect(files).toContain("product.ts"); // product persisted
    expect(files).not.toContain(".adhd"); // no harness bookkeeping in the product commit
    expect(existsSync(join(tmpDir, ".adhd", "progress.json"))).toBe(true); // .adhd/ survives on disk
  }

  test("gitignored .adhd/: product commit still made, no .adhd/ in it", async () => {
    await runFallbackScenario(true);
  });

  test("non-gitignored .adhd/: product commit made, .adhd/ excluded from it", async () => {
    await runFallbackScenario(false);
  });
});
