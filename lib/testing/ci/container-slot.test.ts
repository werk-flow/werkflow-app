// No credential enters a job container of the owner's machines (container-slot.ts): the job's
// environment is an allowlist, a token-shaped value fails the job, the docker command names nothing
// of the runner's environment and runs the image by its id, reads back from the slot are bounded, and
// the start probe fails when a job can see the runner's side.
import { afterAll, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { slotEnvironment, slotShell } from '../../../scripts/ci/container-executor';
import {
  jobCommand,
  jobEnvironment,
  READ_LIMIT_BYTES,
  readCommand,
  type SlotConfig,
  slotConfigSchema,
  stageCommand,
} from './container-slot';

const SLOT: SlotConfig = {
  prefix: ['wsl.exe', '-d', 'werkflow-ci', '-u', 'cirunner', '--exec'],
  dockerHost: 'unix:///run/user/1002/docker.sock',
  socket: '/run/user/1002/docker.sock',
  root: '/home/cirunner/ci',
  image: 'sha256:abc',
  containerUser: 'root',
};
const TOKEN = `ghp_${'x'.repeat(36)}`;
const RUN_KEY = '0123456789abcdef-1';
const WORKSPACE = `/home/cirunner/ci/runs/${RUN_KEY}/app`;
const START = { jobStartedAt: '2026-11-23T02:00:00.000Z', machineStart: true };
const scratch = mkdtempSync(join(tmpdir(), 'container-slot-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

test("a job container's environment is the allowlist: the runner's tokens never pass, and Node's heap is set", () => {
  const environment = jobEnvironment(
    SLOT,
    {
      unit: { job: 'fast', shard: null },
      env: {
        CI_EVENT: 'integration',
        CI_RUN_URL: 'https://github.com/werk-flow/werkflow-app/commit/abc#run',
        GITHUB_REPOSITORY: 'werk-flow/werkflow-app',
        GH_TOKEN: TOKEN,
        GITHUB_TOKEN: TOKEN,
        CI_JOB_GH_TOKEN: TOKEN,
        SIBLING_REPOSITORIES_TOKEN: TOKEN,
        CI_CHECK_APP_TOKEN: TOKEN,
        CI_LEDGER: '/state/ledger.jsonl',
        CI_PUBLISHER: '/trusted/publish',
      },
    },
    RUN_KEY,
    START,
  );
  for (const name of [
    'GH_TOKEN',
    'GITHUB_TOKEN',
    'CI_JOB_GH_TOKEN',
    'SIBLING_REPOSITORIES_TOKEN',
    'CI_CHECK_APP_TOKEN',
    'CI_LEDGER',
    'CI_PUBLISHER',
  ])
    expect(environment).not.toHaveProperty(name);
  expect(environment.CI_RESULTS_DIR).toBe(`${WORKSPACE}/results`);
  expect(environment.WERKFLOW_GITHUB_SNAPSHOT).toBe(`${WORKSPACE}/github-snapshot.json`);
  // F11: the heap reaches the job from its container, not through the shared process executor.
  expect(environment.NODE_OPTIONS).toBe('--max-old-space-size=4096');
});

test('a token-shaped value under an allowed name fails the job instead of entering it', () => {
  expect(() =>
    jobEnvironment(
      SLOT,
      { unit: { job: 'plan', shard: null }, env: { CI_FULL_REASON: `see ${TOKEN}` } },
      RUN_KEY,
      START,
    ),
  ).toThrow('CI_FULL_REASON holds a credential');
});

test("F12, F14: a job runs the image by its id, at the run's one workspace path, and only Fast writes the build a browser shard reads", () => {
  const command = (job: 'fast' | 'browser' | 'sql') =>
    jobCommand(SLOT, {
      runKey: RUN_KEY,
      environment: jobEnvironment(
        SLOT,
        { unit: { job, shard: job === 'browser' ? 1 : null }, env: { CI_EVENT: 'integration' } },
        RUN_KEY,
        START,
      ),
      unit: { job, shard: job === 'browser' ? 1 : null },
      image: 'sha256:abc',
    });
  const volumes = (argv: string[]) =>
    argv.flatMap((argument, index) => (argv[index - 1] === '--volume' ? [argument] : []));
  const build = `/home/cirunner/ci/runs/${RUN_KEY}/build`;
  expect(volumes(command('fast'))).toContain(`${build}:${build}`);
  expect(volumes(command('browser'))).toContain(`${build}:${build}:ro`);
  expect(volumes(command('sql')).some((volume) => volume.startsWith(build))).toBe(false);
  expect(command('browser')).toContain(`CI_BUILD_TAR=${build}/build.tar`);
  expect(command('sql')).toContain(`--workdir`);
  expect(command('sql')[command('sql').indexOf('--workdir') + 1]).toBe(`${WORKSPACE}/werkflow-app`);
  expect(command('sql').slice(-3)).toEqual(['sha256:abc', 'werkflow-ci-job', 'sql']);
  // The run's own Bun cache; no shared cache a job could write for a later run.
  // S22: no named volume at all: nothing a job writes outlives it but its workspace.
  expect(volumes(command('sql')).every((volume) => volume.startsWith('/'))).toBe(true);
  expect(volumes(command('sql')).some((volume) => volume.includes('playwright'))).toBe(false);
  for (const argv of [
    command('fast'),
    stageCommand(SLOT, {
      runKey: RUN_KEY,
      commit: 'a'.repeat(40),
      repository: 'werk-flow/werkflow-app',
      image: 'sha256:abc',
    }),
  ])
    expect(argv.join(' ')).not.toMatch(/TOKEN|ghp_/);
});

test('S26: an argv with spaces, quotes and sh -c positional parameters reaches the slot intact through the prefix', async () => {
  // A prefix that prints each argument it gets, NUL-terminated, as `wsl.exe … --exec` hands them on.
  const shell = slotShell({ ...SLOT, prefix: ['printf', '%s\\0'] });
  const argv = ['sh', '-c', 'test -f "$1" && cat "$1"', 'read', '/slot/a b/"quoted" $HOME.json', "it's"];
  const answer = await shell(argv);
  expect(answer.stdout.split('\0').slice(0, -1)).toEqual(argv);
  // The PC's prefix hands its arguments on without the distribution's shell.
  const pc: unknown = JSON.parse(
    readFileSync(resolve(import.meta.dir, '../../../ci/machines/pc.example.json'), 'utf8'),
  );
  expect(pc).toMatchObject({
    slot: { prefix: ['wsl.exe', '-d', 'werkflow-ci', '-u', 'cirunner', '--exec'] },
  });
});

test('CR 923: a slot root with a trailing slash is refused, so no derived path differs from the open file', () => {
  expect(() => slotConfigSchema.parse({ ...SLOT, root: '/home/cirunner/ci/' })).toThrow('trailing slash');
  expect(slotConfigSchema.parse(SLOT).root).toBe('/home/cirunner/ci');
});

test('CR 983: the slot shell decodes its output once, so a character split across chunks stays whole', async () => {
  // The child writes the two bytes of `ö` apart, so the runner reads them as two chunks.
  const child =
    "const [first, second] = Buffer.from('ö'); process.stdout.write(Buffer.from([first])); setTimeout(() => process.stdout.write(Buffer.from([second])), 200);";
  const shell = slotShell({ ...SLOT, prefix: [process.execPath, '-e', child] });
  expect((await shell([])).stdout).toBe('ö');
});

test('S11: a read back from the slot has its deadline on the slot itself', () => {
  expect(readCommand('/slot/x.json').slice(0, 3)).toEqual(['timeout', '60', 'sh']);
});

// The read checks its descriptor through /proc, which only Linux has: both slots are Linux.
test.skipIf(process.platform !== 'linux')(
  'F9, S21: a read back from the slot opens a file once and copies it only when it is a regular file reached by no link, capped',
  () => {
    const real = join(scratch, 'real');
    spawnSync('mkdir', ['-p', real]);
    const file = join(real, 'result.json');
    writeFileSync(file, '{"status":"passed"}');
    const link = join(real, 'link.json');
    symlinkSync('/etc/hostname', link);
    // A linked folder on the way: the path names the file, but the open reaches it elsewhere.
    const linkedFolder = join(scratch, 'linked');
    symlinkSync(real, linkedFolder);
    const large = join(real, 'large.json');
    writeFileSync(large, Buffer.alloc(READ_LIMIT_BYTES + 10, 'x'));
    const read = (path: string) =>
      spawnSync(readCommand(path)[0] ?? 'sh', readCommand(path).slice(1), {
        encoding: 'utf8',
        timeout: 5_000,
        maxBuffer: 64 * 1024 ** 2,
      });
    expect(read(file)).toMatchObject({ status: 0, stdout: '{"status":"passed"}' });
    for (const path of [link, join(linkedFolder, 'result.json'), '/dev/zero', join(real, 'missing.json')])
      expect([path, read(path).status]).not.toEqual([path, 0]);
    // A file past the limit comes back one byte over it, which the trusted side refuses.
    expect(read(large).stdout.length).toBe(READ_LIMIT_BYTES + 1);
  },
);

test('F3: the start probe fails when a job, or a container through its socket, reads a sentinel of the runner, and passes otherwise', () => {
  const bin = join(scratch, 'bin');
  spawnSync('mkdir', ['-p', bin]);
  const host = join(scratch, 'host');
  // A fake docker: `run … /:/host … -c <script>` runs the script with /host as the fake slot root.
  writeFileSync(
    join(bin, 'docker'),
    `#!/bin/bash\nscript="\${@: -1}"\nif test -n "$FAKE_DOCKER_FAILS" && [[ $script == *"$FAKE_DOCKER_FAILS"* ]]; then exit 125; fi\nexec bash -c "\${script//\\/host/${host.replaceAll('/', '\\/')}}"\n`,
  );
  chmodSync(join(bin, 'docker'), 0o755);
  spawnSync('mkdir', ['-p', join(host, 'etc'), join(host, 'home/owner')]);
  const probe = resolve(import.meta.dir, '../../../ci/image/probe.sh');
  const range = join(scratch, 'port-range');
  writeFileSync(range, '55000\t65000\n');
  const run = (sentinel: string, fails = '') =>
    spawnSync('bash', [probe, 'secret-token', sentinel, ''], {
      encoding: 'utf8',
      env: {
        NODE_ENV: 'test',
        FAKE_DOCKER_FAILS: fails,
        PATH: `${bin}:${process.env.PATH}`,
        WERKFLOW_PROBE_IMAGE: 'sha256:abc',
        WERKFLOW_PORT_RANGE_FILE: range,
      },
    });
  expect(run('/home/owner/.werkflow-ci-probe').status).toBe(0);
  writeFileSync(join(host, 'home/owner/.werkflow-ci-probe'), 'secret-token\n');
  expect(run('/home/owner/.werkflow-ci-probe').status).toBe(1);
  const own = join(scratch, 'own-sentinel');
  writeFileSync(own, 'secret-token\n');
  expect(run(own).status).toBe(1);
  // S24: a slot whose ephemeral port range covers the stack's ports fails the probe.
  rmSync(own);
  rmSync(join(host, 'home/owner/.werkflow-ci-probe'));
  expect(run('/home/owner/.werkflow-ci-probe').status).toBe(0);
  writeFileSync(range, '32768\t60999\n');
  expect(run('/home/owner/.werkflow-ci-probe').status).toBe(1);
  // CR 874: a sentinel check that cannot run through the socket fails the probe; silence proves nothing.
  writeFileSync(range, '55000\t65000\n');
  expect(run('/home/owner/.werkflow-ci-probe', 'secret-token').status).toBe(2);
});

test('B1 (CI lead): the start probe fails when the slot host mounts a Windows drive or can start a Windows program', () => {
  const bin = join(scratch, 'bin');
  spawnSync('mkdir', ['-p', bin]);
  const host = join(scratch, 'host');
  writeFileSync(
    join(bin, 'docker'),
    `#!/bin/bash\nscript="\${@: -1}"\nif test -n "$FAKE_DOCKER_FAILS" && [[ $script == *"$FAKE_DOCKER_FAILS"* ]]; then exit 125; fi\nexec bash -c "\${script//\\/host/${host.replaceAll('/', '\\/')}}"\n`,
  );
  chmodSync(join(bin, 'docker'), 0o755);
  const own = join(scratch, 'own-bin');
  spawnSync('mkdir', ['-p', join(host, 'etc'), join(host, 'mnt/c'), join(host, 'usr/bin'), own]);
  spawnSync('mkdir', ['-p', join(host, 'proc/sys/fs/binfmt_misc')]);
  const range = join(scratch, 'port-range');
  writeFileSync(range, '55000\t65000\n');
  const probe = resolve(import.meta.dir, '../../../ci/image/probe.sh');
  const run = (fails = '') =>
    spawnSync('bash', [probe, 'secret-token', '/home/owner/.werkflow-ci-probe', ''], {
      encoding: 'utf8',
      env: {
        NODE_ENV: 'test',
        FAKE_DOCKER_FAILS: fails,
        PATH: `${own}:${bin}:${process.env.PATH}`,
        WERKFLOW_PROBE_IMAGE: 'sha256:abc',
        WERKFLOW_PORT_RANGE_FILE: range,
      },
    });
  // An empty mount point holds no drive: the boundary holds.
  expect(run().status).toBe(0);
  const cases: [string, () => void, () => void][] = [
    [
      'a mounted C: drive',
      () => writeFileSync(join(host, 'mnt/c/pagefile.sys'), ''),
      () => rmSync(join(host, 'mnt/c/pagefile.sys')),
    ],
    [
      'wsl.exe on the slot host',
      () => writeFileSync(join(host, 'usr/bin/wsl.exe'), ''),
      () => rmSync(join(host, 'usr/bin/wsl.exe')),
    ],
    [
      'interop registered',
      () => writeFileSync(join(host, 'proc/sys/fs/binfmt_misc/WSLInterop'), 'enabled\ninterpreter /init\n'),
      () => rmSync(join(host, 'proc/sys/fs/binfmt_misc/WSLInterop')),
    ],
    [
      "cmd.exe in the job's own view",
      () => {
        writeFileSync(join(own, 'cmd.exe'), '#!/bin/sh\n');
        chmodSync(join(own, 'cmd.exe'), 0o755);
      },
      () => rmSync(join(own, 'cmd.exe')),
    ],
  ];
  for (const [name, plant, remove] of cases) {
    plant();
    expect({ name, status: run().status }).toEqual({ name, status: 1 });
    remove();
  }
  // Interop that is registered but disabled starts nothing.
  writeFileSync(join(host, 'proc/sys/fs/binfmt_misc/WSLInterop'), 'disabled\n');
  expect(run().status).toBe(0);
  // A check that cannot run through the socket proves nothing.
  expect(run('binfmt_misc').status).toBe(2);
});

test("the slot's commands run without the runner's variables, and WSL forwards none", () => {
  const environment = slotEnvironment({
    PATH: '/usr/bin',
    HOME: '/home/agent',
    WSL_INTEROP: '/run/WSL/1_interop',
    GH_TOKEN: TOKEN,
    SIBLING_REPOSITORIES_TOKEN: TOKEN,
    WSLENV: 'GH_TOKEN/u',
  });
  expect(environment).toEqual({
    WSLENV: '',
    PATH: '/usr/bin',
    HOME: '/home/agent',
    WSL_INTEROP: '/run/WSL/1_interop',
  });
});
