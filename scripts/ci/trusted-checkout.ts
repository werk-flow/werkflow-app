// The machine runner's start-up integrity check of its trusted checkout (scripts/ci/machine-runner.ts).
// An agent on the machine can write that checkout (docs/technical/machine-setup.md, Security): a
// clean `git status` proves the tracked files, but not `node_modules`, which git ignores. So at every
// start the runner checks that the lockfile is the commit's, removes `node_modules` and installs it
// again from the lockfile alone with an empty package cache, and refuses to start when anything of that differs or fails.
// It imports only Node's own modules, so no code from node_modules runs before it: the service runs
// it before the runner. Usage: bun scripts/ci/trusted-checkout.ts <trusted checkout>
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const sha256 = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');

const git = (checkout: string, args: readonly string[]) =>
  spawnSync('git', args, { cwd: checkout, encoding: 'buffer', timeout: 60_000 });

/**
 * Rebuilds `checkout`'s `node_modules` from its committed lockfile with `install` (the runner's
 * `bun install --frozen-lockfile`) and verifies the checkout clean before and after; the lockfile's
 * hash on success.
 */
export function verifyTrustedCheckout(
  checkout: string,
  install: () => { status: number | null },
): { lockHash: string } | { problem: string } {
  const committed = git(checkout, ['show', 'HEAD:bun.lock']);
  if (committed.status !== 0) return { problem: 'The trusted checkout has no committed bun.lock.' };
  const lockHash = sha256(committed.stdout);
  const clean = (): boolean => {
    const status = git(checkout, ['status', '--porcelain']);
    return status.status === 0 && status.stdout.length === 0;
  };
  const lockfileIsCommitted = (): boolean => sha256(readFileSync(join(checkout, 'bun.lock'))) === lockHash;
  if (!clean() || !lockfileIsCommitted())
    return { problem: 'The trusted checkout differs from its commit; the runner runs only a clean commit.' };
  rmSync(join(checkout, 'node_modules'), { recursive: true, force: true });
  if (install().status !== 0)
    return { problem: 'bun install --frozen-lockfile failed in the trusted checkout.' };
  if (!clean() || !lockfileIsCommitted())
    return { problem: 'The install changed the trusted checkout; the runner does not start.' };
  return { lockHash };
}

if (import.meta.main) {
  const checkout = process.argv[2];
  if (!checkout) throw new Error('Usage: bun scripts/ci/trusted-checkout.ts <trusted checkout>');
  // A new, empty package cache: every package comes from the registry against bun.lock's integrity
  // hash, never from a cache another process of this user could have written.
  const cache = mkdtempSync(join(dirname(resolve(checkout)), '.install-cache-'));
  const verified = verifyTrustedCheckout(checkout, () =>
    spawnSync(process.execPath, ['install', '--frozen-lockfile'], {
      cwd: checkout,
      stdio: 'inherit',
      timeout: 10 * 60_000,
      env: { ...process.env, BUN_INSTALL_CACHE_DIR: cache },
    }),
  );
  rmSync(cache, { recursive: true, force: true });
  if ('problem' in verified) throw new Error(verified.problem);
  console.info(`[trusted-checkout] node_modules rebuilt from bun.lock ${verified.lockHash}`);
}
