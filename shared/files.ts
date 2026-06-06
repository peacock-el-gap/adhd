import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { access, mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { log } from "./logger.ts";
import { normalizeSurfaces } from "./surfaces.ts";
import type { EvalResult, HarnessProgress, SprintContract } from "./types.ts";
import type { VerificationResult } from "./verification.ts";

/** Resolve the .adhd metadata directory for a given project root. */
export function harnessDir(workDir: string): string {
  return join(workDir, ".adhd");
}

/**
 * Well-known artifact path for the cost ledger, relative to the project root.
 * Used both as a git-staging path and (joined with workDir) as a filesystem path.
 */
export const USAGE_FILE = ".adhd/usage.json";

/** Resolve the git working directory. In greenfield mode, code lives under app/. */
export function gitDir(workDir: string, isGreenfield: boolean): string {
  return isGreenfield ? join(workDir, "app") : workDir;
}

/**
 * Initialize workspace for a harness run.
 *
 * @param workDir - Project root directory
 * @param options.greenfield - If true, create app/ with git init.
 *   Defaults to true when no options are provided.
 * @param options.resume - If true, skip all cleanup of existing artifacts
 */
export async function initWorkspace(
  workDir: string,
  options?: { greenfield?: boolean; resume?: boolean },
): Promise<void> {
  // Default to greenfield when called without options
  const greenfield = options?.greenfield ?? options === undefined;
  const resume = options?.resume ?? false;

  const hDir = harnessDir(workDir);

  // Always ensure .adhd/ structure exists
  await mkdir(join(hDir, "contracts"), { recursive: true });
  await mkdir(join(hDir, "feedback"), { recursive: true });
  await mkdir(join(hDir, "logs"), { recursive: true });
  await mkdir(join(hDir, "skills", "installed"), { recursive: true });
  await mkdir(join(hDir, "skills", "local"), { recursive: true });

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

  // Clean stale artifacts (only inside .adhd/), but NOT on resume
  if (!resume) {
    await cleanHarnessArtifacts(hDir);
  }

  // Advisory: check if .adhd/ is in .gitignore
  checkGitignore(workDir);
}

/** Remove stale artifacts from .adhd/ (contracts, feedback, spec, progress). */
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
      if (!content.includes(".adhd")) {
        log("HARNESS", "Consider adding .adhd/ to your .gitignore");
      }
    } else {
      log("HARNESS", "Consider adding .adhd/ to your .gitignore");
    }
  } catch {
    // Not critical — skip silently
  }
}

// --- File I/O: all paths go through .adhd/ ---

export async function writeSpec(workDir: string, spec: string): Promise<void> {
  await writeFile(join(harnessDir(workDir), "spec.md"), spec, "utf-8");
}

export async function readSpec(workDir: string): Promise<string> {
  return readFile(join(harnessDir(workDir), "spec.md"), "utf-8");
}

/**
 * Serialize a contract with a stable, diff-friendly key order (matching the
 * convention used in usage.json). `surfaces` is only emitted when it is
 * actually present, so re-persisting a legacy contract never injects the field.
 */
function serializeContract(contract: SprintContract): Record<string, unknown> {
  const surfaces = normalizeSurfaces(contract.surfaces);
  const serialized: Record<string, unknown> = {
    sprintNumber: contract.sprintNumber,
    features: contract.features,
  };
  if (surfaces !== undefined) {
    serialized.surfaces = surfaces;
  }
  serialized.criteria = contract.criteria;
  return serialized;
}

export async function writeContract(workDir: string, contract: SprintContract): Promise<void> {
  const path = join(harnessDir(workDir), "contracts", `sprint-${contract.sprintNumber}.json`);
  await writeFile(path, JSON.stringify(serializeContract(contract), null, 2), "utf-8");
}

export async function readContract(workDir: string, sprintNumber: number): Promise<SprintContract> {
  const path = join(harnessDir(workDir), "contracts", `sprint-${sprintNumber}.json`);
  const raw = await readFile(path, "utf-8");
  let parsed: SprintContract;
  try {
    parsed = JSON.parse(raw) as SprintContract;
  } catch {
    throw new Error(`Invalid JSON in contract file: ${path}`);
  }
  // Degrade malformed/absent surfaces gracefully; never crash on a stored file.
  parsed.surfaces = normalizeSurfaces(parsed.surfaces);
  return parsed;
}

/**
 * Attempt to load an existing contract from disk for the given sprint.
 * Returns the contract if it exists and is valid, or null if the file
 * is missing, empty, or malformed. Used by both --resume and --sprint modes.
 */
export async function loadExistingContract(workDir: string, sprintNumber: number): Promise<SprintContract | null> {
  const path = join(harnessDir(workDir), "contracts", `sprint-${sprintNumber}.json`);
  try {
    const raw = await readFile(path, "utf-8");
    if (!raw.trim()) return null;
    const parsed = JSON.parse(raw);
    // Validate essential contract structure
    if (!parsed || !Array.isArray(parsed.criteria) || parsed.criteria.length === 0) {
      return null;
    }
    if (!Array.isArray(parsed.features)) {
      return null;
    }
    // Ensure sprintNumber matches
    parsed.sprintNumber = sprintNumber;
    // Degrade malformed/absent surfaces gracefully; never crash on a stored file.
    parsed.surfaces = normalizeSurfaces(parsed.surfaces);
    return parsed as SprintContract;
  } catch {
    return null;
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

/**
 * Persist a pre-Generator verification baseline for a sprint as run metadata
 * under `.adhd/`. This file is not committed to the project repository by
 * default — it is harness-internal metadata consumed by later stages (e.g.
 * Sprint 3 injection). Overwrites any existing baseline for the same sprint.
 *
 * Never throws; a write failure is silently swallowed so the sprint attempt
 * can continue (the baseline is advisory metadata, not load-bearing state).
 */
export async function writeBaselineVerification(
  workDir: string,
  sprintNumber: number,
  baseline: VerificationResult,
): Promise<void> {
  try {
    const path = join(harnessDir(workDir), `baseline-verification-sprint-${sprintNumber}.json`);
    await writeFile(path, JSON.stringify(baseline, null, 2), "utf-8");
  } catch {
    // Non-fatal: baseline storage is metadata only; proceed without it.
  }
}
