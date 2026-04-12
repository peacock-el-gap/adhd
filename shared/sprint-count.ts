/**
 * Count the number of sprint headings in a spec.
 *
 * Only matches `## Sprint N` headings that start at column 1 (line-start anchored).
 * Inline prose references, blockquoted headings, or indented lines are NOT counted.
 */
export function countSprintHeadings(spec: string): number {
  // Anchored to line start with ^ and multiline flag m.
  // This prevents matching sprint references in prose, blockquotes, or indented text.
  const matches = spec.match(/^##\s*Sprint\s+\d+/gim);
  return matches ? matches.length : 0;
}
