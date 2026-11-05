import { describe, expect, test } from 'bun:test';

import { readManualEntryEvent } from './manual-entry-bridge';
import { toTimeEntry, type TimeEntryRow } from './types';

const row: TimeEntryRow = {
  capture_source: null,
  operation_id: null,
  recovery_reason: null,
  id: 'entry-1',
  user_id: 'user-1',
  organization_id: 'org-1',
  entry_type: 'clock_in',
  timestamp: '2026-11-05T08:00:00.000Z',
  is_manual: true,
  job_id: null,
  status: 'pending',
  reviewed_by: null,
  reviewed_at: null,
  created_at: '2026-11-05T08:00:00.000Z',
  updated_at: '2026-11-05T08:00:00.000Z',
};

describe('readManualEntryEvent', () => {
  test('keeps every field of an entry the manual entry button sends', () => {
    const entries = [toTimeEntry(row)];
    expect(readManualEntryEvent({ entries })).toEqual(entries);
  });

  test.each([[null], [{}], [{ entries: 'entry-1' }], [{ entries: [{ id: 'entry-1' }] }]])(
    'refuses a detail the button never sends: %j',
    (detail) => {
      expect(readManualEntryEvent(detail)).toBeNull();
    },
  );
});
