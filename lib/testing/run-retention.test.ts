import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { archiveSizeProblem, citedRunKeys, prunableArchiveBytes, prunableRunKeys, type RetentionRun } from "./run-retention";

const now = Date.parse("2026-09-14T12:00:00.000Z");
const old = "2026-09-12T10:00:00.000Z";
function run(runKey: string, overrides: Partial<RetentionRun> = {}): RetentionRun {
  return { runKey, status: "passed", startedAt: old, completedAt: old, retainedAt: null, cleanedAt: old, world: { runId: runKey }, ...overrides };
}

test("current proofs and reviewed references keep their runs; superseded results do not", () => {
  const cited = citedRunKeys({
    reports: [
      { target: "local", results: [{ groupId: "audit:a", status: "passed", startedAt: "2026-09-13T10:00:00.000Z", runKey: "older-pass" }] },
      { target: "local", results: [{ groupId: "audit:a", status: "passed", startedAt: "2026-09-13T11:00:00.000Z", runKey: "latest-pass" }, { groupId: "audit:b", status: "failed", startedAt: "2026-09-13T11:30:00.000Z", runKey: "latest-failure" }] },
      { target: "cloud", results: [{ groupId: "audit:a", status: "passed", startedAt: "2026-09-13T09:00:00.000Z", runKey: "cloud-pass" }] },
    ],
    baselineRunKeys: ["reference-run"],
  });
  expect([...cited].sort()).toEqual(["cloud-pass", "latest-pass", "reference-run"]);
});

test("only completed, cleaned, uncited runs older than a day are prunable", () => {
  const runs = [
    run("prunable"),
    run("no-world", { world: null, cleanedAt: null }),
    run("cited"),
    run("retained", { status: "failed_retained", retainedAt: old, cleanedAt: null }),
    run("uncleaned", { status: "failed", cleanedAt: null }),
    run("running", { status: "running", completedAt: null }),
    run("interrupted", { status: "interrupted" }),
    run("fresh", { startedAt: "2026-09-14T00:00:00.000Z", completedAt: "2026-09-14T01:00:00.000Z" }),
    run("already", { prunedAt: old }),
    run("diagnostic", { status: "diagnostic_passed" }),
  ];
  expect(prunableRunKeys({ runs, cited: new Set(["cited"]), now })).toEqual(["prunable", "no-world", "diagnostic"]);
});

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

test("the size scan counts only the prunable directories and the guard names the command", () => {
  const root = mkdtempSync(join(tmpdir(), "werkflow-run-retention-"));
  directories.push(root);
  mkdirSync(join(root, "run-a/playwright/results"), { recursive: true });
  mkdirSync(join(root, "run-a/active"), { recursive: true });
  mkdirSync(join(root, "run-a/state"), { recursive: true });
  writeFileSync(join(root, "run-a/playwright/results/trace.zip"), Buffer.alloc(1000));
  writeFileSync(join(root, "run-a/active/world.json"), Buffer.alloc(200));
  writeFileSync(join(root, "run-a/state/world.json"), Buffer.alloc(300));
  writeFileSync(join(root, "run-a/manifest.json"), Buffer.alloc(50));
  expect(prunableArchiveBytes(root)).toBe(1200);
  expect(prunableArchiveBytes(root, ["run-a"])).toBe(1200);
  expect(prunableArchiveBytes(join(root, "missing"))).toBe(0);
  expect(archiveSizeProblem(1200, 2000)).toBeUndefined();
  expect(archiveSizeProblem(3000, 2000)).toContain("bun run test:runs prune");
});
