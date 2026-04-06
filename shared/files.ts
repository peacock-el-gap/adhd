import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { access, mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { EvalResult, HarnessProgress, SprintContract } from "./types.ts";

/** Resolve the .harness metadata directory for a given project root. */
export function harnessDir(workDir: string): string {
  return join(workDir, ".harness");
}

/**
 * Initialize workspace for a harness run.
 *
 * @param workDir - Project root directory
 * @param options.greenfield - If true, create app/ with git init.
 *   Defaults to true when no options are provided (legacy/codex-harness compat).
 *   Claude-harness always passes this explicitly.
 * @param options.resume - If true, skip all cleanup of existing artifacts
 */
export async function initWorkspace(
  workDir: string,
  options?: { greenfield?: boolean; resume?: boolean },
): Promise<void> {
  // Default to greenfield when called without options (backward compat for codex-harness)
  const greenfield = options?.greenfield ?? options === undefined;
  const resume = options?.resume ?? false;

  const hDir = harnessDir(workDir);

  // Always ensure .harness/ structure exists
  await mkdir(join(hDir, "contracts"), { recursive: true });
  await mkdir(join(hDir, "feedback"), { recursive: true });
  await mkdir(join(hDir, "logs"), { recursive: true });

  // Greenfield mode: create app/ with git init
  if (greenfield) {
    const appDir = join(workDir, "app");
    await mkdir(appDir, { recursive: true });
    const gitDir = join(appDir, ".git");
    try {
      await access(gitDir);
    } catch {
      try {
        execSync('git init && git commit --allow-empty -m "Initial commit"', {
          cwd: appDir,
          stdio: "ignore",
        });
      } catch (err) {
        console.warn(`Warning: failed to initialize git in ${appDir}: ${err}`);
      }
    }
  }

  // Clean stale artifacts (only inside .harness/), but NOT on resume
  if (!resume) {
    await cleanHarnessArtifacts(hDir);
  }

  // Advisory: check if .harness/ is in .gitignore
  checkGitignore(workDir);
}

/** Remove stale artifacts from .harness/ (contracts, feedback, spec, progress). */
async function cleanHarnessArtifacts(hDir: string): Promise<void> {
  // Clean contracts/
  await cleanDirectory(join(hDir, "contracts"));
  // Clean feedback/
  await cleanDirectory(join(hDir, "feedback"));
  // Remove spec and progress
  await safeUnlink(join(hDir, "spec.md"));
  await safeUnlink(join(hDir, "progress.json"));
}

async function cleanDirectory(dir: string): Promise<void> {
  try {
    const entries = await readdir(dir);
    for (const entry of entries) {
      await unlink(join(dir, entry));
    }
  } catch {
    // Directory doesn't exist yet — fine
  }
}

async function safeUnlink(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch {
    // File doesn't exist — fine
  }
}

function checkGitignore(workDir: string): void {
  const gitignorePath = join(workDir, ".gitignore");
  try {
    if (existsSync(gitignorePath)) {
      const content = readFileSync(gitignorePath, "utf-8");
      if (!content.includes(".harness")) {
        console.log("[HARNESS] Consider adding .harness/ to your .gitignore");
      }
    } else {
      console.log("[HARNESS] Consider adding .harness/ to your .gitignore");
    }
  } catch {
    // Not critical — skip silently
  }
}

// --- File I/O: all paths go through .harness/ ---

export async function writeSpec(workDir: string, spec: string): Promise<void> {
  await writeFile(join(harnessDir(workDir), "spec.md"), spec, "utf-8");
}

export async function readSpec(workDir: string): Promise<string> {
  return readFile(join(harnessDir(workDir), "spec.md"), "utf-8");
}

export async function writeContract(workDir: string, contract: SprintContract): Promise<void> {
  const path = join(harnessDir(workDir), "contracts", `sprint-${contract.sprintNumber}.json`);
  await writeFile(path, JSON.stringify(contract, null, 2), "utf-8");
}

export async function readContract(workDir: string, sprintNumber: number): Promise<SprintContract> {
  const path = join(harnessDir(workDir), "contracts", `sprint-${sprintNumber}.json`);
  const raw = await readFile(path, "utf-8");
  try {
    return JSON.parse(raw) as SprintContract;
  } catch {
    throw new Error(`Invalid JSON in contract file: ${path}`);
  }
}

export async function writeFeedback(
  workDir: string,
  sprintNumber: number,
  round: number,
  result: EvalResult,
): Promise<void> {
  const path = join(harnessDir(workDir), "feedback", `sprint-${sprintNumber}-round-${round}.json`);
  await writeFile(path, JSON.stringify(result, null, 2), "utf-8");
}

export async function readFeedback(workDir: string, sprintNumber: number, round: number): Promise<EvalResult> {
  const path = join(harnessDir(workDir), "feedback", `sprint-${sprintNumber}-round-${round}.json`);
  const raw = await readFile(path, "utf-8");
  try {
    return JSON.parse(raw) as EvalResult;
  } catch {
    throw new Error(`Invalid JSON in feedback file: ${path}`);
  }
}

export async function writeProgress(workDir: string, progress: HarnessProgress): Promise<void> {
  await writeFile(join(harnessDir(workDir), "progress.json"), JSON.stringify(progress, null, 2), "utf-8");
}

export async function readProgress(workDir: string): Promise<HarnessProgress> {
  const raw = await readFile(join(harnessDir(workDir), "progress.json"), "utf-8");
  try {
    return JSON.parse(raw) as HarnessProgress;
  } catch {
    throw new Error(`Invalid JSON in progress file: ${join(harnessDir(workDir), "progress.json")}`);
  }
}
