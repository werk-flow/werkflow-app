// Actual server environment readers. `server-only` refuses to load outside a
// server bundle, so this runs in its own process with that marker replaced.
import assert from 'node:assert/strict';
import { mock } from 'bun:test';

mock.module('server-only', () => ({}));
const { getEmailOtpHashSecret, getSiteUrl, getSupabaseSecretKey } = await import('@/lib/env/server');

// A required secret that is missing, empty or blank stops the caller with the variable's name.
for (const [variable, read] of [
  ['SUPABASE_SECRET_KEY', getSupabaseSecretKey],
  ['EMAIL_OTP_HASH_SECRET', getEmailOtpHashSecret],
] as const) {
  for (const blank of [undefined, '', '   ']) {
    if (blank === undefined) delete process.env[variable];
    else process.env[variable] = blank;
    assert.throws(read, { message: `Missing ${variable} environment variable.` });
  }
  process.env[variable] = '  fixture-value\n';
  assert.equal(read(), 'fixture-value');
}

// The site URL is optional: blank means absent, a value arrives trimmed.
delete process.env.NEXT_PUBLIC_SITE_URL;
assert.equal(getSiteUrl(), undefined);
process.env.NEXT_PUBLIC_SITE_URL = '  ';
assert.equal(getSiteUrl(), undefined);
process.env.NEXT_PUBLIC_SITE_URL = ' https://app.example.test ';
assert.equal(getSiteUrl(), 'https://app.example.test');
