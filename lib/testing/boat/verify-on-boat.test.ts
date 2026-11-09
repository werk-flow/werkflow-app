// Rule test: test:verify picks Boat only where a Boat run proves the same thing as a local one,
// falls back to the local run on any Boat failure, and an unusable key says so in one line.
import { expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  renameSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BoatError, boatClient } from './boat-api';
import { readBoatKey } from './boat-key';
import { createMachine, runScript } from './boat-machine';
import { backendValueDigests } from '../evidence/proof-environment';
import {
  boatFailure,
  changedSinceHead,
  fallbackLine,
  gitEnvironment,
  copyResults,
  evidenceFiles,
  localReason,
  machineBoundGroup,
  placeFiles,
  prepareAndRun,
  rebuiltTreeProblem,
  runOnBoat,
  tarPackArguments,
  unpackResults,
  withMachine,
  linkedDestination,
  withheldFile,
} from './verify-on-boat';

test('change plans and ordinary groups may run on Boat', () => {
  expect(localReason([], {})).toBeUndefined();
  expect(localReason(['--group', 'sql:security,golden:gg-00'], {})).toBeUndefined();
  expect(localReason(['--mode', 'change'], {})).toBeUndefined();
  // Lab counts repeat on any machine; every product change selects both lab groups.
  expect(localReason(['--group', 'audit:lab:office,audit:lab:field'], {})).toBeUndefined();
});

test('runs that measure this machine, reach DEV or are asked local stay local', () => {
  expect(localReason(['--mode', 'release'], {})).toContain('release mode');
  expect(localReason(['--target', 'cloud'], {})).toContain('DEV');
  for (const group of ['audit:performance:calendar', 'audit:visual', 'audit:layout-field'])
    expect(localReason(['--group', `sql:security,${group}`], {}), group).toContain('references');
  expect(localReason([], { WERKFLOW_VERIFY_LOCAL: '1' })).toContain('WERKFLOW_VERIFY_LOCAL');
  // CI and the Boat machine itself run locally without a line.
  expect(localReason([], { CI: 'true' })).toBe('');
  expect(localReason([], { WERKFLOW_BOAT_MACHINE: '1' })).toBe('');
});

function keyFolder(files: Record<string, string>, folderMode = 0o700, keyMode = 0o600): string {
  const folder = join(mkdtempSync(join(tmpdir(), 'boat-key-')), 'werkflow');
  mkdirSync(folder);
  for (const [name, text] of Object.entries(files)) writeFileSync(join(folder, name), text);
  chmodSync(folder, folderMode);
  if (files['boat-api-key'] !== undefined) chmodSync(join(folder, 'boat-api-key'), keyMode);
  return folder;
}
const now = new Date('2026-11-08T07:00:00Z');

test('a workstation without a key runs locally without a line', () => {
  expect(readBoatKey(keyFolder({}), now)).toEqual({ kind: 'absent' });
});

test('a usable key reminds the owner within 14 days of its expiry', () => {
  const fresh = readBoatKey(
    keyFolder({ 'boat-api-key': 'boat_abc\n', 'boat-api-key.expires': '2027-02-06\n' }),
    now,
  );
  expect(fresh).toEqual({ kind: 'usable', key: 'boat_abc', expiresOn: '2027-02-06', reminder: undefined });
  const soon = readBoatKey(
    keyFolder({ 'boat-api-key': 'boat_abc', 'boat-api-key.expires': '2026-11-20' }),
    now,
  );
  expect(soon.kind === 'usable' && soon.reminder).toContain('expires on 2026-11-20, in 12 days');
});

test('an expired, malformed or exposed key falls back to local with the reason', () => {
  const expired = readBoatKey(
    keyFolder({ 'boat-api-key': 'boat_abc', 'boat-api-key.expires': '2026-11-08' }),
    now,
  );
  expect(expired.kind === 'unusable' && expired.reason).toContain('expired on 2026-11-08');
  expect(expired.kind === 'unusable' && expired.reason).toContain('Renew it');
  const malformed = readBoatKey(keyFolder({ 'boat-api-key': 'boat_abc\nsecond line' }), now);
  expect(malformed.kind).toBe('unusable');
  const exposed = readBoatKey(keyFolder({ 'boat-api-key': 'boat_abc' }, 0o700, 0o644), now);
  expect(exposed.kind === 'unusable' && exposed.reason).toContain('chmod');
  // A key file the read fails on, such as one being replaced. A directory fails the read for every
  // user; a mode-200 file does not where the process may read any file, as on a Boat machine.
  const unreadable = keyFolder({});
  mkdirSync(join(unreadable, 'boat-api-key'), { mode: 0o700 });
  expect(readBoatKey(unreadable, now)).toEqual({
    kind: 'unusable',
    reason: 'the key file could not be read.',
  });
});

test('a Boat refusal keeps its status and code, and the key never appears in a message', async () => {
  const client = boatClient('boat_secret', async () =>
    Response.json(
      // A provider body may echo the request; none of it may reach a message or a log.
      {
        ok: false,
        code: 'api_key_expired',
        error: { code: 'api_key_expired', message: 'Bearer boat_secret expired' },
      },
      { status: 403 },
    ),
  );
  const failure = await client.create({ type: 'large' }, 'request-1').catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(BoatError);
  expect(failure instanceof BoatError && [failure.status, failure.code]).toEqual([403, 'api_key_expired']);
  expect(String(failure)).not.toContain('boat_secret');
});

test('a command streams its output in order and reports its exit and a memory kill', async () => {
  const frames = [
    {
      status: 'running',
      running: true,
      exitCode: null,
      stdout: 'one\n',
      stderr: '',
      stdoutNextOffset: 4,
      stderrNextOffset: 0,
    },
    {
      status: 'exited',
      running: false,
      exitCode: 137,
      oomKilled: true,
      stdout: 'two\n',
      stderr: 'killed\n',
      stdoutNextOffset: 8,
      stderrNextOffset: 7,
    },
  ];
  const offsets: string[] = [];
  const client = boatClient('boat_secret', async (url) => {
    if (url.endsWith('/commands')) return Response.json({ processId: 7 });
    offsets.push(new URL(url).search);
    return Response.json(frames.shift());
  });
  let out = '';
  let err = '';
  const result = await runScript({ id: 'bx_test', client, log: () => undefined, pollMs: 1 }, 'true', {
    stdout: (text) => (out += text),
    stderr: (text) => (err += text),
  });
  expect(result).toEqual({ exitCode: 137, oomKilled: true });
  expect([out, err]).toEqual(['one\ntwo\n', 'killed\n']);
  expect(offsets).toEqual(['?stdoutOffset=0&stderrOffset=0', '?stdoutOffset=4&stderrOffset=0']);
});

test('each Boat refusal becomes one fallback line, and a rejected key says how to renew', () => {
  expect(boatFailure(new BoatError(503, 'no_ready_machine', 'POST /sandboxes: 503'))).toBe(
    'Boat answered 503 no_ready_machine.',
  );
  expect(boatFailure(new BoatError(429, 'member_limit_reached', 'POST /sandboxes: 429'))).toBe(
    'Boat answered 429 member_limit_reached.',
  );
  for (const refusal of [new BoatError(403, 'api_key_expired', ''), new BoatError(401, 'unauthorized', '')])
    expect(boatFailure(refusal)).toContain('Renew it in the Boat dashboard');
});

test('an untracked credential or local setting stays on the workstation', () => {
  for (const file of [
    '.npmrc',
    '.netrc',
    '.git-credentials',
    '.env.preview',
    'lib/.pgpass',
    'certs/dev.pem',
    'id_ed25519',
    'r2-token.txt',
  ])
    expect(withheldFile(['lib/new-module.ts', file]), file).toBe(file);
  expect(
    withheldFile(['lib/new-module.ts', '.claude/skills/new/SKILL.md', 'tests/golden/new.spec.ts']),
  ).toBeUndefined();
});

test('a plan that runs a measuring or capturing group stays local, whatever selected it', () => {
  const plan = [
    'RUN   static:lint | Static gate | 12 proof inputs | missing or changed proof',
    'REUSE audit:lab:office | Changed spec | 30 proof inputs | passed 2026-11-07',
    'RUN   audit:visual | Changed spec | 30 proof inputs | no pass since selection',
  ].join('\n');
  expect(machineBoundGroup(plan)).toBe('audit:visual');
  expect(
    machineBoundGroup('RUN   golden:gg-00 | Critical journey | 9 proof inputs | no pass'),
  ).toBeUndefined();
});

test('the backend comparison covers every source the proof digest reads, but no workstation credential', () => {
  const folder = mkdtempSync(join(tmpdir(), 'proof-env-'));
  writeFileSync(
    join(folder, '.env.local'),
    'NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321\nSUPABASE_ACCESS_TOKEN=sbp_x\nEMAIL_OTP_HASH_SECRET=y\n',
  );
  writeFileSync(join(folder, '.env'), 'R2_BUCKET_NAME=werkflow-documents-local\n');
  const digests = backendValueDigests(folder, {
    NEXT_PUBLIC_EXTRA: 'z',
    SUPABASE_ACCESS_TOKEN: 'sbp_x',
    PATH: '/bin',
  });
  expect(Object.keys(digests).sort()).toEqual([
    '.env.local:NEXT_PUBLIC_SUPABASE_URL',
    '.env:R2_BUCKET_NAME',
    'process:NEXT_PUBLIC_EXTRA',
    'usable:EMAIL_OTP_HASH_SECRET',
  ]);
  expect(digests['usable:EMAIL_OTP_HASH_SECRET']).toBe('usable');
  // The WSL address is transport: any private stack origin compares equal.
  writeFileSync(join(folder, '.env.local'), 'NEXT_PUBLIC_SUPABASE_URL=http://172.20.0.5:54321\n');
  expect(backendValueDigests(folder, {})['.env.local:NEXT_PUBLIC_SUPABASE_URL']).toBe(
    digests['.env.local:NEXT_PUBLIC_SUPABASE_URL'],
  );
});

test('only planning metadata of local runs goes to Boat, never a world and never a cloud run', () => {
  const repository = mkdtempSync(join(tmpdir(), 'boat-evidence-'));
  const write = (path: string, text = '{}') => {
    mkdirSync(join(repository, path, '..'), { recursive: true });
    writeFileSync(join(repository, path), text);
  };
  write('.agent-logs/verification/r1/report.json');
  write('.agent-logs/verification/r1/diagnoses.json');
  write('.agent-logs/verification/r1/static-lint.log', 'log');
  for (const [key, target] of [
    ['local-run', 'local'],
    ['cloud-run', 'cloud'],
  ]) {
    const run = `.agent-logs/playwright-runs/${key}`;
    write(`${run}/manifest.json`, JSON.stringify({ target }));
    write(`${run}/latency-summary.json`);
    write(`${run}/live-latencies.ndjson`, '');
    write(`${run}/state/world.json`, JSON.stringify({ password: 'dev-password' }));
    write(`${run}/active/world.json`);
    write(`${run}/runner.log`, 'log');
  }
  expect(evidenceFiles(repository).sort()).toEqual([
    '.agent-logs/playwright-runs/local-run/latency-summary.json',
    '.agent-logs/playwright-runs/local-run/live-latencies.ndjson',
    '.agent-logs/playwright-runs/local-run/manifest.json',
    '.agent-logs/verification/r1/diagnoses.json',
    '.agent-logs/verification/r1/report.json',
  ]);
});

test('a Boat proof stands for a workstation only where its code-hash secret is usable', () => {
  const folder = mkdtempSync(join(tmpdir(), 'proof-otp-'));
  const secret = (fileLine: string, environment: Record<string, string>) => {
    writeFileSync(join(folder, '.env.local'), fileLine);
    return backendValueDigests(folder, environment)['usable:EMAIL_OTP_HASH_SECRET'];
  };
  // A Boat machine exports a drawn secret; its .env.local holds none.
  const boat = secret('', { EMAIL_OTP_HASH_SECRET: 'drawn-per-run' });
  expect(secret('EMAIL_OTP_HASH_SECRET=local-secret\n', {})).toBe(boat);
  for (const missing of [
    secret('EMAIL_OTP_HASH_SECRET=\n', {}),
    secret('', {}),
    secret('EMAIL_OTP_HASH_SECRET=x\n', { EMAIL_OTP_HASH_SECRET: ' ' }),
  ])
    expect(missing).not.toBe(boat);
});

test('results never unpack through a symbolic link that already exists in the checkout', () => {
  const repository = mkdtempSync(join(tmpdir(), 'boat-links-'));
  const outside = mkdtempSync(join(tmpdir(), 'boat-outside-'));
  mkdirSync(join(repository, '.agent-logs', 'verification'), { recursive: true });
  const report = ['.agent-logs/verification/r1/report.json'];
  expect(linkedDestination(repository, report)).toBeUndefined();
  symlinkSync(outside, join(repository, '.agent-logs', 'verification', 'r1'));
  expect(linkedDestination(repository, report)).toContain('.agent-logs/verification/r1 is a symbolic link');
});

test('results are copied from outside the checkout and never through a symbolic link', () => {
  const unpacked = () => {
    const staging = mkdtempSync(join(tmpdir(), 'boat-staging-'));
    mkdirSync(join(staging, '.agent-logs', 'verification', 'r1'), { recursive: true });
    writeFileSync(join(staging, '.agent-logs', 'verification', 'r1', 'report.json'), '{"ok":true}');
    return staging;
  };
  const repository = mkdtempSync(join(tmpdir(), 'boat-checkout-'));
  copyResults(unpacked(), repository);
  expect(readFileSync(join(repository, '.agent-logs', 'verification', 'r1', 'report.json'), 'utf8')).toBe(
    '{"ok":true}',
  );
  // `.agent-logs` itself, or a folder below it, already a link: nothing is written anywhere.
  for (const link of ['.agent-logs', '.agent-logs/verification']) {
    const checkout = mkdtempSync(join(tmpdir(), 'boat-checkout-'));
    const outside = mkdtempSync(join(tmpdir(), 'boat-outside-'));
    mkdirSync(join(checkout, link, '..'), { recursive: true });
    symlinkSync(outside, join(checkout, link));
    expect(() => copyResults(unpacked(), checkout), link).toThrow('is a symbolic link in the checkout');
    expect(existsSync(join(outside, 'verification')) || existsSync(join(outside, 'r1')), link).toBe(false);
  }
});

// Crafted archives, built with tar itself, go through the same unpack and copy as a Boat run.
test('a crafted results archive is refused whole and writes nothing into the checkout', () => {
  const crafted = (name: string, build: (work: string) => string[], extra: string[] = []) => {
    const work = mkdtempSync(join(tmpdir(), `boat-crafted-${name}-`));
    mkdirSync(join(work, '.agent-logs', 'verification'), { recursive: true });
    const members = build(work);
    const archive = join(work, `${name}.tgz`);
    execFileSync('tar', ['-czf', archive, ...extra, ...members], { cwd: work });
    const checkout = mkdtempSync(join(tmpdir(), 'boat-checkout-'));
    const staging = mkdtempSync(join(tmpdir(), 'boat-staging-'));
    let refusal: string | undefined;
    try {
      unpackResults(archive, staging, checkout);
    } catch (error) {
      refusal = error instanceof Error ? error.message : String(error);
    }
    return {
      refusal,
      wrote: existsSync(join(checkout, '.agent-logs')) || existsSync(join(checkout, 'package.json')),
    };
  };
  const file = (work: string, path: string) => {
    mkdirSync(join(work, path, '..'), { recursive: true });
    writeFileSync(join(work, path), '{}');
    return path;
  };
  const good = crafted('good', (work) => [file(work, '.agent-logs/verification/report.json')]);
  expect(good).toEqual({ refusal: undefined, wrote: true });
  const refused = [
    crafted('symlink', (work) => {
      symlinkSync('/etc/passwd', join(work, '.agent-logs', 'link'));
      return ['.agent-logs/link'];
    }),
    crafted('hardlink', (work) => {
      file(work, '.agent-logs/first');
      execFileSync('ln', [join(work, '.agent-logs', 'first'), join(work, '.agent-logs', 'hard')]);
      return ['.agent-logs/first', '.agent-logs/hard'];
    }),
    crafted('outside', (work) => [file(work, 'package.json')]),
    // -P (GNU tar and bsdtar alike) keeps the `..` in the member name.
    crafted('escape', (work) => [file(work, '.agent-logs/../package.json')], ['-P']),
    // Archived as the folder, so tar reads these names from disk; no tar unquotes them.
    crafted('backslash', (work) => (file(work, '.agent-logs/a\\b/report.json'), ['.agent-logs'])),
    crafted('newline', (work) => (file(work, '.agent-logs/a\nb/report.json'), ['.agent-logs'])),
  ];
  for (const result of refused) {
    expect(result.refusal).toContain('The Boat results archive was refused');
    expect(result.wrote).toBe(false);
  }
});

test('an existing destination link whose name holds a backslash or a newline is never written through', () => {
  for (const name of ['a\\b', 'a\nb']) {
    const staging = mkdtempSync(join(tmpdir(), 'boat-staging-'));
    mkdirSync(join(staging, '.agent-logs', name), { recursive: true });
    writeFileSync(join(staging, '.agent-logs', name, 'report.json'), '{}');
    const checkout = mkdtempSync(join(tmpdir(), 'boat-checkout-'));
    const outside = mkdtempSync(join(tmpdir(), 'boat-outside-'));
    mkdirSync(join(checkout, '.agent-logs'));
    symlinkSync(outside, join(checkout, '.agent-logs', name));
    expect(() => copyResults(staging, checkout), JSON.stringify(name)).toThrow();
    expect(existsSync(join(outside, 'report.json')), JSON.stringify(name)).toBe(false);
  }
});

test('a Ctrl-C while a machine starts deletes it and never falls back to a local run', async () => {
  const interrupt = new AbortController();
  const calls: string[] = [];
  const client = boatClient('boat_secret', async (url, init) => {
    calls.push(`${init?.method ?? 'GET'} ${new URL(url).pathname}`);
    if (init?.method === 'POST') {
      interrupt.abort();
      return Response.json({ sandbox: { id: 'bx_test', state: 'provisioning' } });
    }
    if (init?.method === 'DELETE') return Response.json({ operation: { id: 'op', status: 'pending' } });
    return Response.json({ code: 'not_found' }, { status: 404 });
  });
  const failure = await createMachine(client, {
    from: 'werkflow-verify',
    name: 'verify-test',
    ttlSeconds: 60,
    snapshots: false,
    log: () => undefined,
    signal: interrupt.signal,
  }).catch((error: unknown) => error);
  // The interruption itself stops the wait: no readiness poll, and the started machine is deleted.
  expect(failure instanceof Error && failure.name).toBe('AbortError');
  expect(calls.slice(0, 2)).toEqual(['POST /api/v1/sandboxes', 'DELETE /api/v1/sandboxes/bx_test']);
  expect(() => fallbackLine(failure, interrupt.signal)).toThrow();
  expect(fallbackLine(new BoatError(503, 'no_ready_machine', ''), new AbortController().signal)).toBe(
    'Running locally: Boat answered 503 no_ready_machine.',
  );
});

test('a crafted archive imported over an existing link with a backslash or newline name writes nothing', () => {
  for (const name of ['a\\b', 'a\nb']) {
    // The archive targets the linked name. It is built from the folder, so tar reads the name from
    // disk: no rename or unquote option, the same on GNU tar and bsdtar.
    const work = mkdtempSync(join(tmpdir(), 'boat-crafted-link-'));
    mkdirSync(join(work, '.agent-logs', name), { recursive: true });
    writeFileSync(join(work, '.agent-logs', name, 'report.json'), '{}');
    const archive = join(work, 'results.tgz');
    execFileSync('tar', ['-czf', archive, '.agent-logs'], { cwd: work });
    const checkout = mkdtempSync(join(tmpdir(), 'boat-checkout-'));
    const outside = mkdtempSync(join(tmpdir(), 'boat-outside-'));
    mkdirSync(join(checkout, '.agent-logs'));
    symlinkSync(outside, join(checkout, '.agent-logs', name));
    const staging = mkdtempSync(join(tmpdir(), 'boat-staging-'));
    expect(() => unpackResults(archive, staging, checkout), JSON.stringify(name)).toThrow(
      'The Boat results archive was refused',
    );
    expect(readdirSync(outside), JSON.stringify(name)).toEqual([]);
    expect(readdirSync(join(checkout, '.agent-logs')), JSON.stringify(name)).toEqual([name]);
  }
});

// A Ctrl-C never turns into a local run, wherever it lands: planning, packing, or the cleanup that
// follows a failed or out-of-memory setup.
const interrupted = () => {
  const controller = new AbortController();
  controller.abort();
  return controller.signal;
};

test('a Ctrl-C during planning stops the run instead of falling back', async () => {
  const repository = mkdtempSync(join(tmpdir(), 'boat-plan-'));
  mkdirSync(join(repository, 'scripts'));
  writeFileSync(
    join(repository, 'scripts', 'verify.ts'),
    "console.log('RUN   sql:security | Explicit selection');\n",
  );
  const outcome = await prepareAndRun([], repository, 'boat_secret', interrupted()).catch(
    (error: unknown) => error,
  );
  expect(outcome instanceof Error && outcome.name).toBe('AbortError');
});

test('a Ctrl-C during packing stops the run instead of falling back', async () => {
  const repository = mkdtempSync(join(tmpdir(), 'boat-pack-'));
  execFileSync('git', ['init', '-q'], { cwd: repository, env: gitEnvironment() });
  writeFileSync(join(repository, 'README.md'), 'x');
  execFileSync('git', ['add', '.'], { cwd: repository, env: gitEnvironment() });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'x'], {
    cwd: repository,
    env: gitEnvironment(),
  });
  // Without a local-stack .env.local the pack is refused, which alone would fall back to local.
  const outcome = await runOnBoat({
    args: [],
    repository,
    folder: mkdtempSync(join(tmpdir(), 'boat-pack-folder-')),
    key: 'boat_secret',
    signal: interrupted(),
  }).catch((error: unknown) => error);
  expect(outcome instanceof Error && outcome.name).toBe('AbortError');
});

test('a Ctrl-C during the cleanup after a failed setup never falls back', async () => {
  const controller = new AbortController();
  const client = boatClient('boat_secret', async (url, init) => {
    if (init?.method === 'DELETE') {
      controller.abort();
      return Response.json({ operation: { id: 'op', status: 'pending' } });
    }
    if (new URL(url).pathname.endsWith('/usage'))
      return Response.json({ seconds: 2, dollars: 0, sandboxType: 'large' });
    return Response.json({ code: 'not_found' }, { status: 404 });
  });
  // `work` stands for a setup that failed: it returns the fallback's undefined.
  const outcome = await withMachine(
    { id: 'bx_test', client, log: () => undefined },
    controller.signal,
    async () => undefined,
  ).catch((error: unknown) => error);
  expect(outcome instanceof Error && outcome.name).toBe('AbortError');
  // Without an interruption the fallback stands.
  const quiet = boatClient('boat_secret', async (_url, init) =>
    init?.method === 'DELETE'
      ? Response.json({ operation: { id: 'op', status: 'pending' } })
      : Response.json({ code: 'not_found' }, { status: 404 }),
  );
  expect(
    await withMachine(
      { id: 'bx_test', client: quiet, log: () => undefined },
      new AbortController().signal,
      async () => undefined,
    ),
  ).toBeUndefined();
});

test('an import never writes through a destination hard link and writes nothing when one file conflicts', () => {
  const staging = mkdtempSync(join(tmpdir(), 'boat-staging-'));
  mkdirSync(join(staging, '.agent-logs', 'runs'), { recursive: true });
  writeFileSync(join(staging, '.agent-logs', 'runs', 'a-first'), 'new');
  writeFileSync(join(staging, '.agent-logs', 'runs', 'z-last'), 'new');
  // z-last is a hard link to a file outside .agent-logs: the import refuses and the file keeps its bytes.
  const linkedCheckout = mkdtempSync(join(tmpdir(), 'boat-checkout-'));
  mkdirSync(join(linkedCheckout, '.agent-logs', 'runs'), { recursive: true });
  writeFileSync(join(linkedCheckout, 'owner-file'), 'owner');
  execFileSync('ln', [
    join(linkedCheckout, 'owner-file'),
    join(linkedCheckout, '.agent-logs', 'runs', 'z-last'),
  ]);
  expect(() => copyResults(staging, linkedCheckout)).toThrow('is a hard link in the checkout');
  expect(readFileSync(join(linkedCheckout, 'owner-file'), 'utf8')).toBe('owner');
  expect(existsSync(join(linkedCheckout, '.agent-logs', 'runs', 'a-first'))).toBe(false);
  // z-last is a folder in the checkout: refused before a-first is written.
  const folderCheckout = mkdtempSync(join(tmpdir(), 'boat-checkout-'));
  mkdirSync(join(folderCheckout, '.agent-logs', 'runs', 'z-last'), { recursive: true });
  expect(() => copyResults(staging, folderCheckout)).toThrow('is not a regular file');
  expect(readdirSync(join(folderCheckout, '.agent-logs', 'runs'))).toEqual(['z-last']);
  // A clean checkout gets both files and no temporary file is left.
  const clean = mkdtempSync(join(tmpdir(), 'boat-checkout-'));
  copyResults(staging, clean);
  expect(readdirSync(join(clean, '.agent-logs', 'runs')).sort()).toEqual(['a-first', 'z-last']);
});

// A link member followed by a file member below it. GNU tar (1.35 measured) creates an escaping
// link as a placeholder until the end of the run, and bsdtar refuses a member whose folder a link
// would alter unless given -P; either way nothing may land outside the staging folder.
test('a link member followed by a file through it writes nothing outside staging', () => {
  for (const target of ['absolute', '../../outside']) {
    const base = mkdtempSync(join(tmpdir(), 'boat-link-file-'));
    const outside = join(base, 'outside');
    mkdirSync(join(base, 'one', '.agent-logs'), { recursive: true });
    mkdirSync(join(base, 'two', '.agent-logs', 'x'), { recursive: true });
    mkdirSync(outside);
    symlinkSync(target === 'absolute' ? outside : target, join(base, 'one', '.agent-logs', 'x'));
    writeFileSync(join(base, 'two', '.agent-logs', 'x', 'file'), 'planted');
    // Create, append, then compress: the same three steps on GNU tar and bsdtar.
    const archive = join(base, 'results.tar');
    execFileSync('tar', ['-cf', archive, '-C', join(base, 'one'), '.agent-logs/x']);
    execFileSync('tar', ['-rf', archive, '-C', join(base, 'two'), '.agent-logs/x/file']);
    execFileSync('gzip', [archive]);
    const staging = join(base, 'staging');
    mkdirSync(staging);
    const checkout = mkdtempSync(join(tmpdir(), 'boat-checkout-'));
    expect(() => unpackResults(`${archive}.gz`, staging, checkout), target).toThrow(
      'The Boat results archive was refused',
    );
    expect(readdirSync(outside), target).toEqual([]);
    expect(existsSync(join(checkout, '.agent-logs')), target).toBe(false);
  }
});

// A real SIGINT, delivered while a synchronous step runs; no timing involved. The handler stands in
// for the one verifyOnBoat installs.
async function withSigint<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T | unknown> {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.on('SIGINT', stop);
  try {
    return await work(controller.signal).catch((error: unknown) => error);
  } finally {
    process.off('SIGINT', stop);
  }
}

test('a real SIGINT during planning stops the run instead of falling back', async () => {
  const repository = mkdtempSync(join(tmpdir(), 'boat-plan-sigint-'));
  mkdirSync(join(repository, 'scripts'));
  // The plan child signals this process while the synchronous planning step waits for it.
  writeFileSync(join(repository, 'scripts', 'verify.ts'), "process.kill(process.ppid, 'SIGINT');\n");
  const outcome = await withSigint((signal) => prepareAndRun([], repository, 'boat_secret', signal));
  expect(outcome instanceof Error && outcome.name).toBe('AbortError');
});

test('a real SIGINT during packing stops the run instead of falling back', async () => {
  const repository = mkdtempSync(join(tmpdir(), 'boat-pack-sigint-'));
  execFileSync('git', ['init', '-q'], { cwd: repository, env: gitEnvironment() });
  writeFileSync(join(repository, 'README.md'), 'x');
  execFileSync('git', ['add', '.'], { cwd: repository, env: gitEnvironment() });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'x'], {
    cwd: repository,
    env: gitEnvironment(),
  });
  const outcome = await withSigint((signal) => {
    // Delivered now, handled only when the event loop turns: as for a SIGINT during the synchronous
    // snapshot and pack that runOnBoat starts with. The refused pack alone would fall back.
    process.kill(process.pid, 'SIGINT');
    return runOnBoat({
      args: [],
      repository,
      folder: mkdtempSync(join(tmpdir(), 'boat-pack-sigint-folder-')),
      key: 'boat_secret',
      signal,
    });
  });
  expect(outcome instanceof Error && outcome.name).toBe('AbortError');
});

test('a failed rename puts the checkout back as it was', () => {
  const staging = mkdtempSync(join(tmpdir(), 'boat-staging-'));
  mkdirSync(join(staging, '.agent-logs', 'runs'), { recursive: true });
  for (const name of ['a-first', 'b-existing', 'c-fails'])
    writeFileSync(join(staging, '.agent-logs', 'runs', name), 'new');
  const checkout = mkdtempSync(join(tmpdir(), 'boat-checkout-'));
  mkdirSync(join(checkout, '.agent-logs', 'runs'), { recursive: true });
  writeFileSync(join(checkout, '.agent-logs', 'runs', 'b-existing'), 'old');
  const files = ['a-first', 'b-existing', 'c-fails'].map((name) => `.agent-logs/runs/${name}`);
  // The third rename into place fails, as ENAMETOOLONG or a full disk would.
  const failing = (from: string, to: string) => {
    if (to.endsWith('c-fails')) throw new Error('ENAMETOOLONG');
    renameSync(from, to);
  };
  expect(() => placeFiles(staging, checkout, files, failing)).toThrow('ENAMETOOLONG');
  expect(readdirSync(join(checkout, '.agent-logs', 'runs'))).toEqual(['b-existing']);
  expect(readFileSync(join(checkout, '.agent-logs', 'runs', 'b-existing'), 'utf8')).toBe('old');
});

test('a destination longer than the system allows is refused before any write', () => {
  const staging = mkdtempSync(join(tmpdir(), 'boat-staging-'));
  mkdirSync(join(staging, '.agent-logs', 'runs'), { recursive: true });
  writeFileSync(join(staging, '.agent-logs', 'runs', 'a-first'), 'new');
  writeFileSync(join(staging, '.agent-logs', 'runs', 'x'.repeat(200)), 'new');
  // A checkout deep enough that the long name's destination passes PATH_MAX while a-first fits.
  const limit = process.platform === 'darwin' ? 1023 : 4095;
  let checkout = mkdtempSync(join(tmpdir(), 'boat-checkout-'));
  while (checkout.length < limit - 150) checkout = join(checkout, 'd'.repeat(100));
  mkdirSync(checkout, { recursive: true });
  expect(() => copyResults(staging, checkout)).toThrow('too long');
  expect(existsSync(join(checkout, '.agent-logs'))).toBe(false);
});

test('macOS bsdtar packs without extended attributes or AppleDouble members, GNU tar as before', () => {
  const mac = 'bsdtar 3.5.3 - libarchive 3.7.4 zlib/1.2.12 liblzma/5.4.3 bz2lib/1.0.8\n';
  expect(tarPackArguments(mac, 'tree.tgz', 'tree.list')).toEqual([
    '-czf',
    'tree.tgz',
    '--no-xattrs',
    '--no-mac-metadata',
    '--null',
    '-T',
    'tree.list',
  ]);
  const gnu = 'tar (GNU tar) 1.35\nCopyright (C) 2023 Free Software Foundation, Inc.\n';
  expect(tarPackArguments(gnu, 'tree.tgz', 'tree.list')).toEqual([
    '-czf',
    'tree.tgz',
    '--null',
    '-T',
    'tree.list',
  ]);
});

/** A committed repository whose working tree has a change, a deletion and an untracked file. */
function workstationCheckout(): string {
  const repository = mkdtempSync(join(tmpdir(), 'boat-tree-'));
  const run = (...args: string[]) => execFileSync('git', args, { cwd: repository, env: gitEnvironment() });
  run('init', '-q');
  mkdirSync(join(repository, 'lib'));
  for (const name of ['lib/kept.ts', 'lib/changed.ts', 'lib/deleted.ts'])
    writeFileSync(join(repository, name), `export const name = '${name}';\n`);
  run('add', '.');
  run('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'x');
  writeFileSync(join(repository, 'lib/changed.ts'), 'export const name = 1;\n');
  rmSync(join(repository, 'lib/deleted.ts'));
  writeFileSync(join(repository, 'lib/new.ts'), 'export const name = 2;\n');
  return repository;
}

/** The workstation's tree packed with this host's tar, unpacked into a fresh clone as remote-verify.sh does. */
function rebuild(workstation: string): string {
  const folder = mkdtempSync(join(tmpdir(), 'boat-pack-'));
  const machine = join(folder, 'machine');
  execFileSync('git', ['clone', '-q', workstation, machine], { env: gitEnvironment() });
  const list = join(folder, 'tree.list');
  writeFileSync(list, ['lib/kept.ts', 'lib/changed.ts', 'lib/new.ts'].join('\0'));
  const version = execFileSync('tar', ['--version'], { encoding: 'utf8' });
  execFileSync('tar', tarPackArguments(version, join(folder, 'tree.tgz'), list), { cwd: workstation });
  execFileSync('tar', ['--extract', '--gzip', '--file', join(folder, 'tree.tgz')], { cwd: machine });
  rmSync(join(machine, 'lib/deleted.ts'));
  return machine;
}

test("git reads a checkout rebuilt with this host's tar as changed exactly where the workstation is", () => {
  const workstation = workstationCheckout();
  const changed = changedSinceHead(workstation);
  expect(changed).toEqual(['lib/changed.ts', 'lib/deleted.ts', 'lib/new.ts']);
  const machine = rebuild(workstation);
  expect(rebuiltTreeProblem(changed, changedSinceHead(machine))).toBeUndefined();
  // An AppleDouble member unpacked by GNU tar is such an extra file.
  writeFileSync(join(machine, 'lib/._kept.ts'), '\0\u0005\u0016\u0007');
  expect(rebuiltTreeProblem(changed, changedSinceHead(machine))).toBe(
    "git reads the rebuilt checkout as changed elsewhere than the workstation's: 1 (lib/._kept.ts) paths only on the machine, 0 only on the workstation.",
  );
});

test('a mismatch names its first five paths on each side and the count', () => {
  const machine = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((name) => `lib/${name}.ts`);
  expect(rebuiltTreeProblem(['lib/a.ts', 'lib/z.ts'], machine)).toBe(
    "git reads the rebuilt checkout as changed elsewhere than the workstation's: 6 (lib/b.ts, lib/c.ts, lib/d.ts, lib/e.ts, lib/f.ts, …) paths only on the machine, 1 (lib/z.ts) only on the workstation.",
  );
});

// macOS only: elsewhere no tar packs a file's extended attributes as an AppleDouble member.
test.skipIf(process.platform !== 'darwin')(
  'a file with an extended attribute packs on macOS without an AppleDouble member or the attribute',
  () => {
    const workstation = workstationCheckout();
    execFileSync('xattr', ['-w', 'com.werkflow.test', 'provenance', join(workstation, 'lib/kept.ts')]);
    const folder = mkdtempSync(join(tmpdir(), 'boat-pack-'));
    const list = join(folder, 'tree.list');
    writeFileSync(list, 'lib/kept.ts');
    const version = execFileSync('tar', ['--version'], { encoding: 'utf8' });
    execFileSync('tar', tarPackArguments(version, join(folder, 'tree.tgz'), list), { cwd: workstation });
    const members = execFileSync('tar', ['-tzf', join(folder, 'tree.tgz')], { encoding: 'utf8' });
    expect(members.trim().split('\n')).toEqual(['lib/kept.ts']);
    expect(execFileSync('gzip', ['-dc', join(folder, 'tree.tgz')]).includes('com.werkflow.test')).toBe(false);
  },
);
