import { expect, jest, test } from 'bun:test';
import type { RealtimeChangeEvent } from './events';
import { ownWrites } from './own-writes';

/** The hold bound lib/realtime/own-writes.ts documents: one second, inside the two-second live target. */
const OWN_SAVE_HOLD_MS = 1_000;

const saved = '2026-10-22T09:15:00.123456+00:00';
const jobEvent = (
  updatedAt: unknown,
  table: RealtimeChangeEvent['table'] = 'jobs',
  id = 'job-1',
): RealtimeChangeEvent => ({
  table,
  eventType: 'UPDATE',
  new: { id, organization_id: 'org-1', updated_at: updatedAt },
  old: { id, organization_id: 'org-1' },
});

/** A save that runs until the test leaves the page; leaving settles it, so no later test sees it running. */
function saveUntilPageLeaves(): { leave: () => Promise<void> } {
  let settle: () => void = () => undefined;
  const saving = ownWrites.track(new Promise<void>((resolve) => (settle = resolve)));
  return {
    leave: async () => {
      settle();
      await saving;
    },
  };
}

test('the Realtime spelling of the saved instant is covered, a millisecond cut or another value is not', () => {
  ownWrites.recorded({ success: true, job: { id: 'job-1', updatedAt: saved, client: null } }, 1_000);

  expect(ownWrites.covers(jobEvent('2026-10-22 11:15:00.123456+02'), 2_000)).toBe(true);
  expect(ownWrites.covers(jobEvent('2026-10-22T09:15:00.123456Z'), 2_000)).toBe(true);
  expect(ownWrites.covers(jobEvent('2026-10-22T09:15:00.123Z'), 2_000)).toBe(false);
  expect(ownWrites.covers(jobEvent('2026-10-22'), 2_000)).toBe(false);
  expect(ownWrites.covers(jobEvent(1_729_588_500_000), 2_000)).toBe(false);
});

test('an event of a row the save named is covered; another row, version, table or a catch-up is not', () => {
  ownWrites.recorded(
    { success: true, job: { id: 'job-1', updatedAt: saved, projectId: 'project-1' } },
    1_000,
  );

  // The same transaction's project, which the save names by reference.
  expect(ownWrites.covers(jobEvent(saved, 'projects', 'project-1'), 2_000)).toBe(true);
  // Another writer's transaction that started in the same microsecond.
  expect(ownWrites.covers(jobEvent(saved, 'jobs', 'job-2'), 2_000)).toBe(false);
  // A later save by someone else.
  expect(ownWrites.covers(jobEvent('2026-10-22T09:15:00.123457+00:00'), 2_000)).toBe(false);
  // A table whose updates need not move updated_at could carry an old stamp.
  expect(ownWrites.covers(jobEvent(saved, 'job_assignments'), 2_000)).toBe(false);
  expect(ownWrites.covers({ table: 'jobs', eventType: 'UPDATE', new: null, old: null }, 2_000)).toBe(false);
});

test('a recorded stamp stops covering after its lifetime', () => {
  ownWrites.recorded([{ id: 'job-1', updated_at: saved }], 1_000_000);
  expect(ownWrites.covers(jobEvent(saved), 1_060_000)).toBe(true);
  expect(ownWrites.covers(jobEvent(saved), 1_060_001)).toBe(false);
});

test('an echo that beats the save response waits for the save and is then covered', async () => {
  let respond: (result: unknown) => void = () => undefined;
  const save = ownWrites.track(new Promise((resolve) => (respond = resolve)));
  const judged: boolean[] = [];
  const echo = jobEvent(saved, 'jobs', 'job-echo');

  expect(ownWrites.heldForSave(echo, () => judged.push(ownWrites.covers(echo)))).toBe(true);
  expect(judged).toEqual([]);
  respond({ success: true, job: { id: 'job-echo', updatedAt: saved } });
  await save;

  expect(judged).toEqual([true]);
  expect(ownWrites.heldForSave(echo, () => undefined)).toBe(false);
});

test('a failed save releases the events it held, and only a stamped event waits', async () => {
  let fail: (error: Error) => void = () => undefined;
  const save = ownWrites.track(new Promise((_, reject) => (fail = reject)));
  const released: string[] = [];

  expect(ownWrites.heldForSave(jobEvent(saved, 'job_assignments'), () => released.push('unstamped'))).toBe(
    false,
  );
  expect(ownWrites.heldForSave(jobEvent(saved), () => released.push('jobs'))).toBe(true);
  fail(new Error('offline'));
  await expect(save).rejects.toThrow('offline');

  expect(released).toEqual(['jobs']);
});

test('a save that never settles holds events for the bound only, then releases and holds nothing', async () => {
  jest.useFakeTimers();
  const page = saveUntilPageLeaves();
  try {
    const released: string[] = [];
    expect(ownWrites.heldForSave(jobEvent(saved), () => released.push('colleague'))).toBe(true);

    jest.advanceTimersByTime(OWN_SAVE_HOLD_MS - 1);
    expect(released).toEqual([]);
    jest.advanceTimersByTime(1);
    expect(released).toEqual(['colleague']);
    expect(ownWrites.heldForSave(jobEvent(saved), () => released.push('later'))).toBe(false);
  } finally {
    await page.leave();
    jest.useRealTimers();
  }
});

test('an event waits once: overlapping saves cannot hold it again after its release', async () => {
  jest.useFakeTimers();
  const pages: Array<{ leave: () => Promise<void> }> = [];
  try {
    const colleague = jobEvent(saved, 'jobs', 'job-colleague');
    const released: string[] = [];
    const judge = (): void => {
      if (!ownWrites.heldForSave(colleague, judge)) released.push('judged');
    };
    pages.push(saveUntilPageLeaves());
    judge();
    jest.advanceTimersByTime(OWN_SAVE_HOLD_MS - 100);
    pages.push(saveUntilPageLeaves());
    jest.advanceTimersByTime(100);

    expect(released).toEqual(['judged']);
  } finally {
    for (const page of pages) await page.leave();
    jest.useRealTimers();
  }
});

test('every listener of one echo waits for the save, and each judges it once on release', async () => {
  let respond: (result: unknown) => void = () => undefined;
  const save = ownWrites.track(new Promise((resolve) => (respond = resolve)));
  const echo = jobEvent(saved, 'documents', 'document-1');
  const judged: string[] = [];
  const listener = (name: string) => (): void => {
    if (!ownWrites.heldForSave(echo, listener(name))) judged.push(`${name}: ${ownWrites.covers(echo)}`);
  };

  listener('overview')();
  listener('documents')();
  expect(judged).toEqual([]);
  respond({ success: true, document: { id: 'document-1', updatedAt: saved } });
  await save;

  expect(judged).toEqual(['overview: true', 'documents: true']);
});
