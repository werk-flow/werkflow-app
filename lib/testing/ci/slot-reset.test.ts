// The slots' reset scripts (ci/slot), run against fake system commands that record each call in
// order: what they refuse, and that nothing restarts before the slot user's state is gone.
import { afterEach, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SLOT = resolve(import.meta.dir, '../../../ci/slot');
const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

/** A folder of fake commands that append `<name> <args>` to the trace and answer from the environment. */
function fakes(commands: Record<string, string>): { bin: string; trace: string; folder: string } {
  const folder = mkdtempSync(join(tmpdir(), 'slot-reset-'));
  folders.push(folder);
  const bin = join(folder, 'bin');
  mkdirSync(bin);
  const trace = join(folder, 'trace');
  writeFileSync(trace, '');
  for (const [name, body] of Object.entries(commands)) {
    writeFileSync(join(bin, name), `#!/bin/bash\necho "${name} $*" >> "$TRACE"\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  }
  return { bin, trace, folder };
}

function rootless(env: { uid?: string; groups?: string; home?: string } = {}) {
  const fake = fakes({
    systemctl: '',
    pkill: '',
    pgrep: 'exit 1',
    find: '',
    install: '',
    git: '',
    cp: '',
    chown: '',
    runuser: '',
    docker: '',
    id: 'case $1 in -u) echo "$FAKE_UID" ;; -nG) echo "$FAKE_GROUPS" ;; esac',
    getent: 'echo "cirunner:x:$FAKE_UID:$FAKE_UID::$FAKE_HOME:/bin/bash"',
  });
  const subuid = join(fake.folder, 'subuid');
  writeFileSync(subuid, 'other:200000:65536\ncirunner:100000:65536\n');
  const run = spawnSync('bash', [join(SLOT, 'reset-rootless.sh'), 'cirunner'], {
    encoding: 'utf8',
    env: {
      NODE_ENV: 'test',
      PATH: `${fake.bin}:${process.env.PATH}`,
      TRACE: fake.trace,
      FAKE_UID: env.uid ?? '1234',
      FAKE_GROUPS: env.groups ?? 'cirunner',
      FAKE_HOME: env.home ?? '/home/cirunner',
      WERKFLOW_SUBUID_FILE: subuid,
    },
  });
  return { status: run.status, calls: readFileSync(fake.trace, 'utf8').split('\n').filter(Boolean) };
}

test("the PC's reset ends the user's runtime folder and wipes its temporary files before anything starts again", () => {
  const { status, calls } = rootless();
  expect(status).toBe(0);
  const at = (call: string): number => calls.findIndex((line) => line.startsWith(call));
  const start = at('systemctl start user@1234.service');
  expect(at('systemctl stop user@1234.service')).toBeGreaterThan(-1);
  expect(at('systemctl stop user-runtime-dir@1234.service')).toBeGreaterThan(
    at('systemctl stop user@1234.service'),
  );
  const temporary = at('find /tmp /var/tmp /dev/shm');
  expect(calls[temporary]).toContain('-uid 1234 -o ( -uid +99999 -uid -165536 )');
  // The git cache is the root-owned mirror's copy, in place before the user's manager starts.
  for (const call of [
    'systemctl stop user-runtime-dir@',
    'find /tmp',
    'cp -a /var/lib/werkflow-ci/git.git',
    'chown -R',
  ])
    expect({ call, before: at(call) > -1 && at(call) < start }).toEqual({ call, before: true });
  expect(start).toBeLessThan(at('docker load'));
});

test("the PC's reset refuses a system account, a sudoer and a home outside /home before it touches anything", () => {
  for (const env of [{ uid: '999' }, { groups: 'cirunner sudo' }, { home: '/home/../etc' }]) {
    const { status, calls } = rootless(env);
    expect({ env, status, systemctl: calls.some((call) => call.startsWith('systemctl')) }).toEqual({
      env,
      status: 1,
      systemctl: false,
    });
  }
});

function colima(env: { help?: string; images?: string } = {}) {
  const fake = fakes({
    colima: [
      'case "$1 $2" in',
      '  "delete --help") echo "$FAKE_HELP" ;;',
      '  "list --profile") echo \'{"name":"ci","cpus":4,"memory":6442450944}\' ;;',
      '  "ssh --profile") test "$6 $7" = "images -q" && echo "$FAKE_IMAGES"; test "$6" = load && cat > /dev/null ;;',
      'esac',
      'true',
    ].join('\n'),
  });
  const archive = join(fake.folder, 'werkflow-ci.tar');
  writeFileSync(archive, 'image');
  const run = spawnSync('bash', [join(SLOT, 'reset-colima.sh'), archive], {
    encoding: 'utf8',
    env: {
      NODE_ENV: 'test',
      PATH: `${fake.bin}:${process.env.PATH}`,
      HOME: fake.folder,
      TRACE: fake.trace,
      FAKE_HELP: env.help ?? '      --data    also delete the data disk\n  -f, --force   do not prompt',
      FAKE_IMAGES: env.images ?? '',
    },
  });
  return { status: run.status, calls: readFileSync(fake.trace, 'utf8').split('\n').filter(Boolean) };
}

test("the Mac's reset deletes the VM's data disk too, and loads the image only into a daemon that holds none", () => {
  const fresh = colima();
  expect(fresh.status).toBe(0);
  expect(fresh.calls).toContain('colima delete --profile ci --force --data');
  expect(fresh.calls.at(-1)).toBe('colima ssh --profile ci -- docker load --quiet');
  // A Colima that cannot delete the data disk deletes nothing.
  const old = colima({ help: '  -f, --force   do not prompt' });
  expect(old.status).toBe(1);
  expect(old.calls.some((call) => call.startsWith('colima delete --profile'))).toBe(false);
  const leftover = colima({ images: 'sha256:planted' });
  expect(leftover.status).toBe(1);
  expect(leftover.calls.some((call) => call.includes('docker load'))).toBe(false);
});
