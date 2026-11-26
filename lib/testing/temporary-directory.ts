import { afterAll, afterEach, beforeEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The one way a unit test gets a temporary folder. The unit preload
// (scripts/unit-test-preload.ts) removes a folder made during a test after
// that test, and one made outside a test (at module scope, in a `beforeAll`)
// when the run ends. scripts/run-unit-tests.ts fails a run that leaves
// anything in its run-scoped TMPDIR (run-temporary-folder.ts).

const testFolders: string[] = [];
const runFolders: string[] = [];
let insideTest = false;

const removeAll = (folders: string[]): void => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
};

/** A new empty folder under the system temporary folder, removed after the test (or the run). */
export function temporaryDirectory(prefix: string): string {
  const folder = mkdtempSync(join(tmpdir(), prefix));
  (insideTest ? testFolders : runFolders).push(folder);
  return folder;
}

/** Registers the removal hooks; the unit preload calls it once, so they apply to every test file. */
export function registerTemporaryDirectoryCleanup(): void {
  beforeEach(() => {
    insideTest = true;
  });
  afterEach(() => {
    insideTest = false;
    removeAll(testFolders);
  });
  afterAll(() => removeAll(runFolders));
}
