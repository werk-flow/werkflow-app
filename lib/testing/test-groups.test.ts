import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { getGroupExecutionFiles, getGroupTimingRequirements, getTestGroups, listTestFiles, readGoldenPrerequisiteFiles, validateNamedTestPrerequisites, validateTestGroupInventory, type TestGroup } from "./test-groups";

function group(id: string, files: string[], prerequisites: string[] = []): TestGroup {
  return { id, files, prerequisites, kind: "golden", scopes: ["personnel"], isolation: "integrated-world", timing: { requireFreshness: false, requireReadiness: false, exclusive: false } };
}

describe("independent group registry", () => {
  test("a renamed or reordered producer fails before browser discovery or setup", () => {
    const producer = `test('save @FRESHNESS', async () => {});`;
    const consumer = (title: string): string => `test('read', {annotation: {type: 'requires-test', description: '${title}'}}, async () => {});`;
    expect(validateNamedTestPrerequisites(producer + consumer("save @FRESHNESS"), "fixture.ts")).toEqual([]);
    expect(validateNamedTestPrerequisites(producer + consumer("save"), "fixture.ts")[0]).toContain("unknown or ambiguous");
    expect(validateNamedTestPrerequisites(consumer("save @FRESHNESS") + producer, "fixture.ts")[0]).toContain("earlier producer");
    expect(validateNamedTestPrerequisites(producer + producer + consumer("save @FRESHNESS"), "fixture.ts")[0]).toContain("ambiguous");
    expect(validateNamedTestPrerequisites(`test('read', {annotation: {type: 'requires-test', description: variable}}, async () => {});`, "fixture.ts")[0]).toContain("literal test title");
  });
  test("expands only declared producers in the same journey and rejects cycles", () => {
    const producer = group("producer", ["producer.spec.ts"]);
    const consumer = group("consumer", ["consumer.spec.ts"], ["producer"]);
    expect(getGroupExecutionFiles(consumer, [consumer, producer])).toEqual(["producer.spec.ts", "consumer.spec.ts"]);
    expect(() => getGroupExecutionFiles(consumer, [consumer])).toThrow("Unknown test prerequisite");
    expect(() => getGroupExecutionFiles(consumer, [consumer, { ...producer, prerequisites: ["consumer"] }])).toThrow("Cyclic");
  });

  test("reads actual annotations, ignores misleading comments, refuses dynamic declarations", () => {
    const source = `// requires-file: fake.spec.ts
      test.describe('consumer', {annotation: {type: 'requires-file', description: 'tests/golden/p1-03.spec.ts'}}, () => {});`;
    expect(readGoldenPrerequisiteFiles(source, "consumer.ts")).toEqual(["tests/golden/p1-03.spec.ts"]);
    expect(() => readGoldenPrerequisiteFiles(`const value = {type: 'requires-file', description: fileName}`, "consumer.ts")).toThrow("literal file");
  });

  test("a new audit file cannot silently escape the executable inventory", () => {
    expect(validateTestGroupInventory([group("one", ["known.spec.ts"])], ["known.spec.ts", "new.spec.ts"])).toEqual(["Unregistered test file: new.spec.ts"]);
    expect(validateTestGroupInventory([group("one", ["same.spec.ts"]), group("two", ["same.spec.ts"])], [])).toContain("Test file has two owners: same.spec.ts (one, two)");
  });

  test("current audit groups are independent and the recorded Golden dependency is preserved", () => {
    const groups = getTestGroups(resolve(import.meta.dir, "../.."));
    const auditFiles = groups.filter((entry) => entry.kind === "audit").flatMap((entry) => entry.files).sort();
    expect(auditFiles).toEqual(listTestFiles(resolve(import.meta.dir, "../.."), "tests/audit", /\.spec\.ts$/));
    expect(groups.filter((entry) => entry.kind === "audit").every((entry) => entry.isolation === "group-world" && !entry.prerequisites.length)).toBe(true);
    const schedules = groups.find((entry) => entry.id === "golden:p1-04")!;
    expect(getGroupExecutionFiles(schedules, groups)).toEqual(["tests/golden/p1-03.spec.ts", "tests/golden/p1-04.spec.ts"]);
  });

  test("audit P1-22 cannot run concurrently when its readiness measurement lives in a helper", () => {
    const root = resolve(import.meta.dir, "../..");
    const groups = getTestGroups(root);
    const audit = groups.find((entry) => entry.id === "audit:wave-2:p1-22")!;
    expect(audit.timing).toEqual({ requireFreshness: false, requireReadiness: true, requiredScenarios: [], exclusive: true });
    // Clearing incidental caller metadata cannot erase the required helper contract.
    expect(getGroupTimingRequirements({ ...audit, timing: { requireFreshness: false, requireReadiness: false, exclusive: false } }, groups, root))
      .toEqual({ requireFreshness: false, requireReadiness: true, requiredScenarios: [], exclusive: true });
    expect(getGroupTimingRequirements(groups.find((entry) => entry.id === "golden:p1-22")!, groups, root).requireReadiness).toBe(true);
    expect(getGroupTimingRequirements(groups.find((entry) => entry.id === "golden:integrated")!, groups, root))
      .toEqual({ requireFreshness: true, requireReadiness: true, requiredScenarios: [], exclusive: true });
  });

  test("all declared freshness scopes reserve exclusive measurement time", () => {
    const groups = getTestGroups(resolve(import.meta.dir, "../.."));
    const measured = groups.filter((entry) => entry.id !== "golden:integrated" && entry.timing.requireFreshness);
    expect(measured).toHaveLength(10);
    expect(measured.every((entry) => entry.timing.exclusive)).toBe(true);
  });

  test("measured scenarios pin their spec, force exclusive scheduling, and cannot drift from source", () => {
    const root = resolve(import.meta.dir, "../..");
    const groups = getTestGroups(root);
    const performance = groups.find((entry) => entry.id === "audit:performance:calendar")!;
    expect(performance.timing.exclusive).toBe(true);
    expect(performance.timing.requiredScenarios).toContain("calendar.board-to-day.covered");
    const planning = getGroupTimingRequirements(groups.find((entry) => entry.id === "golden:p1-11")!, groups, root);
    expect(planning.requireFreshness).toBe(true);
    expect(planning.requireReadiness).toBe(true);
    expect(planning.requiredScenarios).toEqual([]);
    const benchmark = getGroupTimingRequirements(groups.find((entry) => entry.id === "audit:performance:planning")!, groups, root);
    expect(benchmark.exclusive).toBe(true);
    expect(benchmark.requiredScenarios).toEqual(["planning.occurrence.cross-session", "calendar.month.employee-open-to-event", "calendar.month.admin-open-to-legacy-event"]);
    const untimed = groups.find((entry) => entry.id === "audit:wave-1:a2")!;
    expect(getGroupTimingRequirements(untimed, groups, root).requiredScenarios).toEqual([]);
  });
});
