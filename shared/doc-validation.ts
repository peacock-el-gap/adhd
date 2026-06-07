import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { logWarn } from "./logger.ts";

export const MIN_README_LENGTH = 200;

/**
 * Validate that the Documenter produced meaningful documentation.
 * Advisory only — never throws. Logs warnings for missing or short files.
 */
export function validateDocumentation(docDir: string): void {
  // Check README.md
  const readmePath = join(docDir, "README.md");
  if (existsSync(readmePath)) {
    const content = readFileSync(readmePath, "utf-8");
    if (content.length < MIN_README_LENGTH) {
      logWarn("HARNESS", "Documentation may be incomplete: README.md is very short.");
    }
  } else {
    logWarn("HARNESS", "Documenter did not create README.md.");
  }

  // Check CHANGELOG.md
  const changelogPath = join(docDir, "CHANGELOG.md");
  if (!existsSync(changelogPath)) {
    logWarn("HARNESS", "Documenter did not create CHANGELOG.md.");
  }
}
