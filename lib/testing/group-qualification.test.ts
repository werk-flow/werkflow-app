import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createGroupQualification, directGroupRetryProblem } from "./group-qualification";
import { hashValue, type InputSnapshot } from "./group-evidence";
import type { TestGroup } from "./test-groups";

const groups: [TestGroup, TestGroup] = [
  { id: "golden:people", kind: "golden", files: ["tests/people.spec.ts"], scopes: ["personnel"], prerequisites: [], isolation: "group-world", timing: { requireFreshness: false, requireReadiness: false, exclusive: false } },
  { id: "golden:inventory", kind: "golden", files: ["tests/inventory.spec.ts"], scopes: ["inventory"], prerequisites: [], isolation: "group-world", timing: { requireFreshness: false, requireReadiness: false, exclusive: false } },
];
const unqualified = {
  runKey: "direct-failure", groupId: "golden:people", target: "local" as const,
  status: "failed" as const, startedAt: "2026-09-06T10:00:00.000Z", retainedAt: null, cleanedAt: "2026-09-06T10:01:00.000Z",
};
const failed = { ...unqualified, groupFingerprint: "group-inputs" };

test("an unrelated test edit cannot unlock a direct failure even without a parent report", () => {
  const root = mkdtempSync(join(tmpdir(), "werkflow-group-qualification-"));
  const sources = {
    "tests/people.spec.ts": "export const people = true;",
    "tests/inventory.spec.ts": "export const inventory = true;",
    "lib/personnel/rule.ts": "export const rule = 1;",
    "lib/inventory/rule.ts": "export const rule = 2;",
  };
  try {
    for (const [file, contents] of Object.entries(sources)) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), contents);
    }
    const snapshot: InputSnapshot = { version: 1, environment: hashValue("local"), files: Object.fromEntries(Object.entries(sources).map(([file, contents]) => [file, hashValue(contents)])) };
    const original = createGroupQualification(root, groups, snapshot).qualify(groups[0]);
    const unrelated = { ...snapshot, files: { ...snapshot.files, "tests/inventory.spec.ts": hashValue("unrelated edit") } };
    const current = createGroupQualification(root, groups, unrelated).qualify(groups[0]);
    expect(hashValue(unrelated)).not.toBe(hashValue(snapshot));
    expect(current.fingerprint).toBe(original.fingerprint);
    expect(directGroupRetryProblem({ groupId: groups[0].id, target: "local", fingerprint: current.fingerprint, runs: [{ ...failed, groupFingerprint: original.fingerprint }], recoveredRunKeys: [] })).toContain("unchanged group inputs");
    const repaired = { ...snapshot, files: { ...snapshot.files, "lib/personnel/rule.ts": hashValue("corrected rule") } };
    const repairedFingerprint = createGroupQualification(root, groups, repaired).qualify(groups[0]).fingerprint;
    expect(repairedFingerprint).not.toBe(original.fingerprint);
    expect(directGroupRetryProblem({ groupId: groups[0].id, target: "local", fingerprint: repairedFingerprint, runs: [{ ...failed, groupFingerprint: original.fingerprint }], recoveredRunKeys: [] })).toBeUndefined();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("editing a registered browser spec invalidates convention-unit proof without coupling another browser group", () => {
  const root = mkdtempSync(join(tmpdir(), "werkflow-unit-filesystem-inputs-"));
  const unit: TestGroup = { id: "unit:all", kind: "unit", files: ["lib/testing/conventions.test.ts"], scopes: ["*"], prerequisites: [], isolation: "process", timing: { requireFreshness: false, requireReadiness: false, exclusive: false } };
  const sql: TestGroup = { ...unit, id: "sql:inventory", kind: "sql", files: ["supabase/tests/inventory.sql"], scopes: ["inventory"] };
  const registered = [...groups, unit, sql];
  const sources = {
    "tests/people.spec.ts": "export const people = true;",
    "tests/inventory.spec.ts": "export const inventory = true;",
    "lib/testing/conventions.test.ts": "export const filesystemCensus = true;",
    "supabase/tests/inventory.sql": "select true;",
  };
  try {
    for (const [file, contents] of Object.entries(sources)) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), contents);
    }
    const snapshot: InputSnapshot = { version: 1, environment: hashValue("local"), files: Object.fromEntries(Object.entries(sources).map(([file, contents]) => [file, hashValue(contents)])) };
    const before = createGroupQualification(root, registered, snapshot);
    expect(before.qualify(unit).inputs).toContain("tests/inventory.spec.ts");
    const sqlEdit = { ...snapshot, files: { ...snapshot.files, "supabase/tests/inventory.sql": hashValue("changed assertion") } };
    expect(createGroupQualification(root, registered, sqlEdit).qualify(unit).fingerprint).not.toBe(before.qualify(unit).fingerprint);
    const edited = { ...snapshot, files: { ...snapshot.files, "tests/inventory.spec.ts": hashValue("broken browser convention") } };
    const after = createGroupQualification(root, registered, edited);
    expect(after.qualify(unit).fingerprint).not.toBe(before.qualify(unit).fingerprint);
    expect(after.qualify(groups[0]).fingerprint).toBe(before.qualify(groups[0]).fingerprint);
    expect(after.qualify(groups[1]).fingerprint).not.toBe(before.qualify(groups[1]).fingerprint);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("suite configuration, the component runner and lint rule modules qualify only the kind that executes them", () => {
  const root = mkdtempSync(join(tmpdir(), "werkflow-kind-owned-inputs-"));
  const timing = { requireFreshness: false, requireReadiness: false, exclusive: false } as const;
  const audit: TestGroup = { id: "audit:wave-1:a1", kind: "audit", files: ["tests/audit/a1.spec.ts"], scopes: ["personnel"], prerequisites: [], isolation: "group-world", timing };
  const ui: TestGroup = { id: "ui:contracts", kind: "ui", files: ["tests/ui-contracts/controls.spec.ts"], scopes: ["*"], prerequisites: [], isolation: "process", timing };
  const lint: TestGroup = { id: "static:lint", kind: "static", files: ["eslint.config.mjs"], scopes: ["*"], prerequisites: [], isolation: "process", timing };
  const unit: TestGroup = { id: "unit:all", kind: "unit", files: ["lib/example.test.ts"], scopes: ["*"], prerequisites: [], isolation: "process", timing };
  const registered = [groups[0], audit, ui, lint, unit];
  const sources = {
    "tests/people.spec.ts": "export const people = true;",
    "tests/audit/a1.spec.ts": "export const audit = true;",
    "tests/ui-contracts/controls.spec.ts": "export const controls = true;",
    "tests/ui-contracts/run.ts": "import { lock } from '../../lib/testing/workspace-test-lock'; export { lock };",
    "lib/testing/workspace-test-lock.ts": "export const lock = true;",
    "playwright.config.ts": "export default {};",
    "playwright.audit.config.ts": "export default {};",
    "eslint.config.mjs": "export default [];",
    "eslint-rules/ui-rules.mjs": "export const uiRules = [];",
    "bunfig.toml": "[test]",
    "lib/example.test.ts": "export const example = true;",
  };
  try {
    for (const [file, contents] of Object.entries(sources)) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), contents);
    }
    const snapshot: InputSnapshot = { version: 1, environment: hashValue("local"), files: Object.fromEntries(Object.entries(sources).map(([file, contents]) => [file, hashValue(contents)])) };
    const qualification = createGroupQualification(root, registered, snapshot);
    const golden = qualification.qualify(groups[0]).inputs;
    expect(golden).toContain("playwright.config.ts");
    for (const file of ["playwright.audit.config.ts", "tests/ui-contracts/run.ts", "lib/testing/workspace-test-lock.ts", "eslint-rules/ui-rules.mjs", "bunfig.toml"]) expect(golden).not.toContain(file);
    expect(qualification.qualify(audit).inputs).toContain("playwright.audit.config.ts");
    expect(qualification.qualify(audit).inputs).not.toContain("playwright.config.ts");
    const component = qualification.qualify(ui).inputs;
    expect(component).toContain("tests/ui-contracts/run.ts");
    expect(component).toContain("lib/testing/workspace-test-lock.ts");
    expect(qualification.qualify(lint).inputs).toContain("eslint-rules/ui-rules.mjs");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("canary support changes qualify providers and actual importers without invalidating unrelated browser groups", () => {
  const root = mkdtempSync(join(tmpdir(), "werkflow-provider-inputs-"));
  const canary: TestGroup = { ...groups[0], id: "canary:security", kind: "canary", files: ["tests/canary/security.spec.ts"], scopes: ["*"], isolation: "cloud-world" };
  const registered = [...groups, canary];
  const helper = "tests/canary/support/receiver.ts";
  const sources = {
    "tests/people.spec.ts": "export const people = true;",
    "tests/inventory.spec.ts": "import { receiver } from './canary/support/receiver'; export { receiver };",
    "tests/canary/security.spec.ts": "import { receiver } from './support/receiver'; export { receiver };",
    [helper]: "export const receiver = true;",
    "unknown-runtime.ts": "export const shared = true;",
  };
  try {
    for (const [file, contents] of Object.entries(sources)) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), contents);
    }
    const snapshot: InputSnapshot = { version: 1, environment: hashValue("local"), files: Object.fromEntries(Object.entries(sources).map(([file, contents]) => [file, hashValue(contents)])) };
    const before = createGroupQualification(root, registered, snapshot);
    const after = createGroupQualification(root, registered, { ...snapshot, files: { ...snapshot.files, [helper]: hashValue("repaired receiver") } });
    expect(after.qualify(groups[0]).fingerprint).toBe(before.qualify(groups[0]).fingerprint);
    expect(after.qualify(groups[1]).fingerprint).not.toBe(before.qualify(groups[1]).fingerprint);
    expect(after.qualify(canary).fingerprint).not.toBe(before.qualify(canary).fingerprint);
    expect(after.qualify(groups[0]).inputs).toContain("unknown-runtime.ts");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("one matching diagnosed environment recovery permits one further attempt", () => {
  const input = { groupId: failed.groupId, target: "local" as const, fingerprint: failed.groupFingerprint, recoveredRunKeys: [failed.runKey] };
  expect(directGroupRetryProblem({ ...input, runs: [failed] })).toBeUndefined();
  const second = { ...failed, runKey: "second-failure", startedAt: "2026-09-06T11:00:00.000Z" };
  expect(directGroupRetryProblem({ ...input, runs: [second, failed], recoveredRunKeys: [failed.runKey, second.runKey] })).toContain("unchanged group inputs");
});

test("a historical failure without group qualification cannot be escaped by a new fingerprint", () => {
  expect(directGroupRetryProblem({ groupId: failed.groupId, target: "local", fingerprint: "different", runs: [unqualified], recoveredRunKeys: [] })).toContain("historical run");
});

test("unfinished or retained ownership blocks a new attempt even after source changes", () => {
  const input = { groupId: failed.groupId, target: "local" as const, fingerprint: "different", recoveredRunKeys: [] };
  expect(directGroupRetryProblem({ ...input, runs: [{ ...failed, status: "running", cleanedAt: null }] })).toContain("unfinished run");
  expect(directGroupRetryProblem({ ...input, runs: [{ ...failed, status: "starting", cleanedAt: null }] })).toContain("unfinished run");
  expect(directGroupRetryProblem({ ...input, runs: [{ ...failed, retainedAt: failed.startedAt, cleanedAt: null }] })).toContain("retains world");
});

test("other group and target failures do not block an independent group", () => {
  expect(directGroupRetryProblem({ groupId: failed.groupId, target: "local", fingerprint: failed.groupFingerprint, recoveredRunKeys: [], runs: [
    { ...failed, groupId: "golden:inventory" }, { ...failed, target: "cloud" },
  ] })).toBeUndefined();
});

test("returning to failed inputs cannot hide that failure behind a different candidate pass", () => {
  expect(directGroupRetryProblem({ groupId: failed.groupId, target: "local", fingerprint: failed.groupFingerprint, recoveredRunKeys: [], runs: [
    failed, { ...failed, runKey: "other-input-pass", groupFingerprint: "different", status: "passed", startedAt: "2026-09-06T11:00:00.000Z" },
  ] })).toContain("unchanged group inputs");
});

test("performance contract, reference, profile and validator edits invalidate prior evidence", () => {
  const root = mkdtempSync(join(tmpdir(), "werkflow-performance-inputs-"));
  const measured: TestGroup = { ...groups[0], id: "audit:performance:calendar", kind: "audit", files: ["tests/audit/performance/calendar.spec.ts"], scopes: ["planning"] };
  const sources: Record<string, string> = {
    "tests/audit/performance/calendar.spec.ts": "import '../../golden/support/live'; import '../support/performance-profile';",
    "tests/golden/support/live.ts": "import '../../../lib/testing/latency-evidence'; import './browser-observation';",
    "tests/golden/support/browser-observation.ts": "export const detectionProtocol = 'browser-raf';",
    "tests/audit/support/performance-profile.ts": "export const count = 40;",
    "lib/testing/latency-evidence.ts": "import './performance-baselines'; import './measured-scenarios';",
    "lib/testing/measured-scenarios.ts": "export const budget = 500;",
    "lib/testing/performance-baselines.ts": "import './performance-baselines.json'; import './performance-context';",
    "lib/testing/performance-context.ts": "export const protocol = 1;",
    "lib/testing/performance-baselines.json": "{}",
  };
  try {
    for (const [file, contents] of Object.entries(sources)) {
      mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), contents);
    }
    const snapshot: InputSnapshot = { version: 1, environment: hashValue("local"), files: Object.fromEntries(Object.entries(sources).map(([file, contents]) => [file, hashValue(contents)])) };
    const before = createGroupQualification(root, [measured], snapshot).qualify(measured);
    for (const file of Object.keys(sources)) {
      expect(before.inputs).toContain(file);
      const changed = { ...snapshot, files: { ...snapshot.files, [file]: hashValue(`changed ${file}`) } };
      expect(createGroupQualification(root, [measured], changed).qualify(measured).fingerprint).not.toBe(before.fingerprint);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
