import { describe, expect, test } from "bun:test";
import { parseContract } from "../harness-claude/contract.ts";

describe("parseContract", () => {
  const validContract = {
    sprintNumber: 1,
    features: ["auth", "dashboard"],
    criteria: [
      { name: "auth_works", description: "JWT auth returns 200", threshold: 7 },
      { name: "dashboard_loads", description: "Dashboard renders", threshold: 7 },
    ],
  };

  test("extracts JSON from a code block", () => {
    const text = `Here is the contract:\n\`\`\`json\n${JSON.stringify(validContract)}\n\`\`\`\nDone.`;
    const result = parseContract(text, 3);
    expect(result.sprintNumber).toBe(3);
    expect(result.criteria).toHaveLength(2);
    expect(result.features).toEqual(["auth", "dashboard"]);
  });

  test("extracts JSON from bare braces when no code block", () => {
    const text = `I propose:\n${JSON.stringify(validContract)}`;
    const result = parseContract(text, 2);
    expect(result.sprintNumber).toBe(2);
    expect(result.criteria).toHaveLength(2);
  });

  test("extracts JSON from bare braces with surrounding text", () => {
    const text = `I propose: ${JSON.stringify(validContract)} — what do you think?`;
    const result = parseContract(text, 2);
    expect(result.sprintNumber).toBe(2);
    expect(result.criteria).toHaveLength(2);
  });

  test("parses raw JSON text", () => {
    const result = parseContract(JSON.stringify(validContract), 1);
    expect(result.sprintNumber).toBe(1);
    expect(result.criteria).toHaveLength(2);
  });

  test("prefers last code block over earlier ones", () => {
    const old = { ...validContract, features: ["old"] };
    const latest = { ...validContract, features: ["new"] };
    const text = `\`\`\`json\n${JSON.stringify(old)}\n\`\`\`\nRevised:\n\`\`\`json\n${JSON.stringify(latest)}\n\`\`\``;
    const result = parseContract(text, 1);
    expect(result.features).toEqual(["new"]);
  });

  test("returns default contract when parsing fails", () => {
    const result = parseContract("This is not JSON at all.", 5);
    expect(result.sprintNumber).toBe(5);
    expect(result.criteria).toHaveLength(3);
    expect(result.criteria[0]!.name).toBe("basic_functionality");
  });

  test("returns default for JSON without criteria array", () => {
    const result = parseContract('{"features": ["x"]}', 1);
    expect(result.criteria).toHaveLength(3);
    expect(result.criteria[0]!.name).toBe("basic_functionality");
  });

  test("overrides sprintNumber from the text with the argument", () => {
    const contractWithWrongSprint = { ...validContract, sprintNumber: 99 };
    const result = parseContract(JSON.stringify(contractWithWrongSprint), 4);
    expect(result.sprintNumber).toBe(4);
  });
});
