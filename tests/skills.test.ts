import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  parseLocalSkill,
  parseSkillYaml,
  scanSkillsDir,
  resolveSkills,
  routeSkillsForAgent,
  warnIfOversized,
} from "../shared/skills.ts";
import type { AgentSkills, ResolvedSkill } from "../shared/skills.ts";

// ── Helpers ────────────────────────────────────────────────────────

let tmpBase: string;

function makeTmp(): string {
  const dir = join(tmpdir(), `adhd-skills-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

beforeEach(() => {
  tmpBase = makeTmp();
});

afterEach(() => {
  rmSync(tmpBase, { recursive: true, force: true });
});

// ── parseLocalSkill ────────────────────────────────────────────────

describe("parseLocalSkill", () => {
  test("parses .md with full frontmatter", () => {
    const md = `---
name: API Conventions
agents: [planner, generator]
tier: reference
type: technology
---
Some content here.`;
    const skill = parseLocalSkill(md, "/tmp/api-conventions.md");
    expect(skill.name).toBe("API Conventions");
    expect(skill.type).toBe("technology");
    expect(skill.routing.planner.tier).toBe("reference");
    expect(skill.routing.generator.tier).toBe("reference");
    expect(skill.routing.evaluator.tier).toBe("exclude");
    expect(skill.routing.planner.files).toEqual(["/tmp/api-conventions.md"]);
  });

  test("defaults: agents=all, tier=inject when omitted", () => {
    const md = `---
name: Simple Skill
---
Content.`;
    const skill = parseLocalSkill(md, "/tmp/simple.md");
    expect(skill.name).toBe("Simple Skill");
    expect(skill.routing.planner.tier).toBe("inject");
    expect(skill.routing.generator.tier).toBe("inject");
    expect(skill.routing.evaluator.tier).toBe("inject");
    // inject tier should have content loaded
    expect(skill.routing.planner.content).toEqual([md]);
  });

  test("derives name from filename when frontmatter has no name", () => {
    const md = `---
tier: inject
---
Content.`;
    const skill = parseLocalSkill(md, "/tmp/my-cool-skill.md");
    expect(skill.name).toBe("my-cool-skill");
  });

  test("handles no frontmatter at all", () => {
    const md = "Just plain markdown content.";
    const skill = parseLocalSkill(md, "/tmp/plain.md");
    expect(skill.name).toBe("plain");
    expect(skill.routing.planner.tier).toBe("inject");
  });
});

// ── parseSkillYaml ─────────────────────────────────────────────────

describe("parseSkillYaml", () => {
  test("parses full skill.yaml", () => {
    const yaml = `name: bdd-gherkin
version: 1.2.0
description: BDD specification methodology
type: methodology-bdd
author: community
source: https://github.com/example/adhd-skill-bdd
routing:
  planner:
    tier: inject
    files: [writing-scenarios.md, feature-templates.md]
  evaluator:
    tier: reference
    files: [verification-checklist.md]
  generator: exclude`;

    const manifest = parseSkillYaml(yaml);
    expect(manifest.name).toBe("bdd-gherkin");
    expect(manifest.version).toBe("1.2.0");
    expect(manifest.type).toBe("methodology-bdd");
    expect(manifest.routing.planner?.tier).toBe("inject");
    expect(manifest.routing.planner?.files).toEqual(["writing-scenarios.md", "feature-templates.md"]);
    expect(manifest.routing.evaluator?.tier).toBe("reference");
    expect(manifest.routing.evaluator?.files).toEqual(["verification-checklist.md"]);
    expect(manifest.routing.generator?.tier).toBe("exclude");
  });

  test("fills missing agents as exclude", () => {
    const yaml = `name: minimal
routing:
  planner:
    tier: inject
    files: [guide.md]`;

    const manifest = parseSkillYaml(yaml);
    expect(manifest.routing.generator?.tier).toBe("exclude");
    expect(manifest.routing.evaluator?.tier).toBe("exclude");
  });
});

// ── scanSkillsDir ──────────────────────────────────────────────────

describe("scanSkillsDir", () => {
  test("scans external skills (subdirs with skill.yaml)", () => {
    const skillDir = join(tmpBase, "my-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "skill.yaml"),
      `name: my-skill
type: technology
routing:
  planner:
    tier: inject
    files: [guide.md]
  generator: exclude
  evaluator: exclude`,
    );
    writeFileSync(join(skillDir, "guide.md"), "# Guide content");

    const skills = scanSkillsDir(tmpBase, "harness");
    expect(skills).toHaveLength(1);
    expect(skills[0]!.name).toBe("my-skill");
    expect(skills[0]!.source).toBe("harness");
    expect(skills[0]!.routing.planner.files).toEqual([join(skillDir, "guide.md")]);
  });

  test("scans local .md files at root level", () => {
    writeFileSync(
      join(tmpBase, "conventions.md"),
      `---
name: Conventions
tier: inject
---
Follow these conventions.`,
    );

    const skills = scanSkillsDir(tmpBase, "user");
    expect(skills).toHaveLength(1);
    expect(skills[0]!.name).toBe("Conventions");
    expect(skills[0]!.source).toBe("user");
  });

  test("scans installed/ subdirectory as project-installed", () => {
    const installedDir = join(tmpBase, "installed", "ext-skill");
    mkdirSync(installedDir, { recursive: true });
    writeFileSync(
      join(installedDir, "skill.yaml"),
      `name: ext-skill
routing:
  planner:
    tier: reference
    files: [ref.md]
  generator: exclude
  evaluator: exclude`,
    );
    writeFileSync(join(installedDir, "ref.md"), "Reference content");

    const skills = scanSkillsDir(tmpBase, "project-local");
    const installed = skills.filter((s) => s.source === "project-installed");
    expect(installed).toHaveLength(1);
    expect(installed[0]!.name).toBe("ext-skill");
  });

  test("scans local/ subdirectory as project-local", () => {
    const localDir = join(tmpBase, "local");
    mkdirSync(localDir, { recursive: true });
    writeFileSync(
      join(localDir, "my-notes.md"),
      `---
name: My Notes
---
Some notes.`,
    );

    const skills = scanSkillsDir(tmpBase, "project-local");
    const local = skills.filter((s) => s.source === "project-local");
    expect(local).toHaveLength(1);
    expect(local[0]!.name).toBe("My Notes");
  });

  test("returns empty array for nonexistent directory", () => {
    const skills = scanSkillsDir("/nonexistent/path/xyz", "harness");
    expect(skills).toEqual([]);
  });

  test("handles mixed content (external + local)", () => {
    // External skill
    const skillDir = join(tmpBase, "ext");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "skill.yaml"),
      `name: ext
routing:
  planner:
    tier: inject
    files: [a.md]
  generator: exclude
  evaluator: exclude`,
    );
    writeFileSync(join(skillDir, "a.md"), "A content");

    // Local .md
    writeFileSync(join(tmpBase, "local-skill.md"), `---\nname: local\n---\nLocal content.`);

    const skills = scanSkillsDir(tmpBase, "harness");
    expect(skills).toHaveLength(2);
    const names = skills.map((s) => s.name).sort();
    expect(names).toEqual(["ext", "local"]);
  });
});

// ── resolveSkills ──────────────────────────────────────────────────

describe("resolveSkills", () => {
  test("deduplicates: project overrides user overrides harness", () => {
    const harnessDir = join(tmpBase, "harness");
    const userDir = join(tmpBase, "user");
    const projectDir = join(tmpBase, "project");

    for (const dir of [harnessDir, userDir, projectDir]) {
      mkdirSync(dir, { recursive: true });
    }

    // Same skill name in all three scopes
    for (const [dir, content] of [
      [harnessDir, "harness version"],
      [userDir, "user version"],
      [projectDir, "project version"],
    ] as const) {
      writeFileSync(
        join(dir, "shared-skill.md"),
        `---\nname: shared-skill\n---\n${content}`,
      );
    }

    const skills = resolveSkills(harnessDir, userDir, projectDir);
    expect(skills).toHaveLength(1);
    // Project wins
    expect(skills[0]!.routing.planner.content?.[0]).toContain("project version");
  });

  test("filters out methodology-bdd when noBdd is set", () => {
    const dir = join(tmpBase, "skills");
    mkdirSync(join(dir, "bdd-skill"), { recursive: true });
    writeFileSync(
      join(dir, "bdd-skill", "skill.yaml"),
      `name: bdd-skill
type: methodology-bdd
routing:
  planner:
    tier: inject
    files: [guide.md]
  generator: exclude
  evaluator: exclude`,
    );
    writeFileSync(join(dir, "bdd-skill", "guide.md"), "BDD guide");

    writeFileSync(join(dir, "other.md"), `---\nname: other\ntype: technology\n---\nOther.`);

    const empty = join(tmpBase, "empty");
    mkdirSync(empty, { recursive: true });

    const skills = resolveSkills(dir, empty, empty, { noBdd: true });
    expect(skills).toHaveLength(1);
    expect(skills[0]!.name).toBe("other");
  });

  test("filters out methodology-tdd when noTdd is set", () => {
    const dir = join(tmpBase, "skills");
    mkdirSync(join(dir, "tdd-skill"), { recursive: true });
    writeFileSync(
      join(dir, "tdd-skill", "skill.yaml"),
      `name: tdd-skill
type: methodology-tdd
routing:
  planner:
    tier: inject
    files: [guide.md]
  generator: exclude
  evaluator: exclude`,
    );
    writeFileSync(join(dir, "tdd-skill", "guide.md"), "TDD guide");

    const empty = join(tmpBase, "empty");
    mkdirSync(empty, { recursive: true });

    const skills = resolveSkills(dir, empty, empty, { noTdd: true });
    expect(skills).toHaveLength(0);
  });

  test("loads inject-tier content from files", () => {
    const dir = join(tmpBase, "skills");
    mkdirSync(join(dir, "my-skill"), { recursive: true });
    writeFileSync(
      join(dir, "my-skill", "skill.yaml"),
      `name: my-skill
routing:
  planner:
    tier: inject
    files: [content.md]
  generator: exclude
  evaluator: exclude`,
    );
    writeFileSync(join(dir, "my-skill", "content.md"), "Injected content here");

    const empty = join(tmpBase, "empty");
    mkdirSync(empty, { recursive: true });

    const skills = resolveSkills(dir, empty, empty);
    expect(skills[0]!.routing.planner.content).toEqual(["Injected content here"]);
  });
});

// ── routeSkillsForAgent ────────────────────────────────────────────

describe("routeSkillsForAgent", () => {
  function makeSkill(overrides: Partial<ResolvedSkill> & { name: string }): ResolvedSkill {
    return {
      source: "harness",
      routing: {
        planner: { tier: "exclude", files: [] },
        generator: { tier: "exclude", files: [] },
        evaluator: { tier: "exclude", files: [] },
      },
      ...overrides,
    };
  }

  test("concatenates inject-tier content", () => {
    const skills: ResolvedSkill[] = [
      makeSkill({
        name: "a",
        routing: {
          planner: { tier: "inject", files: ["/a.md"], content: ["Content A"] },
          generator: { tier: "exclude", files: [] },
          evaluator: { tier: "exclude", files: [] },
        },
      }),
      makeSkill({
        name: "b",
        routing: {
          planner: { tier: "inject", files: ["/b.md"], content: ["Content B"] },
          generator: { tier: "exclude", files: [] },
          evaluator: { tier: "exclude", files: [] },
        },
      }),
    ];

    const result = routeSkillsForAgent(skills, "planner");
    expect(result.injected).toBe("Content A\n\nContent B");
  });

  test("builds reference manifest with file paths", () => {
    const skills: ResolvedSkill[] = [
      makeSkill({
        name: "ref-skill",
        routing: {
          planner: { tier: "exclude", files: [] },
          generator: { tier: "reference", files: ["/skills/ref/guide.md", "/skills/ref/examples.md"] },
          evaluator: { tier: "exclude", files: [] },
        },
      }),
    ];

    const result = routeSkillsForAgent(skills, "generator");
    expect(result.referenceManifest).toContain("## Available Reference Skills");
    expect(result.referenceManifest).toContain("`/skills/ref/guide.md`");
    expect(result.referenceManifest).toContain("`/skills/ref/examples.md`");
  });

  test("collects unique parent directories for additionalDirs", () => {
    const skills: ResolvedSkill[] = [
      makeSkill({
        name: "ref1",
        routing: {
          planner: { tier: "exclude", files: [] },
          generator: { tier: "exclude", files: [] },
          evaluator: {
            tier: "reference",
            files: ["/skills/eval/a.md", "/skills/eval/b.md", "/skills/other/c.md"],
          },
        },
      }),
    ];

    const result = routeSkillsForAgent(skills, "evaluator");
    expect(result.additionalDirs.sort()).toEqual(["/skills/eval", "/skills/other"]);
  });

  test("skips exclude-tier entries", () => {
    const skills: ResolvedSkill[] = [
      makeSkill({
        name: "excluded",
        routing: {
          planner: { tier: "exclude", files: [] },
          generator: { tier: "exclude", files: [] },
          evaluator: { tier: "exclude", files: [] },
        },
      }),
    ];

    const result = routeSkillsForAgent(skills, "planner");
    expect(result.injected).toBe("");
    expect(result.referenceManifest).toBe("");
    expect(result.additionalDirs).toEqual([]);
  });

  test("returns empty manifest when no reference skills exist", () => {
    const skills: ResolvedSkill[] = [
      makeSkill({
        name: "inject-only",
        routing: {
          planner: { tier: "inject", files: ["/a.md"], content: ["Stuff"] },
          generator: { tier: "exclude", files: [] },
          evaluator: { tier: "exclude", files: [] },
        },
      }),
    ];

    const result = routeSkillsForAgent(skills, "planner");
    expect(result.injected).toBe("Stuff");
    expect(result.referenceManifest).toBe("");
    expect(result.additionalDirs).toEqual([]);
  });
});

// ── Harness-scope skills (integration sanity) ─────────────────────

describe("harness-scope skills", () => {
  const harnessSkillsDir = resolve(import.meta.dir, "../shared/skills");

  test("shared/skills/ directory contains the 3 expected skills", () => {
    const skills = scanSkillsDir(harnessSkillsDir, "harness");
    const names = skills.map((s) => s.name).sort();
    expect(names).toEqual(["contract-structure", "evaluation-criteria", "spec-format"]);
  });

  test("spec-format skill injects to planner, excludes others", () => {
    const skills = scanSkillsDir(harnessSkillsDir, "harness");
    const specFormat = skills.find((s) => s.name === "spec-format")!;
    expect(specFormat.routing.planner.tier).toBe("inject");
    expect(specFormat.routing.generator.tier).toBe("exclude");
    expect(specFormat.routing.evaluator.tier).toBe("exclude");
    expect(specFormat.routing.planner.files.length).toBeGreaterThan(0);
  });

  test("contract-structure skill is reference for generator and evaluator", () => {
    const skills = scanSkillsDir(harnessSkillsDir, "harness");
    const contractStructure = skills.find((s) => s.name === "contract-structure")!;
    expect(contractStructure.routing.planner.tier).toBe("exclude");
    expect(contractStructure.routing.generator.tier).toBe("reference");
    expect(contractStructure.routing.evaluator.tier).toBe("reference");
  });

  test("evaluation-criteria skill is reference for evaluator only", () => {
    const skills = scanSkillsDir(harnessSkillsDir, "harness");
    const evalCriteria = skills.find((s) => s.name === "evaluation-criteria")!;
    expect(evalCriteria.routing.planner.tier).toBe("exclude");
    expect(evalCriteria.routing.generator.tier).toBe("exclude");
    expect(evalCriteria.routing.evaluator.tier).toBe("reference");
  });

  test("resolveSkills loads harness skills with inject content", () => {
    const empty = join(tmpBase, "empty");
    mkdirSync(empty, { recursive: true });
    const skills = resolveSkills(harnessSkillsDir, empty, empty);
    const specFormat = skills.find((s) => s.name === "spec-format")!;
    // inject content should be loaded
    expect(specFormat.routing.planner.content).toBeDefined();
    expect(specFormat.routing.planner.content!.length).toBeGreaterThan(0);
    expect(specFormat.routing.planner.content![0]).toContain("Sprint");
  });

  test("routeSkillsForAgent produces correct planner view from harness skills", () => {
    const empty = join(tmpBase, "empty");
    mkdirSync(empty, { recursive: true });
    const skills = resolveSkills(harnessSkillsDir, empty, empty);
    const plannerView = routeSkillsForAgent(skills, "planner");
    // spec-format is injected to planner
    expect(plannerView.injected).toContain("Sprint");
    // no reference skills for planner from harness scope
    expect(plannerView.referenceManifest).toBe("");
  });

  test("routeSkillsForAgent produces correct evaluator view from harness skills", () => {
    const empty = join(tmpBase, "empty");
    mkdirSync(empty, { recursive: true });
    const skills = resolveSkills(harnessSkillsDir, empty, empty);
    const evalView = routeSkillsForAgent(skills, "evaluator");
    // no injected content for evaluator
    expect(evalView.injected).toBe("");
    // reference manifest should include contract-structure + evaluation-criteria files
    expect(evalView.referenceManifest).toContain("contract-format.md");
    expect(evalView.referenceManifest).toContain("scoring-guide.md");
    expect(evalView.additionalDirs.length).toBeGreaterThan(0);
  });
});

// ── warnIfOversized ───────────────────────────────────────────────

describe("warnIfOversized", () => {
  test("does not throw for small content", () => {
    const skills: AgentSkills = { injected: "small", referenceManifest: "", additionalDirs: [] };
    expect(() => warnIfOversized(skills, "planner")).not.toThrow();
  });

  test("does not throw for oversized content (just warns)", () => {
    const skills: AgentSkills = { injected: "x".repeat(40_000), referenceManifest: "", additionalDirs: [] };
    // Should log a warning but not throw
    expect(() => warnIfOversized(skills, "generator")).not.toThrow();
  });
});
