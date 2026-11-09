// Rule test: only the files that differ from HEAD travel to a Boat machine, and a dropped or stalled
// transfer is retried on a fresh request before the run falls back, so a finished run's results are
// never thrown away for one reset.
import { expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { boatClient } from './boat-api';
import { transfer } from './boat-transfer';
import {
  changedSinceHead,
  fallbackLine,
  gitEnvironment,
  importResults,
  rebuiltTreeProblem,
  tarPackArguments,
  treeFiles,
} from './verify-on-boat';

/** A results archive as remote-verify.sh packs it: one report under .agent-logs/. */
function resultsArchive(): Uint8Array {
  const work = mkdtempSync(join(tmpdir(), 'boat-results-'));
  mkdirSync(join(work, '.agent-logs', 'verification', 'r1'), { recursive: true });
  writeFileSync(join(work, '.agent-logs', 'verification', 'r1', 'report.json'), '{"ok":true}');
  execFileSync('tar', ['-czf', join(work, 'results.tgz'), '.agent-logs'], { cwd: work });
  return readFileSync(join(work, 'results.tgz'));
}

const reset = () =>
  Object.assign(new TypeError('ECONNRESET: The socket connection was closed unexpectedly.'), {
    code: 'ECONNRESET',
  });

/** A machine whose results download answers each signed-URL read with `answers`' next entry. */
function machineAnswering(answers: (() => Response)[]) {
  const signedUrls: string[] = [];
  const client = boatClient('boat_secret', async (url, init) => {
    if (url.endsWith('/files/download-url')) {
      signedUrls.push(`https://box.example/results/${signedUrls.length}`);
      return Response.json({ url: signedUrls.at(-1) });
    }
    expect(init?.signal).toBeDefined();
    const answer = answers.shift();
    if (!answer) throw new Error('no answer left');
    return answer();
  });
  return { machine: { id: 'bx_test', client, log: () => undefined }, signedUrls };
}

function checkout() {
  return {
    folder: mkdtempSync(join(tmpdir(), 'boat-run-')),
    repository: mkdtempSync(join(tmpdir(), 'boat-checkout-')),
  };
}

test("a connection reset while the results come back retries on a fresh request and imports the run's results", async () => {
  const archive = resultsArchive();
  const { machine, signedUrls } = machineAnswering([
    () => {
      throw reset();
    },
    () => new Response(archive.slice()),
  ]);
  const run = checkout();
  const waits: number[] = [];
  const lines: string[] = [];
  await importResults(machine, run, {
    signal: new AbortController().signal,
    log: (line) => lines.push(line),
    wait: async (milliseconds) => {
      waits.push(milliseconds);
    },
  });
  expect(readFileSync(join(run.repository, '.agent-logs', 'verification', 'r1', 'report.json'), 'utf8')).toBe(
    '{"ok":true}',
  );
  // Each attempt asks Boat for its own signed URL.
  expect(signedUrls).toHaveLength(2);
  expect(waits).toEqual([2_000]);
  expect(lines).toEqual(['The results download failed (ECONNRESET); attempt 2 of 4 in 2 s.']);
});

test('a results download that fails on every attempt falls back after four fresh requests and writes nothing', async () => {
  const { machine, signedUrls } = machineAnswering(
    Array.from({ length: 4 }, () => () => {
      throw reset();
    }),
  );
  const run = checkout();
  const waits: number[] = [];
  const signal = new AbortController().signal;
  const failure = await importResults(machine, run, {
    signal,
    log: () => undefined,
    wait: async (milliseconds) => {
      waits.push(milliseconds);
    },
  }).catch((error: unknown) => error);
  expect(signedUrls).toHaveLength(4);
  expect(waits).toEqual([2_000, 10_000, 30_000]);
  expect(existsSync(join(run.repository, '.agent-logs'))).toBe(false);
  // runOnBoat turns the last failure into its one fallback line and runs the plan locally.
  expect(fallbackLine(failure, signal)).toBe(
    'Running locally: ECONNRESET: The socket connection was closed unexpectedly.',
  );
});

test('a refusal a retry cannot change, or an interruption, ends the download without a retry', async () => {
  const missing = machineAnswering([() => new Response('', { status: 404 })]);
  const waits: number[] = [];
  const wait = async (milliseconds: number) => {
    waits.push(milliseconds);
  };
  const refused = await importResults(missing.machine, checkout(), {
    signal: new AbortController().signal,
    log: () => undefined,
    wait,
  }).catch((error: unknown) => error);
  expect(refused instanceof Error && refused.message).toBe('download of /home/user/results.tgz: 404');
  expect(missing.signedUrls).toHaveLength(1);

  const interrupt = new AbortController();
  const interrupted = machineAnswering([
    () => {
      interrupt.abort();
      throw reset();
    },
  ]);
  const stopped = await importResults(interrupted.machine, checkout(), {
    signal: interrupt.signal,
    log: () => undefined,
    wait,
  }).catch((error: unknown) => error);
  expect(stopped instanceof Error && 'code' in stopped && stopped.code).toBe('ECONNRESET');
  expect(() => fallbackLine(stopped, interrupt.signal)).toThrow();
  expect(interrupted.signedUrls).toHaveLength(1);
  expect(waits).toEqual([]);
});

test('a stalled upload gives way to one fresh request at its deadline, and a second stall fails the upload', async () => {
  /** A machine whose upload PUTs stall until their signal aborts, `stalls` times, then succeed. */
  const stalling = (stalls: number) => {
    let puts = 0;
    const client = boatClient('boat_secret', async (url, init) => {
      if (url.endsWith('/files/upload-url')) return Response.json({ url: 'https://box.example/upload' });
      puts++;
      const signal = init?.signal;
      if (puts > stalls) return new Response(null, { status: 200 });
      return new Promise<Response>((_, fail) => signal?.addEventListener('abort', () => fail(signal.reason)));
    });
    return { client, puts: () => puts };
  };
  const policy = { waits: [2_000], attemptMs: 100 };
  const lines: string[] = [];
  const context = {
    signal: new AbortController().signal,
    log: (line: string) => lines.push(line),
    wait: async () => undefined,
  };
  const once = stalling(1);
  await transfer('The upload of tree.tgz', policy, context, (signal) =>
    once.client.upload('bx_test', '/home/user/tree.tgz', new Uint8Array([1]), signal),
  );
  expect(once.puts()).toBe(2);
  expect(lines).toEqual(['The upload of tree.tgz took longer than 0.1 s; attempt 2 of 2 in 2 s.']);

  const twice = stalling(2);
  const failure = await transfer('The upload of tree.tgz', policy, context, (signal) =>
    twice.client.upload('bx_test', '/home/user/tree.tgz', new Uint8Array([1]), signal),
  ).catch((error: unknown) => error);
  expect(twice.puts()).toBe(2);
  expect(failure instanceof Error && failure.message).toBe('The upload of tree.tgz took longer than 0.1 s.');
});

test('only the files that differ from HEAD travel, and the checkout they rebuild reads as changed where the workstation does', () => {
  const workstation = mkdtempSync(join(tmpdir(), 'boat-tree-'));
  const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env: gitEnvironment() });
  git(workstation, 'init', '-q');
  mkdirSync(join(workstation, 'lib'));
  for (const name of ['kept', 'changed', 'deleted', 'staged'])
    writeFileSync(join(workstation, `lib/${name}.ts`), `export const name = '${name}';\n`);
  git(workstation, 'add', '.');
  git(workstation, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'x');
  writeFileSync(join(workstation, 'lib/changed.ts'), 'export const name = 1;\n');
  writeFileSync(join(workstation, 'lib/staged.ts'), 'export const name = 2;\n');
  git(workstation, 'add', 'lib/staged.ts');
  rmSync(join(workstation, 'lib/deleted.ts'));
  writeFileSync(join(workstation, 'lib/new.ts'), 'export const name = 3;\n');

  const files = treeFiles(workstation);
  expect(files).toEqual(['lib/changed.ts', 'lib/new.ts', 'lib/staged.ts']);

  // The machine clones HEAD, unpacks the packed files over it and removes the deleted ones, as remote-verify.sh does.
  const folder = mkdtempSync(join(tmpdir(), 'boat-pack-'));
  const machine = join(folder, 'machine');
  execFileSync('git', ['clone', '-q', workstation, machine], { env: gitEnvironment() });
  writeFileSync(join(folder, 'tree.list'), files.join('\0'));
  const version = execFileSync('tar', ['--version'], { encoding: 'utf8' });
  execFileSync('tar', tarPackArguments(version, join(folder, 'tree.tgz'), join(folder, 'tree.list')), {
    cwd: workstation,
  });
  execFileSync('tar', ['--extract', '--gzip', '--file', join(folder, 'tree.tgz')], { cwd: machine });
  rmSync(join(machine, 'lib/deleted.ts'));
  expect(rebuiltTreeProblem(changedSinceHead(workstation), changedSinceHead(machine))).toBeUndefined();
  for (const name of ['kept', 'changed', 'staged', 'new'])
    expect(readFileSync(join(machine, `lib/${name}.ts`), 'utf8')).toBe(
      readFileSync(join(workstation, `lib/${name}.ts`), 'utf8'),
    );
});
