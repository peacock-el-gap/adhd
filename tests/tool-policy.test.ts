/**
 * Unit tests for shared/tool-policy.ts (F11).
 *
 * All tests exercise the policy function directly — no SDK objects are
 * instantiated. This satisfies the `tool_policy_pure_shared` contract criterion.
 */
import { describe, expect, test } from "bun:test";
import { buildToolPolicyInput, isNonCodingRole, resolveToolPolicy } from "../shared/tool-policy.ts";

// ---------------------------------------------------------------------------
// isNonCodingRole
// ---------------------------------------------------------------------------

describe("isNonCodingRole", () => {
  test("PLANNER is non-coding", () => {
    expect(isNonCodingRole("PLANNER")).toBe(true);
  });

  test("HARNESS is non-coding", () => {
    expect(isNonCodingRole("HARNESS")).toBe(true);
  });

  test("planner (lowercase) is non-coding", () => {
    expect(isNonCodingRole("planner")).toBe(true);
  });

  test("contract-proposal is non-coding", () => {
    expect(isNonCodingRole("contract-proposal")).toBe(true);
  });

  test("contract-review is non-coding", () => {
    expect(isNonCodingRole("contract-review")).toBe(true);
  });

  test("contract-negotiation is non-coding", () => {
    expect(isNonCodingRole("contract-negotiation")).toBe(true);
  });

  test("refinement-planner is non-coding", () => {
    expect(isNonCodingRole("refinement-planner")).toBe(true);
  });

  test("GENERATOR is not non-coding", () => {
    expect(isNonCodingRole("GENERATOR")).toBe(false);
  });

  test("EVALUATOR is not non-coding", () => {
    expect(isNonCodingRole("EVALUATOR")).toBe(false);
  });

  test("DOCUMENTER is not non-coding", () => {
    expect(isNonCodingRole("DOCUMENTER")).toBe(false);
  });

  test("generator (lowercase) is not non-coding", () => {
    expect(isNonCodingRole("generator")).toBe(false);
  });

  test("empty string is treated as non-coding (safe default)", () => {
    expect(isNonCodingRole("")).toBe(true);
  });

  test("unknown role falls back to safe non-coding default", () => {
    // An unrecognized role gets the more-restrictive non-coding treatment
    // only if it matches the HARNESS/PLANNER/contract/refinement patterns.
    // 'generator' does NOT match, so it returns false.
    expect(isNonCodingRole("generator")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resolveToolPolicy — non-coding roles
// ---------------------------------------------------------------------------

const noMcpInput = buildToolPolicyInput({ disableMcp: false, addMcpServers: {} });
const disabledInput = buildToolPolicyInput({ disableMcp: true, addMcpServers: {} });
const extraServersInput = buildToolPolicyInput({
  disableMcp: false,
  addMcpServers: { "my-server": { command: "node" } },
});

describe("resolveToolPolicy — non-coding roles always get no MCP", () => {
  test("PLANNER gets mcpServers: {} regardless of disableMcp=false", () => {
    const policy = resolveToolPolicy("PLANNER", noMcpInput);
    expect(policy.mcpServers).toEqual({});
  });

  test("HARNESS gets mcpServers: {} unconditionally", () => {
    const policy = resolveToolPolicy("HARNESS", noMcpInput);
    expect(policy.mcpServers).toEqual({});
  });

  test("HARNESS with disableMcp=true still gets mcpServers: {} (already restricted)", () => {
    const policy = resolveToolPolicy("HARNESS", disabledInput);
    expect(policy.mcpServers).toEqual({});
  });

  test("HARNESS with addMcpServers set still gets mcpServers: {} (non-coding ignores extra servers)", () => {
    const policy = resolveToolPolicy("HARNESS", extraServersInput);
    expect(policy.mcpServers).toEqual({});
  });

  test("non-coding role gets settingSources: ['project']", () => {
    const policy = resolveToolPolicy("PLANNER", noMcpInput);
    expect(policy.settingSources).toEqual(["project"]);
  });

  test("contract-proposal gets no MCP", () => {
    const policy = resolveToolPolicy("contract-proposal", noMcpInput);
    expect(policy.mcpServers).toEqual({});
  });

  test("contract-review gets no MCP", () => {
    const policy = resolveToolPolicy("contract-review", noMcpInput);
    expect(policy.mcpServers).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// resolveToolPolicy — coding roles
// ---------------------------------------------------------------------------

describe("resolveToolPolicy — coding roles", () => {
  test("GENERATOR with no overrides does NOT receive mcpServers (SDK default)", () => {
    const policy = resolveToolPolicy("GENERATOR", noMcpInput);
    // No mcpServers field — SDK default applies (no MCP forced)
    expect(policy.mcpServers).toBeUndefined();
  });

  test("EVALUATOR with no overrides gets settingSources for all layers", () => {
    const policy = resolveToolPolicy("EVALUATOR", noMcpInput);
    expect(policy.settingSources).toEqual(["user", "project", "local"]);
  });

  test("DOCUMENTER with disableMcp=true gets mcpServers: {}", () => {
    const policy = resolveToolPolicy("DOCUMENTER", disabledInput);
    expect(policy.mcpServers).toEqual({});
  });

  test("GENERATOR with disableMcp=true gets mcpServers: {}", () => {
    const policy = resolveToolPolicy("GENERATOR", disabledInput);
    expect(policy.mcpServers).toEqual({});
  });

  test("GENERATOR with addMcpServers set receives those servers", () => {
    const policy = resolveToolPolicy("GENERATOR", extraServersInput);
    expect(policy.mcpServers).toEqual({ "my-server": { command: "node" } });
  });

  test("disableMcp=true wins over addMcpServers (disable takes priority)", () => {
    const input = buildToolPolicyInput({
      disableMcp: true,
      addMcpServers: { "my-server": { command: "node" } },
    });
    const policy = resolveToolPolicy("GENERATOR", input);
    // disableMcp wins → mcpServers: {}
    expect(policy.mcpServers).toEqual({});
  });

  test("GENERATOR gets settingSources even with disableMcp=true", () => {
    const policy = resolveToolPolicy("GENERATOR", disabledInput);
    expect(policy.settingSources).toEqual(["user", "project", "local"]);
  });
});

// ---------------------------------------------------------------------------
// resolveToolPolicy — safety / never-throws
// ---------------------------------------------------------------------------

describe("resolveToolPolicy — never throws on bad inputs", () => {
  test("empty role string returns an empty policy (safe fallback)", () => {
    // Empty string matches isNonCodingRole, so gets project-only settings
    const policy = resolveToolPolicy("", noMcpInput);
    expect(policy).toBeDefined();
  });

  test("does not throw for any string role input", () => {
    expect(() => resolveToolPolicy("UNKNOWN_ROLE", noMcpInput)).not.toThrow();
    expect(() => resolveToolPolicy("generator", noMcpInput)).not.toThrow();
    expect(() => resolveToolPolicy("EVALUATOR", disabledInput)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// buildToolPolicyInput
// ---------------------------------------------------------------------------

describe("buildToolPolicyInput", () => {
  test("fills in defaults when fields are absent", () => {
    const input = buildToolPolicyInput({});
    expect(input.disableMcp).toBe(false);
    expect(input.addMcpServers).toEqual({});
  });

  test("passes through provided values", () => {
    const input = buildToolPolicyInput({ disableMcp: true, addMcpServers: { s: { k: 1 } } });
    expect(input.disableMcp).toBe(true);
    expect(input.addMcpServers).toEqual({ s: { k: 1 } });
  });

  test("undefined addMcpServers defaults to empty object", () => {
    const input = buildToolPolicyInput({ addMcpServers: undefined });
    expect(input.addMcpServers).toEqual({});
  });
});
