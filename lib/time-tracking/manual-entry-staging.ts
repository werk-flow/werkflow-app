import 'server-only';
import { readJobAssignmentOfUser, readOrganizationJob } from '@/lib/jobs/job-access-reads';
import type { OrgRole } from '@/lib/roles';
import type { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { getLocalDayEnd } from '@/lib/date-time/berlin';
import type { z } from '@/lib/zod';
import { getUserEntriesForDay } from './action-access';
import type { addManualEntryInputSchema } from './action-schemas';
import { determineApprovalStatus, hasOpenSession } from './helpers';
import { getOpenSessionOrgsForUserOnDay } from './open-session-orgs';
import { toTimeEntries, type AddManualEntryResult, type TimeEntry, type TimeEntryType } from './types';
import { validateManualEntries, validateManualEntryJobOwnership } from './validation';

// The checks addManualEntry (entry-write-actions.ts) runs on an authorized
// submission before it inserts: the day's rules, the job, the approval status
// and a session open in another organization. The action resolves the caller,
// the target's role and the closed periods first.

function getManualEntryJobId(entryType: TimeEntry['entryType'], jobId?: string | null): string | null {
  if (entryType !== 'clock_in') {
    return null;
  }

  return jobId ?? null;
}

type ManualEntryDraft = { entryType: TimeEntryType; timestamp: string; jobId: string | null };

/**
 * Cross-org guard: when the new entries would leave the target clocked in on
 * that day, a session open in another organization refuses them; null when
 * nothing refuses them.
 */
async function refuseOpenSessionElsewhere(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  target: { userId: string; organizationId: string; day: Date; status: TimeEntry['status'] },
  timeEntries: readonly TimeEntry[],
  normalizedEntries: readonly ManualEntryDraft[],
): Promise<AddManualEntryResult | null> {
  const simulatedEntries: TimeEntry[] = normalizedEntries.map((e, idx) => ({
    id: `simulated-${idx}`,
    userId: target.userId,
    organizationId: target.organizationId,
    entryType: e.entryType,
    timestamp: e.timestamp,
    isManual: true,
    jobId: e.jobId ?? null,
    status: target.status,
    reviewedBy: null,
    reviewedAt: null,
    createdAt: e.timestamp,
    updatedAt: e.timestamp,
  }));

  const wouldBeClockedIn = hasOpenSession([...timeEntries, ...simulatedEntries], getLocalDayEnd(target.day));
  if (!wouldBeClockedIn) return null;
  const openOrgs = await getOpenSessionOrgsForUserOnDay(admin, target.userId, target.day);
  if (!openOrgs) return { success: false, error: 'fetch_failed' };
  const openOther = openOrgs.find((o) => o.organizationId !== target.organizationId);
  if (!openOther) return null;
  return {
    success: false,
    error: 'working_in_other_org',
    otherOrgId: openOther.organizationId,
    otherOrgName: openOther.organizationName,
  };
}

/**
 * The entries with the job on their clock-in only, or the refusal of that job:
 * it lies in the organization, and an employee's entry names only a job the
 * employee is assigned to, as the live clock requires.
 */
async function attachManualEntryJob(
  params: {
    organizationId: string;
    targetUserId: string;
    entries: ReadonlyArray<{ entryType: TimeEntryType; timestamp: string }>;
    jobId?: string | null | undefined;
  },
  targetRole: OrgRole,
): Promise<{ entries: ManualEntryDraft[] } | { refusal: AddManualEntryResult }> {
  const { organizationId, targetUserId, entries, jobId } = params;
  const drafts = entries.map((entry) => ({
    entryType: entry.entryType,
    timestamp: entry.timestamp,
    jobId: getManualEntryJobId(entry.entryType, jobId),
  }));
  const ownership = validateManualEntryJobOwnership(drafts);
  if (!ownership.valid) return { refusal: { success: false, ...ownership.failure } };
  const namedJobId = drafts.find((draft) => draft.jobId)?.jobId;
  if (!namedJobId) return { entries: drafts };
  const [job, assignment] = await Promise.all([
    readOrganizationJob(organizationId, namedJobId),
    targetRole === 'employee' ? readJobAssignmentOfUser(organizationId, namedJobId, targetUserId) : null,
  ]);
  if (job.error || assignment?.error) return { refusal: { success: false, error: 'load_failed' } };
  if (!job.data) return { refusal: { success: false, error: 'job_not_found' } };
  if (assignment && !assignment.data) return { refusal: { success: false, error: 'job_not_assigned' } };
  return { entries: drafts };
}

/**
 * The entries as they would be inserted, with their approval status, or the
 * refusal of the submission.
 */
export async function stageManualEntries(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  input: {
    params: z.infer<typeof addManualEntryInputSchema>;
    day: Date;
    callerRole: OrgRole;
    callerId: string;
    targetRole: OrgRole;
  },
): Promise<{ entries: ManualEntryDraft[]; status: TimeEntry['status'] } | { refusal: AddManualEntryResult }> {
  const { params, day: targetDay, callerRole, targetRole } = input;
  const { organizationId, targetUserId, entries } = params;
  const existingEntries = await getUserEntriesForDay(admin, targetUserId, organizationId, targetDay);
  if (!existingEntries) return { refusal: { success: false, error: 'fetch_failed' } };
  const timeEntries = toTimeEntries(existingEntries);

  // Validate the new entries
  const validationResult = validateManualEntries(timeEntries, entries, {
    allowFutureTimestamps: callerRole === 'admin',
  });
  if (!validationResult.valid) return { refusal: { success: false, ...validationResult.failure } };

  const withJob = await attachManualEntryJob(params, targetRole);
  if ('refusal' in withJob) return withJob;
  const normalizedEntries = withJob.entries;

  // Determine approval status
  const status = determineApprovalStatus(callerRole, targetUserId, input.callerId);

  const otherOrgRefusal = await refuseOpenSessionElsewhere(
    admin,
    { userId: targetUserId, organizationId, day: targetDay, status },
    timeEntries,
    normalizedEntries,
  );
  if (otherOrgRefusal) return { refusal: otherOrgRefusal };
  return { entries: normalizedEntries, status };
}
