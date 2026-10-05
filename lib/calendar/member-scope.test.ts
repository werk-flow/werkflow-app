import { describe, expect, test } from 'bun:test';
import type { CalendarBoardRow } from '@/lib/calendar/board';
import type { CalendarJob } from '@/lib/jobs/types';
import type { TimeEntry } from '@/lib/time-tracking/types';
import {
  boardTeamsOf,
  scopedEntries,
  scopedJobs,
  scopedMembers,
  scopedParkedJobs,
  type MemberScope,
} from './member-scope';

function entry(id: string, userId: string): TimeEntry {
  return {
    id,
    userId,
    organizationId: 'org-1',
    entryType: 'clock_in',
    timestamp: '2026-10-05T07:00:00Z',
    isManual: false,
    jobId: null,
    status: 'approved',
    reviewedBy: null,
    reviewedAt: null,
    createdAt: '2026-10-05T07:00:00Z',
    updatedAt: '2026-10-05T07:00:00Z',
  };
}

function job(id: string, assignedUserIds: string[]): CalendarJob {
  return {
    id,
    title: id,
    jobNumber: null,
    status: 'nicht_bearbeitet',
    executionState: null,
    priority: 'mittel',
    plannedDate: '2026-10-05',
    plannedTime: null,
    estimatedDurationMinutes: null,
    plannedWorkingMinutes: null,
    location: null,
    clientName: null,
    clientAddress: null,
    projectName: null,
    projectNumber: null,
    assignedUserIds,
  };
}

function row(employeeRecordId: string, team: { id: string; name: string } | null): CalendarBoardRow {
  return {
    employeeRecordId,
    userId: null,
    displayName: employeeRecordId,
    role: null,
    hasLogin: false,
    teamId: team?.id ?? null,
    teamName: team?.name ?? null,
    entryDate: null,
    exitDate: null,
  };
}

const manager: MemberScope = { isManager: true, currentUserId: 'me', selectedMemberIds: null };
const employee: MemberScope = { isManager: false, currentUserId: 'me', selectedMemberIds: ['other'] };

describe('member scope', () => {
  test('recorded time needs working hours and follows the selection or the own user', () => {
    const own = entry('1', 'me');
    const foreign = entry('2', 'other');
    const entries = [own, foreign];
    expect(scopedEntries(entries, false, manager)).toEqual([]);
    expect(scopedEntries(entries, true, manager)).toBe(entries);
    expect(scopedEntries(entries, true, { ...manager, selectedMemberIds: ['other'] })).toEqual([foreign]);
    expect(scopedEntries(entries, true, employee)).toEqual([own]);
  });

  test('members follow the selection for managers and are only the own user otherwise', () => {
    const members = [{ user_id: 'me' }, { user_id: 'other' }];
    expect(scopedMembers(members, manager)).toBe(members);
    expect(scopedMembers(members, { ...manager, selectedMemberIds: ['other'] })).toEqual([
      { user_id: 'other' },
    ]);
    expect(scopedMembers(members, employee)).toEqual([{ user_id: 'me' }]);
  });

  test('a selection keeps unassigned jobs; an employee sees only own jobs and no Parkplatz', () => {
    const jobs = [job('own', ['me']), job('open', []), job('foreign', ['third'])];
    const selection = { ...manager, selectedMemberIds: ['me'] };
    expect(scopedJobs(jobs, false, manager)).toEqual([]);
    expect(scopedJobs(jobs, true, selection).map((item) => item.id)).toEqual(['own', 'open']);
    expect(scopedJobs(jobs, true, employee).map((item) => item.id)).toEqual(['own']);
    expect(scopedParkedJobs(jobs, selection).map((item) => item.id)).toEqual(['own', 'open']);
    expect(scopedParkedJobs(jobs, manager)).toBe(jobs);
    expect(scopedParkedJobs(jobs, employee)).toEqual([]);
  });

  test('board teams appear once each in German order', () => {
    const rows = [
      row('r1', { id: 't2', name: 'Öl' }),
      row('r2', { id: 't1', name: 'Bad' }),
      row('r3', { id: 't2', name: 'Öl' }),
      row('r4', null),
    ];
    expect(boardTeamsOf(rows)).toEqual([
      { id: 't1', name: 'Bad' },
      { id: 't2', name: 'Öl' },
    ]);
  });
});
