import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readCheckpoint, writeCheckpoint } from './checkpoints';

const directories: string[] = [];
function temporaryPath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'werkflow-checkpoint-'));
  directories.push(directory);
  return join(directory, 'checkpoints.json');
}
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

test('recovers an exact persisted value without process memory', () => {
  const path = temporaryPath();
  writeCheckpoint(path, 'world-one', 'performance.typicalProfile', {
    windowFrom: '2026-10-01',
    assignedJobNumber: 'AUF-1',
  });
  expect(readCheckpoint(path, 'world-one', 'performance.typicalProfile')).toEqual({
    windowFrom: '2026-10-01',
    assignedJobNumber: 'AUF-1',
  });
  expect(readCheckpoint(path, 'world-one', 'layout.details')).toBeUndefined();
});

test('refuses checkpoint reuse across disposable worlds', () => {
  const path = temporaryPath();
  writeCheckpoint(path, 'original', 'performance.typicalProfile', {
    windowFrom: '2026-10-01',
    assignedJobNumber: 'AUF-1',
  });
  expect(() => readCheckpoint(path, 'other', 'performance.typicalProfile')).toThrow('different test world');
  expect(() =>
    writeCheckpoint(path, 'other', 'performance.typicalProfile', {
      windowFrom: '2026-10-01',
      assignedJobNumber: 'AUF-1',
    }),
  ).toThrow('different test world');
});

test('does not treat corrupted checkpoint data as missing setup', () => {
  const path = temporaryPath();
  writeFileSync(
    path,
    JSON.stringify({
      version: 1,
      worldRunId: 'world',
      values: { 'performance.typicalProfile': { windowFrom: 'not-a-date', assignedJobNumber: 'AUF-1' } },
    }),
  );
  expect(() => readCheckpoint(path, 'world', 'performance.typicalProfile')).toThrow();
});
