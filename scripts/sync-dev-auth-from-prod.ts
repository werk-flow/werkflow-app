/**
 * Auth-config parity check and one-way template sync: prod -> dev.
 *
 * Supabase auth email templates are project configuration, not schema, so no
 * migration carries them (decision 0003). This script compares the complete
 * auth configuration of both projects and, with --apply, copies PROD's mail
 * fields to DEV.
 *
 *   bun scripts/sync-dev-auth-from-prod.ts           # compare only, read-only
 *   bun scripts/sync-dev-auth-from-prod.ts --apply   # also PATCH DEV's mail fields to PROD's values
 *
 * PROD is only ever read, with the read-only PROD token that only the PROD
 * inspection job holds (.github/workflows/prod-inspect.yml, input `auth`); on a
 * workstation the run fails and names the job. DEV is read and written with
 * SUPABASE_ACCESS_TOKEN, and only `mailer_*` fields and SYNC_EXTRA are written.
 * Environment-specific fields (site_url, uri_allow_list, SMTP credentials) are
 * reported as expected divergences and never synced. The job's log is public,
 * so the output names fields only, never a value or a response body.
 *
 * Exit 0: no unexpected divergence, or applied and verified. Exit 2: a compare
 * found unexpected divergences. Exit 1: the run failed.
 */

import { resolve } from 'node:path';

import { supabaseProjectRefs } from '../lib/security/production-access';
import {
  InspectionFailure,
  PROD_DENIED,
  failureMessage,
  patchProject,
  projectTokens,
  readProject,
} from '../lib/security/production-inspection';
import { z } from '../lib/zod';

const EXPECTED_DIVERGENT = new Set([
  'site_url',
  'uri_allow_list',
  'smtp_user',
  'smtp_pass',
  'smtp_sender_name',
  // Platform-managed internal flag (newer projects have it on; PATCH is a
  // silent no-op). No user-visible auth behavior; not worth chasing.
  'index_worker_ensure_user_search_indexes_exist',
]);

// Non-mailer fields that must still match prod (found divergent 2026-08-20):
// dev's defaults throttled auth emails to 2/hour and enabled a newer platform
// toggle prod has off. Explicit allowlist — never blind-sync unknown fields.
const SYNC_EXTRA = new Set([
  'rate_limit_email_sent',
  'index_worker_ensure_user_search_indexes_exist',
  'security_update_password_require_reauthentication',
  'smtp_admin_email',
]);

const label = '[auth-sync]';
const configSchema = z.record(z.string(), z.unknown());
const differs = (left: unknown, right: unknown) =>
  JSON.stringify(left ?? null) !== JSON.stringify(right ?? null);

async function main(): Promise<number> {
  const refs = supabaseProjectRefs(resolve(import.meta.dir, '..'));
  if (!refs) throw new InspectionFailure('docs/technical/environments.md names no Supabase project refs.');
  const tokens = projectTokens(process.env);
  const prodCall = {
    ref: refs.production,
    token: tokens.production,
    denied: PROD_DENIED,
    path: 'config/auth',
  };
  const devCall = { ref: refs.dev, token: tokens.dev, path: 'config/auth' };
  const readDev = () => readProject({ ...devCall, schema: configSchema });
  const [prod, dev] = await Promise.all([readProject({ ...prodCall, schema: configSchema }), readDev()]);

  const keys = [...new Set([...Object.keys(prod), ...Object.keys(dev)])].sort();
  const divergent = keys.filter((key) => differs(prod[key], dev[key]));
  const expected = divergent.filter((key) => EXPECTED_DIVERGENT.has(key));
  const unexpected = divergent.filter((key) => !EXPECTED_DIVERGENT.has(key));
  console.log(`${label} Compared ${keys.length} fields of the Auth configuration.`);
  console.log(`${label} Expected environment-specific divergences: ${expected.join(', ') || 'none'}.`);
  console.log(`${label} Unexpected divergences: ${unexpected.join(', ') || 'none'}.`);

  if (!process.argv.includes('--apply')) {
    if (unexpected.length > 0)
      console.log(`${label} Read-only run. Apply copies the mail fields from PROD to DEV.`);
    return unexpected.length === 0 ? 0 : 2;
  }

  // *_custom_contents are derived bookkeeping (which fields are customized);
  // the API rejects them in a PATCH, which silently voids the whole payload.
  const patch = Object.fromEntries(
    Object.keys(prod)
      .filter((key) => !key.endsWith('_custom_contents'))
      .filter((key) => key.startsWith('mailer_') || SYNC_EXTRA.has(key))
      .filter((key) => differs(prod[key], dev[key]))
      .map((key) => [key, prod[key]]),
  );
  const fields = Object.keys(patch);
  if (fields.length === 0) {
    console.log(`${label} Nothing to apply: the mail fields already match PROD.`);
    return 0;
  }
  console.log(`${label} Patching ${fields.length} fields of DEV: ${fields.join(', ')}.`);
  await patchProject({ ...devCall, patch, schema: z.unknown() });

  // The config propagates asynchronously; an immediate re-read can be stale.
  await new Promise((done) => setTimeout(done, 8000));
  const after = await readDev();
  const still = fields.filter((key) => differs(after[key], prod[key]));
  if (still.length > 0) {
    console.error(`${label} Still divergent after the PATCH: ${still.join(', ')}.`);
    return 1;
  }
  console.log(`${label} Applied and verified: DEV's mail fields match PROD.`);
  return 0;
}

if (import.meta.main) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(`${label} unverified: ${failureMessage(error)}`);
    process.exitCode = 1;
  }
}
