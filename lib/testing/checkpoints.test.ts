import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readCheckpoint, writeCheckpoint } from "./checkpoints";

const directories: string[] = [];
function temporaryPath(): string {
  const directory = mkdtempSync(join(tmpdir(), "werkflow-checkpoint-"));
  directories.push(directory);
  return join(directory, "checkpoints.json");
}
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

test("recovers exact persisted identity and a zero baseline without process memory", () => {
  const path = temporaryPath();
  writeCheckpoint(path, "world-one", "a3.personnelRecordId", "record-one");
  writeCheckpoint(path, "world-one", "a6.organizationTimeBaseline", 0);
  expect(readCheckpoint(path, "world-one", "a3.personnelRecordId")).toBe(
    "record-one",
  );
  expect(readCheckpoint(path, "world-one", "a6.organizationTimeBaseline")).toBe(
    0,
  );
  expect(
    readCheckpoint(path, "world-one", "a7.organizationTimeBaseline"),
  ).toBeUndefined();
});

test("refuses checkpoint reuse across disposable worlds", () => {
  const path = temporaryPath();
  writeCheckpoint(path, "original", "a1.signupOrganizationCode", "ABC123");
  expect(() =>
    readCheckpoint(path, "other", "a1.signupOrganizationCode"),
  ).toThrow("different test world");
  expect(() =>
    writeCheckpoint(path, "other", "a1.signupOrganizationCode", "DEF456"),
  ).toThrow("different test world");
});

test("does not treat corrupted checkpoint data as missing setup", () => {
  const path = temporaryPath();
  writeFileSync(
    path,
    JSON.stringify({
      version: 1,
      worldRunId: "world",
      values: { "a6.organizationTimeBaseline": "0" },
    }),
  );
  expect(() =>
    readCheckpoint(path, "world", "a6.organizationTimeBaseline"),
  ).toThrow();
});
