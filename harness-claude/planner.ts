import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { harnessDir } from "../shared/files.ts";
import { log, logError } from "../shared/logger.ts";
import type { PlannerResult, RunPlannerOptions } from "../shared/orchestration/types.ts";
import { buildPlannerPrompt } from "../shared/prompts.ts";
import { buildToolPolicyInput, resolveToolPolicy } from "../shared/tool-policy.ts";
import { runAgent } from "./run-agent.ts";
import type { Options } from "./tracing-claude.ts";

export async function runPlanner(opts: RunPlannerOptions): Promise<PlannerResult> {
  const { config, identity, reviseFeedback, skills, supplementaryContext } = opts;
  const { userPrompt, workDir, isGreenfield, interactive, logLevel } = config;

  log("PLANNER", `Starting planning for: "${userPrompt.slice(0, 100)}${userPrompt.length > 100 ? "..." : ""}"`);

  const model = config.resolvedModelPlanner;
  let systemPrompt = buildPlannerPrompt({
    workDir,
    isGreenfield,
    sourceDir: config.sourceDir,
    testDir: config.testDir,
    noBdd: config.noBdd,
    skills,
  });

  if (!interactive) {
    systemPrompt +=
      "\n\nDo not ask questions. Make your best judgment on any ambiguous points and document your assumptions in the spec.";
  }

  const hDir = harnessDir(workDir);

  const tools: string[] = ["Read", "Write"];
  if (interactive) {
    tools.push("AskUserQuestion");
  }

  // Context injection — prepend reference documents to prompt
  let promptBody = userPrompt;
  if (config.contextFiles?.length) {
    const docs = config.contextFiles.map((f) => {
      const content = readFileSync(resolve(workDir, f), "utf-8");
      return `### ${basename(f)}\n\n\`\`\`\n${content}\n\`\`\``;
    });
    promptBody = `## Reference Documents\n\n${docs.join("\n\n")}\n\n## Task\n\n${userPrompt}`;
    log("PLANNER", `Injected ${config.contextFiles.length} context file(s) into prompt`);
  }

  let fullPrompt = `IMPORTANT: Your working directory is ${workDir}. Write the spec to ${hDir}/spec.md. Do NOT write files outside of ${workDir}.\n\n${promptBody}`;

  if (reviseFeedback) {
    fullPrompt += `\n\n## Revision Feedback\n\nThe user reviewed your spec and requests changes:\n\n${reviseFeedback}\n\nRewrite the spec incorporating this feedback.`;
  }

  // Inject supplementary context (e.g. harness-generated codebase map) after
  // the main prompt sections so the Planner does not re-explore from scratch.
  if (supplementaryContext) {
    fullPrompt += `\n\n${supplementaryContext}`;
  }

  const toolPolicy = resolveToolPolicy("PLANNER", buildToolPolicyInput(config));

  const result = await runAgent({
    identity,
    role: "PLANNER",
    workDir,
    prompt: fullPrompt,
    systemPrompt,
    model,
    tools,
    maxTurns: config.resolvedMaxTurnsPlanner,
    persistSession: false,
    logLevel,
    additionalDirectories: skills?.additionalDirs,
    canUseTool: interactive ? makePlannerInteractiveBridge() : undefined,
    toolPolicy,
    sessionDir: config.sessionDir,
    callbacks: {
      onResult: (r) => log("PLANNER", `Planning complete (session: ${r.session_id?.slice(0, 8)}...)`),
    },
  });

  if (!result.sdkResult) {
    logError("PLANNER", "Planner query did not complete");
    throw new Error("Planner failed to produce output");
  }

  // The planner writes spec.md via the Write tool — the file is the canonical output.
  // result.response contains narration text ("Let me examine..."), not the spec itself.
  // Always prefer the file on disk; fall back to result.response only if no file exists.
  let spec: string;
  try {
    spec = await readFile(join(hDir, "spec.md"), "utf-8");
    log("PLANNER", "Read spec from file written by planner agent");
  } catch {
    if (!result.response) {
      logError("PLANNER", "No text response and no spec.md on disk");
      throw new Error("Planner completed but produced no spec");
    }
    log("PLANNER", "Using text response as spec (no file on disk)");
    spec = result.response;
  }

  log("PLANNER", "Product specification generated");
  return { spec, sdkResult: result.sdkResult, sessionId: result.sessionId };
}

/**
 * Build the canUseTool callback that bridges Claude's AskUserQuestion tool
 * to terminal stdin. Only used in interactive mode. Times out after 60s
 * with a "best judgment" answer so a left-running session never hangs.
 */
function makePlannerInteractiveBridge(): NonNullable<Options["canUseTool"]> {
  return async (toolName, toolInput) => {
    if (toolName === "AskUserQuestion") {
      const question = typeof toolInput.question === "string" ? toolInput.question : String(toolInput.question ?? "");
      const BOLD_MAGENTA = "\x1b[1;35m";
      const RST = "\x1b[0m";
      process.stdout.write(`\n${BOLD_MAGENTA}[PLANNER asks]${RST} ${question}\n> `);

      const answer = await new Promise<string>((resolveAnswer) => {
        const timeout = setTimeout(() => {
          process.stdout.write("\n(timeout — proceeding with best judgment)\n");
          resolveAnswer("Proceed with your best judgment.");
        }, 60_000);

        const onData = (data: Buffer) => {
          clearTimeout(timeout);
          process.stdin.removeListener("data", onData);
          process.stdin.pause();
          resolveAnswer(data.toString().trim());
        };

        process.stdin.resume();
        process.stdin.once("data", onData);
      });

      return { behavior: "allow" as const, updatedInput: { ...toolInput, answer } };
    }
    return { behavior: "allow" as const };
  };
}
