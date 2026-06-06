import { gitDir } from "../files.ts";
import { detectStaticAnalysisCommands, TEST_SCRIPT_KEYS, truncateStaticAnalysisOutput } from "../static-analysis.ts";
import type { ResolvedConfig } from "../types.ts";

export interface StaticAnalysisResult {
  output: string;
  failed: boolean;
}

export async function runStaticAnalysis(config: ResolvedConfig): Promise<StaticAnalysisResult> {
  const projectDir = gitDir(config.workDir, config.isGreenfield);
  let commands: Awaited<ReturnType<typeof detectStaticAnalysisCommands>>;
  try {
    commands = await detectStaticAnalysisCommands(projectDir);
  } catch {
    return { output: "", failed: false };
  }

  // Test commands are handled by the verification runner — exclude them here
  // so the static analysis runner only runs lint/typecheck as before.
  const lintTypecheckCommands = commands.filter((cmd) => !TEST_SCRIPT_KEYS.includes(cmd.name));

  if (lintTypecheckCommands.length === 0) {
    return { output: "", failed: false };
  }

  let combinedOutput = "";
  let anyFailed = false;

  for (const cmd of lintTypecheckCommands) {
    try {
      const result = Bun.spawnSync(["sh", "-c", cmd.script], {
        cwd: projectDir,
        env: { ...process.env },
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdout = result.stdout.toString();
      const stderr = result.stderr.toString();
      const exitCode = result.exitCode;

      if (exitCode !== 0) anyFailed = true;

      combinedOutput += `### ${cmd.name} (exit code: ${exitCode})\n`;
      if (stdout) combinedOutput += stdout;
      if (stderr) combinedOutput += stderr;
      combinedOutput += "\n";
    } catch (err) {
      combinedOutput += `### ${cmd.name} (execution error)\n${err}\n`;
      anyFailed = true;
    }
  }

  return {
    output: truncateStaticAnalysisOutput(combinedOutput.trim()),
    failed: anyFailed,
  };
}
