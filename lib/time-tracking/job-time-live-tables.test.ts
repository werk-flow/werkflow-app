import { describe, expect, test } from 'bun:test';
import { isJobTimeEventRelevant, JOB_TIME_LIVE_TABLES } from './job-time-live-tables';

const request = (row: Record<string, unknown> | null) => ({
  table: 'time_correction_requests',
  new: row,
  old: null,
});

describe('job and project time correction invalidation', () => {
  test('job time views subscribe to correction requests', () => {
    expect(JOB_TIME_LIVE_TABLES).toContain('time_correction_requests');
  });

  test('a participant as subject or requester triggers a read', () => {
    expect(
      isJobTimeEventRelevant(
        request({ status: 'submitted', subject_user_id: 'worker', requested_by: 'boss' }),
        ['worker'],
      ),
    ).toBe(true);
    expect(
      isJobTimeEventRelevant(
        request({ status: 'submitted', subject_user_id: 'other', requested_by: 'worker' }),
        ['worker'],
      ),
    ).toBe(true);
  });

  test('a non-approved edit for non-participants skips the read', () => {
    expect(
      isJobTimeEventRelevant(
        request({ status: 'submitted', subject_user_id: 'other', requested_by: 'boss' }),
        ['worker'],
      ),
    ).toBe(false);
  });

  test('missing either person or the whole row triggers a read', () => {
    for (const row of [
      null,
      { id: 'request' },
      { status: 'submitted', subject_user_id: 'other' },
      { status: 'submitted', requested_by: 'boss' },
    ]) {
      expect(isJobTimeEventRelevant(request(row), ['worker'])).toBe(true);
    }
    expect(
      isJobTimeEventRelevant(
        {
          table: 'time_correction_requests',
          new: null,
          old: { subject_user_id: 'worker', requested_by: 'boss' },
        },
        ['worker'],
      ),
    ).toBe(true);
  });

  test('loading or empty participants cannot rule out a correction', () => {
    expect(
      isJobTimeEventRelevant(
        request({ status: 'submitted', subject_user_id: 'other', requested_by: 'boss' }),
        [],
      ),
    ).toBe(true);
  });

  test('an approval reads even when the worker is not yet a participant', () => {
    expect(
      isJobTimeEventRelevant(
        request({ status: 'approved', subject_user_id: 'new-worker', requested_by: 'boss' }),
        ['worker'],
      ),
    ).toBe(true);
  });

  test('a missing new status cannot rule out a correction', () => {
    expect(
      isJobTimeEventRelevant(request({ subject_user_id: 'other', requested_by: 'boss' }), ['worker']),
    ).toBe(true);
    expect(
      isJobTimeEventRelevant(
        {
          table: 'time_correction_requests',
          new: null,
          old: { status: 'submitted', subject_user_id: 'other', requested_by: 'boss' },
        },
        ['worker'],
      ),
    ).toBe(true);
  });

  test('every other table still triggers a read', () => {
    expect(
      isJobTimeEventRelevant({ table: 'time_entries', new: { user_id: 'other' }, old: null }, ['worker']),
    ).toBe(true);
  });
});
