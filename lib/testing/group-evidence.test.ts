import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { sourceImportGraph, UNKNOWN_IMPORT_DEPENDENCY, changedInputs, groupAttemptProblem, groupFingerprint, groupInputFiles, hashValue, INPUT_DRIFT_REASON, inputsUnchangedBetween, isDocumentationInput, reusableGroupResult, type EvidenceGroup, type GroupResult, type InputSnapshot } from "./group-evidence";

const groups: [EvidenceGroup, EvidenceGroup] = [
  { id: "people", files: ["tests/people.ts"], sourcePrefixes: ["lib/people"] },
  { id: "inventory", files: ["tests/inventory.ts"], sourcePrefixes: ["lib/inventory"] },
];
const files = ["lib/people/save.ts", "lib/inventory/read.ts", "tests/people.ts", "tests/inventory.ts", "lib/auth.ts"];
const snapshot: InputSnapshot = { version: 1, environment: hashValue("local"), files: Object.fromEntries(files.map((file) => [file, hashValue(file)])) };
const pass: GroupResult = { groupId: "people", fingerprint: hashValue("inputs"), status: "passed", startedAt: "2026-09-06T10:00:00.000Z", completedAt: "2026-09-06T10:01:00.000Z", durationMs: 60000, runKey: "run-one", buildId: "build-one", logPath: "log", reason: null };

test("runtime Markdown remains qualified while agent guidance uses current static checks", () => {
  expect(isDocumentationInput("app/help/page.mdx")).toBe(false);
  expect(isDocumentationInput("content/help.md")).toBe(false);
  expect(isDocumentationInput("docs/technical/testing.md")).toBe(true);
  expect(isDocumentationInput("AGENTS.md")).toBe(true);
  expect(isDocumentationInput(".agents/skills/testing/SKILL.md")).toBe(true);
  expect(isDocumentationInput("temporary-transcripts/security/video.txt")).toBe(true);
  expect(isDocumentationInput("temporary-transcripts/check-inventory.mjs")).toBe(true);
  expect(isDocumentationInput("temporary-transcripts-app/runtime.ts")).toBe(false);
  // Tooling no test executes (2026-09-14: an .mcp.json edit invalidated every browser proof).
  for (const file of [".mcp.json", ".coderabbit.yaml", ".gitignore", "supabase/.gitignore", "tests/audit/README.md", "tests/golden/support/notes.md"]) expect(isDocumentationInput(file)).toBe(true);
  for (const file of ["eslint-rules/ui-rules.mjs", "bunfig.toml", "tests/audit/fixtures/readme.txt", "lib/.gitignore-loader.ts", "app/mcp.json"]) expect(isDocumentationInput(file)).toBe(false);
});

describe("independent group proof", () => {
  test("unrelated owned changes preserve a group's proof; shared and imported changes invalidate it", () => {
    const selected = groupInputFiles({ group: groups[0], groups, files, graph: new Map() });
    expect(selected).toEqual(["lib/auth.ts", "lib/people/save.ts", "tests/people.ts"]);
    const original = groupFingerprint(groups[0], snapshot, selected);
    const change = (file: string): InputSnapshot => ({ ...snapshot, files: { ...snapshot.files, [file]: hashValue("changed") } });
    expect(groupFingerprint(groups[0], change("lib/inventory/read.ts"), selected)).toBe(original);
    expect(groupFingerprint(groups[0], change("lib/auth.ts"), selected)).not.toBe(original);
    const imported = groupInputFiles({ group: groups[0], groups, files, graph: new Map([["lib/people/save.ts", ["lib/inventory/read.ts"]]]) });
    expect(groupFingerprint(groups[0], change("lib/inventory/read.ts"), imported)).not.toBe(groupFingerprint(groups[0], snapshot, imported));
  });
  test("unknown additions, deletion, environment and group definition changes invalidate evidence", () => {
    const selected = groupInputFiles({ group: groups[0], groups, files, graph: new Map() });
    const original = groupFingerprint(groups[0], snapshot, selected);
    const unknownFiles = [...files, "new-server-entry.ts"];
    expect(groupInputFiles({ group: groups[0], groups, files: unknownFiles, graph: new Map() })).toContain("new-server-entry.ts");
    const removed = { ...snapshot, files: { ...snapshot.files } };
    delete removed.files["lib/people/save.ts"];
    expect(changedInputs(snapshot, removed)).toEqual(["lib/people/save.ts"]);
    expect(groupFingerprint(groups[0], removed, selected)).not.toBe(original);
    expect(groupFingerprint(groups[0], { ...snapshot, environment: hashValue("cloud") }, selected)).not.toBe(original);
    expect(groupFingerprint({ ...groups[0], sourcePrefixes: [...groups[0].sourcePrefixes, "lib/inventory"] }, snapshot, selected)).not.toBe(original);
  });
  test("never reuses a failed or blocked result, or an older pass hidden by a later failure", () => {
    expect(reusableGroupResult({ groupId: "people", fingerprint: pass.fingerprint, results: [pass] })).toBe(pass);
    const failed: GroupResult = { ...pass, startedAt: "2026-09-06T11:00:00.000Z", status: "failed" };
    expect(reusableGroupResult({ groupId: "people", fingerprint: pass.fingerprint, results: [pass, failed] })).toBeUndefined();
    expect(reusableGroupResult({ groupId: "people", fingerprint: hashValue("new"), results: [pass] })).toBeUndefined();
    expect(groupAttemptProblem({ groupId: "people", fingerprint: pass.fingerprint, results: [pass, failed] })).toContain("unchanged inputs");
    expect(groupAttemptProblem({ groupId: "people", fingerprint: hashValue("fixed"), results: [failed] })).toBeUndefined();
  });
  test("an attempt voided by an input change neither proves nor blocks the group", () => {
    const voided: GroupResult = { ...pass, startedAt: "2026-09-06T12:00:00.000Z", status: "failed", reason: `${INPUT_DRIFT_REASON}: tests/other.spec.ts` };
    expect(reusableGroupResult({ groupId: "people", fingerprint: pass.fingerprint, results: [pass, voided] })).toBe(pass);
    expect(groupAttemptProblem({ groupId: "people", fingerprint: pass.fingerprint, results: [voided] })).toBeUndefined();
  });
});


test("global entries invalidate consumers through owned transitive imports", () => {
  const extendedFiles = [...files, "lib/inventory/permission.ts"];
  const graph = new Map([
    ["lib/auth.ts", ["lib/inventory/read.ts"]],
    ["lib/inventory/read.ts", ["lib/inventory/permission.ts"]],
  ]);
  const selected = groupInputFiles({ group: groups[0], groups, files: extendedFiles, graph });
  expect(selected).toContain("lib/inventory/read.ts");
  expect(selected).toContain("lib/inventory/permission.ts");
  expect(selected).not.toContain("tests/inventory.ts");
  const original = groupFingerprint(groups[0], snapshot, selected);
  const changed = { ...snapshot, files: { ...snapshot.files, "lib/inventory/permission.ts": hashValue("changed-permission") } };
  expect(groupFingerprint(groups[0], changed, selected)).not.toBe(original);
});

test("already-selected shared imports are traversed and cycles terminate", () => {
  const graph = new Map([
    ["lib/people/save.ts", ["lib/auth.ts"]],
    ["lib/auth.ts", ["lib/inventory/read.ts"]],
    ["lib/inventory/read.ts", ["lib/auth.ts"]],
  ]);
  const selected = groupInputFiles({ group: groups[0], groups, files, graph });
  expect(selected).toContain("lib/inventory/read.ts");
  expect(selected.filter((file) => file === "lib/auth.ts")).toHaveLength(1);
  expect(selected).not.toContain("tests/inventory.ts");
});


function withImportFiles<T>(sources: Readonly<Record<string, string>>, check: (root: string, files: string[]) => T): T {
  const root = mkdtempSync(join(tmpdir(), "werkflow-import-graph-"));
  try {
    for (const [file, contents] of Object.entries(sources)) {
      const path = join(root, file);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, contents);
    }
    return check(root, Object.keys(sources));
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test("application and test imports cannot turn isolated research into unqualified runtime inputs", () => {
  for (const importer of ['app/page.tsx', 'tests/example.ts', 'scripts/example.ts']) {
    for (const declaration of [
      'import value from "@/temporary-transcripts/check.mjs";',
      'import value from "@/lib/../temporary-transcripts/check.mjs";',
      'export { value } from "../temporary-transcripts/check.mjs";',
      'const value = require("../temporary-transcripts/check.mjs");',
      'const value = import("../temporary-transcripts/check.mjs");',
    ]) {
      withImportFiles({ [importer]: declaration }, (root, listed) => {
        expect(() => sourceImportGraph(root, listed)).toThrow('imports isolated research input');
      });
    }
  }
});

test("computed and unresolved local imports invalidate all group inputs", () => {
  for (const source of [
    'export const load = (name: string) => import(name);',
    'export const load = () => import(`./${moduleName}`);',
    'export { value } from "./missing";',
    'import module = require("./missing");',
    'const module = require(moduleName);',
  ]) {
    withImportFiles({ "lib/people/save.ts": source, "lib/inventory/read.ts": "export const value = 1;" }, (root, listed) => {
      const graph = sourceImportGraph(root, listed);
      expect(graph.get("lib/people/save.ts")).toContain(UNKNOWN_IMPORT_DEPENDENCY);
      expect(groupInputFiles({ group: groups[0], groups, files: listed, graph })).toEqual([...listed].sort());
    });
  }
});

test("static relative and root imports follow source files including emitted extensions", () => {
  withImportFiles({
    "lib/people/save.ts": 'import { value } from "../inventory/read.js"; export const load = () => import(`@/lib/inventory/other`);',
    "lib/inventory/read.ts": "export const value = 1;",
    "lib/inventory/other.ts": "export const other = 2;",
  }, (root, listed) => {
    expect(sourceImportGraph(root, listed).get("lib/people/save.ts")).toEqual(["lib/inventory/read.ts", "lib/inventory/other.ts"]);
  });
});

test("ordinary calls and static external packages do not create false import dependencies", () => {
  withImportFiles({
    "lib/people/save.ts": 'import React from "react"; import { readFile } from "node:fs"; object.require(name); load(name); const text = "import(name)";',
  }, (root, listed) => {
    expect(sourceImportGraph(root, listed).get("lib/people/save.ts")).toEqual([]);
  });
});

test("additional TypeScript aliases fail broad rather than pretending to be external packages", () => {
  withImportFiles({
    "tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "domain/*": ["lib/*"] } } }),
    "lib/people/save.ts": 'import { value } from "domain/inventory/read";',
    "lib/inventory/read.ts": "export const value = 1;",
  }, (root, listed) => {
    const graph = sourceImportGraph(root, listed);
    expect(graph.get("lib/people/save.ts")).toContain(UNKNOWN_IMPORT_DEPENDENCY);
    expect(groupInputFiles({ group: groups[0], groups, files: listed, graph })).toEqual([...listed].sort());
  });
});

test("an unresolved import in an unrelated owned test does not select it", () => {
  withImportFiles({
    "tests/people.ts": "export const value = 1;",
    "tests/inventory.ts": "export const load = () => import(unknownName);",
  }, (root, listed) => {
    const selected = groupInputFiles({ group: groups[0], groups, files: listed, graph: sourceImportGraph(root, listed) });
    expect(selected).toEqual(["tests/people.ts"]);
  });
});


test("a remapped root alias cannot preserve the former import graph", () => {
  withImportFiles({
    "tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "@/*": ["different-root/*"] } } }),
    "tests/people.ts": 'import { value } from "@/lib/people/save";',
    "lib/people/save.ts": "export const value = 1;",
  }, (root, listed) => {
    expect(sourceImportGraph(root, listed).get("tests/people.ts")).toContain(UNKNOWN_IMPORT_DEPENDENCY);
  });
});

test("harness support modules qualify only the groups that import them; config-loaded helpers stay shared", () => {
  const harnessFiles = [...files, "tests/golden/support/live.ts", "tests/audit/support/a1-steps.ts", "tests/golden/support/run-reporter.ts", "lib/testing/latency-evidence.ts"];
  const graph = new Map([
    ["tests/people.ts", ["tests/golden/support/live.ts"]],
    ["tests/golden/support/live.ts", ["lib/testing/latency-evidence.ts"]],
  ]);
  const people = groupInputFiles({ group: groups[0], groups, files: harnessFiles, graph });
  expect(people).toContain("tests/golden/support/live.ts");
  expect(people).toContain("lib/testing/latency-evidence.ts");
  expect(people).not.toContain("tests/audit/support/a1-steps.ts");
  expect(people).toContain("tests/golden/support/run-reporter.ts");
  const inventory = groupInputFiles({ group: groups[1], groups, files: harnessFiles, graph });
  expect(inventory).not.toContain("tests/golden/support/live.ts");
  expect(inventory).not.toContain("lib/testing/latency-evidence.ts");
  expect(inventory).toContain("tests/golden/support/run-reporter.ts");
});

test("a pass recorded under a wider input set is reused when every current input is unchanged", () => {
  const inputs = ["lib/people/save.ts", "lib/auth.ts"];
  const recorded: GroupResult = { ...pass, fingerprint: hashValue("older-rule"), snapshot };
  expect(inputsUnchangedBetween(snapshot, snapshot, inputs)).toBe(true);
  expect(reusableGroupResult({ groupId: "people", fingerprint: hashValue("new-rule"), inputs, snapshot, results: [recorded] })).toBe(recorded);
  const changed = { ...snapshot, files: { ...snapshot.files, "lib/auth.ts": hashValue("changed-auth") } };
  expect(inputsUnchangedBetween(snapshot, changed, inputs)).toBe(false);
  expect(reusableGroupResult({ groupId: "people", fingerprint: hashValue("new-rule"), inputs, snapshot: changed, results: [recorded] })).toBeUndefined();
  const otherEnvironment = { ...snapshot, environment: hashValue("cloud") };
  expect(reusableGroupResult({ groupId: "people", fingerprint: hashValue("new-rule"), inputs, snapshot: otherEnvironment, results: [recorded] })).toBeUndefined();
  const laterFailure: GroupResult = { ...recorded, startedAt: "2026-09-06T11:00:00.000Z", status: "failed" };
  expect(reusableGroupResult({ groupId: "people", fingerprint: hashValue("new-rule"), inputs, snapshot, results: [recorded, laterFailure] })).toBeUndefined();
  expect(groupAttemptProblem({ groupId: "people", fingerprint: hashValue("new-rule"), inputs, snapshot, results: [recorded, laterFailure] })).toContain("unchanged inputs");
});
