import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseLocalSkill,
  parseSkillYaml,
  resolveSkills,
  routeSkillsForAgent,
  scanSkillsDir,
} from "../shared/skills.ts";
import type { AgentSkills, ResolvedSkill } from "../shared/skills.ts";
import { validateDocumentation } from "../shared/doc-validation.ts";

// ── Helpers ────────────────────────────────────────────────────────

let tmpBase: string;

function makeTmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "adhd-sprint3-test-"));
  mkdirSync(dir, { recursive: true });
  return dir;
}

beforeEach(() => {
  tmpBase = makeTmp();
});

afterEach(() => {
  rmSync(tmpBase, { recursive: true, force: true });
});

function makeSkill(overrides: Partial<ResolvedSkill> & { name: string }): ResolvedSkill {
  return {
    source: "harness",
    routing: {
      planner: { tier: "exclude", files: [] },
      generator: { tier: "exclude", files: [] },
      evaluator: { tier: "exclude", files: [] },
      documenter: { tier: "exclude", files: [] },
    },
    ...overrides,
  };
}

// =====================================================
// Feature 8: Skills Integration for Documenter
// =====================================================

describe("parseSkillYaml recognizes documenter agent", () => {
  test("parses documenter with inject tier and files", () => {
    const yaml = `name: doc-style
routing:
  planner: exclude
  generator: exclude
  evaluator: exclude
  documenter:
    tier: inject
    files: [style-guide.md]`;

    const manifest = parseSkillYaml(yaml);
    expect(manifest.routing.documenter).toBeDefined();
    expect(manifest.routing.documenter?.tier).toBe("inject");
    expect(manifest.routing.documenter?.files).toEqual(["style-guide.md"]);
  });

  test("parses documenter with exclude shorthand", () => {
    const yaml = `name: no-docs
routing:
  planner:
    tier: inject
    files: [guide.md]
  generator: exclude
  evaluator: exclude
  documenter: exclude`;

    const manifest = parseSkillYaml(yaml);
    expect(manifest.routing.documenter?.tier).toBe("exclude");
  });

  test("fills missing documenter as exclude", () => {
    const yaml = `name: minimal
routing:
  planner:
    tier: inject
    files: [guide.md]`;

    const manifest = parseSkillYaml(yaml);
    expect(manifest.routing.documenter?.tier).toBe("exclude");
  });

  test("parses documenter with reference tier", () => {
    const yaml = `name: ref-docs
routing:
  planner: exclude
  generator: exclude
  evaluator: exclude
  documenter:
    tier: reference
    files: [template.md, conventions.md]`;

    const manifest = parseSkillYaml(yaml);
    expect(manifest.routing.documenter?.tier).toBe("reference");
    expect(manifest.routing.documenter?.files).toEqual(["template.md", "conventions.md"]);
  });
});

describe("parseLocalSkill supports documenter agent", () => {
  test("default agents includes documenter", () => {
    const md = `---
name: My Skill
tier: inject
---
Content.`;
    const skill = parseLocalSkill(md, "/tmp/my-skill.md");
    expect(skill.routing.documenter).toBeDefined();
    expect(skill.routing.documenter.tier).toBe("inject");
    expect(skill.routing.documenter.content).toEqual([md]);
  });

  test("agents: [documenter, generator] routes to both", () => {
    const md = `---
name: Doc Style
agents: [documenter, generator]
tier: inject
---
Style guide content.`;
    const skill = parseLocalSkill(md, "/tmp/doc-style.md");
    expect(skill.routing.documenter.tier).toBe("inject");
    expect(skill.routing.generator.tier).toBe("inject");
    expect(skill.routing.planner.tier).toBe("exclude");
    expect(skill.routing.evaluator.tier).toBe("exclude");
  });

  test("agents: [planner] excludes documenter", () => {
    const md = `---
name: Planner Only
agents: [planner]
tier: inject
---
Content.`;
    const skill = parseLocalSkill(md, "/tmp/planner-only.md");
    expect(skill.routing.documenter.tier).toBe("exclude");
    expect(skill.routing.planner.tier).toBe("inject");
  });

  test("agents: [documenter] with reference tier", () => {
    const md = `---
name: Doc Template
agents: [documenter]
tier: reference
---
Template content.`;
    const skill = parseLocalSkill(md, "/tmp/doc-template.md");
    expect(skill.routing.documenter.tier).toBe("reference");
    expect(skill.routing.documenter.files).toEqual(["/tmp/doc-template.md"]);
    expect(skill.routing.documenter.content).toBeUndefined();
  });
});

describe("resolveSkills loads documenter inject content", () => {
  test("loads inject-tier content for documenter-targeted skills", () => {
    const dir = join(tmpBase, "skills");
    mkdirSync(join(dir, "doc-skill"), { recursive: true });
    writeFileSync(
      join(dir, "doc-skill", "skill.yaml"),
      `name: doc-skill
routing:
  planner: exclude
  generator: exclude
  evaluator: exclude
  documenter:
    tier: inject
    files: [guide.md]`,
    );
    writeFileSync(join(dir, "doc-skill", "guide.md"), "Documentation guide content");

    const empty = join(tmpBase, "empty");
    mkdirSync(empty, { recursive: true });

    const skills = resolveSkills(dir, empty, empty);
    expect(skills).toHaveLength(1);
    expect(skills[0]!.routing.documenter.tier).toBe("inject");
    expect(skills[0]!.routing.documenter.content).toEqual(["Documentation guide content"]);
  });

  test("resolveExternalSkill populates documenter routing from skill.yaml", () => {
    const dir = join(tmpBase, "skills");
    const skillDir = join(dir, "full-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "skill.yaml"),
      `name: full-skill
routing:
  planner:
    tier: inject
    files: [p.md]
  generator:
    tier: inject
    files: [g.md]
  evaluator:
    tier: reference
    files: [e.md]
  documenter:
    tier: inject
    files: [d.md]`,
    );
    writeFileSync(join(skillDir, "p.md"), "planner");
    writeFileSync(join(skillDir, "g.md"), "generator");
    writeFileSync(join(skillDir, "e.md"), "evaluator");
    writeFileSync(join(skillDir, "d.md"), "documenter content");

    const empty = join(tmpBase, "empty");
    mkdirSync(empty, { recursive: true });

    const skills = resolveSkills(dir, empty, empty);
    expect(skills[0]!.routing.documenter.tier).toBe("inject");
    expect(skills[0]!.routing.documenter.content).toEqual(["documenter content"]);
  });
});

describe("routeSkillsForAgent for documenter", () => {
  test("documenter: exclude returns empty skills", () => {
    const skills: ResolvedSkill[] = [
      makeSkill({
        name: "excluded",
        routing: {
          planner: { tier: "inject", files: ["/a.md"], content: ["Content"] },
          generator: { tier: "exclude", files: [] },
          evaluator: { tier: "exclude", files: [] },
          documenter: { tier: "exclude", files: [] },
        },
      }),
    ];

    const result = routeSkillsForAgent(skills, "documenter");
    expect(result.injected).toBe("");
    expect(result.referenceManifest).toBe("");
    expect(result.additionalDirs).toEqual([]);
  });

  test("documenter: inject returns concatenated content", () => {
    const skills: ResolvedSkill[] = [
      makeSkill({
        name: "doc-a",
        routing: {
          planner: { tier: "exclude", files: [] },
          generator: { tier: "exclude", files: [] },
          evaluator: { tier: "exclude", files: [] },
          documenter: { tier: "inject", files: ["/a.md"], content: ["Doc style A"] },
        },
      }),
      makeSkill({
        name: "doc-b",
        routing: {
          planner: { tier: "exclude", files: [] },
          generator: { tier: "exclude", files: [] },
          evaluator: { tier: "exclude", files: [] },
          documenter: { tier: "inject", files: ["/b.md"], content: ["Doc style B"] },
        },
      }),
    ];

    const result = routeSkillsForAgent(skills, "documenter");
    expect(result.injected).toBe("Doc style A\n\nDoc style B");
  });

  test("documenter: reference returns manifest and dirs", () => {
    const skills: ResolvedSkill[] = [
      makeSkill({
        name: "ref-skill",
        routing: {
          planner: { tier: "exclude", files: [] },
          generator: { tier: "exclude", files: [] },
          evaluator: { tier: "exclude", files: [] },
          documenter: { tier: "reference", files: ["/skills/docs/template.md"] },
        },
      }),
    ];

    const result = routeSkillsForAgent(skills, "documenter");
    expect(result.injected).toBe("");
    expect(result.referenceManifest).toContain("## Available Reference Skills");
    expect(result.referenceManifest).toContain("`/skills/docs/template.md`");
    expect(result.additionalDirs).toEqual(["/skills/docs"]);
  });

  test("no skills targeting documenter returns empty", () => {
    const result = routeSkillsForAgent([], "documenter");
    expect(result.injected).toBe("");
    expect(result.referenceManifest).toBe("");
    expect(result.additionalDirs).toEqual([]);
  });
});

// =====================================================
// Feature 10: Documentation Quality Validation
// =====================================================

describe("validateDocumentation", () => {
  test("passes silently for README.md with 500+ characters", () => {
    const dir = join(tmpBase, "project");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "README.md"), "x".repeat(500));
    writeFileSync(join(dir, "CHANGELOG.md"), "# Changelog\n\n## Sprint 1\n- Feature A");

    expect(() => validateDocumentation(dir)).not.toThrow();
  });

  test("warns for missing README.md without throwing", () => {
    const dir = join(tmpBase, "project");
    mkdirSync(dir, { recursive: true });

    expect(() => validateDocumentation(dir)).not.toThrow();
  });
});

// =====================================================
// Integration: scanSkillsDir with documenter
// =====================================================

describe("scanSkillsDir with documenter routing", () => {
  test("external skill with documenter routing is loaded correctly", () => {
    const skillDir = join(tmpBase, "doc-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "skill.yaml"),
      `name: doc-skill
routing:
  planner: exclude
  generator: exclude
  evaluator: exclude
  documenter:
    tier: inject
    files: [template.md]`,
    );
    writeFileSync(join(skillDir, "template.md"), "Template content");

    const skills = scanSkillsDir(tmpBase, "harness");
    expect(skills).toHaveLength(1);
    expect(skills[0]!.routing.documenter.tier).toBe("inject");
    expect(skills[0]!.routing.documenter.files).toEqual([join(skillDir, "template.md")]);
  });

  test("local .md skill defaults to including documenter", () => {
    writeFileSync(
      join(tmpBase, "my-docs-skill.md"),
      `---
name: My Docs Skill
---
Skill content for all agents.`,
    );

    const skills = scanSkillsDir(tmpBase, "user");
    expect(skills).toHaveLength(1);
    expect(skills[0]!.routing.documenter.tier).toBe("inject");
  });
});
