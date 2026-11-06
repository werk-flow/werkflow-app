import { afterEach, beforeEach, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dir, '../..');
const holdScript = join(repositoryRoot, '.github/scripts/hold-until.sh');
const HOUR = 3600;
const LEG = 345 * 60;

const releaseWorkflow = readFileSync(join(repositoryRoot, '.github/workflows/release.yml'), 'utf8');
const nightlyWorkflow = readFileSync(join(repositoryRoot, '.github/workflows/nightly.yml'), 'utf8');

let stub = '';

beforeEach(() => {
  stub = mkdtempSync(join(tmpdir(), 'ci-schedule-'));
  writeFileSync(join(stub, 'date'), '#!/usr/bin/env bash\necho "$NOW"\n');
  writeFileSync(join(stub, 'sleep'), '#!/usr/bin/env bash\necho "$1" > "$STUB/slept"\n');
  chmodSync(join(stub, 'date'), 0o755);
  chmodSync(join(stub, 'sleep'), 0o755);
});

afterEach(() => rmSync(stub, { recursive: true, force: true }));

/** The seconds one leg of the hold sleeps when it starts at `instant`. */
function secondsHeldFrom(instant: string) {
  rmSync(join(stub, 'slept'), { force: true });
  const now = Date.parse(instant) / 1000;
  const result = spawnSync('bash', [holdScript, '07:00'], {
    encoding: 'utf8',
    env: { NODE_ENV: 'test', PATH: `${stub}:${process.env.PATH}`, STUB: stub, NOW: String(now) },
  });
  expect(result.status).toBe(0);
  return existsSync(join(stub, 'slept')) ? Number(readFileSync(join(stub, 'slept'), 'utf8')) : 0;
}

test('a run that starts in the night holds exactly until 07:00 Berlin', () => {
  expect(secondsHeldFrom('2026-11-10T02:00:00Z')).toBe(4 * HOUR);
});

test('07:00 stays 07:00 Berlin across both clock changes', () => {
  // Winter 06:00 UTC, summer 05:00 UTC.
  expect(secondsHeldFrom('2026-07-01T02:00:00Z')).toBe(3 * HOUR);
  // The night of 2027-03-28 lasts an hour less, the night of 2026-10-25 an hour more.
  expect(secondsHeldFrom('2027-03-28T00:30:00Z')).toBe(4.5 * HOUR);
  expect(secondsHeldFrom('2026-10-25T00:30:00Z')).toBe(5.5 * HOUR);
});

test('a run GitHub starts on time holds through both legs and no further', () => {
  // 22:30 Berlin: 8.5 hours to 07:00, more than one leg may last.
  const start = Date.parse('2026-11-09T21:30:00Z');
  expect(secondsHeldFrom('2026-11-09T21:30:00Z')).toBe(LEG);
  const second = new Date(start + LEG * 1000).toISOString();
  expect(secondsHeldFrom(second)).toBe(8.5 * HOUR - LEG);
  expect(secondsHeldFrom('2026-11-10T06:00:00Z')).toBe(0);
});

test('a run that arrives after 07:00 goes on at once instead of waiting a day', () => {
  expect(secondsHeldFrom('2026-11-10T06:01:00Z')).toBe(0);
  expect(secondsHeldFrom('2026-11-10T13:40:00Z')).toBe(0);
});

test('the release waits for its hold, and only a schedule event holds', () => {
  expect(releaseWorkflow).toMatch(/\n {2}candidate:\n {4}name: .+\n {4}needs: hold\n/);
  const holdSteps = releaseWorkflow.slice(
    releaseWorkflow.indexOf('\n  hold:'),
    releaseWorkflow.indexOf('\n  candidate:'),
  );
  expect(holdSteps.match(/- uses:|- name:/g)).toHaveLength(2);
  expect(holdSteps.match(/if: github\.event_name == 'schedule'/g)).toHaveLength(2);
  // A skipped job would skip the gate jobs behind it, so the job itself always runs.
  expect(holdSteps).not.toMatch(/\n {4}if:/);
  expect(releaseWorkflow).toContain("github.event_name == 'schedule' && 'scheduled'");
  expect(releaseWorkflow).toContain('needs: [hold, candidate, full, release, smoke, proof]');
});

test('the release cron line fires the evening before a weekday, and the nightly with it', () => {
  expect(releaseWorkflow).toContain("- cron: '30 22 * * 0-4'\n      timezone: Europe/Berlin");
  expect(nightlyWorkflow).toContain("- cron: '30 22 * * *'\n      timezone: Europe/Berlin");
});
