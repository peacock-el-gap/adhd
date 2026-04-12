import { describe, expect, test } from "bun:test";
import { countSprintHeadings } from "../shared/sprint-count.ts";

describe("countSprintHeadings", () => {
  test("counts standard line-start headings", () => {
    const spec = `# My Spec

## Sprint 1
Some content.

## Sprint 2
More content.

## Sprint 3
Even more.

## Sprint 4
Final content.
`;
    expect(countSprintHeadings(spec)).toBe(4);
  });

  test("does not count inline prose references to sprints", () => {
    const spec = `## Sprint 1
Content for sprint 1.

## Sprint 2
This builds on Sprint 3 features and uses Sprint 4 patterns.
`;
    expect(countSprintHeadings(spec)).toBe(2);
  });

  test("does not count blockquoted sprint headings", () => {
    const spec = `## Sprint 1
Content.

## Sprint 2
Content.

> ## Sprint 3
> This is a blockquote referencing a sprint heading.
`;
    expect(countSprintHeadings(spec)).toBe(2);
  });

  test("does not count indented sprint headings", () => {
    const spec = `## Sprint 1
Content.

## Sprint 2
Content.

  ## Sprint 3
  This is indented.
`;
    expect(countSprintHeadings(spec)).toBe(2);
  });

  test("does not count backtick-quoted sprint references", () => {
    const spec = `## Sprint 1
Content.

## Sprint 2
Refer to \`## Sprint 3\` in the acceptance criteria.
`;
    expect(countSprintHeadings(spec)).toBe(2);
  });

  test("handles acceptance criteria mentioning sprint numbers", () => {
    const spec = `## Sprint 1
Feature A.

## Sprint 2
Feature B that builds on Sprint 1 features.
- Acceptance: "builds on Sprint 1 features"
- Also references Sprint 3 in the description.
`;
    expect(countSprintHeadings(spec)).toBe(2);
  });

  test("returns 0 for spec with no sprint headings", () => {
    const spec = `# My Spec

## Features
Some feature list.
`;
    expect(countSprintHeadings(spec)).toBe(0);
  });

  test("handles case-insensitive matching", () => {
    const spec = `## sprint 1
Content.

## SPRINT 2
Content.
`;
    expect(countSprintHeadings(spec)).toBe(2);
  });

  test("handles varied whitespace between ## and Sprint", () => {
    const spec = `##Sprint 1
Content.

##  Sprint 2
Content.
`;
    expect(countSprintHeadings(spec)).toBe(2);
  });

  test("inline heading-like text in acceptance criteria is not counted", () => {
    const spec = `## Sprint 1

Some feature.

## Sprint 2

### Acceptance scenarios
- Given a spec containing \`Sprint 1\`, \`Sprint 2\`, and prose text mentioning \`Sprint 3\` (even with markdown heading level 2 \`##\`) inside a blockquote or inline context
- When the harness counts sprints from the spec
- Then the total sprint count is 2
`;
    expect(countSprintHeadings(spec)).toBe(2);
  });
});
