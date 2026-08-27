import { afterEach, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { withFileLock } from './file-lock';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('cross-process file lock', () => {
  test('serializes concurrent atomic JSON updates', async () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'werkflow-file-lock-'));
    temporaryDirectories.push(directory);
    const path = resolve(directory, 'counter.json');
    writeFileSync(path, '{"count":0}\n');
    const workerPath = resolve(import.meta.dir, 'file-lock-worker.ts');
    const workers = Array.from({ length: 4 }, () =>
      Bun.spawn([process.execPath, workerPath, path, '50'], {
        stdout: 'ignore',
        stderr: 'pipe',
      })
    );
    const results = await Promise.all(
      workers.map(async (worker) => ({
        exitCode: await worker.exited,
        stderr: await new Response(worker.stderr).text(),
      }))
    );
    expect(results, results.map((result) => result.stderr).join('\n')).toEqual(
      Array.from({ length: 4 }, () => ({ exitCode: 0, stderr: '' }))
    );
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ count: 200 });
    // This test proves lossless serialization, not speed: four spawned Bun
    // workers can be slow to start under host load (it intermittently crossed
    // 15s on 2026-08-27), and a latency-tripped failure here reads as a lock
    // bug. Generous budget on purpose; the count assertion is the contract.
  }, 60_000);

  test('never steals an old lock from another operation', () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'werkflow-file-lock-'));
    temporaryDirectories.push(directory);
    const lockPath = resolve(directory, 'manifest.json.lock');
    writeFileSync(lockPath, 'existing-owner');
    const oldTimestamp = new Date(Date.now() - 60_000);
    utimesSync(lockPath, oldTimestamp, oldTimestamp);

    expect(() =>
      withFileLock(lockPath, () => undefined, { timeoutMilliseconds: 50 })
    ).toThrow('Timed out waiting for file lock');
    expect(existsSync(lockPath)).toBe(true);
    expect(readFileSync(lockPath, 'utf8')).toBe('existing-owner');
  });
});
