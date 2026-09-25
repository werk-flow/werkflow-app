import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PREPARED_PLAN_ENV, preparedGroupRun, readPreparedPlan, writePreparedPlan, type PreparedPlan } from "./prepared-plan";

const plan: PreparedPlan = {
  version: 1,
  target: "local",
  preparedAt: "2026-09-25T08:00:00.000Z",
  buildId: "build-1",
  discoveries: {
    golden: [
      { id: "tests/golden/p1-06.spec.ts › a", file: "tests/golden/p1-06.spec.ts", title: "a", annotations: [] },
      { id: "tests/golden/p1-07.spec.ts › b", file: "tests/golden/p1-07.spec.ts", title: "b", annotations: [] },
    ],
  },
  groups: { "golden:p1-06": { fingerprint: "f1", runKey: "20260925T080000000Z-abc123" } },
};

test("a prepared plan round-trips through its file and the environment names it", () => {
  const directory = mkdtempSync(join(tmpdir(), "prepared-plan-"));
  try {
    const path = join(directory, "prepared-plan.json");
    writePreparedPlan(path, plan);
    expect(readPreparedPlan({})).toBeNull();
    expect(readPreparedPlan({ [PREPARED_PLAN_ENV]: path })).toEqual(plan);
    expect(() => readPreparedPlan({ [PREPARED_PLAN_ENV]: join(directory, "missing.json") })).toThrow("missing file");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a group run takes its identity and discovery from the plan and refuses a mismatch", () => {
  const run = preparedGroupRun(plan, { groupId: "golden:p1-06", suite: "golden", target: "local" });
  expect(run.runKey).toBe("20260925T080000000Z-abc123");
  expect(run.fingerprint).toBe("f1");
  expect(run.selection.total).toBe(2);
  expect(() => preparedGroupRun(plan, { groupId: "golden:p1-06", suite: "golden", target: "cloud" })).toThrow("targets local");
  expect(() => preparedGroupRun(plan, { groupId: "golden:p1-07", suite: "golden", target: "local" })).toThrow("no entry");
  expect(() => preparedGroupRun(plan, { groupId: "golden:p1-06", suite: "audit", target: "local" })).toThrow("no audit discovery");
});
