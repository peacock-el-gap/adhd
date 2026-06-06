import { readFile } from "node:fs/promises";
import { join } from "node:path";

const LINT_TYPECHECK_SCRIPT_KEYS = ["lint", "typecheck", "type-check"];
/** Ordered by priority — first match wins when multiple test scripts exist. */
export const TEST_SCRIPT_KEYS = ["test", "test:unit", "test:run"];
const MAX_OUTPUT_CHARS = 4000;

export interface StaticAnalysisCommand {
  name: string;
  script: string;
}

/**
 * Detect the canonical test command from a project's package.json scripts.
 * Returns the first matching test script in priority order, or null if none found.
 * Never throws — returns null on any read or parse error.
 * @param projectDir - The project directory containing package.json
 * @returns The detected test command, or null if not found
 */
export async function detectTestCommand(projectDir: string): Promise<StaticAnalysisCommand | null> {
  try {
    const raw = await readFile(join(projectDir, "package.json"), "utf-8");
    const pkg = JSON.parse(raw);
    if (!pkg.scripts || typeof pkg.scripts !== "object") return null;

    for (const key of TEST_SCRIPT_KEYS) {
      if (typeof pkg.scripts[key] === "string") {
        return { name: key, script: `npm run ${key}` };
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Detect lint/typecheck/test commands from a project's package.json scripts.
 * Returns an empty array if no package.json or no matching scripts.
 * Includes lint, typecheck, and the canonical test command when present.
 * @param projectDir - The project directory containing package.json
 * @returns Array of detected static analysis commands
 */
export async function detectStaticAnalysisCommands(projectDir: string): Promise<StaticAnalysisCommand[]> {
  try {
    const raw = await readFile(join(projectDir, "package.json"), "utf-8");
    const pkg = JSON.parse(raw);
    if (!pkg.scripts || typeof pkg.scripts !== "object") return [];

    const commands: StaticAnalysisCommand[] = [];
    for (const key of LINT_TYPECHECK_SCRIPT_KEYS) {
      if (typeof pkg.scripts[key] === "string") {
        commands.push({ name: key, script: `npm run ${key}` });
      }
    }

    // Include the canonical test command when present
    const testCmd = await detectTestCommand(projectDir);
    if (testCmd) {
      commands.push(testCmd);
    }

    return commands;
  } catch {
    return [];
  }
}

/**
 * Truncate static analysis output to MAX_OUTPUT_CHARS with a warning message.
 * If the output is within the limit, it is returned unchanged.
 * @param output - The raw static analysis output string
 * @returns The original output if within limits, or truncated output with a warning appended
 */
export function truncateStaticAnalysisOutput(output: string): string {
  if (output.length <= MAX_OUTPUT_CHARS) return output;
  const truncated = output.slice(0, MAX_OUTPUT_CHARS);
  return `${truncated}\n[output truncated — showing first ${MAX_OUTPUT_CHARS} chars of ${output.length} total]`;
}
