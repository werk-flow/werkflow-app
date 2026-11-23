import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { withFileLock } from './file-lock';
import { temporaryDirectory } from '../temporary-directory';

describe('cross-process file lock', () => {
  test('serializes concurrent atomic JSON updates', async () => {
    const directory = temporaryDirectory('werkflow-file-lock-');
    const path = resolve(directory, 'counter.json');
    writeFileSync(path, '{"count":0}\n');
    const workerPath = resolve(import.meta.dir, 'file-lock-worker.ts');
    const workers = Array.from({ length: 4 }, () =>
      Bun.spawn([process.execPath, workerPath, path, '50'], {
        stdout: 'ignore',
        stderr: 'pipe',
      }),
    );
    const results = await Promise.all(
      workers.map(async (worker) => ({
        exitCode: await worker.exited,
        stderr: await new Response(worker.stderr).text(),
      })),
    );
    expect(results, results.map((result) => result.stderr).join('\n')).toEqual(
      Array.from({ length: 4 }, () => ({ exitCode: 0, stderr: '' })),
    );
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ count: 200 });
    // This test proves lossless serialization, not speed: four spawned Bun
    // workers can be slow to start under host load (it intermittently crossed
    // 15s on 2026-08-27), and a latency-tripped failure here reads as a lock
    // bug. Generous budget on purpose; the count assertion is the contract.
  });

  test('never steals an old lock from another operation', () => {
    const directory = temporaryDirectory('werkflow-file-lock-');
    const lockPath = resolve(directory, 'manifest.json.lock');
    writeFileSync(lockPath, 'existing-owner');
    const oldTimestamp = new Date('2026-01-02T10:00:00.000Z');
    utimesSync(lockPath, oldTimestamp, oldTimestamp);

    expect(() => withFileLock(lockPath, () => undefined, { timeoutMilliseconds: 50 })).toThrow(
      'Timed out waiting for file lock',
    );
    expect(existsSync(lockPath)).toBe(true);
    expect(readFileSync(lockPath, 'utf8')).toBe('existing-owner');
  });
});
