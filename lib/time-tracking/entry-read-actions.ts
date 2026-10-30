'use server';
import type { ActionFailure } from '@/lib/action-result';
import { logReadFailure, logReadErrors } from '@/lib/data/read-request-cache';
import { readJobAssignmentOfUser } from '@/lib/jobs/job-access-reads';
import { logError } from '@/lib/logging';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { readCompleteRows, readInBatches, LIST_ROW_CAP } from '@/lib/supabase/query-batches';
import { getAuthenticatedUser } from '@/lib/data/cached';
import {
  getTimeEntriesInputSchema,
  timeEntryAuditInputSchema,
  timeEntryAuditRowSchema,
} from './action-schemas';
import {
  type TimeEntry,
  type JobTimeParticipant,
  type GetTimeEntriesParams,
  type GetTimeEntriesResult,
  type AuditedEntryState,
  type GetTimeEntryAuditEventsResult,
  type TimeEntryRow,
  type TimeEntryStatus,
  toTimeEntries,
} from './types';
import { calculateWorkSessions, canViewEntries } from './helpers';
import { uuidSchema } from '@/lib/validation/uuid';
import { formatBerlinLocalDate, getLocalDayEnd, getLocalDayStart } from '@/lib/date-time/berlin';
import { getCanonicalTimeEntries } from './canonical-entries';
import { readWindowProjections } from './entry-window-projections';
import type { getProvisionalTimeCorrectionProjection } from '@/lib/time-corrections/actions';
import { loadApprovedCorrectionProjection } from '@/lib/time-corrections/approved-projection';
import { applyApprovedTimeCorrections } from '@/lib/time-corrections/projection';
import type { TimeCorrectionApplicationProjection } from '@/lib/time-corrections/types';
import { verifyCurrentMembership } from './action-access';
import { isManagerRole, type OrgRole } from '@/lib/roles';

// The Server Actions that read time entries: a window of the organization,
// one job and the jobs of one project.

type ProvisionalSource = Awaited<
  ReturnType<typeof getProvisionalTimeCorrectionProjection>
>['sources'][number];

/** Each official entry with the pending correction that would change it, when one exists. */
function markPendingCorrections(
  entries: readonly TimeEntry[],
  sources: readonly ProvisionalSource[],
): TimeEntry[] {
  const pendingByLegacyId = new Map(
    sources
      .filter((source) => source.sourceKind === 'legacy_entry')
      .map((source) => [source.sourceId, source]),
  );
  const pendingBySegmentId = new Map(
    sources
      .filter((source) => source.sourceKind === 'canonical_segment')
      .map((source) => [source.sourceId, source]),
  );
  const pendingByApplicationId = new Map(
    sources
      .filter((source) => source.sourceKind === 'correction_application')
      .map((source) => [source.sourceId, source]),
  );
  return entries.map((entry) => {
    const pending =
      pendingByLegacyId.get(entry.id) ??
      (entry.canonicalSegmentId ? pendingBySegmentId.get(entry.canonicalSegmentId) : undefined) ??
      (entry.correctionApplicationId ? pendingByApplicationId.get(entry.correctionApplicationId) : undefined);
    return pending
      ? {
          ...entry,
          pendingCorrectionRequestId: pending.requestId,
          pendingCorrectionKind: pending.kind,
        }
      : entry;
  });
}

/**
 * The window's entries the caller may see: legacy rows and canonical entries,
 * with approved corrections applied, filtered to the window, subject and
 * status, marked with their pending corrections and sorted by time.
 */
function visibleWindowEntries(input: {
  legacyRows: TimeEntryRow[];
  canonicalEntries: TimeEntry[];
  applications: readonly TimeCorrectionApplicationProjection[];
  pendingSources: readonly ProvisionalSource[];
  callerRole: OrgRole;
  callerId: string;
  organizationId: string;
  fromTimestamp: number;
  toTimestamp: number;
  userId: string | undefined;
  status: TimeEntryStatus | undefined;
}): TimeEntry[] {
  const { callerRole, callerId, fromTimestamp, toTimestamp, userId, status } = input;
  const visibleEntries = input.legacyRows.filter((entry) => canViewEntries(callerRole, entry.user_id, callerId));
  const visibleCanonicalEntries = input.canonicalEntries.filter((entry) =>
    canViewEntries(callerRole, entry.userId, callerId),
  );
  const projectedEntries = applyApprovedTimeCorrections(
    [...toTimeEntries(visibleEntries), ...visibleCanonicalEntries],
    input.applications,
    input.organizationId,
  ).filter((entry) => {
    const timestamp = Date.parse(entry.timestamp);
    return (
      canViewEntries(callerRole, entry.userId, callerId) &&
      timestamp >= fromTimestamp &&
      timestamp <= toTimestamp &&
      (!userId || entry.userId === userId) &&
      (!status || entry.status === status)
    );
  });
  const officialEntries = markPendingCorrections(projectedEntries, input.pendingSources);
  return officialEntries.sort(
    (left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime(),
  );
}

export async function getTimeEntries(rawParams: GetTimeEntriesParams): Promise<GetTimeEntriesResult> {
  try {
    const parsed = getTimeEntriesInputSchema.safeParse(rawParams);
    if (!parsed.success) return { success: false, error: 'invalid_input' };
    const user = await getAuthenticatedUser();
    if (!user) {
      return { success: false, error: 'not_authenticated' };
    }

    const { organizationId, from, to, userId, status } = parsed.data;
    const fromTimestamp = Date.parse(from);
    const toTimestamp = Date.parse(to);
    if (!Number.isFinite(fromTimestamp) || !Number.isFinite(toTimestamp) || fromTimestamp > toTimestamp) {
      return { success: false, error: 'invalid_input' };
    }
    const normalizedFrom = new Date(fromTimestamp).toISOString();
    const normalizedTo = new Date(toTimestamp).toISOString();

    const callerRole = await verifyCurrentMembership(organizationId);
    if (!callerRole) {
      return { success: false, error: 'not_a_member' };
    }

    const admin = createSupabaseAdminClient();

    if (userId && !canViewEntries(callerRole, userId, user.id)) {
      return { success: false, error: 'not_authorized' };
    }

    let query = admin
      .from('time_entries')
      .select('*')
      .eq('organization_id', organizationId)
      .gte('timestamp', normalizedFrom)
      .lte('timestamp', normalizedTo)
      .order('timestamp', { ascending: true })
      .order('created_at', { ascending: true })
      .order('id');

    const effectiveUserId = callerRole === 'employee' ? user.id : userId;
    if (effectiveUserId) query = query.eq('user_id', effectiveUserId);

    if (status) {
      query = query.eq('status', status);
    }

    // Every read below depends only on the authorized scope and date window.
    // Start legacy rows alongside projections, not one database roundtrip earlier.
    const [legacyResult, [canonicalResult, applications, provisionalProjection]] = await Promise.all([
      readCompleteRows((from, to) => query.range(from, to), LIST_ROW_CAP),
      readWindowProjections(admin, {
        organizationId,
        from: normalizedFrom,
        to: normalizedTo,
        status,
        subjectUserId: userId ?? (callerRole === 'employee' ? user.id : undefined),
        effectiveUserId,
      }),
    ]);
    if (legacyResult.error) {
      logError('Error fetching time entries:', legacyResult.error);
      return { success: false, error: 'fetch_failed' };
    }
    if (!canonicalResult.success) {
      return { success: false, error: 'fetch_failed' };
    }
    return {
      success: true,
      entries: visibleWindowEntries({
        legacyRows: legacyResult.data ?? [],
        canonicalEntries: canonicalResult.entries,
        applications,
        pendingSources: provisionalProjection.sources,
        callerRole,
        callerId: user.id,
        organizationId,
        fromTimestamp,
        toTimestamp,
        userId,
        status,
      }),
      provisionalEntries: provisionalProjection.entries,
    };
  } catch (error) {
    logReadFailure('Unexpected error in getTimeEntries:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

/** The names of the people with entries on a job, for a manager; null when the names could not be read. */
async function loadJobParticipants(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  isManager: boolean,
  entries: readonly TimeEntry[],
): Promise<JobTimeParticipant[] | null> {
  if (!isManager) return [];
  const participantUserIds = [...new Set(entries.map((entry) => entry.userId))];
  if (participantUserIds.length === 0) return [];

  const { data: participantProfiles, error: participantProfilesError } = await readInBatches(
    participantUserIds,
    (batch) =>
      admin
        .from('profiles')
        .select('id, first_name, last_name, email, avatar_path')
        .in('id', [...batch]),
  );

  if (participantProfilesError) {
    logError('Error fetching participant profiles for job time entries:', participantProfilesError);
    return null;
  }

  return participantProfiles.map((profile) => ({
    userId: profile.id,
    firstName: profile.first_name ?? null,
    lastName: profile.last_name ?? null,
    email: profile.email ?? null,
    avatarPath: profile.avatar_path ?? null,
  }));
}

/** The key of one person's local day in one organization. */
function userDayKey(entry: TimeEntry): string {
  return `${entry.userId}:${entry.organizationId}:${formatBerlinLocalDate(new Date(entry.timestamp))}`;
}

/**
 * The legacy sessions a job's clock-ins open, read with the whole local days
 * they sit in, merged by id with the job's canonical entries; null when the
 * day read fails.
 */
async function collectJobSessionEntries(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  job: { organizationId: string; jobId: string },
  targetClockIns: readonly TimeEntry[],
  canonicalEntries: readonly TimeEntry[],
): Promise<TimeEntry[] | null> {
  const userIds = [...new Set(targetClockIns.map((entry) => entry.userId))];
  const targetDayKeys = new Set(targetClockIns.map(userDayKey));
  const timestamps = targetClockIns.map((entry) => new Date(entry.timestamp).getTime());
  const rangeStart = getLocalDayStart(new Date(Math.min(...timestamps))).toISOString();
  const rangeEnd = getLocalDayEnd(new Date(Math.max(...timestamps))).toISOString();

  // Every clock-in above belongs to the job's organization. One user sits in
  // one batch, so each user's days keep their timestamp order.
  const { data, error } = await readInBatches(userIds, (batch) =>
    readCompleteRows(
      (from, to) =>
        admin
          .from('time_entries')
          .select('*')
          .in('user_id', [...batch])
          .eq('organization_id', job.organizationId)
          .gte('timestamp', rangeStart)
          .lte('timestamp', rangeEnd)
          .neq('status', 'rejected')
          .order('timestamp', { ascending: true })
          .order('created_at', { ascending: true })
          .order('id')
          .range(from, to),
      LIST_ROW_CAP,
    ),
  );

  if (error) {
    logError('Error fetching session-aware time entries for job:', error);
    return null;
  }

  const relevantEntries = toTimeEntries(data || []).filter((entry) => targetDayKeys.has(userDayKey(entry)));
  const entriesByUserDay = new Map<string, TimeEntry[]>();

  for (const entry of relevantEntries) {
    const key = userDayKey(entry);
    const existing = entriesByUserDay.get(key);
    if (existing) {
      existing.push(entry);
    } else {
      entriesByUserDay.set(key, [entry]);
    }
  }

  const dedupedEntries = new Map<string, TimeEntry>();

  for (const entry of canonicalEntries) {
    dedupedEntries.set(entry.id, entry);
  }

  for (const entriesForDay of entriesByUserDay.values()) {
    const sessions = calculateWorkSessions(entriesForDay).filter(
      (session) => session.clockIn?.jobId === job.jobId,
    );

    for (const session of sessions) {
      if (session.clockIn) {
        dedupedEntries.set(session.clockIn.id, session.clockIn);
      }
      if (session.clockOut) {
        dedupedEntries.set(session.clockOut.id, session.clockOut);
      }
    }
  }
  return [...dedupedEntries.values()];
}

/**
 * The corrected time entries of one job the caller may see; null when a read
 * fails. The caller authorized the job and loaded the
 * approved corrections once for its whole request.
 */
async function readJobTimeEntries(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  scope: {
    organizationId: string;
    jobId: string;
    userId: string;
    isManager: boolean;
    projectionTime: string;
    correctionApplications: readonly TimeCorrectionApplicationProjection[];
  },
): Promise<TimeEntry[] | null> {
  const { organizationId, jobId, userId, isManager, projectionTime } = scope;
  const canonicalResult = await getCanonicalTimeEntries({
    organizationId,
    from: '1970-01-01T00:00:00.000Z',
    to: projectionTime,
    userId: isManager ? undefined : userId,
    jobId,
    referenceTime: projectionTime,
  });
  if (!canonicalResult.success) return null;
  const canonicalEntries = canonicalResult.entries;
  const projectJobEntries = (entries: readonly TimeEntry[]): TimeEntry[] =>
    applyApprovedTimeCorrections(entries, scope.correctionApplications, organizationId).filter(
      (entry) => entry.jobId === jobId && (isManager || entry.userId === userId),
    );
  let jobClockInsQuery = admin
    .from('time_entries')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('entry_type', 'clock_in')
    .eq('job_id', jobId)
    .neq('status', 'rejected');

  if (!isManager) {
    jobClockInsQuery = jobClockInsQuery.eq('user_id', userId);
  }

  const orderedJobClockIns = jobClockInsQuery.order('timestamp', { ascending: true }).order('id');
  const { data: jobClockIns, error: jobClockInsError } = await readCompleteRows(
    (from, to) => orderedJobClockIns.range(from, to),
    LIST_ROW_CAP,
  );

  if (jobClockInsError) {
    logError('Error fetching clock-ins for job:', jobClockInsError);
    return null;
  }

  const targetClockIns = toTimeEntries(jobClockIns || []);
  if (targetClockIns.length === 0) return projectJobEntries(canonicalEntries);

  const sessionEntries = await collectJobSessionEntries(
    admin,
    { organizationId, jobId },
    targetClockIns,
    canonicalEntries,
  );
  if (!sessionEntries) return null;

  return projectJobEntries(sessionEntries).sort((a, b) => {
    const timestampDiff = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
    if (timestampDiff !== 0) return timestampDiff;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });
}

/**
 * Get all time entries linked to a specific job.
 */
export async function getTimeEntriesForJob(rawJobId: string): Promise<GetTimeEntriesResult> {
  try {
    const parsed = uuidSchema.safeParse(rawJobId);
    if (!parsed.success) return { success: false, error: 'invalid_input' };
    const jobId = parsed.data;
    const user = await getAuthenticatedUser();
    if (!user) {
      return { success: false, error: 'not_authenticated' };
    }

    const admin = createSupabaseAdminClient();
    // tenant-scope: by-id-then-verified — the caller's membership in the job's organization is verified next, and every later read filters by it.
    const { data: job, error: jobError } = await admin
      .from('jobs')
      .select('id, organization_id')
      .eq('id', jobId)
      .single();

    if (jobError || !job) {
      logReadErrors('getTimeEntriesForJob: read failed', jobError);
      return { success: false, error: 'fetch_failed' };
    }

    const callerRole = await verifyCurrentMembership(job.organization_id);
    if (!callerRole) {
      return { success: false, error: 'not_a_member' };
    }

    if (callerRole !== 'admin' && callerRole !== 'buero') {
      const { data: assignment, error: assignmentError } = await readJobAssignmentOfUser(
        job.organization_id,
        jobId,
        user.id,
      );
      if (assignmentError) return { success: false, error: 'fetch_failed' };

      if (!assignment) {
        return { success: false, error: 'not_authorized' };
      }
    }

    const isManager = callerRole === 'admin' || callerRole === 'buero';
    const projectionTime = new Date().toISOString();
    const correctionApplications = await loadApprovedCorrectionProjection(admin, {
      organizationId: job.organization_id,
      from: '1970-01-01T00:00:00.000Z',
      to: projectionTime,
      ...(!isManager ? { userIds: [user.id] } : {}),
    });
    const entries = await readJobTimeEntries(admin, {
      organizationId: job.organization_id,
      jobId,
      userId: user.id,
      isManager,
      projectionTime,
      correctionApplications,
    });
    if (!entries) return { success: false, error: 'fetch_failed' };
    const participants = await loadJobParticipants(admin, isManager, entries);
    if (!participants) return { success: false, error: 'fetch_failed' };
    return { success: true, entries, participants };
  } catch (error) {
    logError('Unexpected error in getTimeEntriesForJob:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

/**
 * The corrected time entries of each authorized job of one project, with the
 * approved corrections read once for all of them; null when a read fails.
 */
async function readProjectJobTimeEntries(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  scope: { organizationId: string; jobIds: readonly string[]; userId: string; isManager: boolean },
): Promise<Array<{ jobId: string; entries: TimeEntry[] }> | null> {
  if (scope.jobIds.length === 0) return [];
  const projectionTime = new Date().toISOString();
  const correctionApplications = await loadApprovedCorrectionProjection(admin, {
    organizationId: scope.organizationId,
    from: '1970-01-01T00:00:00.000Z',
    to: projectionTime,
    ...(!scope.isManager ? { userIds: [scope.userId] } : {}),
  });
  const jobs: Array<{ jobId: string; entries: TimeEntry[] | null }> = [];
  const jobReadConcurrency = 4;
  for (let offset = 0; offset < scope.jobIds.length; offset += jobReadConcurrency) {
    const batch = scope.jobIds.slice(offset, offset + jobReadConcurrency);
    jobs.push(
      ...(await Promise.all(
        batch.map(async (jobId) => ({
          jobId,
          entries: await readJobTimeEntries(admin, {
            organizationId: scope.organizationId,
            jobId,
            userId: scope.userId,
            isManager: scope.isManager,
            projectionTime,
            correctionApplications,
          }),
        })),
      )),
    );
  }
  const readJobs = jobs.flatMap(({ jobId, entries }) => (entries ? [{ jobId, entries }] : []));
  return readJobs.length === jobs.length ? readJobs : null;
}

export async function getTimeEntriesForProjectJobs(
  rawProjectId: string,
): Promise<{ success: true; jobs: Array<{ jobId: string; entries: TimeEntry[] }> } | ActionFailure> {
  try {
    const parsed = uuidSchema.safeParse(rawProjectId);
    if (!parsed.success) return { success: false, error: 'invalid_input' };
    const user = await getAuthenticatedUser();
    if (!user) return { success: false, error: 'not_authenticated' };

    const admin = createSupabaseAdminClient();
    // tenant-scope: by-id-then-verified — the caller's membership in the project's organization is verified next, and every later read filters by it.
    const { data: project, error: projectError } = await admin
      .from('projects')
      .select('id, organization_id')
      .eq('id', parsed.data)
      .maybeSingle();
    if (projectError || !project) {
      logReadErrors('getTimeEntriesForProjectJobs: read failed', projectError);
      return { success: false, error: 'fetch_failed' };
    }

    const callerRole = await verifyCurrentMembership(project.organization_id);
    if (!callerRole) return { success: false, error: 'not_a_member' };

    const { data: projectJobs, error: jobsError } = await admin
      .from('jobs')
      .select('id')
      .eq('organization_id', project.organization_id)
      .eq('project_id', project.id);
    if (jobsError) {
      logReadErrors('getTimeEntriesForProjectJobs: read failed', jobsError);
      return { success: false, error: 'fetch_failed' };
    }

    let visibleJobIds = (projectJobs ?? []).map((job) => job.id);
    if (callerRole === 'employee' && visibleJobIds.length > 0) {
      const { data: assignments, error: assignmentsError } = await readInBatches(visibleJobIds, (batch) =>
        admin
          .from('job_assignments')
          .select('job_id')
          .eq('organization_id', project.organization_id)
          .eq('user_id', user.id)
          .in('job_id', [...batch]),
      );
      if (assignmentsError) {
        logReadErrors('getTimeEntriesForProjectJobs: read failed', assignmentsError);
        return { success: false, error: 'fetch_failed' };
      }
      visibleJobIds = assignments.map((assignment) => assignment.job_id);
    }

    const jobs = await readProjectJobTimeEntries(admin, {
      organizationId: project.organization_id,
      jobIds: visibleJobIds,
      userId: user.id,
      isManager: callerRole === 'admin' || callerRole === 'buero',
    });
    if (!jobs) return { success: false, error: 'fetch_failed' };
    return { success: true, jobs };
  } catch (error) {
    logError('Unexpected error in getTimeEntriesForProjectJobs:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

function toAuditedEntryState(state: {
  entry_type: AuditedEntryState['entryType'];
  timestamp: string;
  job_id: string | null;
  status: AuditedEntryState['status'];
}): AuditedEntryState {
  return {
    entryType: state.entry_type,
    timestamp: state.timestamp,
    jobId: state.job_id,
    status: state.status,
  };
}

/**
 * The audit events of Admins' own direct edits and deletions whose entry was
 * recorded inside the window, newest first; optionally of one Admin. Admin
 * and Büro read them, as they read every entry of the organization.
 */
export async function getTimeEntryAuditEvents(rawParams: {
  organizationId: string;
  from: string;
  to: string;
  userId?: string;
}): Promise<GetTimeEntryAuditEventsResult> {
  try {
    const parsed = timeEntryAuditInputSchema.safeParse(rawParams);
    if (!parsed.success) return { success: false, error: 'invalid_input' };
    const user = await getAuthenticatedUser();
    if (!user) return { success: false, error: 'not_authenticated' };
    const { organizationId, from, to, userId } = parsed.data;
    const fromTimestamp = Date.parse(from);
    const toTimestamp = Date.parse(to);
    if (!Number.isFinite(fromTimestamp) || !Number.isFinite(toTimestamp) || fromTimestamp > toTimestamp) {
      return { success: false, error: 'invalid_input' };
    }

    const callerRole = await verifyCurrentMembership(organizationId);
    if (!callerRole) return { success: false, error: 'not_a_member' };
    if (!isManagerRole(callerRole)) return { success: false, error: 'not_authorized' };

    const admin = createSupabaseAdminClient();
    let query = admin
      .from('time_entry_audit_events')
      .select('id, entry_id, actor_id, action, created_at, before_entry, after_entry')
      .eq('organization_id', organizationId)
      .gte('entry_timestamp', new Date(fromTimestamp).toISOString())
      .lte('entry_timestamp', new Date(toTimestamp).toISOString())
      .order('created_at', { ascending: false })
      .order('id');
    if (userId) query = query.eq('actor_id', userId);
    const { data, error } = await readCompleteRows(
      (rangeFrom, rangeTo) => query.range(rangeFrom, rangeTo),
      LIST_ROW_CAP,
    );
    if (error) {
      logReadFailure('getTimeEntryAuditEvents: audit events read failed', error);
      return { success: false, error: 'fetch_failed' };
    }
    const rows = timeEntryAuditRowSchema.array().safeParse(data);
    if (!rows.success) {
      logReadFailure('getTimeEntryAuditEvents: malformed audit event', { code: 'malformed_row' });
      return { success: false, error: 'fetch_failed' };
    }
    return {
      success: true,
      events: rows.data.map((row) => ({
        id: row.id,
        entryId: row.entry_id,
        actorId: row.actor_id,
        action: row.action,
        createdAt: row.created_at,
        before: toAuditedEntryState(row.before_entry),
        after: row.after_entry ? toAuditedEntryState(row.after_entry) : null,
      })),
    };
  } catch (error) {
    logError('Unexpected error in getTimeEntryAuditEvents:', error);
    return { success: false, error: 'unexpected_error' };
  }
}
