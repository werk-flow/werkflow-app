import { waitForLocalStackHealth } from '../lib/testing/local-stack/local-stack-startup';
import { createWriteStream, mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { subscribeForDatabaseReadiness } from './realtime-probe';
import { runSessionCommand, withLocalStackLease } from '../lib/testing/local-stack/local-stack-lease';
import { withWorkspaceTestLock } from '../lib/testing/runner/workspace-test-lock';

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
  if (!url || !key || !secret)
    throw new Error(
      '.env.local must name NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY.',
    );
  // Channel authorization needs a user JWT (the sb_* keys are not accepted),
  // so the warm-up signs in a throwaway confirmed user without any
  // organization membership; RLS delivers it nothing, which is fine.
  const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  const email = `realtime-warm-up-${process.pid}-${Date.now()}@werkflow.local`;
  const password = crypto.randomUUID();
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user)
    throw new Error(`Could not create the Realtime warm-up user: ${created.error?.message ?? 'no user'}`);
  const warmUpUserId = created.data.user.id;
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { timeout: 20_000 },
  });
  // The throwaway user is deleted on every exit, a failed warm-up included.
  const cleanUp = async (): Promise<void> => {
    client.realtime.disconnect();
    const deleted = await admin.auth.admin.deleteUser(warmUpUserId);
    if (deleted.error)
      console.warn(
        `[werkflow-test] Could not delete the Realtime warm-up user ${email}: ${deleted.error.message}`,
      );
  };
  let channel = client.channel('werkflow-test-realtime-warm-up');
  try {
    const signedIn = await client.auth.signInWithPassword({ email, password });
    if (signedIn.error || !signedIn.data.session)
      throw new Error(
        `Could not sign in the Realtime warm-up user: ${signedIn.error?.message ?? 'no session'}`,
      );
    await client.realtime.setAuth(signedIn.data.session.access_token);
    // A cold tenant rejects the first joins while it initializes (about ten
    // seconds) and does not confirm the database subscription of a rejected
    // join later, so each attempt uses a fresh channel until one is confirmed.
    const deadline = Date.now() + 120_000;
    for (let attempt = 1; ; attempt += 1) {
      const outcome = await subscribeForDatabaseReadiness(channel, 15_000);
      if (outcome === 'ok') break;
      await client.removeChannel(channel);
      if (Date.now() >= deadline)
        throw new Error(
          `The local Realtime tenant did not report database readiness within 120 s; last attempt: ${outcome}.`,
        );
      console.warn(
        `[werkflow-test] Realtime warm-up attempt ${attempt}: ${outcome}; retrying while the tenant initializes.`,
      );
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

/**
 * The served build's output is the only record of a server-side failure
 * during a browser group; the P1-08 redirect of 2026-09-30 could not be traced
 * to its exception because that output lived in a terminal. Tee it to a capped
 * file per server lifetime, keeping the terminal stream unchanged.
 */
const SERVER_LOG_CAP_BYTES = 64 * 1024 * 1024;
function openServerLog(): {
  path: string;
  tee: (terminal: NodeJS.WriteStream) => (chunk: Buffer) => void;
  close: () => Promise<void>;
} {
  const directory = resolve(repositoryRoot, '.agent-logs/test-server');
  mkdirSync(directory, { recursive: true });
  const path = resolve(directory, `${new Date().toISOString().replace(/[-:.]/g, '')}-${target}.log`);
  const file = createWriteStream(path);
  let written = 0;
  return {
    path,
    tee: (terminal) => (chunk) => {
      terminal.write(chunk);
      if (written >= SERVER_LOG_CAP_BYTES) return;
      written += chunk.length;
      file.write(chunk);
      if (written >= SERVER_LOG_CAP_BYTES)
        file.write(
          `\n[werkflow-test] Server log capped at ${SERVER_LOG_CAP_BYTES} bytes; later output stays on the terminal only.\n`,
        );
    },
    close: () => new Promise((resolveClose) => file.end(resolveClose)),
  };
}

await withLocalStackLease(target === 'local', async (signal) => {
  // Bun loaded the old .env.local at startup. Children must read the newly
  // switched file instead of inheriting its previous backend keys.
  const childEnvironment: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: 'production' };
  for (const key of Object.keys(childEnvironment)) {
    if (key !== 'SUPABASE_ACCESS_TOKEN' && /^(NEXT_PUBLIC_|SUPABASE_|R2_)/.test(key))
      delete childEnvironment[key];
  }
  const run = async (
    command: readonly string[],
    output: { onStdout: (chunk: Buffer) => void; onStderr: (chunk: Buffer) => void } | undefined = undefined,
  ): Promise<void> => {
    const code = await runSessionCommand(command, {
      signal,
      cwd: repositoryRoot,
      env: {
        ...childEnvironment,
        WERKFLOW_TEST_LOCK_TOKEN: process.env.WERKFLOW_TEST_LOCK_TOKEN,
        WERKFLOW_TEST_LOCK_PATH: process.env.WERKFLOW_TEST_LOCK_PATH,
      },
      ...output,
    });
    if (code !== 0) throw new Error(`${command[1] ?? command[0]} exited ${code}.`);
  };
  await withWorkspaceTestLock({ operation: `prepare ${target} test server`, repositoryRoot }, async () => {
    if (target === 'local') await waitForLocalStackHealth(signal);
    await run([process.execPath, 'run', target === 'local' ? 'env:local' : 'env:dev']);
    if (target === 'local')
      await run(['wsl.exe', '--exec', 'docker', 'start', 'supabase_edge_runtime_werkflow-app']);
    await run([process.execPath, 'run', 'test:preflight', 'backend', target]);
    await run([process.execPath, 'run', 'build:test']);
  });
  const releaseRealtimeWarmUp = target === 'local' ? await keepRealtimeWarm() : null;
  const serverLog = openServerLog();
  console.log(
    `[werkflow-test] Serving the recorded ${target} build. Keep this process alive throughout verification. Server output is also written to ${serverLog.path}.`,
  );
  try {
    await run([process.execPath, 'run', 'start'], {
      onStdout: serverLog.tee(process.stdout),
      onStderr: serverLog.tee(process.stderr),
    });
  } finally {
    await serverLog.close();
    await releaseRealtimeWarmUp?.();
  }
});
