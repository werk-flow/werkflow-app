/**
 * Auth-config parity check and one-way template sync: prod -> dev.
 *
 * Background (2026-08-20): the environment split replicated the database
 * byte-exactly, but Supabase auth EMAIL TEMPLATES are project configuration,
 * not schema. Dev therefore shipped with the default confirmation-link
 * template while the app's signup flow expects the 6-digit OTP ({{ .Token }})
 * that prod's customized template sends. This script closes that class of gap
 * and doubles as the parity check that the split's acceptance was missing.
 *
 * Usage (requires SUPABASE_ACCESS_TOKEN, a Supabase PAT, in the environment):
 *   bun scripts/sync-dev-auth-from-prod.ts           # diff only, read-only
 *   bun scripts/sync-dev-auth-from-prod.ts --apply   # also PATCH dev's mailer_* fields to prod's values
 *
 * Prod is only ever read. Only dev is written, and only `mailer_*` fields
 * (templates, subjects, OTP expiry, autoconfirm). Deliberately environment-
 * specific fields (site_url, uri_allow_list, SMTP credentials) are reported
 * as expected divergences and never synced.
 */

const PROD_REF = 'jbgaqpdjauzoocplgdsn';
const DEV_REF = 'mbkkzuqjbdvzelqvuzcn';
const API = 'https://api.supabase.com/v1/projects';

const EXPECTED_DIVERGENT = new Set([
  'site_url',
  'uri_allow_list',
  'smtp_user',
  'smtp_pass',
  'smtp_sender_name',
]);

const SECRET_PATTERN = /(pass|secret|key|token)/i;

const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  console.error(
    'SUPABASE_ACCESS_TOKEN is not set. Export the Supabase PAT first (see docs/technical/environments.md, onboarding step 1).'
  );
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
};

async function getAuthConfig(ref: string): Promise<Record<string, unknown>> {
  const response = await fetch(`${API}/${ref}/config/auth`, { headers });
  if (!response.ok) {
    throw new Error(`GET auth config for ${ref} failed: ${response.status} ${await response.text()}`);
  }
  return (await response.json()) as Record<string, unknown>;
}

function displayValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '<empty>';
  if (SECRET_PATTERN.test(key)) return '<redacted>';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > 120 ? `${text.slice(0, 117)}… (${text.length} chars)` : text;
}

const apply = process.argv.includes('--apply');

const [prod, dev] = await Promise.all([getAuthConfig(PROD_REF), getAuthConfig(DEV_REF)]);

const allKeys = [...new Set([...Object.keys(prod), ...Object.keys(dev)])].sort();
const divergent: string[] = [];
const expected: string[] = [];

for (const key of allKeys) {
  const prodValue = JSON.stringify(prod[key] ?? null);
  const devValue = JSON.stringify(dev[key] ?? null);
  if (prodValue === devValue) continue;
  const line = `  ${key}: prod=${displayValue(key, prod[key])} | dev=${displayValue(key, dev[key])}`;
  (EXPECTED_DIVERGENT.has(key) ? expected : divergent).push(line);
}

console.log(`Auth config comparison (${allKeys.length} fields):`);
console.log(`\nExpected environment-specific divergences (${expected.length}):`);
for (const line of expected) console.log(line);
console.log(`\nUNEXPECTED divergences (${divergent.length}):`);
for (const line of divergent) console.log(line.length > 0 ? line : '  none');
if (divergent.length === 0) console.log('  none — dev matches prod outside the expected fields.');

if (!apply) {
  console.log('\nRead-only run. Re-run with --apply to sync mailer_* fields (templates, subjects, OTP expiry) prod -> dev.');
  process.exit(divergent.length === 0 ? 0 : 2);
}

const mailerPatch: Record<string, unknown> = {};
for (const key of Object.keys(prod)) {
  if (key.startsWith('mailer_') && JSON.stringify(prod[key]) !== JSON.stringify(dev[key])) {
    mailerPatch[key] = prod[key];
  }
}

if (Object.keys(mailerPatch).length === 0) {
  console.log('\nNothing to apply: all mailer_* fields already match prod.');
  process.exit(0);
}

console.log(`\nPatching dev with ${Object.keys(mailerPatch).length} mailer_* fields: ${Object.keys(mailerPatch).join(', ')}`);
const patchResponse = await fetch(`${API}/${DEV_REF}/config/auth`, {
  method: 'PATCH',
  headers,
  body: JSON.stringify(mailerPatch),
});
if (!patchResponse.ok) {
  throw new Error(`PATCH dev auth config failed: ${patchResponse.status} ${await patchResponse.text()}`);
}

const devAfter = await getAuthConfig(DEV_REF);
const stillDifferent = Object.keys(mailerPatch).filter(
  (key) => JSON.stringify(devAfter[key]) !== JSON.stringify(prod[key])
);
if (stillDifferent.length > 0) {
  console.error(`Verification failed — still divergent after PATCH: ${stillDifferent.join(', ')}`);
  process.exit(1);
}
console.log('Applied and verified: dev mailer configuration now matches prod.');
