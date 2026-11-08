import { createClient } from '@supabase/supabase-js';
import { expect, test } from '../golden/support/fixtures';
import { requireEnv } from '../golden/support/env';
import { testSupabaseClientOptions } from '../golden/support/client-options';
import { isJsonRecord } from '../../lib/supabase/json';
import { getDevSecurityProblems } from '../../lib/testing/spec-support/cloud-security';
import { captureRealtimeBoundaries } from './support/realtime-boundaries';

// Independent from the timing canary so a known speed failure cannot hide
// provider security drift. Every invocation owns a fresh disposable DEV world.
test('C10: Cloud-Berechtigungen bleiben auf die vorgesehenen Rollen beschränkt @CANARY', async () => {
  expect(await getDevSecurityProblems()).toEqual([]);
});

test('C11: Realtime verbirgt Änderungen vor fremden und gesperrten Empfängern @CANARY', async ({
  world,
}, testInfo) => {
  const events = await captureRealtimeBoundaries(world);
  await testInfo.attach('synthetic-realtime-delivery.json', {
    body: Buffer.from(JSON.stringify(events, null, 2)),
    contentType: 'application/json',
  });
  expect(events.filter((event) => event.receiver === 'foreign')).toEqual([]);
  expect(events.filter((event) => event.receiver === 'revoked' && event.phase === 'revoked')).toEqual([]);
  expect(events.filter((event) => event.event === 'DELETE' && event.source === 'row')).toEqual([]);
  const deletion = events.filter((event) => event.receiver === 'ordinary' && event.source === 'deletion');
  expect(deletion).toHaveLength(1);
  const [deletionEvent] = deletion;
  if (!deletionEvent) throw new Error('expected one deletion event');
  expect(Object.keys(deletionEvent.current).sort()).toEqual([
    'created_at',
    'id',
    'organization_id',
    'row_id',
    'table_name',
  ]);
  expect(deletionEvent.current).toMatchObject({ organization_id: world.orgId, table_name: 'clients' });
});

test('C12: Cloud-Mail benötigt Serverberechtigung und einen bestätigten Versandauftrag @CANARY', async ({
  world,
}) => {
  const url = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
  const key = requireEnv('SUPABASE_SECRET_KEY');
  const admin = createClient(url, key, testSupabaseClientOptions);
  // Resend's documented test mailbox is reserved by this run before sending.
  expect(world.invitee.email).toMatch(/^delivered\+gg-[a-f0-9]+@resend\.dev$/);
  const mailed = await admin.functions.invoke<unknown>('send-invite-email', {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    body: {
      to: world.invitee.email,
      inviterName: 'Security Test',
      organizationName: world.orgName,
      inviteUrl: 'https://app.werk-flow.app/login',
      isExistingUser: true,
    },
  });
  const { data } = mailed;
  // functions-js types a failure's error as any.
  const error: unknown = mailed.error;
  expect(error).toBeNull();
  expect(data).toMatchObject({ success: true });
  expect(isJsonRecord(data) ? data.id : undefined).toMatch(/^[0-9a-f-]{36}$/i);
  const denied = await fetch(`${url}/functions/v1/send-invite-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(15_000),
    redirect: 'error',
  });
  expect(denied.status).toBe(401);
});
