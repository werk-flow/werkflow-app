import type { CalendarBoardRow } from '@/lib/calendar/board';
import type { CalendarJob } from '@/lib/jobs/types';
import type { TimeEntry } from '@/lib/time-tracking/types';

/**
 * The calendar's member scope. A manager sees the selected members (null
 * means everyone); everybody else sees only their own records.
 */
export type MemberScope = {
  isManager: boolean;
  currentUserId: string;
  selectedMemberIds: readonly string[] | null;
};

/** Recorded time is drawn only while working hours are switched on. */
export function scopedEntries(
  entries: TimeEntry[],
  showWorkingHours: boolean,
  scope: MemberScope,
): TimeEntry[] {
  if (!showWorkingHours) return [];
  if (!scope.isManager) return entries.filter((entry) => entry.userId === scope.currentUserId);
  const selected = scope.selectedMemberIds;
  return selected ? entries.filter((entry) => selected.includes(entry.userId)) : entries;
}

export function scopedMembers<Member extends { user_id: string }>(
  members: Member[],
  scope: MemberScope,
): Member[] {
  if (!scope.isManager) return members.filter((member) => member.user_id === scope.currentUserId);
  const selected = scope.selectedMemberIds;
  return selected ? members.filter((member) => selected.includes(member.user_id)) : members;
}

/** Planned work; unassigned visits stay visible under every member selection. */
export function scopedJobs(jobs: CalendarJob[], showJobs: boolean, scope: MemberScope): CalendarJob[] {
  if (!showJobs) return [];
  if (!scope.isManager) return jobs.filter((job) => job.assignedUserIds.includes(scope.currentUserId));
  return selectedOrUnassigned(jobs, scope.selectedMemberIds);
}

/** The Parkplatz belongs to managers; unassigned parked jobs stay visible under every selection. */
export function scopedParkedJobs(
  parkedJobs: CalendarJob[],
  scope: Pick<MemberScope, 'isManager' | 'selectedMemberIds'>,
): CalendarJob[] {
  if (!scope.isManager) return [];
  return selectedOrUnassigned(parkedJobs, scope.selectedMemberIds);
}

function selectedOrUnassigned(jobs: CalendarJob[], selected: readonly string[] | null): CalendarJob[] {
  return selected
    ? jobs.filter(
        (job) =>
          job.assignedUserIds.length === 0 || job.assignedUserIds.some((userId) => selected.includes(userId)),
      )
    : jobs;
}

/** The teams on the board, once each, in German name order. */
export function boardTeamsOf(rows: readonly CalendarBoardRow[]): Array<{ id: string; name: string }> {
  const teams = new Map<string, string>();
  for (const row of rows) if (row.teamId && row.teamName) teams.set(row.teamId, row.teamName);
  return [...teams].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'de'));
}
