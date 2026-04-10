import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConversationLog } from "./conversation-logger.ts";

describe("conversation-logger", () => {
  it("creates a logger with expected methods", () => {
    const logger = createConversationLog("/tmp/test", "Generator");
    expect(typeof logger.logAssistantText).toBe("function");
    expect(typeof logger.logToolUse).toBe("function");
    expect(typeof logger.logToolResult).toBe("function");
    expect(typeof logger.finalize).toBe("function");
  });

  it("writes a log file on finalize", async () => {
    const dir = await mkdtemp(join(tmpdir(), "convlog-"));
    await mkdir(join(dir, ".adhd", "logs"), { recursive: true });

    const logger = createConversationLog(dir, "Generator", 1, 0);
    logger.logAssistantText("Hello world");
    await logger.finalize(5000);

    const content = await readFile(join(dir, ".adhd", "logs", "sprint-1-attempt-0-generator.md"), "utf-8");
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

    const content = await readFile(join(dir, ".adhd", "logs", "sprint-2-attempt-1-generator.md"), "utf-8");
    expect(content).toContain("Bash");
    expect(content).toContain("echo hello");
  });

  it("generates correct filename without sprint/attempt", async () => {
    const dir = await mkdtemp(join(tmpdir(), "convlog-"));
    await mkdir(join(dir, ".adhd", "logs"), { recursive: true });

    const logger = createConversationLog(dir, "Planner");
    await logger.finalize(1000);

    const content = await readFile(join(dir, ".adhd", "logs", "planner.md"), "utf-8");
    expect(content).toContain("Planner");
  });

  it("skips empty assistant text", async () => {
    const dir = await mkdtemp(join(tmpdir(), "convlog-"));
    await mkdir(join(dir, ".adhd", "logs"), { recursive: true });

    const logger = createConversationLog(dir, "Evaluator", 1, 0);
    logger.logAssistantText("   ");
    logger.logAssistantText("Actual content");
    await logger.finalize(1000);

    const content = await readFile(join(dir, ".adhd", "logs", "sprint-1-attempt-0-evaluator.md"), "utf-8");
    expect(content).toContain("Actual content");
  });
});
