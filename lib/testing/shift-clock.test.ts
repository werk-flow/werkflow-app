import { afterEach, beforeEach, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dir, '../..');
const script = '.github/scripts/shift-clock.sh';
const INSTANT = 1_796_000_000;
const REAL_CLOCK = 1_790_000_000;
const DAY = 86_400;
const STARTED_AT_UPTIME = 100;
const UPTIME = 160;

// Each stub answers from a file its test wrote, so no test reads this machine's clock or its GNU tools.
const STUBS = {
  sudo: 'printf "%s\\n" "$*" >> "$STUB/sudo.log"',
  docker: `case "$*" in
  *pg_isready*) test "$(cat "$STUB/postgres-refusals")" -eq 0 || { echo "$(($(cat "$STUB/postgres-refusals") - 1))" > "$STUB/postgres-refusals"; exit 1; } ;;
  exec*) cat "$STUB/postgres-clock" ;;
esac`,
  sleep: 'exit 0',
  bun: 'cat "$STUB/bun-clock"',
  curl: 'printf "204 0.1s"',
  cut: 'cat "$STUB/uptime"',
  date: `case "$*" in
  +%s) cat "$STUB/shell-clock" ;;
  --date=@*) printf "%s" "\${1#--date=@}" ;;
  *) printf "shown" ;;
esac`,
};

let stub = '';

beforeEach(() => {
  stub = mkdtempSync(join(tmpdir(), 'shift-clock-'));
  for (const [name, body] of Object.entries(STUBS)) {
    writeFileSync(join(stub, name), `#!/usr/bin/env bash\n${body}\n`);
    chmodSync(join(stub, name), 0o755);
  }
  writeFileSync(join(stub, 'sudo.log'), '');
  writeFileSync(join(stub, 'uptime'), String(UPTIME));
  writeFileSync(join(stub, 'postgres-refusals'), '0');
});

afterEach(() => rmSync(stub, { recursive: true, force: true }));

function clocksShow(values: { shell: number; bun: number; postgres: number | string }) {
  writeFileSync(join(stub, 'shell-clock'), String(values.shell));
  writeFileSync(join(stub, 'bun-clock'), String(values.bun));
  writeFileSync(join(stub, 'postgres-clock'), String(values.postgres));
}

function run(args: string[]) {
  return spawnSync('bash', [script, ...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: { NODE_ENV: 'test', PATH: `${stub}:${process.env.PATH}`, STUB: stub, RUNNER_TEMP: stub },
  });
}

function sudoCalls() {
  return readFileSync(join(stub, 'sudo.log'), 'utf8');
}

/** The state `set` leaves for a shift to INSTANT from REAL_CLOCK, and the shell clock `seconds` after it. */
function shiftedBy(seconds: number) {
  writeFileSync(join(stub, 'shifted-clock'), `${INSTANT} ${REAL_CLOCK} ${STARTED_AT_UPTIME}\n`);
  writeFileSync(join(stub, 'shell-clock'), String(INSTANT + seconds));
}

test('a shift holds only when the shell, Bun and Postgres all show it', () => {
  clocksShow({ shell: INSTANT, bun: INSTANT, postgres: INSTANT });

  const result = run(['set', `@${INSTANT}`]);

  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  expect(sudoCalls()).toContain('systemctl stop chrony');
  expect(sudoCalls()).toContain(`date --utc --set=@${INSTANT}`);
});

test('a clock the kernel did not take fails the leg instead of proving the real date', () => {
  clocksShow({ shell: REAL_CLOCK, bun: INSTANT, postgres: INSTANT });

  const result = run(['set', `@${INSTANT}`]);

  expect(result.status).toBe(1);
  expect(result.stdout).toContain('Shell does not show the shifted clock');
});

test('a database on the real clock fails the leg instead of testing a mismatch', () => {
  clocksShow({ shell: INSTANT, bun: INSTANT, postgres: INSTANT - DAY });

  const result = run(['set', `@${INSTANT}`]);

  expect(result.status).toBe(1);
  expect(result.stdout).toContain('Postgres does not show the shifted clock');
});

test('a runtime on another clock fails the leg', () => {
  clocksShow({ shell: INSTANT, bun: INSTANT + DAY, postgres: INSTANT });

  const result = run(['set', `@${INSTANT}`]);

  expect(result.status).toBe(1);
  expect(result.stdout).toContain('Bun does not show the shifted clock');
});

test('a clock that cannot be read fails the leg', () => {
  clocksShow({ shell: INSTANT, bun: INSTANT, postgres: '' });

  const result = run(['set', `@${INSTANT}`]);

  expect(result.status).toBe(1);
  expect(result.stdout).toContain('Postgres does not show the shifted clock');
});

test('a Postgres still restarting is waited for, so the proof reads its clock', () => {
  clocksShow({ shell: INSTANT, bun: INSTANT, postgres: INSTANT });
  writeFileSync(join(stub, 'postgres-refusals'), '3');

  const result = run(['set', `@${INSTANT}`]);

  expect(result.status).toBe(0);
  expect(readFileSync(join(stub, 'postgres-refusals'), 'utf8').trim()).toBe('0');
});

test('a Postgres that never comes back fails the leg within its bound', () => {
  clocksShow({ shell: INSTANT, bun: INSTANT, postgres: INSTANT });
  writeFileSync(join(stub, 'postgres-refusals'), '1000');

  const result = run(['set', `@${INSTANT}`]);

  expect(result.status).toBe(1);
  expect(result.stdout).toContain('Postgres did not come back');
});

test('restore puts the real clock back, moved on by the time the leg took', () => {
  shiftedBy(UPTIME - STARTED_AT_UPTIME);

  const result = run(['restore']);

  expect(result.status).toBe(0);
  expect(sudoCalls()).toContain(`date --utc --set=@${REAL_CLOCK + UPTIME - STARTED_AT_UPTIME}`);
  expect(sudoCalls()).toContain('systemctl start chrony');
});

test('a clock that left its shift during the leg is restored and still fails the leg', () => {
  shiftedBy(-DAY);

  const result = run(['restore']);

  expect(result.status).toBe(1);
  expect(result.stdout).toContain('left its shift');
  expect(sudoCalls()).toContain(`date --utc --set=@${REAL_CLOCK + UPTIME - STARTED_AT_UPTIME}`);
});

test('a job that failed before its shift has nothing to restore', () => {
  const result = run(['restore']);

  expect(result.status).toBe(0);
  expect(sudoCalls()).toBe('');
});
