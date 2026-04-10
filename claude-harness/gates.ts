import { readFile as readFileRaw } from "node:fs/promises";
import { join } from "node:path";
import { harnessDir, writeSpec } from "../shared/files.ts";
import { promptGateWithText } from "../shared/interaction.ts";
import { log } from "../shared/logger.ts";
import type { AgentSkills } from "../shared/skills.ts";
import type { Span } from "../shared/tracing.ts";
import type { HarnessConfig } from "../shared/types.ts";
import type { UsageTracker } from "../shared/usage.ts";
import { UserAbortError } from "./error-handling.ts";
import { runPlanner } from "./planner.ts";

export async function specApprovalGate(
  config: HarnessConfig,
  spec: string,
  parentSpan: Span,
  usage: UsageTracker,
  plannerSkills?: AgentSkills,
): Promise<string> {
  const specPath = join(harnessDir(config.workDir), "spec.md");

  // --gate-timeout 0 means "skip all gates, auto-approve"
  if (config.gateTimeout === 0) {
    log("HARNESS", "Spec gate skipped (--gate-timeout 0). Auto-approved.");
    return spec;
  }

  // Non-interactive: auto-approve
  if (!(config.interactive ?? true)) {
    log("HARNESS", "Spec gate skipped (non-interactive mode). Auto-approved.");
    return spec;
  }

  const timeoutSec = config.gateTimeout ?? 120;

  // Build options — hide Edit if no editor configured
  const options: import("../shared/interaction.ts").GateOption[] = [
    { key: "a", label: "Approve — proceed to building", isDefault: false },
    ...(config.editor ? [{ key: "e", label: `Edit — open in ${config.editor.split(" ")[0]}`, isDefault: false }] : []),
    { key: "r", label: "Revise — give feedback, planner rewrites", isDefault: false },
    { key: "x", label: "Abort", isDefault: true }, // Default on timeout = abort (safe)
    { key: "w", label: "Wait — pause timer", isDefault: false },
  ];

  let currentSpec = spec;

  while (true) {
    const result = await promptGateWithText(
      `Spec written to .adhd/spec.md`,
      options,
      timeoutSec,
      config.interactive ?? true,
      "r", // "revise" triggers free-text input
    );

    if (result.key === "a") {
      return currentSpec;
    }

    if (result.key === "x" || result.timedOut) {
      log("HARNESS", "Spec gate: aborted. Spec saved at .adhd/spec.md");
      log("HARNESS", "To resume: adhd --resume");
      throw new UserAbortError("Spec gate aborted");
    }

    if (result.key === "e" && config.editor) {
      // Open editor, block until closed
      const { execSync } = await import("node:child_process");
      execSync(`${config.editor} ${JSON.stringify(specPath)}`, { stdio: "inherit" });
      // Read back the (possibly modified) spec
      currentSpec = await readFileRaw(specPath, "utf-8");
      await writeSpec(config.workDir, currentSpec);
      log("HARNESS", `Spec updated (${currentSpec.length} chars). Re-reviewing.`);
      continue;
    }

    if (result.key === "r" && result.freeText) {
      // Re-run planner with feedback
      log("HARNESS", "Re-running planner with your feedback...");
      const revisionSpan = parentSpan.startChild("planner-revision");
      const revisedSpec = await revisionSpan.run(() => runPlanner(config, result.freeText, usage, plannerSkills));
      revisionSpan.end();
      currentSpec = revisedSpec;
      await writeSpec(config.workDir, currentSpec);
      log("HARNESS", "Spec revised. Re-reviewing.");
    }
  }
}
