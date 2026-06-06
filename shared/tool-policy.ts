/**
 * Per-agent tool and MCP policy resolution (F11).
 *
 * Pure shared module — zero SDK imports. The `resolveToolPolicy` function
 * decides, per agent role, which settings layers and MCP servers each agent
 * receives. The result is mapped onto SDK Options in `harness-claude/run-agent.ts`.
 *
 * Role classification:
 *   - Non-coding roles (Planner, refinement Planner, contract-negotiation):
 *     get only their needed built-in tools and NO MCP servers.
 *   - Coding roles (Generator, Evaluator, Documenter): receive the project
 *     settings source inheritance so the operator's own MCP config can apply;
 *     MCP is not explicitly disabled unless the operator opts out.
 *
 * Override precedence (CLI flag > env var > .adhd/.env > default) is applied
 * by the caller before invoking this function — the resolved boolean flags are
 * passed in via `ToolPolicyInput`.
 *
 * Never throws; returns a safe fallback for unrecognised roles (treated as
 * non-coding, no MCP — the more restrictive default).
 */

/** Settings layers the Claude Agent SDK can load from disk. */
export type SettingSourceType = "user" | "project" | "local";

/**
 * An MCP server entry. In shared/ we cannot reference the SDK's
 * `McpServerConfig` type directly, so we use a plain-object alias. The
 * harness-claude layer performs the cast when building SDK Options.
 */
export type McpServerEntry = Record<string, unknown>;

/**
 * The resolved tool/MCP policy for one agent run.
 *
 * - `settingSources`:  when set, passed to `Options.settingSources` so the
 *   agent loads the specified settings layers. When absent, no override is
 *   applied (SDK default / isolation mode).
 * - `mcpServers`:  when set, passed to `Options.mcpServers`. An empty object
 *   (`{}`) means "no MCP servers". When absent, no override is applied.
 */
export interface ResolvedToolPolicy {
  settingSources?: SettingSourceType[];
  mcpServers?: Record<string, McpServerEntry>;
}

/**
 * Runtime inputs that control MCP behaviour. Callers resolve these from the
 * full `ResolvedConfig` before invoking `resolveToolPolicy`.
 */
export interface ToolPolicyInput {
  /** When true, all agents — including coding agents — receive `mcpServers: {}`. */
  disableMcp: boolean;
  /**
   * Additional MCP server entries to inject into coding agents. Keys are
   * server names; values are server config objects passed through to the SDK.
   * Applied after the disable-mcp gate: if both `disableMcp` and `addMcpServers`
   * are set, `disableMcp` wins (the extra servers are ignored).
   */
  addMcpServers: Record<string, McpServerEntry>;
}

/**
 * Roles that must never receive MCP servers, regardless of overrides.
 * These are the non-coding orchestration roles whose work is text-only
 * (planning, contract negotiation, spec refinement).
 */
const NON_CODING_ROLES = new Set([
  // Logger-level identifiers (uppercase, used by harness-claude/)
  "PLANNER",
  "HARNESS",
  // Lower-case identifiers used internally / in tests
  "planner",
  "contract-proposal",
  "contract-review",
  "contract-negotiation",
  "refinement-planner",
]);

/**
 * Returns true when the given role belongs to the non-coding category
 * (Planner, refinement Planner, contract negotiation). These roles never
 * receive MCP servers, regardless of operator overrides.
 *
 * Comparison is case-insensitive for robustness. Never throws.
 */
export function isNonCodingRole(role: string): boolean {
  if (!role || typeof role !== "string") return true; // safe default: treat unknown as non-coding
  // Check exact set first (fast path)
  if (NON_CODING_ROLES.has(role)) return true;
  // Case-insensitive fallback
  const lower = role.toLowerCase();
  return lower === "planner" || lower === "harness" || lower.includes("contract") || lower.includes("refinement");
}

/**
 * Resolve the tool/MCP policy for a single agent run.
 *
 * @param role   The agent role identifier (e.g. `"GENERATOR"`, `"planner"`).
 * @param input  Operator-resolved override flags.
 * @returns      A `ResolvedToolPolicy` ready to be mapped onto SDK `Options`.
 *
 * Policy rules (applied in order):
 * 1. Non-coding roles always receive `mcpServers: {}` (empty = no MCP),
 *    even when `disableMcp` is false or `addMcpServers` is non-empty.
 * 2. For coding roles, when `disableMcp` is true, `mcpServers: {}` is set.
 * 3. For coding roles, when `addMcpServers` is non-empty and MCP is not
 *    disabled, the servers are merged into `mcpServers`.
 * 4. Coding roles get `settingSources: ["user", "project", "local"]` so the
 *    operator's project/user settings (including any MCP they configure) apply.
 * 5. Non-coding roles get `settingSources: ["project"]` (project settings only
 *    — enough to load CLAUDE.md, but not user-wide MCP configurations).
 *
 * Never throws — returns an empty policy on any unexpected input.
 */
export function resolveToolPolicy(role: string, input: ToolPolicyInput): ResolvedToolPolicy {
  try {
    const nonCoding = isNonCodingRole(role);

    if (nonCoding) {
      // Non-coding: project settings only + no MCP, unconditionally.
      return {
        settingSources: ["project"],
        mcpServers: {},
      };
    }

    // Coding role
    const settingSources: SettingSourceType[] = ["user", "project", "local"];

    if (input.disableMcp) {
      return { settingSources, mcpServers: {} };
    }

    // Add any operator-specified servers; omit the field entirely when there are none
    // so the SDK falls back to whatever its default MCP resolution would be.
    const hasExtra = Object.keys(input.addMcpServers).length > 0;
    if (hasExtra) {
      return { settingSources, mcpServers: { ...input.addMcpServers } };
    }

    // No special MCP config: just set settingSources, leave mcpServers unset.
    return { settingSources };
  } catch {
    // Never-throwing: return an empty policy on any unexpected error.
    return {};
  }
}

/**
 * Build a `ToolPolicyInput` from the resolved config fields. This is the
 * bridge between `ResolvedConfig` and the pure `resolveToolPolicy` function.
 * Lives in shared/ so it can be unit-tested without harness-claude imports.
 */
export function buildToolPolicyInput(config: {
  disableMcp?: boolean;
  addMcpServers?: Record<string, McpServerEntry>;
}): ToolPolicyInput {
  return {
    disableMcp: config.disableMcp ?? false,
    addMcpServers: config.addMcpServers ?? {},
  };
}
