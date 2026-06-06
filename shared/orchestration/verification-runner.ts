import type { VerificationResult } from "../verification.ts";
import {
  buildErrorVerificationResult,
  buildVerificationResult,
  detectTestCommand,
  VERIFICATION_NO_OP,
} from "../verification.ts";

/**
 * Synchronous command executor signature.
 * Returns the combined stdout, stderr, and exit code for a shell command.
 * The default implementation uses Bun.spawnSync; tests inject a mock.
 */
export type CommandExecutor = (cmd: string, cwd: string) => { stdout: string; stderr: string; exitCode: number };

/**
 * Per-attempt verification runner.
 * Executes the project's canonical test command at most once; all subsequent
 * calls to run() return the same cached result without re-spawning.
 */
export interface VerificationRunner {
  run(projectDir: string): Promise<VerificationResult>;
}

/**
 * Create a new VerificationRunner for a single attempt.
 *
 * The runner:
 * - Detects the test command from package.json.
 * - Runs it exactly once via the provided (or default Bun) executor.
 * - Caches the result so repeat calls within the same attempt are free.
 * - Degrades gracefully: returns VERIFICATION_NO_OP when no test command is
 *   found, and a failed result when the command errors, without throwing.
 *
 * @param executor - Optional override for the spawn function (for testing).
 */
export function createVerificationRunner(executor?: CommandExecutor): VerificationRunner {
  let cached: VerificationResult | null = null;

  return {
    async run(projectDir: string): Promise<VerificationResult> {
      // Return cached result on repeated calls within the same attempt
      if (cached !== null) return cached;

      // Detect the canonical test command
      const testCmd = await detectTestCommand(projectDir);
      if (!testCmd) {
        cached = VERIFICATION_NO_OP;
        return cached;
      }

      // Execute via injected executor (tests) or Bun.spawnSync (production)
      const spawn = executor ?? bunExecutor;
      try {
        const { stdout, stderr, exitCode } = spawn(testCmd.script, projectDir);
        const combined = [stdout, stderr].filter(Boolean).join("\n");
        cached = buildVerificationResult(combined, exitCode);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        cached = buildErrorVerificationResult(message);
      }

      return cached;
    },
  };
}

// ---------------------------------------------------------------------------
// Default executor (Bun runtime)
// ---------------------------------------------------------------------------

function bunExecutor(cmd: string, cwd: string): { stdout: string; stderr: string; exitCode: number } {
  const result = Bun.spawnSync(["sh", "-c", cmd], {
    cwd,
    env: { ...process.env },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    exitCode: result.exitCode ?? 1,
  };
}
