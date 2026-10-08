import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { calculateBuildInputs, type BuildReceipt } from '../lib/testing/evidence/build-identity';
import { assertAppPortFree } from '../lib/testing/runner/app-port';
import { withWorkspaceTestLock } from '../lib/testing/runner/workspace-test-lock';

// The one local production build (`bun run build`). It records the build the
// test server serves; Vercel runs plain `next build` (vercel.json buildCommand).
const repositoryRoot = realpathSync(resolve(import.meta.dir, '..'));
await withWorkspaceTestLock({ operation: 'production build', repositoryRoot }, async () => {
  await assertAppPortFree();
  const receiptPath = resolve(repositoryRoot, '.next/werkflow-build-receipt.json');
  if (existsSync(receiptPath)) rmSync(receiptPath);
  const inputs = calculateBuildInputs(repositoryRoot);
  const buildId = randomUUID();
  const exitCode = await new Promise<number>((resolveExit, reject) => {
    const child = spawn(
      'node',
      [resolve(repositoryRoot, 'node_modules/next/dist/bin/next'), 'build', ...process.argv.slice(2)],
      {
        cwd: repositoryRoot,
        stdio: 'inherit',
        env: { ...process.env, NODE_ENV: 'production', WERKFLOW_BUILD_ID: buildId },
      },
    );
    child.once('error', reject);
    child.once('exit', (code) => resolveExit(code ?? 1));
  });
  if (exitCode !== 0) {
    process.exitCode = exitCode;
    return;
  }
  const after = calculateBuildInputs(repositoryRoot);
  if (JSON.stringify(after) !== JSON.stringify(inputs))
    throw new Error(
      'Build inputs changed during compilation. Freeze application and environment edits, then rebuild.',
    );
  if (readFileSync(resolve(repositoryRoot, '.next/BUILD_ID'), 'utf8').trim() !== buildId)
    throw new Error('Next did not persist the requested build identity.');
  const receipt: BuildReceipt = {
    version: 1,
    ...inputs,
    repositoryRoot,
    buildId,
    completedAt: new Date().toISOString(),
  };
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(`[werkflow-build] Recorded ${buildId} for this workspace and environment.`);
});
