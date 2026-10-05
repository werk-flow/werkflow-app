import 'server-only';

import { logReadFailure } from '@/lib/data/read-request-cache';
import { getJobDisplayTitle } from '@/lib/jobs/types';
import type { EffectiveResponsibilityHolder } from '@/lib/responsibilities/resolution';
import type { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { LIST_ROW_CAP, readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';
import { canApproveEntries } from './helpers';
import { groupPendingEntries } from './pending-sessions';
import {
  toChangeRequest,
  toTimeEntry,
  type ChangeRequestWithDetails,
  type GetChangeRequestsResult,
  type GetPendingSessionsResult,
  type OrgRole,
  type PendingSession,
  type TimeEntryRow,
} from './types';

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;
type PersonName = { first_name: string | null; last_name: string | null };

/**
 * The two approval queues behind the Anträge tab and the attention counts.
 * The callers in actions.ts establish identity, membership, role and the
 * time-approval responsibility first; these readers take that verdict as
 * input. Every queue is read whole (an overflow fails like a query error),
 * and a failed related read fails the queue instead of returning cards
 * without their names or job titles.
 */
export async function readPendingSessionQueue(input: {
  admin: AdminClient;
  organizationId: string;
  callerRole: OrgRole;
  holder: EffectiveResponsibilityHolder;
}): Promise<GetPendingSessionsResult> {
  const { admin, organizationId, callerRole, holder } = input;
  const { data: pendingEntries, error: entriesError } = await readCompleteRows(
    (from, to) =>
      admin
        .from('time_entries')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .order('id')
        .range(from, to),
    LIST_ROW_CAP,
  );
  if (entriesError) {
    logReadFailure('Error fetching pending entries:', entriesError);
    return { success: false, error: 'fetch_failed' };
  }
  if (pendingEntries.length === 0) return { success: true, sessions: [] };

  const { data: memberRows, error: memberRowsError } = await readInBatches(
    [...new Set(pendingEntries.map((entry) => entry.user_id))],
    (batch) =>
      admin
        .from('organization_members')
        .select('user_id, role')
        .eq('organization_id', organizationId)
        .in('user_id', [...batch]),
  );
  if (memberRowsError) {
    logReadFailure('Error fetching pending-entry member roles:', memberRowsError);
    return { success: false, error: 'fetch_failed' };
  }
  const roleByUser = new Map(memberRows.map((member) => [member.user_id, member.role as OrgRole]));
  const approvableEntries: TimeEntryRow[] = pendingEntries.filter((entry) => {
    const targetRole = roleByUser.get(entry.user_id);
    return Boolean(
      targetRole && canApproveEntries(callerRole, targetRole, { holder, targetUserId: entry.user_id }),
    );
  });

  // Personal display data only for targets this approver may see:
  // authorization is resolved before any profile lookup.
  const groups = groupPendingEntries(approvableEntries);
  const jobIdOf = (group: (typeof groups)[number]) => group.clockIn?.job_id ?? group.clockOut?.job_id ?? null;
  const jobIds = [...new Set(groups.map(jobIdOf).filter((id): id is string => id !== null))];
  const [profiles, jobs] = await Promise.all([
    readInBatches([...new Set(groups.map((group) => group.userId))], (batch) =>
      admin
        .from('profiles')
        .select('id, first_name, last_name')
        .in('id', [...batch]),
    ),
    readInBatches(jobIds, (batch) =>
      admin
        .from('jobs')
        .select('id, title, description')
        .eq('organization_id', organizationId)
        .in('id', [...batch]),
    ),
  ]);
  const detailError = profiles.error ?? jobs.error;
  if (detailError) {
    logReadFailure('getPendingSessions: names or job titles failed', detailError);
    return { success: false, error: 'fetch_failed' };
  }
  const profileById = new Map<string, PersonName>(profiles.data.map((profile) => [profile.id, profile]));
  const jobTitleById = new Map(
    jobs.data.map((job) => [job.id, getJobDisplayTitle({ title: job.title, description: job.description })]),
  );

  // One session per manual submission; the grouping rule lives in pending-sessions.ts.
  const sessions: PendingSession[] = groups.map((group) => {
    const profile = profileById.get(group.userId);
    const jobId = jobIdOf(group);
    return {
      id: group.id,
      userId: group.userId,
      firstName: profile?.first_name || null,
      lastName: profile?.last_name || null,
      clockIn: group.clockIn ? toTimeEntry(group.clockIn) : null,
      clockOut: group.clockOut ? toTimeEntry(group.clockOut) : null,
      entryIds: group.entries.map((entry) => entry.id),
      date: group.date,
      createdAt: group.createdAt,
      jobTitle: jobId ? (jobTitleById.get(jobId) ?? null) : null,
    };
  });
  return { success: true, sessions };
}

export async function readPendingChangeRequestQueue(input: {
  admin: AdminClient;
  organizationId: string;
}): Promise<GetChangeRequestsResult> {
  const { admin, organizationId } = input;
  const { data: requests, error: requestsError } = await readCompleteRows(
    (from, to) =>
      admin
        .from('entry_change_requests')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .order('id')
        .range(from, to),
    LIST_ROW_CAP,
  );
  if (requestsError) {
    logReadFailure('Error fetching change requests:', requestsError);
    return { success: false, error: 'fetch_failed' };
  }
  if (requests.length === 0) return { success: true, requests: [] };

  const entryIds = requests.flatMap((request) =>
    request.paired_entry_id ? [request.entry_id, request.paired_entry_id] : [request.entry_id],
  );
  const [entries, profiles] = await Promise.all([
    readInBatches(entryIds, (batch) =>
      admin
        .from('time_entries')
        .select('*')
        .eq('organization_id', organizationId)
        .in('id', [...batch]),
    ),
    readInBatches([...new Set(requests.map((request) => request.requested_by))], (batch) =>
      admin
        .from('profiles')
        .select('id, first_name, last_name')
        .in('id', [...batch]),
    ),
  ]);
  const detailError = entries.error ?? profiles.error;
  if (detailError) {
    logReadFailure('getPendingChangeRequests: entries or requester names failed', detailError);
    return { success: false, error: 'fetch_failed' };
  }
  const entryById = new Map(entries.data.map((entry) => [entry.id, entry]));
  const profileById = new Map<string, PersonName>(profiles.data.map((profile) => [profile.id, profile]));

  const enriched: ChangeRequestWithDetails[] = [];
  for (const request of requests) {
    // entry_id cascades on delete: an entry deleted between the two reads took
    // its request with it, so the request is no longer pending.
    const entry = entryById.get(request.entry_id);
    if (!entry) continue;
    const pairedEntry = request.paired_entry_id ? entryById.get(request.paired_entry_id) : undefined;
    const profile = profileById.get(request.requested_by);
    enriched.push({
      ...toChangeRequest(request),
      entry: toTimeEntry(entry),
      pairedEntry: pairedEntry ? toTimeEntry(pairedEntry) : null,
      requesterFirstName: profile?.first_name || null,
      requesterLastName: profile?.last_name || null,
    });
  }
  return { success: true, requests: enriched };
}
