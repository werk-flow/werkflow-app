// B3 (the CI lead's review): the runner's start-up integrity check of its trusted checkout
// (scripts/ci/trusted-checkout.ts) rebuilds node_modules from the committed lockfile, and refuses a
// checkout or an install that differs from the commit.
import { afterEach, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyTrustedCheckout } from '../../../scripts/ci/trusted-checkout';

const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

function checkout(): string {
  const folder = mkdtempSync(join(tmpdir(), 'trusted-checkout-'));
  folders.push(folder);
  const git = (...args: string[]) =>
    spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], { cwd: folder });
  git('init', '--quiet');
  writeFileSync(join(folder, '.gitignore'), 'node_modules\n');
  writeFileSync(join(folder, 'bun.lock'), '{"lockfileVersion":1}\n');
  git('add', '.');
  git('commit', '--quiet', '-m', 'trusted');
  return folder;
}

test('B3 (CI lead): a planted node_modules is removed and installed again from the lockfile', () => {
  const folder = checkout();
  mkdirSync(join(folder, 'node_modules/zod'), { recursive: true });
  writeFileSync(join(folder, 'node_modules/zod/index.js'), 'planted');
  let sawPlanted: boolean | undefined;
  const verified = verifyTrustedCheckout(folder, () => {
    sawPlanted = existsSync(join(folder, 'node_modules/zod/index.js'));
    return { status: 0 };
  });
  expect(sawPlanted).toBe(false);
  expect('lockHash' in verified && /^[0-9a-f]{64}$/.test(verified.lockHash)).toBe(true);
});

test('B3 (CI lead): a changed lockfile, a failed install or an install that changes the checkout refuses the start', () => {
  const changed = checkout();
  writeFileSync(join(changed, 'bun.lock'), '{"lockfileVersion":1,"planted":true}\n');
  expect(verifyTrustedCheckout(changed, () => ({ status: 0 }))).toHaveProperty('problem');
  expect(verifyTrustedCheckout(checkout(), () => ({ status: 1 }))).toHaveProperty('problem');
  const rewritten = checkout();
  const install = () => {
    writeFileSync(join(rewritten, 'bun.lock'), '{"lockfileVersion":2}\n');
    return { status: 0 };
  };
  expect(verifyTrustedCheckout(rewritten, install)).toHaveProperty('problem');
});
