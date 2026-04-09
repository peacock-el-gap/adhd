import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { log } from "./logger.ts";

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
      log("HARNESS", "WARNING: Documentation may be incomplete: README.md is very short.");
    }
  } else {
    log("HARNESS", "WARNING: Documenter did not create README.md.");
  }

  // Check CHANGELOG.md
  const changelogPath = join(docDir, "CHANGELOG.md");
  if (!existsSync(changelogPath)) {
    log("HARNESS", "WARNING: Documenter did not create CHANGELOG.md.");
  }
}
