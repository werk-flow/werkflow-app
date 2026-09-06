import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createGroupQualification, directGroupRetryProblem } from "./group-qualification";
import { hashValue, type InputSnapshot } from "./group-evidence";
import type { TestGroup } from "./test-groups";

const groups: TestGroup[] = [
  { id: "golden:people", kind: "golden", files: ["tests/people.spec.ts"], scopes: ["personnel"], prerequisites: [], isolation: "group-world", timing: { requireFreshness: false, requireReadiness: false, exclusive: false } },
  { id: "golden:inventory", kind: "golden", files: ["tests/inventory.spec.ts"], scopes: ["inventory"], prerequisites: [], isolation: "group-world", timing: { requireFreshness: false, requireReadiness: false, exclusive: false } },
];
const failed = {
  runKey: "direct-failure", groupId: "golden:people", groupFingerprint: "group-inputs", target: "local" as const,
  status: "failed" as const, startedAt: "2026-09-06T10:00:00.000Z", retainedAt: null, cleanedAt: "2026-09-06T10:01:00.000Z",
};

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

test("one matching diagnosed environment recovery permits one further attempt", () => {
  const input = { groupId: failed.groupId, target: "local" as const, fingerprint: failed.groupFingerprint, recoveredRunKeys: [failed.runKey] };
  expect(directGroupRetryProblem({ ...input, runs: [failed] })).toBeUndefined();
  const second = { ...failed, runKey: "second-failure", startedAt: "2026-09-06T11:00:00.000Z" };
  expect(directGroupRetryProblem({ ...input, runs: [second, failed], recoveredRunKeys: [failed.runKey, second.runKey] })).toContain("unchanged group inputs");
});

test("a historical failure without group qualification cannot be escaped by a new fingerprint", () => {
  expect(directGroupRetryProblem({ groupId: failed.groupId, target: "local", fingerprint: "different", runs: [{ ...failed, groupFingerprint: undefined }], recoveredRunKeys: [] })).toContain("historical run");
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
