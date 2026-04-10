import { describe, expect, it } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseLocalSkill, parseSkillYaml, routeSkillsForAgent, scanSkillsDir } from "./skills.ts";

describe("skills", () => {
  describe("parseSkillYaml", () => {
    it("parses a basic skill manifest", () => {
      const yaml = `name: test-skill
version: 1.0
description: A test skill
type: technology
routing:
  planner:
    tier: inject
    files: [guide.md]
  generator:
    tier: reference
    files: [api.md]
  evaluator: exclude
  documenter: exclude`;

      const manifest = parseSkillYaml(yaml);
      expect(manifest.name).toBe("test-skill");
      expect(manifest.version).toBe("1.0");
      expect(manifest.type).toBe("technology");
      expect(manifest.routing.planner?.tier).toBe("inject");
      expect(manifest.routing.planner?.files).toEqual(["guide.md"]);
      expect(manifest.routing.generator?.tier).toBe("reference");
      expect(manifest.routing.evaluator?.tier).toBe("exclude");
    });

    it("fills missing agents as exclude", () => {
      const yaml = `name: minimal
routing:
  planner:
    tier: inject
    files: [guide.md]`;

      const manifest = parseSkillYaml(yaml);
      expect(manifest.routing.generator?.tier).toBe("exclude");
      expect(manifest.routing.evaluator?.tier).toBe("exclude");
      expect(manifest.routing.documenter?.tier).toBe("exclude");
    });
  });

  describe("parseLocalSkill", () => {
    it("parses a markdown skill with frontmatter", () => {
      const md = `---
name: my-local-skill
type: methodology-bdd
tier: inject
agents: [generator, evaluator]
---

# My Skill

Content here.`;

      const skill = parseLocalSkill(md, "/path/to/skill.md");
      expect(skill.name).toBe("my-local-skill");
      expect(skill.type).toBe("methodology-bdd");
      expect(skill.routing.generator.tier).toBe("inject");
      expect(skill.routing.evaluator.tier).toBe("inject");
      expect(skill.routing.planner.tier).toBe("exclude");
    });

    it("derives name from filename when not in frontmatter", () => {
      const md = "# Some content without frontmatter";
      const skill = parseLocalSkill(md, "/path/to/my-guide.md");
      expect(skill.name).toBe("my-guide");
    });
  });

  describe("routeSkillsForAgent", () => {
    it("concatenates injected content for an agent", () => {
      const skills = [
        {
          name: "skill-a",
          source: "harness" as const,
          routing: {
            planner: { tier: "inject" as const, files: ["/a.md"], content: ["Content A"] },
            generator: { tier: "exclude" as const, files: [] },
            evaluator: { tier: "exclude" as const, files: [] },
            documenter: { tier: "exclude" as const, files: [] },
          },
        },
        {
          name: "skill-b",
          source: "harness" as const,
          routing: {
            planner: { tier: "inject" as const, files: ["/b.md"], content: ["Content B"] },
            generator: { tier: "exclude" as const, files: [] },
            evaluator: { tier: "exclude" as const, files: [] },
            documenter: { tier: "exclude" as const, files: [] },
          },
        },
      ];

      const result = routeSkillsForAgent(skills, "planner");
      expect(result.injected).toContain("Content A");
      expect(result.injected).toContain("Content B");
    });

    it("returns empty strings for agents with no skills", () => {
      const result = routeSkillsForAgent([], "generator");
      expect(result.injected).toBe("");
      expect(result.referenceManifest).toBe("");
      expect(result.additionalDirs).toEqual([]);
    });
  });

  describe("scanSkillsDir", () => {
    it("returns empty array for non-existent directory", () => {
      const result = scanSkillsDir("/nonexistent/path", "harness");
      expect(result).toEqual([]);
    });

    it("scans local .md files in a directory", async () => {
      const dir = await mkdtemp(join(tmpdir(), "skills-"));
      await writeFile(join(dir, "test-skill.md"), "---\nname: test-skill\n---\n# Content", "utf-8");

      const result = scanSkillsDir(dir, "user");
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("test-skill");
      expect(result[0].source).toBe("user");
    });
  });
});
