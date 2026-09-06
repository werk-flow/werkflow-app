import { resolve } from 'node:path';
import { runSessionCommand, withLocalStackLease } from '../lib/testing/local-stack-lease';
import { withWorkspaceTestLock } from '../lib/testing/workspace-test-lock';

const target = process.argv[2];
if (target !== 'local' && target !== 'cloud') throw new Error('Usage: bun run test:server <local|cloud>');
const repositoryRoot = resolve(import.meta.dir, '..');

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
    await run([process.execPath, 'run', 'test:preflight', 'iteration', target]);
    await run([process.execPath, 'run', 'build:test']);
  });
  console.log(`[werkflow-test] Serving the recorded ${target} build. Keep this process alive throughout verification.`);
  await run([process.execPath, 'run', 'start']);
});
