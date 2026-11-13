import { describe, expect, test } from 'bun:test';

import type { FieldSyncTodayAssignment } from '@/lib/field-sync/today-snapshot';
import { offlineViewAt } from './today-address';

// Without signal a job page's address shows that job's pack and any other
// address the day's list (decision record 0010, "Device data"). The pack's
// „Alle Einsätze von heute“ link goes to /dashboard, so the list must stay
// reachable whatever the stored assignments hold.

function assignment(jobId: string, jobNumber: string | null): FieldSyncTodayAssignment {
  return {
    jobId,
    jobNumber,
    title: 'Heizung tauschen',
    requestedOutcome: null,
    plannedWorkingMinutes: null,
    visits: [{ startAt: '2026-11-09T07:00:00.000Z', endAt: '2026-11-09T09:00:00.000Z' }],
    customerName: null,
    customerPhone: null,
    siteName: null,
    siteAddress: null,
    accessNotes: null,
    contactName: null,
    contactRole: null,
    contactPhone: null,
    project: null,
    instructions: [],
  };
}

const numbered = assignment('9a000000-0000-4000-8000-000000000021', 'AUF-2026-21');
const unnumbered = assignment('9a000000-0000-4000-8000-000000000022', null);

describe('what an address shows without signal', () => {
  test("an address that names no job shows the day's list, even beside an assignment without a job number", () => {
    for (const pathname of ['/dashboard', '/offline', '/auftraege/projekt', '/auftraege/%E0%A4%A']) {
      expect(offlineViewAt(pathname, [unnumbered, numbered])).toEqual({ jobNumber: null, assignment: null });
    }
  });

  test("a job page's address shows that job's pack, inside a project too", () => {
    for (const pathname of ['/auftraege/AUF-2026-21', '/auftraege/projekt/PRJ-2026-3/AUF-2026-21/']) {
      expect(offlineViewAt(pathname, [unnumbered, numbered]).assignment).toBe(numbered);
    }
  });

  test("a job that is not stored names its number and shows the day's list", () => {
    expect(offlineViewAt('/auftraege/AUF-2026-99', [unnumbered, numbered])).toEqual({
      jobNumber: 'AUF-2026-99',
      assignment: null,
    });
  });
});
