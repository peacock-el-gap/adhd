import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConversationLog } from "../shared/conversation-logger.ts";

// Timestamp pattern: YYYY.MM.DD-HH.MM.SS
const TIMESTAMP_RE = /^\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2}/;

describe("conversation-logger", () => {
  it("creates a logger with expected methods", () => {
    const logger = createConversationLog("/tmp/test", "Generator");
    expect(typeof logger.logAssistantText).toBe("function");
    expect(typeof logger.logToolUse).toBe("function");
    expect(typeof logger.logToolResult).toBe("function");
    expect(typeof logger.finalize).toBe("function");
  });

  it("writes a timestamped log file on finalize", async () => {
    const dir = await mkdtemp(join(tmpdir(), "convlog-"));
    await mkdir(join(dir, ".adhd", "logs"), { recursive: true });

    const logger = createConversationLog(dir, "Generator", 1, 0);
    logger.logAssistantText("Hello world");
    await logger.finalize(5000);

    const files = await readdir(join(dir, ".adhd", "logs"));
    expect(files.length).toBe(1);
    const filename = files[0];
    // Filename should match: YYYY.MM.DD-HH.MM.SS-sprint-1-attempt-0-generator.md
    expect(filename).toMatch(TIMESTAMP_RE);
    expect(filename).toContain("sprint-1-attempt-0-generator.md");

    const content = await readFile(join(dir, ".adhd", "logs", filename), "utf-8");
    expect(content).toContain("Generator");
    expect(content).toContain("Hello world");
  });

  it("logs tool use with Bash formatting", async () => {
    const dir = await mkdtemp(join(tmpdir(), "convlog-"));
    await mkdir(join(dir, ".adhd", "logs"), { recursive: true });

    const logger = createConversationLog(dir, "Generator", 2, 1);
    logger.logToolUse("Bash", { command: "echo hello" });
    logger.logToolResult("hello");
    await logger.finalize(3000);

    const files = await readdir(join(dir, ".adhd", "logs"));
    const filename = files[0];
    expect(filename).toMatch(TIMESTAMP_RE);
    expect(filename).toContain("sprint-2-attempt-1-generator.md");

    const content = await readFile(join(dir, ".adhd", "logs", filename), "utf-8");
    expect(content).toContain("Bash");
    expect(content).toContain("echo hello");
  });

  it("generates timestamped filename without sprint/attempt", async () => {
    const dir = await mkdtemp(join(tmpdir(), "convlog-"));
    await mkdir(join(dir, ".adhd", "logs"), { recursive: true });

    const logger = createConversationLog(dir, "Planner");
    await logger.finalize(1000);

    const files = await readdir(join(dir, ".adhd", "logs"));
    const filename = files[0];
    expect(filename).toMatch(TIMESTAMP_RE);
    expect(filename).toContain("planner.md");

    const content = await readFile(join(dir, ".adhd", "logs", filename), "utf-8");
    expect(content).toContain("Planner");
  });

  it("skips empty assistant text", async () => {
    const dir = await mkdtemp(join(tmpdir(), "convlog-"));
    await mkdir(join(dir, ".adhd", "logs"), { recursive: true });

    const logger = createConversationLog(dir, "Evaluator", 1, 0);
    logger.logAssistantText("   ");
    logger.logAssistantText("Actual content");
    await logger.finalize(1000);

    const files = await readdir(join(dir, ".adhd", "logs"));
    const filename = files[0];
    expect(filename).toContain("sprint-1-attempt-0-evaluator.md");

    const content = await readFile(join(dir, ".adhd", "logs", filename), "utf-8");
    expect(content).toContain("Actual content");
  });

  it("contract negotiation logs have timestamped names", async () => {
    const dir = await mkdtemp(join(tmpdir(), "convlog-"));
    await mkdir(join(dir, ".adhd", "logs"), { recursive: true });

    const logger = createConversationLog(dir, "contract-negotiation", 3);
    await logger.finalize(2000);

    const files = await readdir(join(dir, ".adhd", "logs"));
    const filename = files[0];
    expect(filename).toMatch(TIMESTAMP_RE);
    expect(filename).toContain("sprint-3-contract-negotiation.md");
  });

  it("resume does not overwrite prior logs (different timestamps)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "convlog-"));
    await mkdir(join(dir, ".adhd", "logs"), { recursive: true });

    // First run
    const logger1 = createConversationLog(dir, "Generator", 2, 0);
    logger1.logAssistantText("First run");
    await logger1.finalize(1000);

    // Small delay to ensure different timestamp
    await new Promise((r) => setTimeout(r, 1100));

    // Second run (resume)
    const logger2 = createConversationLog(dir, "Generator", 2, 0);
    logger2.logAssistantText("Second run");
    await logger2.finalize(1000);

    const files = await readdir(join(dir, ".adhd", "logs"));
    expect(files.length).toBe(2);
    // Both should have different timestamps
    expect(files[0]).not.toBe(files[1]);
    // Both should contain the sprint/attempt identifier
    for (const f of files) {
      expect(f).toContain("sprint-2-attempt-0-generator.md");
      expect(f).toMatch(TIMESTAMP_RE);
    }
  });

  it("exposes timestampedName for span alignment", () => {
    const logger = createConversationLog("/tmp/test", "Generator", 1, 0);
    expect(logger.timestampedName).toMatch(TIMESTAMP_RE);
    expect(logger.timestampedName).toContain("sprint-1-attempt-0-generator");
  });

  it("documenter logs have timestamped names", async () => {
    const dir = await mkdtemp(join(tmpdir(), "convlog-"));
    await mkdir(join(dir, ".adhd", "logs"), { recursive: true });

    const logger = createConversationLog(dir, "Documenter");
    await logger.finalize(1000);

    const files = await readdir(join(dir, ".adhd", "logs"));
    const filename = files[0];
    expect(filename).toMatch(TIMESTAMP_RE);
    expect(filename).toContain("documenter.md");
  });
});
