import { Codex } from "@openai/codex-sdk";
import { CODEX_MODEL, CODEX_NETWORK_ACCESS } from "../shared/config.ts";
import { log, logError } from "../shared/logger.ts";
import { PLANNER_SYSTEM_PROMPT } from "../shared/prompts.ts";

export async function runPlanner(userPrompt: string, workDir: string): Promise<string> {
  log("PLANNER", `Starting planning for: "${userPrompt}"`);

  const codex = new Codex();
  const thread = codex.startThread({
    workingDirectory: workDir,
    sandboxMode: "danger-full-access",
    networkAccessEnabled: CODEX_NETWORK_ACCESS,
    approvalPolicy: "never",
    model: CODEX_MODEL,
  });

  const fullPrompt = `${PLANNER_SYSTEM_PROMPT}\n\n---\n\nUser Request: ${userPrompt}`;

  const turn = await thread.run(fullPrompt);

  if (!turn.finalResponse) {
    logError("PLANNER", "Planner produced no output");
    throw new Error("Planner failed to produce output");
  }

  log("PLANNER", "Product specification generated");
  return turn.finalResponse;
}
