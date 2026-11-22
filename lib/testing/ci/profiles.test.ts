// Each CI profile places every inventory item, the fleet's values are #582's own, the Mac's are
// marked placeholders, and only ci/profile.json picks the active one (lib/testing/ci/profiles.ts).
import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readWorkflow } from '../ci-workflow';
import { CI_EVENTS, CI_JOBS } from './dag';
import { FULL_RUN_SLOTS } from './full-run';
import { INVENTORY_KEYS, SCHEDULE_NAMES, SCHEDULES } from './inventory';
import { MIRROR_JOB_CAP } from './mirror';
import { activeProfile, CI_PROFILE_NAMES, CI_PROFILES, placementOf, type Timing } from './profiles';
import { MAX_BATCH } from './queue';
import { CLOCK_WORK } from './schedule';

const repositoryRoot = resolve(import.meta.dir, '../../..');
const WALL_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

test('each profile places every inventory item and nothing else', () => {
  for (const name of CI_PROFILE_NAMES) {
    const profile = CI_PROFILES[name];
    expect(profile.name).toBe(name);
    expect(Object.keys(profile.jobs).toSorted()).toEqual([...CI_JOBS].sort());
    expect(Object.keys(profile.runs).toSorted()).toEqual([...CI_EVENTS].sort());
    expect(Object.keys(profile.schedules).toSorted()).toEqual([...SCHEDULE_NAMES].sort());
    for (const key of INVENTORY_KEYS) {
      const { atOnce } = placementOf(profile, key);
      expect(atOnce === 'all' || (Number.isInteger(atOnce) && atOnce > 0), `${name} ${key}`).toBe(true);
    }
  }
});

test('a timed schedule gets a time in every profile, an event schedule none', () => {
  const timings: Timing[] = [];
  for (const profile of Object.values(CI_PROFILES))
    for (const name of SCHEDULE_NAMES) {
      const placement = profile.schedules[name];
      const timed = SCHEDULES[name].trigger.on === 'time';
      expect('timing' in placement, `${profile.name} ${name}`).toBe(timed);
      if ('timing' in placement) timings.push(placement.timing);
    }
  for (const timing of timings) {
    if (timing.kind === 'clock') {
      expect(timing.at).toMatch(WALL_TIME);
      expect(timing.weekdays.length).toBeGreaterThan(0);
    } else {
      expect([timing.from, timing.to]).toEqual([
        expect.stringMatching(WALL_TIME),
        expect.stringMatching(WALL_TIME),
      ]);
      expect(timing.from < timing.to && timing.everyMinutes > 0).toBe(true);
    }
  }
});

/** A daily or weekly cron line of a clock timing, as GitHub reads it (Sunday 0). */
const cronOf = (timing: Timing): string => {
  if (timing.kind !== 'clock' || timing.zone !== 'UTC')
    throw new Error('A cron line runs on UTC wall times.');
  const [hour = '', minute = ''] = timing.at.split(':');
  const days = timing.weekdays.length === 7 ? '*' : timing.weekdays.map((day) => (day + 1) % 7).join(',');
  return `${Number(minute)} ${Number(hour)} * * ${days}`;
};

test("the fleet profile is #582's design: the mirror's cap, batches of 4, the conductor's clock and the workflows' crons", () => {
  const fleet = CI_PROFILES.fleet;
  expect(fleet.values).toBe('in use');
  expect(fleet.window).toBeUndefined();
  expect(fleet.jobsAtOnce).toBe(MIRROR_JOB_CAP);
  expect(fleet.maxBatch).toBe(MAX_BATCH);
  expect(fleet.jobs.browser.atOnce).toBe('all');
  expect(fleet.schedules.nightly.timing).toMatchObject({
    at: CLOCK_WORK.nightly.time,
    weekdays: CLOCK_WORK.nightly.weekdays,
  });
  expect(fleet.schedules['release-candidate'].timing).toMatchObject({
    at: CLOCK_WORK.release.time,
    weekdays: CLOCK_WORK.release.weekdays,
  });
  expect(fleet.schedules['main-full-run'].timing).toEqual({
    kind: 'slots',
    from: FULL_RUN_SLOTS.first,
    to: FULL_RUN_SLOTS.last,
    everyMinutes: FULL_RUN_SLOTS.intervalMs / 60_000,
  });
  const lookahead = readWorkflow('date-lookahead.yml');
  expect(cronOf(fleet.schedules['date-lookahead'].timing)).toBe(lookahead.text('on', 'schedule', 0, 'cron'));
  expect(lookahead.at('jobs', 'leg', 'strategy', 'max-parallel')).toBe(
    fleet.schedules['date-lookahead'].atOnce,
  );
  const health = readWorkflow('health.yml').text('on', 'schedule', 0, 'cron');
  expect(cronOf(fleet.schedules['health-ci-queue'].timing)).toBe(health);
  expect(cronOf(fleet.schedules['health-pr-asset-branches'].timing)).toBe(health);
});

test('the Mac profile is marked a placeholder: one MacBook, one unit at a time, at most two jobs at once', () => {
  const mac = CI_PROFILES.mac;
  expect(mac.values).toBe('placeholder');
  expect(mac.jobsAtOnce).toBeLessThanOrEqual(2);
  expect(mac.maxBatch).toBeLessThanOrEqual(MAX_BATCH);
  expect(mac.window).toBeDefined();
  for (const key of INVENTORY_KEYS)
    expect(placementOf(mac, key), key).toEqual({
      executor: 'mac',
      atOnce: key.startsWith('run:') ? mac.jobsAtOnce : 1,
    });
});

/** A repository folder whose ci/profile.json holds `text`. */
const repositoryWith = (text: string): string => {
  const folder = mkdtempSync(join(tmpdir(), 'ci-profile-'));
  folders.push(folder);
  Bun.spawnSync(['mkdir', '-p', join(folder, 'ci')]);
  writeFileSync(join(folder, 'ci/profile.json'), text);
  return folder;
};

test("ci/profile.json picks the active profile, the Mac's on main for now", () => {
  expect(activeProfile().name).toBe('mac');
  expect(activeProfile(repositoryRoot).name).toBe('mac');
  expect(activeProfile(repositoryWith('{"profile":"fleet"}')).name).toBe('fleet');
});

test('a missing, unknown or widened switch throws, so no conductor guesses its profile', () => {
  const empty = mkdtempSync(join(tmpdir(), 'ci-profile-'));
  folders.push(empty);
  expect(() => activeProfile(empty)).toThrow();
  for (const text of ['{"profile":"boat"}', '{"profile":"mac","jobsAtOnce":8}', '{}', 'mac'])
    expect(() => activeProfile(repositoryWith(text)), text).toThrow();
});
