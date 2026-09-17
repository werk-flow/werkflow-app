import { describe, expect, test } from 'bun:test';
import { isClockStateEventRelevant } from './clock-state-events';

describe('clock-state event relevance (Step 2, PF-29)', () => {
  test('time rows always trigger a read', () => {
    expect(isClockStateEventRelevant({ table: 'time_sessions', new: { id: 's1' }, old: null }, null)).toBe(true);
    expect(isClockStateEventRelevant({ table: 'time_segments', new: null, old: { id: 'g1' } }, 'job-1')).toBe(true);
  });

  test('a job change matters only for the running session job', () => {
    expect(isClockStateEventRelevant({ table: 'jobs', new: { id: 'job-1', title: 'x' }, old: null }, 'job-1')).toBe(true);
    expect(isClockStateEventRelevant({ table: 'jobs', new: { id: 'job-2' }, old: null }, 'job-1')).toBe(false);
    expect(isClockStateEventRelevant({ table: 'jobs', new: { id: 'job-2' }, old: null }, null)).toBe(false);
  });

  test('a delete payload carries only the id and is judged by it', () => {
    expect(isClockStateEventRelevant({ table: 'jobs', new: null, old: { id: 'job-1', organization_id: 'o' } }, 'job-1')).toBe(true);
    expect(isClockStateEventRelevant({ table: 'jobs', new: null, old: { id: 'job-9', organization_id: 'o' } }, 'job-1')).toBe(false);
  });

  test('a payload without an id reads rather than guesses', () => {
    expect(isClockStateEventRelevant({ table: 'jobs', new: null, old: null }, null)).toBe(true);
  });
});
