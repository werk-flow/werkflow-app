// Rule test: only the files that differ from HEAD travel to a Boat machine, and a dropped or stalled
// transfer is retried on a fresh request before the run falls back, so a finished run's results are
// never thrown away for one reset.
import { expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { boatClient } from './boat-api';
import { transfer } from './boat-transfer';
import {
  changedSinceHead,
  gitEnvironment,
  importResults,
  rebuiltTreeProblem,
  tarPackArguments,
  treeFiles,
  unavailable,
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
  expect(lines[0]).toBe('The results download failed (ECONNRESET); attempt 2 of 4 in 2 s.');
  // The download's size and time follow, as the upload's do.
  expect(lines[1]).toMatch(/^Downloaded the results \(0\.0 MB\) in \d+\.\d s\.$/);
  expect(lines).toHaveLength(2);
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
  // runOnBoat turns the last failure into Boat's unavailability; only the cheap groups then run here.
  expect(unavailable(failure, signal)).toEqual({
    unavailable: 'ECONNRESET: The socket connection was closed unexpectedly.',
  });
});

test('a refused signed URL is signed afresh, and the run keeps its results', async () => {
  const archive = resultsArchive();
  const { machine, signedUrls } = machineAnswering([
    () => new Response('', { status: 403 }),
    () => new Response(archive.slice()),
  ]);
  const run = checkout();
  await importResults(machine, run, {
    signal: new AbortController().signal,
    log: () => undefined,
    wait: async () => undefined,
  });
  expect(signedUrls).toHaveLength(2);
  expect(existsSync(join(run.repository, '.agent-logs', 'verification', 'r1', 'report.json'))).toBe(true);
});

test("a refusal of Boat's API, or an interruption, ends the download without a retry", async () => {
  let signings = 0;
  const expired = boatClient('boat_secret', async () => {
    signings++;
    return Response.json({ error: { code: 'api_key_expired' } }, { status: 401 });
  });
  const waits: number[] = [];
  const wait = async (milliseconds: number) => {
    waits.push(milliseconds);
  };
  const refused = await importResults({ id: 'bx_test', client: expired, log: () => undefined }, checkout(), {
    signal: new AbortController().signal,
    log: () => undefined,
    wait,
  }).catch((error: unknown) => error);
  expect(refused instanceof Error && refused.message).toBe(
    'POST /sandboxes/bx_test/files/download-url: 401 api_key_expired',
  );
  expect(signings).toBe(1);

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
  expect(() => unavailable(stopped, interrupt.signal)).toThrow();
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

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, env: gitEnvironment(), encoding: 'utf8' });

/** A committed checkout with LF text, as this repository's .gitattributes keeps it, an executable and a link. */
function committedCheckout(): string {
  const workstation = mkdtempSync(join(tmpdir(), 'boat-tree-'));
  git(workstation, 'init', '-q');
  mkdirSync(join(workstation, 'lib'));
  writeFileSync(join(workstation, '.gitattributes'), '* text=auto eol=lf\n');
  for (const name of ['kept', 'changed', 'deleted', 'staged'])
    writeFileSync(join(workstation, `lib/${name}.ts`), `export const name = '${name}';\n`);
  writeFileSync(join(workstation, 'lib/run.sh'), '#!/bin/sh\n', { mode: 0o755 });
  symlinkSync('kept.ts', join(workstation, 'lib/link.ts'));
  git(workstation, 'add', '.');
  git(workstation, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'x');
  return workstation;
}

const packed = (workstation: string) => treeFiles(workstation, changedSinceHead(workstation));

test('only the files that differ from HEAD travel, and the checkout they rebuild reads as changed where the workstation does', () => {
  const workstation = committedCheckout();
  writeFileSync(join(workstation, 'lib/changed.ts'), 'export const name = 1;\n');
  writeFileSync(join(workstation, 'lib/staged.ts'), 'export const name = 2;\n');
  git(workstation, 'add', 'lib/staged.ts');
  rmSync(join(workstation, 'lib/deleted.ts'));
  writeFileSync(join(workstation, 'lib/new.ts'), 'export const name = 3;\n');

  const tree = packed(workstation);
  expect(tree).toEqual({ files: ['lib/changed.ts', 'lib/new.ts', 'lib/staged.ts'] });
  const files = 'files' in tree ? tree.files : [];

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

test('a file git reads as unchanged although it differs from HEAD keeps the run off Boat', () => {
  const hidden = (change: (workstation: string) => void) => {
    const workstation = committedCheckout();
    change(workstation);
    return packed(workstation);
  };
  const edit = (workstation: string) =>
    writeFileSync(join(workstation, 'lib/kept.ts'), 'export const name = 0;\n');
  // Each of these makes git read lib/kept.ts as unchanged, so the machine would check out HEAD's version.
  expect(
    hidden((workstation) => {
      edit(workstation);
      git(workstation, 'update-index', '--assume-unchanged', 'lib/kept.ts');
    }),
  ).toEqual({ hidden: 'lib/kept.ts' });
  expect(
    hidden((workstation) => {
      edit(workstation);
      git(workstation, 'update-index', '--skip-worktree', 'lib/kept.ts');
    }),
  ).toEqual({ hidden: 'lib/kept.ts' });
  expect(
    hidden((workstation) => {
      git(workstation, 'config', 'core.filemode', 'false');
      chmodSync(join(workstation, 'lib/kept.ts'), 0o755);
    }),
  ).toEqual({ hidden: 'lib/kept.ts' });
  const crlf = hidden((workstation) =>
    writeFileSync(join(workstation, 'lib/kept.ts'), "export const name = 'kept';\r\n"),
  );
  expect(crlf).toEqual({ hidden: 'lib/kept.ts' });
  expect(
    hidden((workstation) => {
      rmSync(join(workstation, 'lib/link.ts'));
      symlinkSync('changed.ts', join(workstation, 'lib/link.ts'));
      git(workstation, 'update-index', '--assume-unchanged', 'lib/link.ts');
    }),
  ).toEqual({ hidden: 'lib/link.ts' });
  // An untouched checkout with an executable and a link packs nothing.
  expect(packed(committedCheckout())).toEqual({ files: [] });
});

test('a stalled signing request ends at the attempt deadline and the interruption, not after 60 s', async () => {
  let signings = 0;
  const client = boatClient('boat_secret', async (url, init) => {
    if (!url.endsWith('/files/upload-url')) return new Response(null, { status: 200 });
    signings++;
    const signal = init?.signal;
    if (signings > 1) return Response.json({ url: 'https://box.example/upload' });
    return new Promise<Response>((_, fail) => signal?.addEventListener('abort', () => fail(signal.reason)));
  });
  const lines: string[] = [];
  await transfer(
    'The upload of tree.tgz',
    { waits: [2_000], attemptMs: 100 },
    { signal: new AbortController().signal, log: (line) => lines.push(line), wait: async () => undefined },
    (signal) => client.upload('bx_test', '/home/user/tree.tgz', new Uint8Array([1]), signal),
  );
  expect(signings).toBe(2);
  expect(lines).toEqual(['The upload of tree.tgz took longer than 0.1 s; attempt 2 of 2 in 2 s.']);

  // Ctrl-C while Boat has not answered the signing request ends the download at once.
  const neverSigns = boatClient('boat_secret', async (_url, init) => {
    const signal = init?.signal;
    return new Promise<Response>((_, fail) => signal?.addEventListener('abort', () => fail(signal.reason)));
  });
  const interrupt = new AbortController();
  const stalled = neverSigns
    .download('bx_test', '/home/user/results.tgz', interrupt.signal)
    .catch((error: unknown) => error);
  interrupt.abort();
  const outcome = await stalled;
  expect(outcome instanceof Error && outcome.name).toBe('AbortError');
});
