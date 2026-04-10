import { join } from "node:path";
import { detectStaticAnalysisCommands, truncateStaticAnalysisOutput } from "../shared/static-analysis.ts";
import type { ResolvedConfig } from "../shared/types.ts";

export interface StaticAnalysisResult {
  output: string;
  failed: boolean;
}

export async function runStaticAnalysis(config: ResolvedConfig): Promise<StaticAnalysisResult> {
  const isGreenfield = config.isGreenfield;
  const projectDir = isGreenfield ? join(config.workDir, "app") : config.workDir;
  let commands: Awaited<ReturnType<typeof detectStaticAnalysisCommands>>;
  try {
    commands = await detectStaticAnalysisCommands(projectDir);
  } catch {
    return { output: "", failed: false };
  }

  if (commands.length === 0) {
    return { output: "", failed: false };
  }

  let combinedOutput = "";
  let anyFailed = false;

  for (const cmd of commands) {
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
