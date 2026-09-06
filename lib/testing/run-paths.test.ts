import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { browserRunPaths, manifestActiveStateDirectory } from './run-paths';
import { artifactsDirectory, storageStatePath, worldFilePath } from '../../tests/golden/support/world';

describe('browser run ownership', () => {
  test('world and session paths resolve ownership after import and follow only the selected run', () => {
    const previousRunKey = process.env.WERKFLOW_RUN_KEY;
    try {
      delete process.env.WERKFLOW_RUN_KEY;
      expect(() => artifactsDirectory()).toThrow('WERKFLOW_RUN_KEY was not configured');
      process.env.WERKFLOW_RUN_KEY = 'first-owner';
      const firstWorld = worldFilePath();
      const firstSession = storageStatePath('employee');
      process.env.WERKFLOW_RUN_KEY = 'second-owner';
      expect(worldFilePath()).not.toBe(firstWorld);
      expect(storageStatePath('employee')).not.toBe(firstSession);
      expect(worldFilePath('first-owner')).toBe(firstWorld);
      expect(storageStatePath('employee', 'first-owner')).toBe(firstSession);
    } finally {
      if (previousRunKey === undefined) delete process.env.WERKFLOW_RUN_KEY;
      else process.env.WERKFLOW_RUN_KEY = previousRunKey;
    }
  });

  test('uses the requested owner for current recovery and only explicit history uses legacy state', () => {
    const root = resolve('/workspace');
    expect(manifestActiveStateDirectory(root, { runKey: 'old' })).toBe(resolve(root, 'tests/golden/.artifacts'));
    expect(manifestActiveStateDirectory(root, { runKey: 'requested', artifactLayout: 'run-owned-v1' }))
      .toBe(browserRunPaths(root, 'requested').activeState);
    expect(() => manifestActiveStateDirectory(root, { runKey: 'requested', artifactLayout: 'unknown' }))
      .toThrow('Unsupported browser artifact layout');
  });

  test('rejects traversal, absolute paths, and empty owners', () => {
    for (const runKey of ['', '..', '../other', 'a/other', 'a\\other', '/tmp/other', 'C:\\other', 'a..b']) {
      expect(() => browserRunPaths('/workspace', runKey)).toThrow('Invalid run key');
    }
  });

  test('clearing one failed group cannot remove another group state or results', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'werkflow-run-paths-'));
    try {
      const failed = browserRunPaths(root, 'failed-group');
      const unrelated = browserRunPaths(root, 'unrelated-group');
      for (const paths of [failed, unrelated]) {
        for (const directory of [paths.activeState, paths.archivedState, paths.results, paths.report]) {
          mkdirSync(directory, { recursive: true });
          writeFileSync(resolve(directory, 'ownership.json'), paths.directory);
        }
      }
      rmSync(failed.directory, { recursive: true });
      for (const directory of [unrelated.activeState, unrelated.archivedState, unrelated.results, unrelated.report]) {
        expect(readFileSync(resolve(directory, 'ownership.json'), 'utf8')).toBe(unrelated.directory);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
