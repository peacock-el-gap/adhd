import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { log } from "./logger.ts";

// ── Types ──────────────────────────────────────────────────────────

type AgentRole = "planner" | "generator" | "evaluator" | "documenter" | "reviewer";
export type SkillTier = "inject" | "reference" | "exclude";
export type SkillSource = "harness" | "user" | "project-installed" | "project-local";

export interface SkillRouting {
  tier: SkillTier;
  files: string[]; // Absolute paths to content files
  content?: string[]; // For inject tier: file contents loaded. For reference: undefined.
}

export interface ResolvedSkill {
  name: string;
  source: SkillSource;
  type?: string; // "methodology-bdd", "methodology-tdd", "technology", etc.
  routing: Record<AgentRole, SkillRouting>;
}

export interface AgentSkills {
  injected: string; // Concatenated content for system prompt
  referenceManifest: string; // Markdown manifest listing reference files
  additionalDirs: string[]; // Absolute paths for SDK additionalDirectories option
}

export interface SkillManifest {
  name: string;
  version?: string;
  description?: string;
  type?: string;
  author?: string;
  source?: string;
  routing: Partial<Record<AgentRole, { tier: SkillTier; files: string[] }>>;
}

export interface SkillFilters {
  noBdd?: boolean;
  noTdd?: boolean;
}

// ── YAML Parsing ───────────────────────────────────────────────────

function parseInlineArray(value: string): string[] {
  const match = value.match(/^\[([^\]]*)\]$/);
  if (!match) return [];
  const inner = match[1];
  if (!inner || inner.trim() === "") return [];
  return inner.split(",").map((s) => s.trim());
}

/**
 * Parse a skill.yaml manifest. Hand-rolled parser for the limited
 * format used by skill manifests (flat scalars + routing block).
 */
export function parseSkillYaml(yamlContent: string): SkillManifest {
  const lines = yamlContent.split("\n");
  const manifest: SkillManifest = { name: "", routing: {} };
  let inRouting = false;
  let currentAgent: AgentRole | null = null;
  let currentAgentData: { tier?: SkillTier; files?: string[] } = {};

  const agents: AgentRole[] = ["planner", "generator", "evaluator", "documenter", "reviewer"];

  function flushAgent() {
    if (currentAgent && currentAgentData.tier) {
      manifest.routing[currentAgent] = {
        tier: currentAgentData.tier,
        files: currentAgentData.files ?? [],
      };
    }
    currentAgent = null;
    currentAgentData = {};
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (line.trim() === "" || line.trim().startsWith("#")) continue;

    // Detect routing block start
    if (/^routing:\s*$/.test(line)) {
      inRouting = true;
      continue;
    }

    if (!inRouting) {
      // Top-level scalar: key: value
      const colonIdx = line.indexOf(":");
      if (colonIdx === -1) continue;
      const key = line.slice(0, colonIdx).trim();
      const val = line.slice(colonIdx + 1).trim();
      if (key === "name") manifest.name = val;
      else if (key === "version") manifest.version = val;
      else if (key === "description") manifest.description = val;
      else if (key === "type") manifest.type = val;
      else if (key === "author") manifest.author = val;
      else if (key === "source") manifest.source = val;
      continue;
    }

    // Inside routing block
    // Check for agent line (2-space indent)
    const agentMatch = line.match(/^ {2}(\w+):\s*(.*)$/);
    if (agentMatch) {
      const name = agentMatch[1] as string;
      const rest = (agentMatch[2] ?? "").trim();
      if (agents.includes(name as AgentRole)) {
        flushAgent();
        if (rest === "exclude") {
          // Shorthand: `generator: exclude`
          manifest.routing[name as AgentRole] = { tier: "exclude", files: [] };
        } else {
          currentAgent = name as AgentRole;
          currentAgentData = {};
        }
        continue;
      }
    }

    // Agent sub-properties (4-space indent)
    const propMatch = line.match(/^ {4}(\w+):\s*(.+)$/);
    if (propMatch && currentAgent) {
      const key = propMatch[1] as string;
      const val = (propMatch[2] ?? "").trim();
      if (key === "tier") {
        currentAgentData.tier = val as SkillTier;
      } else if (key === "files") {
        currentAgentData.files = parseInlineArray(val);
      }
    }
  }

  flushAgent();

  // Fill in missing agents as exclude
  for (const agent of agents) {
    if (!manifest.routing[agent]) {
      manifest.routing[agent] = { tier: "exclude", files: [] };
    }
  }

  return manifest;
}

/**
 * Parse a local .md skill file with YAML frontmatter.
 * Defaults: agents → all, tier → inject.
 */
export function parseLocalSkill(mdContent: string, filePath: string): ResolvedSkill {
  let name = "";
  let type: string | undefined;
  let tier: SkillTier = "inject";
  let agentList: AgentRole[] = ["planner", "generator", "evaluator", "documenter"];

  // Extract frontmatter
  const fmMatch = mdContent.match(/^---\n([\s\S]*?)\n---/);
  if (fmMatch) {
    const fmLines = (fmMatch[1] as string).split("\n");
    for (const line of fmLines) {
      const colonIdx = line.indexOf(":");
      if (colonIdx === -1) continue;
      const key = line.slice(0, colonIdx).trim();
      const val = line.slice(colonIdx + 1).trim();
      if (key === "name") name = val;
      else if (key === "type") type = val;
      else if (key === "tier") tier = val as SkillTier;
      else if (key === "agents") {
        const parsed = parseInlineArray(val);
        if (parsed.length > 0) agentList = parsed as AgentRole[];
      }
    }
  }

  if (!name) {
    // Derive name from filename
    const parts = filePath.split("/");
    const filename = parts[parts.length - 1] ?? "";
    name = filename.replace(/\.md$/, "");
  }

  const allAgents: AgentRole[] = ["planner", "generator", "evaluator", "documenter", "reviewer"];
  const routing = {} as Record<AgentRole, SkillRouting>;

  for (const agent of allAgents) {
    if (agentList.includes(agent)) {
      routing[agent] = {
        tier,
        files: [filePath],
        content: tier === "inject" ? [mdContent] : undefined,
      };
    } else {
      routing[agent] = { tier: "exclude", files: [] };
    }
  }

  return { name, source: "project-local", type, routing };
}

// ── Resolution ─────────────────────────────────────────────────────

function resolveExternalSkill(skillDir: string, yamlPath: string, source: SkillSource): ResolvedSkill | null {
  try {
    const yamlContent = readFileSync(yamlPath, "utf-8");
    const manifest = parseSkillYaml(yamlContent);

    const allAgents: AgentRole[] = ["planner", "generator", "evaluator", "documenter", "reviewer"];
    const routing = {} as Record<AgentRole, SkillRouting>;

    for (const agent of allAgents) {
      const entry = manifest.routing[agent];
      if (!entry || entry.tier === "exclude") {
        routing[agent] = { tier: "exclude", files: [] };
      } else {
        routing[agent] = {
          tier: entry.tier,
          files: entry.files.map((f) => join(skillDir, f)),
        };
      }
    }

    return {
      name: manifest.name,
      source,
      type: manifest.type,
      routing,
    };
  } catch {
    return null;
  }
}

/**
 * Scan a directory for skills. Handles external (subdirs with skill.yaml)
 * and local (.md files at root level). Also handles installed/ and local/
 * subdirectories within project scope dirs.
 */
export function scanSkillsDir(dir: string, source: SkillSource): ResolvedSkill[] {
  if (!existsSync(dir)) return [];

  const skills: ResolvedSkill[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    let stat: ReturnType<typeof statSync> | undefined;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }
    if (!stat) continue;

    if (stat.isDirectory()) {
      // Special subdirectories for project scope
      if (entry === "installed") {
        // Each subdirectory is an external skill
        try {
          for (const sub of readdirSync(fullPath)) {
            const subDir = join(fullPath, sub);
            if (statSync(subDir).isDirectory()) {
              const yamlPath = join(subDir, "skill.yaml");
              if (existsSync(yamlPath)) {
                const skill = resolveExternalSkill(subDir, yamlPath, "project-installed");
                if (skill) skills.push(skill);
              }
            }
          }
        } catch {
          // skip unreadable installed dir
        }
        continue;
      }

      if (entry === "local") {
        // Each .md file is a local skill
        try {
          for (const mdFile of readdirSync(fullPath)) {
            if (mdFile.endsWith(".md")) {
              const mdPath = join(fullPath, mdFile);
              const content = readFileSync(mdPath, "utf-8");
              const skill = parseLocalSkill(content, mdPath);
              skill.source = "project-local";
              skills.push(skill);
            }
          }
        } catch {
          // skip unreadable local dir
        }
        continue;
      }

      // Regular subdirectory: check for skill.yaml (external skill)
      const yamlPath = join(fullPath, "skill.yaml");
      if (existsSync(yamlPath)) {
        const skill = resolveExternalSkill(fullPath, yamlPath, source);
        if (skill) skills.push(skill);
      }
    } else if (entry.endsWith(".md")) {
      // Top-level .md file: local skill
      const content = readFileSync(fullPath, "utf-8");
      const skill = parseLocalSkill(content, fullPath);
      skill.source = source;
      skills.push(skill);
    }
  }

  return skills;
}

/**
 * Main entry point: scan all three scope directories, deduplicate,
 * apply filters, and load inject-tier content.
 */
export function resolveSkills(
  harnessSkillsDir: string,
  userSkillsDir: string,
  projectSkillsDir: string,
  filters?: SkillFilters,
): ResolvedSkill[] {
  const harnessSkills = scanSkillsDir(harnessSkillsDir, "harness");
  const userSkills = scanSkillsDir(userSkillsDir, "user");
  const projectSkills = scanSkillsDir(projectSkillsDir, "project-local");

  // Deduplicate: project > user > harness
  const byName = new Map<string, ResolvedSkill>();
  for (const skill of harnessSkills) byName.set(skill.name, skill);
  for (const skill of userSkills) byName.set(skill.name, skill);
  for (const skill of projectSkills) byName.set(skill.name, skill);

  let skills = Array.from(byName.values());

  // Apply methodology filters
  if (filters?.noBdd) {
    skills = skills.filter((s) => s.type !== "methodology-bdd");
  }
  if (filters?.noTdd) {
    skills = skills.filter((s) => s.type !== "methodology-tdd");
  }

  // Load inject-tier file contents
  const allAgents: AgentRole[] = ["planner", "generator", "evaluator", "documenter", "reviewer"];
  for (const skill of skills) {
    for (const agent of allAgents) {
      const routing = skill.routing[agent];
      if (routing && routing.tier === "inject" && !routing.content) {
        routing.content = routing.files.filter((f) => existsSync(f)).map((f) => readFileSync(f, "utf-8"));
      }
    }
  }

  return skills;
}

// ── Per-Agent Routing ──────────────────────────────────────────────

/**
 * Build the per-agent view: concatenated injection content,
 * reference manifest, and additional directories for SDK config.
 */
export function routeSkillsForAgent(skills: ResolvedSkill[], agent: AgentRole): AgentSkills {
  const injectedParts: string[] = [];
  const referenceEntries: string[] = [];
  const dirSet = new Set<string>();

  for (const skill of skills) {
    const routing = skill.routing[agent];
    if (!routing || routing.tier === "exclude") continue;

    if (routing.tier === "inject" && routing.content) {
      for (const c of routing.content) {
        injectedParts.push(c);
      }
    } else if (routing.tier === "reference") {
      for (const f of routing.files) {
        referenceEntries.push(`- \`${f}\``);
        dirSet.add(dirname(f));
      }
    }
  }

  const injected = injectedParts.join("\n\n");
  const referenceManifest =
    referenceEntries.length > 0
      ? `## Available Reference Skills\n\nThese files are available for reading when needed:\n\n${referenceEntries.join("\n")}`
      : "";

  return {
    injected,
    referenceManifest,
    additionalDirs: Array.from(dirSet),
  };
}

// ── Size Guardrail ─────────────────────────────────────────────────

const INJECT_SIZE_LIMIT = 32_000;

/**
 * Warn if injected content exceeds ~8K tokens (32K chars).
 */
export function warnIfOversized(agentSkills: AgentSkills, agent: AgentRole): void {
  if (agentSkills.injected.length > INJECT_SIZE_LIMIT) {
    log(
      "HARNESS",
      `Warning: injected skills for ${agent} are ${agentSkills.injected.length} chars (~${Math.round(agentSkills.injected.length / 4)} tokens). Consider moving large skills to reference tier.`,
    );
  }
}

// ── All-Agent Resolution ──────────────────────────────────────────

export interface AllAgentSkills {
  planner: AgentSkills;
  generator: AgentSkills;
  evaluator: AgentSkills;
  documenter: AgentSkills;
  reviewer: AgentSkills;
}

/**
 * Resolve skills from all three scope directories, route them per agent,
 * warn about oversized injections, and log the summary.
 */
export function resolveAllAgentSkills(workDir: string, harnessBaseDir: string, filters?: SkillFilters): AllAgentSkills {
  const harnessSkillsDir = join(harnessBaseDir, "skills");
  const userSkillsDir = join(process.env.HOME ?? "", ".adhd", "skills");
  const projectSkillsDir = join(workDir, ".adhd", "skills");
  const resolvedSkills = resolveSkills(harnessSkillsDir, userSkillsDir, projectSkillsDir, filters);

  const planner = routeSkillsForAgent(resolvedSkills, "planner");
  const generator = routeSkillsForAgent(resolvedSkills, "generator");
  const evaluator = routeSkillsForAgent(resolvedSkills, "evaluator");
  const documenter = routeSkillsForAgent(resolvedSkills, "documenter");
  const reviewer = routeSkillsForAgent(resolvedSkills, "reviewer");

  warnIfOversized(planner, "planner");
  warnIfOversized(generator, "generator");
  warnIfOversized(evaluator, "evaluator");
  warnIfOversized(documenter, "documenter");
  warnIfOversized(reviewer, "reviewer");

  if (resolvedSkills.length > 0) {
    log("HARNESS", `Skills loaded: ${resolvedSkills.length} (${resolvedSkills.map((s) => s.name).join(", ")})`);
  }

  return { planner, generator, evaluator, documenter, reviewer };
}
