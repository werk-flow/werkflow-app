// Rule test: agents hold only DEV, staging and Stripe sandbox keys, in one private file per
// machine, and `bun run agent-access:check` fails on a key that reaches anything else. Every value
// here is made up.
import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  STAGING_AGENT_KEY_FILE,
  devOnlyVerdict,
  installStagingAgentKeys,
  keyShapeVerdict,
  privateModeVerdict,
  protectionVerdict,
  readStagingAgentKeys,
  sandboxVerdict,
  stagingAgentKeysFrom,
  withStagingAgentKeys,
  writeRefusedVerdict,
} from './staging-agent-keys';
import { DEV_PROJECT_REF } from '../testing/local-stack/dev-migration-history';

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

test('the reader returns only keys in shape, so a malformed or live key is never sent', () => {
  const keys = stagingAgentKeysFrom(
    `${fileText({ ...MADE_UP, STRIPE_SANDBOX_KEY: `rk_live_${'Ab1'.repeat(10)}` })}\nOTHER=1\n# VERCEL_STAGING_BYPASS_SECRET=commented`,
  );
  if (keys.file !== 'present') throw new Error('The file text was not read.');
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
  expect(
    withStagingAgentKeys(text, new Map([['SUPABASE_DEV_SECRET_KEY', MADE_UP.SUPABASE_DEV_SECRET_KEY]])),
  ).toBe(`# agent keys\nOTHER=1\nSUPABASE_DEV_SECRET_KEY=${MADE_UP.SUPABASE_DEV_SECRET_KEY}\n`);
  expect(withStagingAgentKeys('', new Map([['STRIPE_SANDBOX_KEY', MADE_UP.STRIPE_SANDBOX_KEY]]))).toBe(
    `STRIPE_SANDBOX_KEY=${MADE_UP.STRIPE_SANDBOX_KEY}\n`,
  );
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

test('a file or folder is private only without group or other access', () => {
  expect(privateModeVerdict(0o100600)).toBe('ok');
  expect(privateModeVerdict(0o40700)).toBe('ok');
  expect(privateModeVerdict(0o100400)).toBe('ok');
  for (const mode of [0o100644, 0o100664, 0o100640, 0o100604, 0o40755, 0o40750])
    expect(privateModeVerdict(mode), mode.toString(8)).toBe('failed');
});

test('a Supabase token passes only when it sees DEV and no other project', () => {
  expect(devOnlyVerdict([{ ref: DEV_PROJECT_REF, name: 'WerkFlow App Dev' }])).toBe('ok');
  expect(devOnlyVerdict([{ id: DEV_PROJECT_REF }])).toBe('ok');
  // An account-wide token sees PROD beside DEV; a token for another project sees no DEV.
  expect(devOnlyVerdict([{ ref: DEV_PROJECT_REF }, { ref: 'madeupotherprojectref' }])).toBe('failed');
  expect(devOnlyVerdict([{ ref: 'madeupotherprojectref' }])).toBe('failed');
  expect(devOnlyVerdict([])).toBe('failed');
  expect(devOnlyVerdict({ message: 'Unauthorized' })).toBe('failed');
});

test('a write passes only when Supabase refuses it', () => {
  expect(writeRefusedVerdict(403)).toBe('ok');
  expect(writeRefusedVerdict(401)).toBe('ok');
  // A write that ran, or an answer that proves nothing, fails.
  for (const status of [200, 201, 400, 404, 429, 500])
    expect(writeRefusedVerdict(status), String(status)).toBe('failed');
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
  expect(protectionVerdict(307, '/login', true)).toBe('ok');
  // A bypass Vercel does not accept leaves the request at its sign-in.
  expect(protectionVerdict(401, null, true)).toBe('failed');
  expect(protectionVerdict(302, signIn, true)).toBe('failed');
  expect(protectionVerdict(500, null, true)).toBe('failed');
});
