import { readFile as readFileRaw } from "node:fs/promises";
import { join } from "node:path";
import { makeIdentity, timedName } from "../agent-identity.ts";
import { harnessDir, writeSpec } from "../files.ts";
import { promptGateWithText } from "../interaction.ts";
import { log, logWarn } from "../logger.ts";
import { notify } from "../notifications.ts";
import type { AgentSkills } from "../skills.ts";
import type { Span } from "../tracing.ts";
import type { ResolvedConfig } from "../types.ts";
import type { UsageTracker } from "../usage.ts";
import { UserAbortError } from "./error-handling.ts";
import type { PlannerFn } from "./types.ts";

// ── Exported helpers (also tested in isolation) ─────────────────────────────

type SyncExecFn = (cmd: string, opts: { stdio: "inherit" }) => void;

/**
 * Try to open an external editor for a spec file.
 *
 * Returns `{ success: true }` when the editor exits cleanly, or
 * `{ success: false, message }` when the editor could not be launched or
 * exited with an error — so the caller can show the message and return the
 * operator to the gate instead of crashing the run.
 *
 * Re-throws anything that is not an `Error` instance (genuinely unexpected).
 *
 * Exported for unit testing.
 */
export function tryExecEditor(
  editor: string,
  specPath: string,
  execFn: SyncExecFn,
): { success: true } | { success: false; message: string } {
  try {
    execFn(`${editor} ${JSON.stringify(specPath)}`, { stdio: "inherit" });
    return { success: true };
  } catch (err) {
    if (err instanceof Error) {
      const editorName = editor.split(" ")[0] ?? editor;
      return {
        success: false,
        message: `Could not open editor "${editorName}": ${err.message}. Check the EDITOR environment variable or choose a different option.`,
      };
    }
    throw err; // Re-throw non-Error (genuinely unexpected)
  }
}

/**
 * Classify a "revise" submission from the spec-approval gate.
 *
 * Returns `{ proceed: true }` when the operator provided non-empty feedback,
 * or `{ proceed: false, message }` when the submission was empty so the gate
 * can show the message and re-present its options instead of silently looping.
 *
 * Exported for unit testing.
 */
export type ReviseClassification = { proceed: true } | { proceed: false; message: string };

export function classifyReviseInput(freeText: string | undefined): ReviseClassification {
  if (!freeText) {
    return {
      proceed: false,
      message: "No feedback was entered. Please type your feedback so the planner can revise the spec.",
    };
  }
  return { proceed: true };
}

// ── Gate ─────────────────────────────────────────────────────────────────────

export async function specApprovalGate(
  config: ResolvedConfig,
  spec: string,
  parentSpan: Span,
  usage: UsageTracker,
  plannerFn: PlannerFn,
  plannerSkills?: AgentSkills,
): Promise<string> {
  const specPath = join(harnessDir(config.workDir), "spec.md");

  // --gate-timeout 0 means "skip all gates, auto-approve"
  if (config.gateTimeout === 0) {
    log("HARNESS", "Spec gate skipped (--gate-timeout 0). Auto-approved.");
    return spec;
  }

  // Non-interactive: auto-approve
  if (!config.interactive) {
    log("HARNESS", "Spec gate skipped (non-interactive mode). Auto-approved.");
    return spec;
  }

  const timeoutSec = config.gateTimeout ?? 120;

  // Build options — hide Edit if no editor configured
  const options: import("../interaction.ts").GateOption[] = [
    { key: "a", label: "Approve — proceed to building", isDefault: false },
    ...(config.editor ? [{ key: "e", label: `Edit — open in ${config.editor.split(" ")[0]}`, isDefault: false }] : []),
    { key: "r", label: "Revise — give feedback, planner rewrites", isDefault: false },
    { key: "x", label: "Abort", isDefault: true }, // Default on timeout = abort (safe)
    { key: "w", label: "Wait — pause timer", isDefault: false },
  ];

  let currentSpec = spec;

  while (true) {
    notify("Spec approval gate — review required", { notify: config.notify });
    const result = await promptGateWithText(
      `Spec written to .adhd/spec.md`,
      options,
      timeoutSec,
      config.interactive,
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
      const editorResult = tryExecEditor(config.editor, specPath, (cmd, opts) => execSync(cmd, opts));
      if (!editorResult.success) {
        logWarn("HARNESS", editorResult.message);
        continue; // Return operator to the gate
      }
      // Read back the (possibly modified) spec
      currentSpec = await readFileRaw(specPath, "utf-8");
      await writeSpec(config.workDir, currentSpec);
      log("HARNESS", `Spec updated (${currentSpec.length} chars). Re-reviewing.`);
      continue;
    }

    if (result.key === "r") {
      const revise = classifyReviseInput(result.freeText);
      if (!revise.proceed) {
        log("HARNESS", revise.message);
        continue; // Re-present the gate options
      }
      // Re-run planner with feedback
      log("HARNESS", "Re-running planner with your feedback...");
      const revisionIdentity = makeIdentity({ role: "planner", variant: "revision" });
      const revisionSpan = parentSpan.startChild(timedName(revisionIdentity));
      const revisionResult = await revisionSpan.run(() =>
        plannerFn({ config, identity: revisionIdentity, reviseFeedback: result.freeText, skills: plannerSkills }),
      );
      if (revisionResult.sdkResult) {
        usage.recordStage("planner-revision", config.resolvedModelPlanner, revisionResult.sdkResult);
      }
      revisionSpan.end();
      currentSpec = revisionResult.spec;
      await writeSpec(config.workDir, currentSpec);
      log("HARNESS", "Spec revised. Re-reviewing.");
    }
  }
}
