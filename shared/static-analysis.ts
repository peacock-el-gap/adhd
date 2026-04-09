import { readFile } from "node:fs/promises";
import { join } from "node:path";

const SCRIPT_KEYS = ["lint", "typecheck", "type-check"];
const MAX_OUTPUT_CHARS = 4000;

export interface StaticAnalysisCommand {
  name: string;
  script: string;
}

/**
 * Detect lint/typecheck commands from a project's package.json scripts.
 * Returns an empty array if no package.json or no matching scripts.
 */
export async function detectStaticAnalysisCommands(projectDir: string): Promise<StaticAnalysisCommand[]> {
  try {
    const raw = await readFile(join(projectDir, "package.json"), "utf-8");
    const pkg = JSON.parse(raw);
    if (!pkg.scripts || typeof pkg.scripts !== "object") return [];

    const commands: StaticAnalysisCommand[] = [];
    for (const key of SCRIPT_KEYS) {
      if (typeof pkg.scripts[key] === "string") {
        commands.push({ name: key, script: `npm run ${key}` });
      }
    }
    return commands;
  } catch {
    return [];
  }
}

/**
 * Truncate static analysis output to MAX_OUTPUT_CHARS with a warning message.
 * If the output is within the limit, it is returned unchanged.
 */
export function truncateStaticAnalysisOutput(output: string): string {
  if (output.length <= MAX_OUTPUT_CHARS) return output;
  const truncated = output.slice(0, MAX_OUTPUT_CHARS);
  return `${truncated}\n[output truncated — showing first ${MAX_OUTPUT_CHARS} chars of ${output.length} total]`;
}
