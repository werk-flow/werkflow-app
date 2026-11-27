import { describe, expect, test } from 'bun:test';
import { isClockStateEventRelevant, isCorrectionEventFor } from './clock-state-events';

const viewer = 'user-viewer';
const colleague = 'user-colleague';

describe('clock-state event relevance (Step 2, PF-29)', () => {
  test('time rows always trigger a read', () => {
    expect(
      isClockStateEventRelevant({ table: 'time_sessions', new: { id: 's1' }, old: null }, null, viewer),
    ).toBe(true);
    expect(
      isClockStateEventRelevant({ table: 'time_segments', new: null, old: { id: 'g1' } }, 'job-1', viewer),
    ).toBe(true);
  });

  test('a job change matters only for the running session job', () => {
    expect(
      isClockStateEventRelevant(
        { table: 'jobs', new: { id: 'job-1', title: 'x' }, old: null },
        'job-1',
        viewer,
      ),
    ).toBe(true);
    expect(
      isClockStateEventRelevant({ table: 'jobs', new: { id: 'job-2' }, old: null }, 'job-1', viewer),
    ).toBe(false);
    expect(isClockStateEventRelevant({ table: 'jobs', new: { id: 'job-2' }, old: null }, null, viewer)).toBe(
      false,
    );
  });

  test('a delete payload carries only the id and is judged by it', () => {
    expect(
      isClockStateEventRelevant(
        { table: 'jobs', new: null, old: { id: 'job-1', organization_id: 'o' } },
        'job-1',
        viewer,
      ),
    ).toBe(true);
    expect(
      isClockStateEventRelevant(
        { table: 'jobs', new: null, old: { id: 'job-9', organization_id: 'o' } },
        'job-1',
        viewer,
      ),
    ).toBe(false);
  });

  test('a payload without an id reads rather than guesses', () => {
    expect(isClockStateEventRelevant({ table: 'jobs', new: null, old: null }, null, viewer)).toBe(true);
  });

  test('a correction request reads the clock only when it concerns the viewer’s own time', () => {
    const request = (subject: string, requester: string) => ({
      table: 'time_correction_requests',
      new: { id: 'r1', organization_id: 'o', subject_user_id: subject, requested_by: requester },
      old: { id: 'r1', organization_id: 'o' },
    });
    expect(isClockStateEventRelevant(request(viewer, viewer), null, viewer)).toBe(true);
    expect(isClockStateEventRelevant(request(viewer, colleague), null, viewer)).toBe(true);
    expect(isClockStateEventRelevant(request(colleague, viewer), null, viewer)).toBe(true);
    // A manager approving a colleague's request: the manager's clock keeps its state.
    expect(isClockStateEventRelevant(request(colleague, colleague), null, viewer)).toBe(false);
    expect(isClockStateEventRelevant(request(viewer, viewer), null, null)).toBe(false);
  });
});

describe('correction request events of the people a view shows', () => {
  const request = (row: Record<string, unknown> | null) => ({
    table: 'time_correction_requests',
    new: row,
    old: { id: 'r1', organization_id: 'o' },
  });

  test('pass for a shown person’s request and skip another person’s', () => {
    const shown = [viewer, 'user-shown'];
    expect(
      isCorrectionEventFor(request({ subject_user_id: 'user-shown', requested_by: 'boss' }), shown),
    ).toBe(true);
    expect(isCorrectionEventFor(request({ subject_user_id: 'boss', requested_by: viewer }), shown)).toBe(
      true,
    );
    expect(isCorrectionEventFor(request({ subject_user_id: colleague, requested_by: 'boss' }), shown)).toBe(
      false,
    );
    expect(isCorrectionEventFor(request({ subject_user_id: colleague, requested_by: 'boss' }), [])).toBe(
      false,
    );
  });

  test('read a deletion notice that names nobody, and pass every other table', () => {
    expect(isCorrectionEventFor(request(null), [viewer])).toBe(true);
    expect(
      isCorrectionEventFor({ table: 'time_entries', new: { user_id: colleague }, old: null }, [viewer]),
    ).toBe(true);
  });
});
