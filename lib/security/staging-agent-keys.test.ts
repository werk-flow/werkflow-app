// Rule test: agents hold only DEV, staging and Stripe sandbox keys, in one private file per
// machine, and `bun run agent-access:check` fails on a key that reaches anything else. Every value
// here is made up.
import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  STAGING_AGENT_KEY_FILE,
  devAccessToken,
  devOnlyVerdict,
  envFileValues,
  installStagingAgentKeys,
  keyShapeVerdict,
  privateModeVerdict,
  protectionVerdict,
  queryErrorSqlState,
  readOnlyModeOffOutcome,
  readStagingAgentKeys,
  sandboxVerdict,
  writeRefusedOutcome,
} from './staging-agent-keys';

const MADE_UP = {
  SUPABASE_DEV_ACCESS_TOKEN: `sbp_${'0a'.repeat(20)}`,
  SUPABASE_DEV_SECRET_KEY: 'sb_secret_MadeUpValue_0123456789abcdef',
  STRIPE_SANDBOX_KEY: `rk_test_${'Ab1'.repeat(10)}`,
  VERCEL_STAGING_BYPASS_SECRET: 'MadeUpBypassSecret0123456789abcd',
};
const fileText = (values: Record<string, string>) =>
  Object.entries(values)
    .map(([name, value]) => `${name}=${value}`)
    .join('\n');

test('each key has its shape, and a live or account-wide key does not', () => {
  expect(keyShapeVerdict('SUPABASE_DEV_ACCESS_TOKEN', MADE_UP.SUPABASE_DEV_ACCESS_TOKEN)).toBe('ok');
  expect(keyShapeVerdict('SUPABASE_DEV_SECRET_KEY', MADE_UP.SUPABASE_DEV_SECRET_KEY)).toBe('ok');
  expect(keyShapeVerdict('STRIPE_SANDBOX_KEY', MADE_UP.STRIPE_SANDBOX_KEY)).toBe('ok');
  expect(keyShapeVerdict('VERCEL_STAGING_BYPASS_SECRET', MADE_UP.VERCEL_STAGING_BYPASS_SECRET)).toBe('ok');
  // Live Stripe is PROD: a live key, a full secret key or a publishable key never passes.
  for (const value of [
    `rk_live_${'Ab1'.repeat(10)}`,
    `sk_live_${'Ab1'.repeat(10)}`,
    `sk_test_${'Ab1'.repeat(10)}`,
  ])
    expect(keyShapeVerdict('STRIPE_SANDBOX_KEY', value), value).toBe('failed');
  expect(keyShapeVerdict('SUPABASE_DEV_SECRET_KEY', 'sb_publishable_MadeUpValue_0123456789')).toBe('failed');
  expect(keyShapeVerdict('SUPABASE_DEV_ACCESS_TOKEN', MADE_UP.SUPABASE_DEV_SECRET_KEY)).toBe('failed');
  expect(keyShapeVerdict('VERCEL_STAGING_BYPASS_SECRET', 'too-short')).toBe('failed');
  expect(keyShapeVerdict('VERCEL_STAGING_BYPASS_SECRET', `${MADE_UP.VERCEL_STAGING_BYPASS_SECRET}x`)).toBe(
    'failed',
  );
  expect(keyShapeVerdict('STRIPE_SANDBOX_KEY', '')).toBe('missing');
  expect(keyShapeVerdict('STRIPE_SANDBOX_KEY', undefined)).toBe('missing');
});

/** Runs `check` with a made-up home whose key file holds `text`, then removes the home. */
function withKeyFile(text: string, check: (home: string, path: string) => void): void {
  const home = mkdtempSync(join(tmpdir(), 'agent-keys-'));
  try {
    const path = join(home, STAGING_AGENT_KEY_FILE);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, text, { mode: 0o600 });
    check(home, path);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

test('the reader returns only keys in shape, so a malformed or live key is never sent', () => {
  const text = `${fileText({ ...MADE_UP, STRIPE_SANDBOX_KEY: `rk_live_${'Ab1'.repeat(10)}` })}\nOTHER=1\n# VERCEL_STAGING_BYPASS_SECRET=commented`;
  withKeyFile(text, (home) => {
    const keys = readStagingAgentKeys(home);
    if (keys.file !== 'present') throw new Error('The key file was not read.');
    expect(keys.verdicts).toEqual({
      SUPABASE_DEV_ACCESS_TOKEN: 'ok',
      SUPABASE_DEV_SECRET_KEY: 'ok',
      STRIPE_SANDBOX_KEY: 'failed',
      VERCEL_STAGING_BYPASS_SECRET: 'ok',
    });
    expect([...keys.values.keys()].sort()).toEqual([
      'SUPABASE_DEV_ACCESS_TOKEN',
      'SUPABASE_DEV_SECRET_KEY',
      'VERCEL_STAGING_BYPASS_SECRET',
    ]);
    expect(keys.values.get('SUPABASE_DEV_ACCESS_TOKEN')).toBe(MADE_UP.SUPABASE_DEV_ACCESS_TOKEN);
  });
});

test('the reader reports a machine without the key file as missing and reads one with it', () => {
  const home = mkdtempSync(join(tmpdir(), 'agent-keys-'));
  try {
    expect(readStagingAgentKeys(home)).toEqual({ file: 'missing' });
    const path = join(home, STAGING_AGENT_KEY_FILE);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, fileText({ SUPABASE_DEV_SECRET_KEY: MADE_UP.SUPABASE_DEV_SECRET_KEY }), {
      mode: 0o600,
    });
    const keys = readStagingAgentKeys(home);
    if (keys.file !== 'present') throw new Error('The key file was not read.');
    expect(keys.verdicts.SUPABASE_DEV_SECRET_KEY).toBe('ok');
    expect(keys.verdicts.SUPABASE_DEV_ACCESS_TOKEN).toBe('missing');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('an install sets each key on one line and keeps the rest of the file', () => {
  const text = `# agent keys\nSUPABASE_DEV_SECRET_KEY=sb_secret_OldMadeUpValue_0123456789\nOTHER=1\n\n`;
  withKeyFile(text, (home, path) => {
    installStagingAgentKeys(new Map([['SUPABASE_DEV_SECRET_KEY', MADE_UP.SUPABASE_DEV_SECRET_KEY]]), home);
    expect(readFileSync(path, 'utf8')).toBe(
      `# agent keys\nOTHER=1\nSUPABASE_DEV_SECRET_KEY=${MADE_UP.SUPABASE_DEV_SECRET_KEY}\n`,
    );
  });
});

test('an install writes a private file in a private folder, and a key out of shape writes nothing', () => {
  const home = mkdtempSync(join(tmpdir(), 'agent-keys-'));
  try {
    const path = join(home, STAGING_AGENT_KEY_FILE);
    mkdirSync(dirname(path), { recursive: true, mode: 0o755 });
    installStagingAgentKeys(
      new Map([['SUPABASE_DEV_ACCESS_TOKEN', MADE_UP.SUPABASE_DEV_ACCESS_TOKEN]]),
      home,
    );
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(dirname(path)).mode & 0o777).toBe(0o700);
    installStagingAgentKeys(new Map([['STRIPE_SANDBOX_KEY', MADE_UP.STRIPE_SANDBOX_KEY]]), home);
    expect(readFileSync(path, 'utf8')).toBe(
      `SUPABASE_DEV_ACCESS_TOKEN=${MADE_UP.SUPABASE_DEV_ACCESS_TOKEN}\nSTRIPE_SANDBOX_KEY=${MADE_UP.STRIPE_SANDBOX_KEY}\n`,
    );
    const live = `rk_live_${'Ab1'.repeat(10)}`;
    const write = () =>
      installStagingAgentKeys(
        new Map([
          ['VERCEL_STAGING_BYPASS_SECRET', MADE_UP.VERCEL_STAGING_BYPASS_SECRET],
          ['STRIPE_SANDBOX_KEY', live],
        ]),
        home,
      );
    expect(write).toThrow('STRIPE_SANDBOX_KEY does not have its shape, so nothing was written.');
    expect(readFileSync(path, 'utf8')).not.toContain('VERCEL_STAGING_BYPASS_SECRET');
    expect(readFileSync(path, 'utf8')).not.toContain(live);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('every assignment of a name in an env file counts, an exported one too', () => {
  const folder = mkdtempSync(join(tmpdir(), 'env-file-'));
  try {
    const path = join(folder, '.env.local');
    writeFileSync(
      path,
      [
        `SUPABASE_ACCESS_TOKEN=${MADE_UP.SUPABASE_DEV_ACCESS_TOKEN}`,
        '# SUPABASE_ACCESS_TOKEN=commented',
        `export SUPABASE_ACCESS_TOKEN="sbp_${'1f'.repeat(20)}"`,
        'OTHER=1',
      ].join('\n'),
    );
    expect(envFileValues(path, 'SUPABASE_ACCESS_TOKEN')).toEqual([
      MADE_UP.SUPABASE_DEV_ACCESS_TOKEN,
      `sbp_${'1f'.repeat(20)}`,
    ]);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test('an env file that cannot be read fails, and a path that is no file holds nothing', () => {
  const folder = mkdtempSync(join(tmpdir(), 'env-file-'));
  try {
    // A symlink loop fails its stat, as an unreadable file fails its read, even for root.
    symlinkSync(join(folder, '.env.loop'), join(folder, '.env.loop'));
    expect(envFileValues(join(folder, '.env.loop'), 'SUPABASE_ACCESS_TOKEN')).toBe('failed');
    mkdirSync(join(folder, '.env.folder'));
    expect(envFileValues(join(folder, '.env.folder'), 'SUPABASE_ACCESS_TOKEN')).toEqual([]);
    expect(envFileValues(join(folder, '.env.missing'), 'SUPABASE_ACCESS_TOKEN')).toEqual([]);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test('the reader refuses a key path that is no regular file', () => {
  const home = mkdtempSync(join(tmpdir(), 'agent-keys-'));
  try {
    mkdirSync(join(home, STAGING_AGENT_KEY_FILE), { recursive: true });
    expect(() => readStagingAgentKeys(home)).toThrow('cannot be read as a regular file');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('a key file is a regular file with mode 600, its folder a folder with mode 700', () => {
  const file = (mode: number) => ({ mode: 0o100000 | mode, isFile: () => true, isDirectory: () => false });
  const folder = (mode: number) => ({ mode: 0o40000 | mode, isFile: () => false, isDirectory: () => true });
  expect(privateModeVerdict(file(0o600), 'file')).toBe('ok');
  expect(privateModeVerdict(folder(0o700), 'folder')).toBe('ok');
  // A mode other than the exact one fails, though it shuts out the group and others too.
  for (const mode of [0o644, 0o664, 0o640, 0o604, 0o700, 0o400])
    expect(privateModeVerdict(file(mode), 'file'), mode.toString(8)).toBe('failed');
  for (const mode of [0o755, 0o750, 0o600])
    expect(privateModeVerdict(folder(mode), 'folder'), mode.toString(8)).toBe('failed');
  // A folder where the file belongs, or a file where the folder belongs, fails.
  expect(privateModeVerdict(folder(0o600), 'file')).toBe('failed');
  expect(privateModeVerdict(file(0o700), 'folder')).toBe('failed');
});

test('a Supabase token passes only when it reaches DEV and is refused PROD', () => {
  for (const refused of [401, 403, 404]) expect(devOnlyVerdict(200, refused), String(refused)).toBe('ok');
  // An account-wide token sees PROD; a token for another project does not reach DEV.
  expect(devOnlyVerdict(200, 200)).toBe('failed');
  for (const status of [401, 403, 404]) expect(devOnlyVerdict(status, 404), String(status)).toBe('failed');
  // An answer that proves nothing about PROD fails.
  for (const status of [429, 500, 503]) expect(devOnlyVerdict(200, status), String(status)).toBe('failed');
});

const OK = { verdict: 'ok' } as const;
const OFF = { enabled: false, override_enabled: false, override_active_until: '2026-01-01T00:00:00Z' };

test("DEV's read-only mode is off only on 200 with both flags false", () => {
  expect(readOnlyModeOffOutcome(200, OFF)).toEqual(OK);
  const reason = (status: number, body: unknown) => {
    const outcome = readOnlyModeOffOutcome(status, body);
    return outcome.verdict === 'failed' ? outcome.reason : 'ok';
  };
  expect(reason(200, { ...OFF, enabled: true })).toBe("DEV's read-only state has enabled true");
  expect(reason(200, { ...OFF, override_enabled: true })).toBe(
    "DEV's read-only state has override_enabled true",
  );
  expect(reason(200, { override_enabled: false })).toBe(
    "DEV's read-only state has enabled missing or not a boolean",
  );
  expect(reason(200, { enabled: false, override_enabled: 'false' })).toBe(
    "DEV's read-only state has override_enabled missing or not a boolean",
  );
  expect(reason(200, [OFF])).toBe("DEV's read-only state is no JSON object");
  expect(reason(200, null)).toBe("DEV's read-only state is no JSON object");
  // A token that may not read the mode, or an answer that proves nothing, fails without its body.
  for (const status of [401, 403, 404, 429, 500])
    expect(reason(status, OFF), String(status)).toBe(`DEV's read-only state answered ${status}, not 200`);
});

test('a write passes only when Supabase refuses it, and 25006 only while DEV is not read-only', () => {
  const readOnly = readOnlyModeOffOutcome(200, { ...OFF, enabled: true });
  const off = { before: OK, after: OK };
  expect(writeRefusedOutcome(403, undefined, { before: readOnly, after: readOnly })).toEqual(OK);
  // A read-only token's query runs in a read-only transaction, which refuses the write. DEV's own
  // read-only mode answers the same to a write-capable token, so the mode must read as off.
  expect(writeRefusedOutcome(400, '25006', off)).toEqual(OK);
  expect(writeRefusedOutcome(400, '25006', { before: readOnly, after: readOnly })).toEqual({
    verdict: 'failed',
    reason: "a read-only transaction refused the write, but before it DEV's read-only state has enabled true",
  });
  const unreadable = readOnlyModeOffOutcome(404, undefined);
  expect(writeRefusedOutcome(400, '25006', { before: unreadable, after: OK })).toEqual({
    verdict: 'failed',
    reason:
      "a read-only transaction refused the write, but before it DEV's read-only state answered 404, not 200",
  });
  // Another query error, a 400 without a code, a write that ran, a refused sign-in, or an answer
  // that proves nothing, fails.
  expect(writeRefusedOutcome(400, '42601', off)).toEqual({
    verdict: 'failed',
    reason: 'the write answered 400 with SQLSTATE 42601, not 403 or 400 with SQLSTATE 25006',
  });
  expect(writeRefusedOutcome(400, undefined, off).verdict).toBe('failed');
  for (const status of [200, 201, 401, 404, 429, 500])
    expect(writeRefusedOutcome(status, '25006', off).verdict, String(status)).toBe('failed');
});

test("a 25006 fails when DEV's read-only mode changes between the reads around the write", () => {
  const readOnly = readOnlyModeOffOutcome(200, { ...OFF, enabled: true });
  const overridden = readOnlyModeOffOutcome(200, { ...OFF, override_enabled: true });
  // DEV was read-only for the write and left the mode before the second read, so the 25006 may be
  // the mode's refusal of a write-capable token.
  expect(writeRefusedOutcome(400, '25006', { before: readOnly, after: OK })).toEqual({
    verdict: 'failed',
    reason: "a read-only transaction refused the write, but before it DEV's read-only state has enabled true",
  });
  // DEV entered the mode after the first read, so the write may have met it.
  expect(writeRefusedOutcome(400, '25006', { before: OK, after: overridden })).toEqual({
    verdict: 'failed',
    reason:
      "a read-only transaction refused the write, but after it DEV's read-only state has override_enabled true",
  });
});

test("a query error's SQLSTATE is the only part of its body read", () => {
  const message = (text: string) => ({ message: `Failed to run sql query: ${text}\n` });
  expect(
    queryErrorSqlState(message('ERROR:  25006: cannot execute CREATE TABLE in a read-only transaction')),
  ).toBe('25006');
  expect(queryErrorSqlState(message('ERROR:  42601: syntax error at or near "creat"'))).toBe('42601');
  // A code elsewhere in the text, or a body of another shape, names none.
  expect(queryErrorSqlState(message('read-only transaction 25006'))).toBeUndefined();
  expect(queryErrorSqlState({ error: 'ERROR:  25006: made up' })).toBeUndefined();
  expect(queryErrorSqlState('ERROR:  25006: made up')).toBeUndefined();
});

test('a DEV script takes the environment token first, else the agent token from the key file', () => {
  const home = mkdtempSync(join(tmpdir(), 'agent-keys-'));
  try {
    expect(devAccessToken({}, home)).toBeUndefined();
    const path = join(home, STAGING_AGENT_KEY_FILE);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, fileText({ SUPABASE_DEV_ACCESS_TOKEN: 'sbp_short' }), { mode: 0o600 });
    // A token out of its shape is never sent.
    expect(devAccessToken({}, home)).toBeUndefined();
    writeFileSync(path, fileText(MADE_UP), { mode: 0o600 });
    expect(devAccessToken({}, home)).toBe(MADE_UP.SUPABASE_DEV_ACCESS_TOKEN);
    expect(devAccessToken({ SUPABASE_ACCESS_TOKEN: 'sbp_from_ci' }, home)).toBe('sbp_from_ci');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('a Stripe answer passes only with livemode false', () => {
  expect(sandboxVerdict({ object: 'balance', livemode: false })).toBe('ok');
  expect(sandboxVerdict({ object: 'balance', livemode: true })).toBe('failed');
  expect(sandboxVerdict({ object: 'balance' })).toBe('failed');
  expect(sandboxVerdict({ error: { type: 'invalid_request_error' } })).toBe('failed');
});

test("staging's protection holds without the bypass and opens with it", () => {
  const signIn = 'https://vercel.com/sso-api?url=https%3A%2F%2Fstaging.example&nonce=madeup';
  expect(protectionVerdict(401, null, false)).toBe('ok');
  expect(protectionVerdict(302, signIn, false)).toBe('ok');
  expect(protectionVerdict(200, null, false)).toBe('failed');
  expect(protectionVerdict(307, '/login', false)).toBe('failed');
  expect(protectionVerdict(200, null, true)).toBe('ok');
  // A redirect may lead anywhere, so only the sign-in page proves the app answered.
  expect(protectionVerdict(307, '/login', true)).toBe('failed');
  // A bypass Vercel does not accept leaves the request at its sign-in.
  expect(protectionVerdict(401, null, true)).toBe('failed');
  expect(protectionVerdict(302, signIn, true)).toBe('failed');
  expect(protectionVerdict(500, null, true)).toBe('failed');
});
