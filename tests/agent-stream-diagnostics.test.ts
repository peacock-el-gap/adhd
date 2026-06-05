import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { processAgentStream } from "../harness-claude/agent-stream.ts";
import { CLAUDE_MAX_TURNS } from "../shared/config.ts";
import type { ConversationLogger } from "../shared/conversation-logger.ts";
import { setLogLevel } from "../shared/logger.ts";

const queryMock = mock();

function makeConvLog(): ConversationLogger {
  return {
    logAssistantText: () => {},
    logToolUse: () => {},
    logToolResult: () => {},
    finalize: async () => {},
    timestampedName: "test",
    bareIdentifier: "test",
  };
}

function yieldResult(fields: {
  stop_reason?: string | null;
  num_turns?: number;
  is_error?: boolean;
}) {
  queryMock.mockReturnValue(
    (async function* () {
      yield {
        type: "result",
        session_id: "sess-1",
        stop_reason: fields.stop_reason ?? "end_turn",
        num_turns: fields.num_turns ?? 1,
        is_error: fields.is_error ?? false,
      };
    })(),
  );
}

let logOutput: string[] = [];
let errOutput: string[] = [];
const origLog = console.log;
const origErr = console.error;

beforeEach(() => {
  // setLogLevel is global state; set it here and restore the default in
  // afterEach so this file never leaks a "debug" level into sibling tests.
  setLogLevel("debug");
  logOutput = [];
  errOutput = [];
  console.log = (msg?: unknown) => {
    logOutput.push(String(msg));
  };
  console.error = (msg?: unknown) => {
    errOutput.push(String(msg));
  };
});

afterEach(() => {
  setLogLevel("normal");
  console.log = origLog;
  console.error = origErr;
  queryMock.mockReset();
});

describe("processAgentStream diagnostic logging", () => {
  test("emits debug log on normal end_turn result", async () => {
    yieldResult({ stop_reason: "end_turn", num_turns: 3 });
    await processAgentStream("p", {} as never, "EVALUATOR", "debug", makeConvLog(), undefined, queryMock);
    const joined = [...logOutput, ...errOutput].join("\n");
    expect(joined).toContain("SDK result: stop_reason=end_turn num_turns=3");
    expect(joined).not.toContain("WARNING");
  });

  test("warns on stop_reason=max_tokens", async () => {
    yieldResult({ stop_reason: "max_tokens", num_turns: 2 });
    await processAgentStream("p", {} as never, "EVALUATOR", "normal", makeConvLog(), undefined, queryMock);
    const joined = [...logOutput, ...errOutput].join("\n");
    expect(joined).toContain("WARNING: SDK result");
    expect(joined).toContain("stop_reason=max_tokens");
  });

  test("warns when num_turns approaches CLAUDE_MAX_TURNS", async () => {
    yieldResult({ stop_reason: "end_turn", num_turns: CLAUDE_MAX_TURNS - 1 });
    await processAgentStream("p", {} as never, "EVALUATOR", "normal", makeConvLog(), undefined, queryMock);
    const joined = [...logOutput, ...errOutput].join("\n");
    expect(joined).toContain("WARNING");
    expect(joined).toContain(`num_turns=${CLAUDE_MAX_TURNS - 1}/${CLAUDE_MAX_TURNS}`);
  });

  test("warns on is_error=true", async () => {
    yieldResult({ stop_reason: "end_turn", num_turns: 1, is_error: true });
    await processAgentStream("p", {} as never, "EVALUATOR", "normal", makeConvLog(), undefined, queryMock);
    const joined = [...logOutput, ...errOutput].join("\n");
    expect(joined).toContain("WARNING");
    expect(joined).toContain("is_error=true");
  });

  test("no result message means no sdkResult and no diagnostic log", async () => {
    queryMock.mockReturnValue(
      (async function* () {
        // no messages
      })(),
    );
    const res = await processAgentStream("p", {} as never, "EVALUATOR", "debug", makeConvLog(), undefined, queryMock);
    expect(res.sdkResult).toBeUndefined();
    const joined = [...logOutput, ...errOutput].join("\n");
    expect(joined).not.toContain("SDK result:");
  });
});
