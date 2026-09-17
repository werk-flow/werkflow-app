import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { runSessionCommand, withLocalStackLease } from '../lib/testing/local-stack-lease';
import { withWorkspaceTestLock } from '../lib/testing/workspace-test-lock';

const target = process.argv[2];
if (target !== 'local' && target !== 'cloud') throw new Error('Usage: bun run test:server <local|cloud>');
const repositoryRoot = resolve(import.meta.dir, '..');

/**
 * The local Realtime service drops its tenant database connection after a few
 * idle minutes and rebuilds it on the next subscription; changes written in
 * the seconds after that cold start reach subscribers 7 to 13 seconds late
 * (incident of 2026-09-15). One subscription held for the server's lifetime
 * warms the tenant before the first group and keeps it warm between groups.
 */
async function keepRealtimeWarm(): Promise<() => Promise<void>> {
  const environment = new Map<string, string>();
  for (const line of (await readFile(resolve(repositoryRoot, '.env.local'), 'utf8')).split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match?.[1] && match[2] !== undefined) environment.set(match[1], match[2].replace(/^"(.*)"$/, '$1'));
  }
  const url = environment.get('NEXT_PUBLIC_SUPABASE_URL');
  const key = environment.get('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
  const secret = environment.get('SUPABASE_SECRET_KEY');
  if (!url || !key || !secret) throw new Error('.env.local must name NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY.');
  // Channel authorization needs a user JWT (the sb_* keys are not accepted),
  // so the warm-up signs in a throwaway confirmed user without any
  // organization membership; RLS delivers it nothing, which is fine.
  const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  const email = `realtime-warm-up-${process.pid}-${Date.now()}@werkflow.local`;
  const password = crypto.randomUUID();
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error(`Could not create the Realtime warm-up user: ${created.error?.message ?? 'no user'}`);
  const warmUpUserId = created.data.user.id;
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, realtime: { timeout: 20_000 } });
  // The throwaway user is deleted on every exit, a failed warm-up included.
  const cleanUp = async (): Promise<void> => {
    client.realtime.disconnect();
    const deleted = await admin.auth.admin.deleteUser(warmUpUserId);
    if (deleted.error) console.warn(`[werkflow-test] Could not delete the Realtime warm-up user ${email}: ${deleted.error.message}`);
  };
  let channel = client.channel('werkflow-test-realtime-warm-up');
  try {
    const signedIn = await client.auth.signInWithPassword({ email, password });
    if (signedIn.error || !signedIn.data.session) throw new Error(`Could not sign in the Realtime warm-up user: ${signedIn.error?.message ?? 'no session'}`);
    await client.realtime.setAuth(signedIn.data.session.access_token);
    // A cold tenant rejects the first joins while it initializes (about ten
    // seconds) and does not confirm the database subscription of a rejected
    // join later, so each attempt uses a fresh channel until one is confirmed.
    const deadline = Date.now() + 120_000;
    for (let attempt = 1; ; attempt += 1) {
      const outcome = await new Promise<'ok' | string>((resolveAttempt) => {
        const timer = setTimeout(() => resolveAttempt('no readiness message within 15 s'), 15_000);
        channel
          .on('system', {}, (payload: unknown) => {
            if (!payload || typeof payload !== 'object' || !('extension' in payload) || payload.extension !== 'postgres_changes' || !('status' in payload)) return;
            clearTimeout(timer);
            resolveAttempt(payload.status === 'ok' ? 'ok' : `postgres changes ${String(payload.status)}`);
          })
          .on('postgres_changes', { event: '*', schema: 'public', table: 'organization_settings' }, () => {})
          .subscribe((status: string, error?: Error) => {
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
              clearTimeout(timer);
              resolveAttempt(`join ${status}${error ? ` (${error.message})` : ''}`);
            }
          });
      });
      if (outcome === 'ok') break;
      await client.removeChannel(channel);
      if (Date.now() >= deadline) throw new Error(`The local Realtime tenant did not report database readiness within 120 s; last attempt: ${outcome}.`);
      console.warn(`[werkflow-test] Realtime warm-up attempt ${attempt}: ${outcome}; retrying while the tenant initializes.`);
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 5_000));
      channel = client.channel(`werkflow-test-realtime-warm-up-${attempt + 1}`);
    }
  } catch (error) {
    await client.removeChannel(channel);
    await cleanUp();
    throw error;
  }
  console.log('[werkflow-test] Realtime tenant is warm; holding the subscription for the server lifetime.');
  return async () => {
    await client.removeChannel(channel);
    await cleanUp();
  };
}

await withLocalStackLease(target === 'local', async (signal) => {
  // Bun loaded the old .env.local at startup. Children must read the newly
  // switched file instead of inheriting its previous backend keys.
  const childEnvironment: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: 'production' };
  for (const key of Object.keys(childEnvironment)) {
    if (key !== 'SUPABASE_ACCESS_TOKEN' && /^(NEXT_PUBLIC_|SUPABASE_|R2_)/.test(key)) delete childEnvironment[key];
  }
  const run = async (command: readonly string[]): Promise<void> => {
    const code = await runSessionCommand(command, { signal, cwd: repositoryRoot, env: { ...childEnvironment, WERKFLOW_TEST_LOCK_TOKEN: process.env.WERKFLOW_TEST_LOCK_TOKEN, WERKFLOW_TEST_LOCK_PATH: process.env.WERKFLOW_TEST_LOCK_PATH } });
    if (code !== 0) throw new Error(`${command[1] ?? command[0]} exited ${code}.`);
  };
  await withWorkspaceTestLock({ operation: `prepare ${target} test server`, repositoryRoot }, async () => {
    await run([process.execPath, 'run', target === 'local' ? 'env:local' : 'env:dev']);
    if (target === 'local') await run(['wsl.exe', '--exec', 'docker', 'start', 'supabase_edge_runtime_werkflow-app']);
    await run([process.execPath, 'run', 'test:preflight', 'backend', target]);
    await run([process.execPath, 'run', 'build:test']);
  });
  const releaseRealtimeWarmUp = target === 'local' ? await keepRealtimeWarm() : null;
  console.log(`[werkflow-test] Serving the recorded ${target} build. Keep this process alive throughout verification.`);
  try {
    await run([process.execPath, 'run', 'start']);
  } finally {
    await releaseRealtimeWarmUp?.();
  }
});
