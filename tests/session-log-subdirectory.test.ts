/**
 * Sprint 3: Per-session log subdirectory tests
 *
 * Verifies that conversation logs land under .adhd/logs/<session-stamp>/
 * when a sessionDir is supplied, that the per-file timestamp prefix is
 * preserved inside the subdirectory, and that the legacy flat behavior
 * (no sessionDir) is unchanged.
 */
import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeIdentity } from "../shared/agent-identity.ts";
import { createConversationLog } from "../shared/conversation-logger.ts";

const TIMESTAMP_RE = /^\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2}/;
const SESSION_STAMP_A = "2026.06.06-10.00.00";
const SESSION_STAMP_B = "2026.06.06-10.30.00";

describe("session-log-subdirectory", () => {
  it("logs_land_in_session_subdirectory: writes into .adhd/logs/<sessionDir>/ when sessionDir is provided", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sess-log-"));
    await mkdir(join(dir, ".adhd", "logs"), { recursive: true });

    const logger = createConversationLog(
      dir,
      makeIdentity({ role: "generator", sprint: 1, attempt: 0 }),
      undefined,
      SESSION_STAMP_A,
    );
    logger.logAssistantText("Session subdirectory test");
    await logger.finalize(1000);

    // File must NOT be directly under .adhd/logs/
    const rootFiles = await readdir(join(dir, ".adhd", "logs"));
    // The session subdirectory should appear as an entry
    expect(rootFiles).toContain(SESSION_STAMP_A);
    // No .md file directly at root level
    const mdAtRoot = rootFiles.filter((f) => f.endsWith(".md"));
    expect(mdAtRoot.length).toBe(0);

    // File IS under .adhd/logs/<sessionDir>/
    const sessionFiles = await readdir(join(dir, ".adhd", "logs", SESSION_STAMP_A));
    expect(sessionFiles.length).toBe(1);
    expect(sessionFiles[0]).toContain("sprint-1-attempt-0-generator.md");
  });

  it("session_directory_name_matches_timedName_format: directory name matches YYYY.MM.DD-HH.MM.SS format", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sess-fmt-"));
    await mkdir(join(dir, ".adhd", "logs"), { recursive: true });

    const logger = createConversationLog(
      dir,
      makeIdentity({ role: "evaluator", sprint: 2, attempt: 0 }),
      undefined,
      SESSION_STAMP_A,
    );
    await logger.finalize(500);

    const rootEntries = await readdir(join(dir, ".adhd", "logs"));
    const dirs = rootEntries.filter((e) => TIMESTAMP_RE.test(e));
    expect(dirs.length).toBe(1);
    expect(dirs[0]).toBe(SESSION_STAMP_A);
  });

  it("per_file_leading_timestamp_preserved: filename inside session dir retains per-file timestamp prefix", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sess-ts-"));
    await mkdir(join(dir, ".adhd", "logs"), { recursive: true });

    const identity = makeIdentity({
      role: "generator",
      sprint: 1,
      attempt: 0,
      timestamp: "2026.06.06-10.05.00",
    });
    const logger = createConversationLog(dir, identity, undefined, SESSION_STAMP_A);
    await logger.finalize(1000);

    const sessionFiles = await readdir(join(dir, ".adhd", "logs", SESSION_STAMP_A));
    expect(sessionFiles.length).toBe(1);
    // File must start with the per-file timestamp (from timedName)
    expect(sessionFiles[0]).toMatch(TIMESTAMP_RE);
    expect(sessionFiles[0]).toContain("2026.06.06-10.05.00-sprint-1-attempt-0-generator.md");
  });

  it("two_runs_produce_two_separate_sibling_directories: separate sessionDirs produce sibling subdirectories", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sess-two-"));
    await mkdir(join(dir, ".adhd", "logs"), { recursive: true });

    const logger1 = createConversationLog(
      dir,
      makeIdentity({ role: "generator", sprint: 2, attempt: 0, timestamp: "2026.06.06-10.00.01" }),
      undefined,
      SESSION_STAMP_A,
    );
    logger1.logAssistantText("Run A");
    await logger1.finalize(1000);

    const logger2 = createConversationLog(
      dir,
      makeIdentity({ role: "generator", sprint: 2, attempt: 0, timestamp: "2026.06.06-10.30.01" }),
      undefined,
      SESSION_STAMP_B,
    );
    logger2.logAssistantText("Run B");
    await logger2.finalize(1000);

    const rootEntries = (await readdir(join(dir, ".adhd", "logs"))).sort();
    // Should have exactly two subdirectory entries (no md files at root)
    expect(rootEntries).toContain(SESSION_STAMP_A);
    expect(rootEntries).toContain(SESSION_STAMP_B);
    const mdAtRoot = rootEntries.filter((e) => e.endsWith(".md"));
    expect(mdAtRoot.length).toBe(0);

    // Each subdirectory contains its own file — no cross-contamination
    const filesA = await readdir(join(dir, ".adhd", "logs", SESSION_STAMP_A));
    const filesB = await readdir(join(dir, ".adhd", "logs", SESSION_STAMP_B));
    expect(filesA.length).toBe(1);
    expect(filesB.length).toBe(1);
    expect(filesA[0]).not.toBe(filesB[0]);

    const contentA = await readFile(join(dir, ".adhd", "logs", SESSION_STAMP_A, filesA[0] as string), "utf-8");
    const contentB = await readFile(join(dir, ".adhd", "logs", SESSION_STAMP_B, filesB[0] as string), "utf-8");
    expect(contentA).toContain("Run A");
    expect(contentB).toContain("Run B");
  });

  it("legacy_flat_logs_untouched: pre-existing flat .md files are not affected by new session-dir writes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sess-legacy-"));
    await mkdir(join(dir, ".adhd", "logs"), { recursive: true });

    // Simulate a legacy log file already present flat in .adhd/logs/
    const legacyFile = join(dir, ".adhd", "logs", "2025.01.01-00.00.00-old-log.md");
    await writeFile(legacyFile, "# Legacy log\n\nOld content", "utf-8");

    // New run with sessionDir
    const logger = createConversationLog(
      dir,
      makeIdentity({ role: "planner", timestamp: "2026.06.06-10.00.00" }),
      undefined,
      SESSION_STAMP_A,
    );
    await logger.finalize(500);

    // Legacy file still present and unchanged
    const rootEntries = await readdir(join(dir, ".adhd", "logs"));
    expect(rootEntries).toContain("2025.01.01-00.00.00-old-log.md");
    const legacyContent = await readFile(legacyFile, "utf-8");
    expect(legacyContent).toContain("Old content");

    // New log under session dir
    expect(rootEntries).toContain(SESSION_STAMP_A);
  });

  it("single_session_timestamp_per_run: same sessionDir reused across multiple agent logs in one run", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sess-single-"));
    await mkdir(join(dir, ".adhd", "logs"), { recursive: true });

    // Two different agents, same run (same sessionDir), different per-file timestamps
    const logger1 = createConversationLog(
      dir,
      makeIdentity({ role: "generator", sprint: 1, attempt: 0, timestamp: "2026.06.06-10.00.01" }),
      undefined,
      SESSION_STAMP_A,
    );
    await logger1.finalize(500);

    const logger2 = createConversationLog(
      dir,
      makeIdentity({ role: "evaluator", sprint: 1, attempt: 0, timestamp: "2026.06.06-10.01.00" }),
      undefined,
      SESSION_STAMP_A,
    );
    await logger2.finalize(500);

    // Both files under the SAME session subdirectory
    const rootEntries = await readdir(join(dir, ".adhd", "logs"));
    expect(rootEntries.filter((e) => TIMESTAMP_RE.test(e)).length).toBe(1);
    expect(rootEntries).toContain(SESSION_STAMP_A);

    const sessionFiles = (await readdir(join(dir, ".adhd", "logs", SESSION_STAMP_A))).sort();
    expect(sessionFiles.length).toBe(2);
    // Both have per-file timestamps
    for (const f of sessionFiles) {
      expect(f).toMatch(TIMESTAMP_RE);
    }
  });

  it("legacy behavior preserved: no sessionDir writes flat file as before", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sess-flat-"));
    await mkdir(join(dir, ".adhd", "logs"), { recursive: true });

    const logger = createConversationLog(
      dir,
      makeIdentity({ role: "generator", sprint: 1, attempt: 0 }),
    );
    await logger.finalize(500);

    const rootFiles = await readdir(join(dir, ".adhd", "logs"));
    // Should have exactly one .md file at root (flat behavior)
    const mdFiles = rootFiles.filter((f) => f.endsWith(".md"));
    expect(mdFiles.length).toBe(1);
    expect(mdFiles[0]).toMatch(TIMESTAMP_RE);
    expect(mdFiles[0]).toContain("sprint-1-attempt-0-generator.md");
  });
});
