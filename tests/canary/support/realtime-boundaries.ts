import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { requireEnv } from '../../golden/support/env';
import { testSupabaseClientOptions } from '../../golden/support/client-options';
import type { TestUser, TestWorld } from '../../golden/support/world';
import { REALTIME_DELETION_TABLE } from '../../../lib/realtime/tables';

type CapturedEvent = { receiver: string; event: string; phase: 'member' | 'revoked'; source: 'row' | 'deletion'; current: Record<string, unknown>; previous: Record<string, unknown> };

/** Uses only the caller's disposable world. Absence is observed after a positive delivery control. */
export async function captureRealtimeBoundaries(world: TestWorld, diagnostic?: (value: Record<string, unknown>) => void): Promise<CapturedEvent[]> {
  const url = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
  const key = requireEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
  const admin = createClient(url, requireEnv('SUPABASE_SECRET_KEY'), testSupabaseClientOptions);
  const clients: SupabaseClient[] = [];
  const events: CapturedEvent[] = [];
  let phase: CapturedEvent['phase'] = 'member';
  const id = randomUUID();
  async function receiver(label: string, user: TestUser): Promise<void> {
    const client = createClient(url, key, testSupabaseClientOptions);
    clients.push(client);
    const { data, error } = await client.auth.signInWithPassword({ email: user.email, password: user.password });
    if (error || !data.session) throw new Error(`Synthetic ${label} sign-in failed.`);
    await client.realtime.setAuth(data.session.access_token);
    const membership = await client.from('organization_members').select('organization_id').eq('organization_id', world.orgId);
    diagnostic?.({ receiver: label, membershipCount: membership.data?.length, membershipError: membership.error?.code });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${label} subscription did not become ready.`)), 20_000);
      let joined = false;
      let postgresReady = false;
      const ready = (): void => { if (joined && postgresReady) { clearTimeout(timer); resolve(); } };
      client.channel(`security-${label}-${world.runId}`)
        .on('system', {}, (payload) => {
          diagnostic?.({ receiver: label, system: payload });
          if (payload.status === 'ok' && payload.extension === 'postgres_changes') { postgresReady = true; ready(); }
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'clients', filter: `organization_id=eq.${world.orgId}` }, (payload) => {
          const current = payload.new as Record<string, unknown>;
          const previous = payload.old as Record<string, unknown>;
          diagnostic?.({ receiver: label, event: payload.eventType, currentFields: Object.keys(current), previousFields: Object.keys(previous), expected: current.id === id || previous.id === id });
          if (current.id === id || previous.id === id) events.push({ receiver: label, event: payload.eventType, phase, source: 'row', current, previous });
        })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: REALTIME_DELETION_TABLE, filter: `organization_id=eq.${world.orgId}` }, (payload) => {
          const current = payload.new as Record<string, unknown>;
          if (current.row_id === id) events.push({ receiver: label, event: 'DELETE', phase, source: 'deletion', current, previous: {} });
        })
        .subscribe((status, subscriptionError) => {
          diagnostic?.({ receiver: label, status, error: subscriptionError?.message });
          if (status === 'SUBSCRIBED') { joined = true; ready(); }
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') { clearTimeout(timer); reject(subscriptionError ?? new Error(`${label}: ${status}`)); }
        });
    });
  }
  async function observe(event: string, expectedReceivers: readonly string[] = ['ordinary']): Promise<void> {
    const deadline = Date.now() + 15_000;
    while (!expectedReceivers.every((receiver) => events.some((entry) => entry.receiver === receiver && entry.event === event))) {
      if (Date.now() >= deadline) throw new Error(`Permitted receivers did not observe ${event}.`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    // This is an explicit negative-delivery observation window, never a UI readiness wait.
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
  try {
    await receiver('ordinary', world.users.admin);
    await receiver('foreign', world.outsider.admin);
    // Clients SELECT permits managers. Prove access before revoking that same
    // office user's membership; an employee never had this permission.
    await receiver('revoked', world.users.buero);
    const inserted = await admin.from('clients').insert({ id, organization_id: world.orgId, name: `Security synthetic ${world.runId}` });
    if (inserted.error) throw new Error(`Synthetic insert failed: ${inserted.error.code}`);
    await observe('INSERT', ['ordinary', 'revoked']);
    const revoked = await admin.from('organization_members').delete().eq('organization_id', world.orgId).eq('user_id', world.users.buero.id);
    if (revoked.error) throw new Error('Synthetic membership revocation failed.');
    phase = 'revoked';
    const updated = await admin.from('clients').update({ name: `Security updated ${world.runId}` }).eq('id', id).eq('organization_id', world.orgId);
    if (updated.error) throw new Error(`Synthetic update failed: ${updated.error.code}`);
    await observe('UPDATE');
    const deleted = await admin.from('clients').delete().eq('id', id).eq('organization_id', world.orgId);
    if (deleted.error) throw new Error(`Synthetic delete failed: ${deleted.error.code}`);
    await observe('DELETE');
    return events;
  } finally {
    await Promise.all(clients.map((client) => client.removeAllChannels()));
    const cleanup = await admin.from('clients').delete().eq('id', id).eq('organization_id', world.orgId);
    if (cleanup.error) throw new Error('Synthetic Realtime row cleanup failed.');
  }
}
