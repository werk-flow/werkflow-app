import { expect, test } from 'bun:test';
import type { RealtimeChangeEvent } from './events';
import { ownWrites } from './own-writes';

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
