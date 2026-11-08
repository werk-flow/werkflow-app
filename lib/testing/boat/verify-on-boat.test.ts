// Rule test: test:verify picks Boat only where a Boat run proves the same thing as a local one,
// falls back to the local run on any Boat failure, and an unusable key says so in one line.
import { expect, test } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BoatError, boatClient } from './boat-api';
import { readBoatKey } from './boat-key';
import { runScript } from './boat-machine';
import { backendValueDigests } from '../evidence/proof-environment';
import { boatFailure, localReason, machineBoundGroup, withheldFile } from './verify-on-boat';

test('change plans and ordinary groups may run on Boat', () => {
  expect(localReason([], {})).toBeUndefined();
  expect(localReason(['--group', 'sql:security,golden:gg-00'], {})).toBeUndefined();
  expect(localReason(['--mode', 'change'], {})).toBeUndefined();
});

test('runs that measure this machine, reach DEV or are asked local stay local', () => {
  expect(localReason(['--mode', 'release'], {})).toContain('release mode');
  expect(localReason(['--target', 'cloud'], {})).toContain('DEV');
  for (const group of [
    'audit:lab:office',
    'audit:performance:calendar',
    'audit:visual',
    'audit:layout-field',
  ])
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
  ]);
  // The WSL address is transport: any private stack origin compares equal.
  writeFileSync(join(folder, '.env.local'), 'NEXT_PUBLIC_SUPABASE_URL=http://172.20.0.5:54321\n');
  expect(backendValueDigests(folder, {})['.env.local:NEXT_PUBLIC_SUPABASE_URL']).toBe(
    digests['.env.local:NEXT_PUBLIC_SUPABASE_URL'],
  );
});
