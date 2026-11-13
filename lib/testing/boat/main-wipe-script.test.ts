// Rule test: a kept Boat machine is wiped by origin/main's wipe script as it is now, never by the copy
// of a branch behind main, and a script that cannot be read is refused with git's reason. Prevents a
// stale branch from failing every wipe and so starting a machine on every run
// (werk-flow/werkflow-planning#414).
import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { mainWipeScript } from './main-wipe-script';

const SCRIPT = 'scripts/boat/wipe-machine.sh';

function git(cwd: string, ...args: string[]): void {
  const result = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.test', ...args], {
    cwd,
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
}

function commitScript(clone: string, text: string): void {
  mkdirSync(dirname(join(clone, SCRIPT)), { recursive: true });
  writeFileSync(join(clone, SCRIPT), text);
  git(clone, 'add', SCRIPT);
  git(clone, 'commit', '-qm', text);
}

/** A remote whose main holds the wipe script, and a checkout on a branch cut from it. */
function checkoutBehindMain() {
  const root = mkdtempSync(join(tmpdir(), 'boat-main-wipe-'));
  const origin = join(root, 'origin.git');
  const checkout = join(root, 'checkout');
  git(root, 'init', '-q', '--bare', '-b', 'main', origin);
  git(root, 'clone', '-q', origin, checkout);
  commitScript(checkout, 'old wipe\n');
  git(checkout, 'push', '-q', 'origin', 'main');
  git(checkout, 'switch', '-qc', 'feature');
  return { root, origin, checkout };
}

test("the wipe is main's script as fetched now, not the branch's or the last fetched main's", () => {
  const { root, origin, checkout } = checkoutBehindMain();
  // Main moves on in another clone; the checkout neither merged it nor fetched it.
  const other = join(root, 'other');
  git(root, 'clone', '-q', origin, other);
  commitScript(other, 'new wipe\n');
  git(other, 'push', '-q', 'origin', 'main');
  expect(mainWipeScript(checkout)).toBe('new wipe\n');
});

test('a checkout whose fetch refspec omits main still reads the fetched main', () => {
  const { root, origin, checkout } = checkoutBehindMain();
  // A single-branch clone: its fetch maps only feature, so a bare `fetch origin main` leaves origin/main stale.
  git(checkout, 'config', 'remote.origin.fetch', '+refs/heads/feature:refs/remotes/origin/feature');
  const other = join(root, 'other');
  git(root, 'clone', '-q', origin, other);
  commitScript(other, 'newer wipe\n');
  git(other, 'push', '-q', 'origin', 'main');
  expect(mainWipeScript(checkout)).toBe('newer wipe\n');
});

test("a wipe script that cannot be fetched or read is refused with git's reason", () => {
  const { root, checkout } = checkoutBehindMain();
  git(checkout, 'remote', 'set-url', 'origin', join(root, 'gone.git'));
  expect(() => mainWipeScript(checkout)).toThrow(/^origin\/main's wipe script cannot be read: fatal: /);
  // Main without the script: the read fails, not the fetch.
  const bare = mkdtempSync(join(tmpdir(), 'boat-main-wipe-'));
  git(bare, 'init', '-q', '--bare', '-b', 'main', join(bare, 'origin.git'));
  git(bare, 'clone', '-q', join(bare, 'origin.git'), join(bare, 'checkout'));
  writeFileSync(join(bare, 'checkout', 'README'), 'no script');
  git(join(bare, 'checkout'), 'add', 'README');
  git(join(bare, 'checkout'), 'commit', '-qm', 'readme');
  git(join(bare, 'checkout'), 'push', '-q', 'origin', 'main');
  expect(() => mainWipeScript(join(bare, 'checkout'))).toThrow(
    /^origin\/main's wipe script cannot be read: fatal: path 'scripts\/boat\/wipe-machine\.sh' does not exist/,
  );
});
