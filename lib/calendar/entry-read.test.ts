import { expect, test } from 'bun:test';
import { completeCalendarEntryRead } from './entry-read';
import type { GetTimeEntriesResult, GetChangeRequestsResult, TimeEntry } from '@/lib/time-tracking/types';

const entry: TimeEntry = { id: 'entry', userId: 'caller', organizationId: 'org', entryType: 'clock_in', timestamp: '2026-06-15T07:00:00Z', isManual: true, jobId: null, status: 'approved', reviewedBy: null, reviewedAt: null, createdAt: '2026-06-15T07:00:00Z', updatedAt: '2026-06-15T07:00:00Z' };

test('entry window waits for its correction metadata and fails the whole read when metadata fails', async () => {
  let resolveEntries!: (result: GetTimeEntriesResult) => void;
  let resolveMetadata!: (result: GetChangeRequestsResult) => void;
  let metadataIds: string[] | undefined;
  let completed = false;
  const result = completeCalendarEntryRead(new Promise(resolve => { resolveEntries = resolve; }), async ids => {
    metadataIds = ids;
    return new Promise(resolve => { resolveMetadata = resolve; });
  });
  void result.then(() => { completed = true; });
  expect(metadataIds).toBeUndefined();
  resolveEntries({ success: true, entries: [entry] });
  await Promise.resolve();
  expect(metadataIds).toEqual(['entry']);
  expect(completed).toBe(false);
  resolveMetadata({ success: false, error: 'read_failed' });
  expect(await result).toEqual({ success: false, error: 'read_failed' });
});

test('canonical-only windows keep provisional projections without an unnecessary metadata call', async () => {
  const canonical = { ...entry, canonicalSegmentId: 'segment' };
  const provisional = { ...entry, id: 'proposed', isProvisionalCorrection: true };
  expect(await completeCalendarEntryRead(Promise.resolve({ success: true, entries: [canonical], provisionalEntries: [provisional] }), async () => { throw new Error('unexpected legacy metadata read'); })).toEqual({ success: true, entries: [canonical, provisional], changeRequestMap: {} });
});
