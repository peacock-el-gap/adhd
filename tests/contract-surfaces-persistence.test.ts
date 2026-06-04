import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initWorkspace, loadExistingContract, readContract, writeContract } from "../shared/files.ts";
import type { SprintContract } from "../shared/types.ts";

describe("contract surfaces persistence", () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "adhd-surfaces-"));
    await initWorkspace(workDir, { greenfield: false, resume: false });
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  const baseContract: SprintContract = {
    sprintNumber: 1,
    features: ["F1"],
    surfaces: ["backend", "tests"],
    criteria: [{ name: "c1", description: "desc", threshold: 7, type: "behavioral" }],
  };

  test("surfaces round-trip exactly through write then read", async () => {
    await writeContract(workDir, baseContract);
    const reread = await readContract(workDir, 1);
    expect(reread.surfaces).toEqual(["backend", "tests"]);
  });

  test("persisted JSON uses stable key order with surfaces before criteria", async () => {
    await writeContract(workDir, baseContract);
    const raw = await readFile(join(workDir, ".adhd", "contracts", "sprint-1.json"), "utf-8");
    const keys = Object.keys(JSON.parse(raw));
    expect(keys).toEqual(["sprintNumber", "features", "surfaces", "criteria"]);
  });

  test("legacy contract with no surfaces field loads without throwing", async () => {
    const legacy = {
      sprintNumber: 2,
      features: ["legacy"],
      criteria: [{ name: "c", description: "d", threshold: 7 }],
    };
    const path = join(workDir, ".adhd", "contracts", "sprint-2.json");
    await writeFile(path, JSON.stringify(legacy, null, 2), "utf-8");

    const viaRead = await readContract(workDir, 2);
    expect(viaRead.surfaces).toBeUndefined();

    const viaLoad = await loadExistingContract(workDir, 2);
    expect(viaLoad).not.toBeNull();
    expect(viaLoad?.surfaces).toBeUndefined();
  });

  test("re-persisting a legacy contract does not inject a surfaces field", async () => {
    const legacy: SprintContract = {
      sprintNumber: 3,
      features: ["legacy"],
      criteria: [{ name: "c", description: "d", threshold: 7 }],
    };
    await writeContract(workDir, legacy);
    const raw = await readFile(join(workDir, ".adhd", "contracts", "sprint-3.json"), "utf-8");
    expect(Object.keys(JSON.parse(raw))).not.toContain("surfaces");
  });

  test("malformed stored surfaces degrade gracefully on read", async () => {
    const cases: Array<{ sprint: number; surfaces: unknown; expected: unknown }> = [
      { sprint: 10, surfaces: null, expected: undefined },
      { sprint: 11, surfaces: "backend", expected: undefined },
      { sprint: 12, surfaces: { backend: true }, expected: undefined },
      { sprint: 13, surfaces: ["backend", "api", 42, null], expected: ["backend"] },
    ];
    for (const { sprint, surfaces } of cases) {
      const path = join(workDir, ".adhd", "contracts", `sprint-${sprint}.json`);
      await writeFile(
        path,
        JSON.stringify({ sprintNumber: sprint, features: ["x"], surfaces, criteria: [{ name: "c", description: "d", threshold: 7 }] }),
        "utf-8",
      );
    }
    expect((await readContract(workDir, 10)).surfaces).toBeUndefined();
    expect((await readContract(workDir, 11)).surfaces).toBeUndefined();
    expect((await readContract(workDir, 12)).surfaces).toBeUndefined();
    expect((await readContract(workDir, 13)).surfaces).toEqual(["backend"]);
  });
});
