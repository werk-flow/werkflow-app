import { afterEach, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Chromium's system packages in CI (.github/actions/playwright/system-packages.sh), run against
// stand-in sudo, timeout, apt-get, dpkg and bunx: a cached install never reaches the package
// mirror, and a stalled mirror ends the step after a bounded fresh attempt with its own cause,
// instead of holding the job until its timeout cancels it.
const script = resolve(import.meta.dir, '../../.github/actions/playwright/system-packages.sh');
const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

type Mirror = {
  /** How many apt-get calls stall (time out) before the mirror answers. */
  stalls?: number;
  /** An apt-get exit code that is not a stall, returned by every call. */
  fails?: number;
  /** A library with a newer version on the mirror, which Playwright then also reports missing. */
  upgrade?: string;
};

function run(
  mode: 'find' | 'install',
  options: { missing?: string[]; cached?: boolean; mirror?: Mirror } = {},
): {
  status: number | null;
  output: string;
  apt: string[];
  installed: boolean;
  outputs: string;
  debs: string[];
} {
  const root = mkdtempSync(join(tmpdir(), 'werkflow-playwright-packages-'));
  directories.push(root);
  const bin = join(root, 'bin');
  const debs = join(root, 'debs');
  mkdirSync(bin);
  mkdirSync(debs);
  const missing = options.missing ?? ['fonts-freefont-ttf', 'xfonts-utils'];
  if (options.cached) for (const name of missing) writeFileSync(join(debs, `${name}.deb`), '');
  const installed = join(root, 'installed');
  const aptLog = join(root, 'apt');
  const stallsLeft = join(root, 'stalls');
  writeFileSync(stallsLeft, String(options.mirror?.stalls ?? 0));
  writeFileSync(join(root, 'github-output'), '');
  const stub = (name: string, body: string): void => {
    writeFileSync(join(bin, name), `#!/usr/bin/env bash\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  };
  stub('sudo', 'exec "$@"');
  // `timeout --kill-after=10 <seconds> apt-get ...`: a stalling mirror passes the deadline.
  stub(
    'timeout',
    [
      'shift 2',
      `left=$(cat '${stallsLeft}')`,
      `if test "$left" -gt 0; then echo "$((left - 1))" > '${stallsLeft}'; echo "stalled: $*" >> '${aptLog}'; exit 124; fi`,
      'exec "$@"',
    ].join('\n'),
  );
  stub(
    'apt-get',
    [
      `echo "$*" >> '${aptLog}'`,
      options.mirror?.fails === undefined
        ? ''
        : `echo "E: the mirror refused" >&2; exit ${options.mirror.fails}`,
      'if test "$1" = install; then',
      '  dir=""; for arg in "$@"; do case "$arg" in Dir::Cache::Archives=*) dir="${arg#*=}" ;; esac; done',
      `  for name in ${missing.join(' ')}; do touch "$dir/$name.deb"; done`,
      'fi',
    ].join('\n'),
  );
  stub('dpkg', `touch '${installed}'`);
  stub(
    'dpkg-query',
    [
      'shift 3',
      `for name in "$@"; do if test -e '${installed}'; then echo "installed $name"; else echo "not-installed $name"; fi; done`,
    ].join('\n'),
  );
  stub(
    'bunx',
    [
      options.mirror?.upgrade === undefined
        ? ''
        : `if test -e '${installed}'; then printf 'Missing system dependencies (1):\\n  ${options.mirror.upgrade}\\n'; exit 1; fi`,
      `if test -e '${installed}' || test -z '${missing.join(' ')}'; then echo "All system dependencies are installed."; exit 0; fi`,
      `echo "Missing system dependencies (${missing.length}):"`,
      ...missing.map((name) => `echo "  ${name}"`),
      'exit 1',
    ].join('\n'),
  );
  const result = spawnSync('bash', [script, mode], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      GITHUB_OUTPUT: join(root, 'github-output'),
      DEBS: debs,
      MISSING: missing.join(' '),
      ImageOS: 'ubuntu24',
    },
  });
  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
    apt: existsSync(aptLog) ? readFileSync(aptLog, 'utf8').trim().split('\n') : [],
    installed: existsSync(installed),
    outputs: readFileSync(join(root, 'github-output'), 'utf8'),
    debs: readdirSync(debs).filter((name) => name.endsWith('.deb')),
  };
}

test('an image that holds every package needs no install and no mirror', () => {
  const { status, apt, outputs } = run('find', { missing: [] });
  expect(status).toBe(0);
  expect(apt).toEqual([]);
  expect(outputs).toContain('missing=\n');
});

test('the missing packages and their cache key come from the offline simulation', () => {
  const { status, apt, outputs } = run('find');
  expect(status).toBe(0);
  expect(apt).toEqual([]);
  expect(outputs).toContain('missing=fonts-freefont-ttf xfonts-utils\n');
  expect(outputs).toMatch(/^key=playwright-debs-ubuntu24-\S+-[0-9a-f]{16}$/m);
});

test('cached packages install without reaching the mirror', () => {
  const { status, apt, installed, output } = run('install', { cached: true });
  expect(status).toBe(0);
  expect(apt).toEqual([]);
  expect(installed).toBe(true);
  expect(output).toContain('from the cache, without the package mirror');
});

test('a mirror that stalls every time ends the step after two bounded attempts, naming the mirror', () => {
  const { status, apt, installed, output } = run('install', { mirror: { stalls: 99 } });
  expect(status).toBe(1);
  expect(apt).toEqual(['stalled: apt-get update', 'stalled: apt-get update']);
  expect(installed).toBe(false);
  expect(output).toContain('attempt 1 of 2');
  expect(output).toContain("apt-get update stalled on the runner's package mirror in all 2 attempts");
  expect(output).toContain('The mirror failed, not a test');
});

test('one stall gets a fresh attempt, and the download fills the cache folder', () => {
  const { status, apt, installed, debs } = run('install', { mirror: { stalls: 1 } });
  expect(status).toBe(0);
  expect(apt[0]).toBe('stalled: apt-get update');
  expect(apt[1]).toBe('update');
  expect(apt[2]).toContain('install --yes --no-install-recommends --download-only');
  expect(apt).toHaveLength(3);
  expect(installed).toBe(true);
  expect(debs.sort()).toEqual(['fonts-freefont-ttf.deb', 'xfonts-utils.deb']);
});

test('a library the mirror offers in a newer version does not fail the install', () => {
  const { status, installed, output } = run('install', { mirror: { upgrade: 'libnss3' } });
  expect(status).toBe(0);
  expect(installed).toBe(true);
  expect(output).toContain("Installed Chromium's packages from the package mirror.");
});

test('an apt failure that is not a stall ends the step at once', () => {
  const { status, apt, output } = run('install', { mirror: { fails: 100 } });
  expect(status).toBe(1);
  expect(apt).toEqual(['update']);
  expect(output).toContain('failed with exit code 100, not a stall');
});
