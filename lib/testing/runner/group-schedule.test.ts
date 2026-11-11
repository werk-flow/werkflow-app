import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  changedTestsFirstBlock,
  ciBrowserHoldUntil,
  CI_BROWSER_JOB_TIMEOUT_MS,
  CI_MIDNIGHT_HOLD_MAX_MS,
  holdOutsideMidnightWindow,
  MIDNIGHT_START_WINDOW,
  midnightProofHoldUntil,
  midnightStartWaitMs,
  runGroupSchedule,
} from './group-schedule';

const MINUTE_MS = 60_000;
const WINDOW_MS = MIDNIGHT_START_WINDOW.leadMs + MIDNIGHT_START_WINDOW.trailMs;
/** A summer day: Berlin midnight of 2026-07-02 is 2026-07-01T22:00Z. */
const SUMMER_MIDNIGHT = Date.parse('2026-07-01T22:00:00Z');

test('a browser group starts at once outside the midnight window', () => {
  for (const offset of [-12 * 60, -MIDNIGHT_START_WINDOW.leadMs / MINUTE_MS - 1, 10, 11, 12 * 60])
    expect(midnightStartWaitMs(new Date(SUMMER_MIDNIGHT + offset * MINUTE_MS))).toBe(0);
  expect(midnightStartWaitMs(new Date(SUMMER_MIDNIGHT + MIDNIGHT_START_WINDOW.trailMs))).toBe(0);
});

test('inside the window a group waits until ten minutes after Berlin midnight, never longer than the window', () => {
  const opening = SUMMER_MIDNIGHT - MIDNIGHT_START_WINDOW.leadMs;
  expect(midnightStartWaitMs(new Date(opening - 1))).toBe(0);
  expect(midnightStartWaitMs(new Date(opening))).toBe(WINDOW_MS);
  expect(midnightStartWaitMs(new Date(opening + 1))).toBe(WINDOW_MS - 1);
  expect(midnightStartWaitMs(new Date(SUMMER_MIDNIGHT))).toBe(MIDNIGHT_START_WINDOW.trailMs);
  expect(midnightStartWaitMs(new Date(SUMMER_MIDNIGHT + MIDNIGHT_START_WINDOW.trailMs - 1))).toBe(1);
});

test('Berlin midnight is found on the days around both daylight-saving changes', () => {
  // Each entry is a Berlin midnight in UTC. The changes fall on 2026-03-29 and 2026-10-25 at 02:00/03:00 local time.
  for (const midnight of [
    '2026-03-28T23:00:00Z', // Sunday of the spring change, still UTC+1
    '2026-03-29T22:00:00Z', // Monday after it, UTC+2
    '2026-10-24T22:00:00Z', // Sunday of the autumn change, still UTC+2
    '2026-10-25T23:00:00Z', // Monday after it, UTC+1
  ]) {
    const instant = Date.parse(midnight);
    expect(midnightStartWaitMs(new Date(instant - 5 * MINUTE_MS))).toBe(15 * MINUTE_MS);
    expect(midnightStartWaitMs(new Date(instant + 9 * MINUTE_MS))).toBe(MINUTE_MS);
    expect(midnightStartWaitMs(new Date(instant + MIDNIGHT_START_WINDOW.trailMs))).toBe(0);
    expect(midnightStartWaitMs(new Date(instant - MIDNIGHT_START_WINDOW.leadMs - 1))).toBe(0);
  }
});

test('locally the wait logs its reason and resume time, and the run signal cancels it', async () => {
  const lines: string[] = [];
  const controller = new AbortController();
  const waiting = holdOutsideMidnightWindow({
    groupId: 'audit:wave-1:a3',
    ci: false,
    signal: controller.signal,
    log: (line) => lines.push(line),
    now: () => new Date(SUMMER_MIDNIGHT - MINUTE_MS),
  });
  controller.abort();
  await expect(waiting).rejects.toThrow();
  expect(lines).toEqual([
    "audit:wave-1:a3: Berlin time is inside the midnight start window (23:40 to 00:10), where a group's business date can change or its day is too young; waiting 11 min until 2026-07-01T22:10:00.000Z (00:10 Berlin).",
  ]);
  expect(
    await holdOutsideMidnightWindow({
      groupId: 'golden:gg-00',
      ci: false,
      signal: AbortSignal.abort(),
      log: (line) => lines.push(line),
      now: () => new Date(SUMMER_MIDNIGHT + 12 * 60 * MINUTE_MS),
    }),
  ).toBeUndefined();
  expect(lines).toHaveLength(1);
});

test('in CI a group inside the window is blocked at once as a harness result, and starts outside it', async () => {
  const hold = (instant: number): Promise<string | undefined> =>
    // A live signal: a CI hold that slept would never settle within the test.
    holdOutsideMidnightWindow({
      groupId: 'audit:visual:acceptance:sets',
      ci: true,
      signal: new AbortController().signal,
      log: () => expect.unreachable('CI logs no wait'),
      now: () => new Date(instant),
    });
  // Browser 2 of run 41137727269 reached its group at 23:43 Berlin and waited 27 minutes.
  expect(await hold(SUMMER_MIDNIGHT - 17 * MINUTE_MS)).toBe(
    "harness, midnight start window: Berlin time is inside the midnight start window (23:40 to 00:10), where a group's business date can change or its day is too young. A CI job's timeout would count the 27 min wait, so the group did not run; rerun the failed job after 2026-07-01T22:10:00.000Z (00:10 Berlin).",
  );
  const opening = SUMMER_MIDNIGHT - MIDNIGHT_START_WINDOW.leadMs;
  expect(await hold(opening)).toStartWith('harness, midnight start window:');
  expect(await hold(SUMMER_MIDNIGHT + MIDNIGHT_START_WINDOW.trailMs - 1)).toStartWith(
    'harness, midnight start window:',
  );
  expect(await hold(opening - 1)).toBeUndefined();
  expect(await hold(SUMMER_MIDNIGHT + MIDNIGHT_START_WINDOW.trailMs)).toBeUndefined();
});

test('a CI run that starts inside the window holds until it closes, so no group is blocked', () => {
  // Runs 41360164346 and 42123492074 started at 00:03 and 23:40 Berlin, and every browser group was blocked.
  for (const started of ['2026-11-01T23:03:13Z', '2026-11-05T22:40:37Z']) {
    const holdUntil = ciBrowserHoldUntil(new Date(started));
    expect(holdUntil?.toISOString().slice(11)).toBe('23:10:00.000Z');
    expect(holdUntil && midnightStartWaitMs(holdUntil)).toBe(0);
  }
});

test('a CI run holds from one Browser job timeout before the window, for at most the longest hold', () => {
  const opening = SUMMER_MIDNIGHT - MIDNIGHT_START_WINDOW.leadMs - CI_BROWSER_JOB_TIMEOUT_MS;
  const closes = SUMMER_MIDNIGHT + MIDNIGHT_START_WINDOW.trailMs;
  expect(ciBrowserHoldUntil(new Date(opening - 1))).toBeUndefined();
  expect(ciBrowserHoldUntil(new Date(opening))?.getTime()).toBe(closes);
  expect(closes - opening).toBe(CI_MIDNIGHT_HOLD_MAX_MS);
  expect(ciBrowserHoldUntil(new Date(closes - 1))?.getTime()).toBe(closes);
  expect(ciBrowserHoldUntil(new Date(closes))).toBeUndefined();
});

test('a Browser job that starts unheld never reaches a group inside the window before its timeout', () => {
  // Every minute of the days around both daylight-saving changes.
  for (const firstDay of ['2026-03-27T00:00:00Z', '2026-10-23T00:00:00Z']) {
    const first = Date.parse(firstDay);
    for (let start = first; start < first + 4 * 24 * 60 * MINUTE_MS; start += MINUTE_MS) {
      if (ciBrowserHoldUntil(new Date(start))) continue;
      // The job's last instant counts: a group that reaches the window then would be blocked.
      for (const elapsed of [0, CI_BROWSER_JOB_TIMEOUT_MS / 3, CI_BROWSER_JOB_TIMEOUT_MS - 1])
        expect(midnightStartWaitMs(new Date(start + elapsed))).toBe(0);
    }
  }
});

test('ci.yml keeps the timeouts the hold is built on', () => {
  const workflow = readFileSync(resolve(import.meta.dir, '../../../.github/workflows/ci.yml'), 'utf8');
  const timeoutOf = (job: string): number =>
    Number(new RegExp(`\\n  ${job}:\\n(?:    .*\\n|\\n)*?    timeout-minutes: (\\d+)`).exec(workflow)?.[1]);
  expect(timeoutOf('browser') * MINUTE_MS).toBe(CI_BROWSER_JOB_TIMEOUT_MS);
  expect(timeoutOf('midnight') * MINUTE_MS).toBeGreaterThan(CI_MIDNIGHT_HOLD_MAX_MS);
});

test('a midnight proof holds for the asked minutes and never on a branch that ships', () => {
  const now = new Date(SUMMER_MIDNIGHT + 12 * 60 * MINUTE_MS);
  const proof = (minutes: string, ref = 't3/ci-midnight-waits'): Date =>
    midnightProofHoldUntil({ now, minutes, ref });
  expect(proof('7').getTime()).toBe(now.getTime() + 7 * MINUTE_MS);
  for (const ref of ['main', 'production'])
    expect(() => proof('7', ref)).toThrow(`A midnight proof run never runs on ${ref}.`);
  for (const minutes of ['0', '-1', '1.5', 'soon', '76'])
    expect(() => proof(minutes)).toThrow('A midnight proof holds 1 to 75 minutes.');
});

test('independent groups overlap within two slots; freshness and database gates remain exclusive', async () => {
  let active = 0;
  let maximum = 0;
  const visits: string[] = [];
  await runGroupSchedule({
    entries: ['static', 'audit-a', 'audit-b', 'freshness', 'audit-c', 'sql'],
    jobs: 2,
    canOverlap: (entry) => entry.startsWith('audit'),
    run: async (entry) => {
      active++;
      maximum = Math.max(maximum, active);
      if (!entry.startsWith('audit')) expect(active).toBe(1);
      visits.push(entry);
      await Promise.resolve();
      active--;
    },
  });
  expect(maximum).toBe(2);
  expect(visits).toEqual(['static', 'audit-a', 'audit-b', 'freshness', 'audit-c', 'sql']);
});

test('workers are bounded below by one and above by the requested count', async () => {
  let active = 0;
  let maximum = 0;
  await runGroupSchedule({
    entries: ['a', 'b', 'c', 'd'],
    jobs: 0,
    canOverlap: () => true,
    run: async () => {
      active++;
      maximum = Math.max(maximum, active);
      await Promise.resolve();
      active--;
    },
  });
  expect(maximum).toBe(1);
  await runGroupSchedule({
    entries: ['a', 'b', 'c', 'd'],
    jobs: 3,
    canOverlap: () => true,
    run: async () => {
      active++;
      maximum = Math.max(maximum, active);
      await new Promise((done) => setImmediate(done));
      active--;
    },
  });
  expect(maximum).toBe(3);
});

test('a failed result does not suppress unrelated entries; unexpected runner errors wait for active work', async () => {
  const outcomes: string[] = [];
  await runGroupSchedule({
    entries: ['failed', 'passed'],
    jobs: 1,
    canOverlap: () => true,
    run: async (entry) => {
      outcomes.push(entry);
    },
  });
  expect(outcomes).toEqual(['failed', 'passed']);
  let peerFinished = false;
  await expect(
    runGroupSchedule({
      entries: ['crash', 'peer'],
      jobs: 2,
      canOverlap: () => true,
      run: async (entry) => {
        if (entry === 'crash') throw new Error('runner failed');
        await Promise.resolve();
        peerFinished = true;
      },
    }),
  ).rejects.toThrow('runner failed');
  expect(peerFinished).toBe(true);
  // After a runner error no worker claims another entry.
  const started: string[] = [];
  await expect(
    runGroupSchedule({
      entries: ['crash', 'active', 'later'],
      jobs: 2,
      canOverlap: () => true,
      run: async (entry) => {
        started.push(entry);
        if (entry === 'crash') throw new Error('runner failed');
        await new Promise((done) => setImmediate(done));
      },
    }),
  ).rejects.toThrow('runner failed');
  expect(started).toEqual(['crash', 'active']);
});

test('changed-spec-first: a lower tier finishes on every worker before the next tier starts', async () => {
  const started: string[] = [];
  const finished: string[] = [];
  const tierOf = (entry: string): number => (entry.startsWith('changed') ? 0 : 1);
  await runGroupSchedule({
    entries: ['changed-a', 'changed-b', 'product-a', 'product-b'],
    jobs: 3,
    canOverlap: () => true,
    tier: tierOf,
    run: async (entry) => {
      started.push(entry);
      if (tierOf(entry) === 1) expect(finished).toEqual(expect.arrayContaining(['changed-a', 'changed-b']));
      await Promise.resolve();
      finished.push(entry);
    },
  });
  expect(started).toEqual(['changed-a', 'changed-b', 'product-a', 'product-b']);
});

test('a failed changed-spec group blocks the later tier for this attempt and names the failed groups', () => {
  expect(changedTestsFirstBlock([])).toBeUndefined();
  expect(changedTestsFirstBlock(['golden:p1-13', 'audit:wave-2:p1-13'])).toBe(
    'Changed-spec tier failed (audit:wave-2:p1-13, golden:p1-13); the groups selected only by product scope wait for its repair.',
  );
});
