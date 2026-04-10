import { describe, expect, it } from "bun:test";
import type { GateOption } from "./interaction.ts";
import { promptGate } from "./interaction.ts";

describe("interaction", () => {
  const defaultOptions: GateOption[] = [
    { key: "a", label: "Approve", isDefault: true },
    { key: "r", label: "Reject", isDefault: false },
  ];

  describe("promptGate (non-interactive)", () => {
    it("returns the default option immediately in non-interactive mode", async () => {
      const result = await promptGate("Test gate", defaultOptions, 10, false);
      expect(result.key).toBe("a");
      expect(result.timedOut).toBe(false);
    });

    it("returns the first option when no option is marked as default", async () => {
      const options: GateOption[] = [
        { key: "x", label: "Option X", isDefault: false },
        { key: "y", label: "Option Y", isDefault: false },
      ];
      const result = await promptGate("Test gate", options, 5, false);
      expect(result.key).toBe("x");
    });

    it("returns the correct default when second option is default", async () => {
      const options: GateOption[] = [
        { key: "a", label: "Approve", isDefault: false },
        { key: "r", label: "Reject", isDefault: true },
      ];
      const result = await promptGate("Test gate", options, 5, false);
      expect(result.key).toBe("r");
    });
  });
});
