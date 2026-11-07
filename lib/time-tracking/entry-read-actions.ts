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
  type WorkSession,
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
  const visibleEntries = input.legacyRows.filter((entry) =>
    canViewEntries(callerRole, entry.user_id, callerId),
  );
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

/** What one job's time read needs: the caller and the approved corrections the caller loaded once. */
type JobReadScope = {
  organizationId: string;
  userId: string;
  isManager: boolean;
  projectionTime: string;
  correctionApplications: readonly TimeCorrectionApplicationProjection[];
};

/** One job's canonical entries and the legacy clock-ins that open its sessions. */
type JobSources = { jobId: string; canonicalEntries: TimeEntry[]; clockIns: TimeEntry[] };

/** Runs `read` over the items, at most four at a time, in item order. */
async function mapInWindows<Item, Result>(
  items: readonly Item[],
  read: (item: Item) => Promise<Result>,
): Promise<Result[]> {
  const windowSize = 4;
  const results: Result[] = [];
  for (let offset = 0; offset < items.length; offset += windowSize) {
    results.push(...(await Promise.all(items.slice(offset, offset + windowSize).map(read))));
  }
  return results;
}

/** The canonical entries and legacy clock-ins of one job the caller may see; null when a read fails. */
async function readJobSources(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  scope: JobReadScope,
  jobId: string,
): Promise<JobSources | null> {
  const { organizationId, userId, isManager, projectionTime } = scope;
  const canonicalResult = await getCanonicalTimeEntries({
    organizationId,
    from: '1970-01-01T00:00:00.000Z',
    to: projectionTime,
    userId: isManager ? undefined : userId,
    jobId,
    referenceTime: projectionTime,
  });
  if (!canonicalResult.success) return null;
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
  return { jobId, canonicalEntries: canonicalResult.entries, clockIns: toTimeEntries(jobClockIns || []) };
}

/**
 * The whole local days each job's clock-ins span, merged where they overlap,
 * each with the people whose days it reads.
 */
function clockInDaySpans(
  jobs: readonly JobSources[],
): Array<{ start: number; end: number; userIds: Set<string> }> {
  const spans = jobs
    .filter((job) => job.clockIns.length > 0)
    .map((job) => {
      const timestamps = job.clockIns.map((entry) => new Date(entry.timestamp).getTime());
      return {
        start: getLocalDayStart(new Date(Math.min(...timestamps))).getTime(),
        end: getLocalDayEnd(new Date(Math.max(...timestamps))).getTime(),
        userIds: new Set(job.clockIns.map((entry) => entry.userId)),
      };
    })
    .sort((left, right) => left.start - right.start);
  const merged: typeof spans = [];
  for (const span of spans) {
    const last = merged.at(-1);
    if (last && span.start <= last.end) {
      last.end = Math.max(last.end, span.end);
      for (const userId of span.userIds) last.userIds.add(userId);
    } else {
      merged.push(span);
    }
  }
  return merged;
}

/**
 * The legacy entries of every local day a clock-in of the jobs sits in,
 * grouped by person and day. Each day is read once for all the jobs, not once
 * per job; null when a read fails.
 */
async function readClockInDays(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  organizationId: string,
  jobs: readonly JobSources[],
): Promise<Map<string, TimeEntry[]> | null> {
  const targetDayKeys = new Set(jobs.flatMap((job) => job.clockIns.map(userDayKey)));
  // Every clock-in above belongs to the organization. One user sits in one
  // batch of a span, and spans hold whole days, so each user's day keeps its
  // timestamp order.
  const results = await mapInWindows(clockInDaySpans(jobs), (span) =>
    readInBatches([...span.userIds], (batch) =>
      readCompleteRows(
        (from, to) =>
          admin
            .from('time_entries')
            .select('*')
            .in('user_id', [...batch])
            .eq('organization_id', organizationId)
            .gte('timestamp', new Date(span.start).toISOString())
            .lte('timestamp', new Date(span.end).toISOString())
            .neq('status', 'rejected')
            .order('timestamp', { ascending: true })
            .order('created_at', { ascending: true })
            .order('id')
            .range(from, to),
        LIST_ROW_CAP,
      ),
    ),
  );
  const failed = results.find((result) => result.error);
  if (failed?.error) {
    logError('Error fetching session-aware time entries for job:', failed.error);
    return null;
  }

  const entriesByUserDay = new Map<string, TimeEntry[]>();
  for (const entry of toTimeEntries(results.flatMap((result) => result.data))) {
    const key = userDayKey(entry);
    if (!targetDayKeys.has(key)) continue;
    const existing = entriesByUserDay.get(key);
    if (existing) {
      existing.push(entry);
    } else {
      entriesByUserDay.set(key, [entry]);
    }
  }
  return entriesByUserDay;
}

/**
 * One job's corrected entries the caller may see: its canonical entries and
 * the legacy sessions its own clock-ins open on their days.
 */
function jobTimeEntries(
  scope: JobReadScope,
  job: JobSources,
  sessionsByUserDay: ReadonlyMap<string, WorkSession[]>,
): TimeEntry[] {
  const projectJobEntries = (entries: readonly TimeEntry[]): TimeEntry[] =>
    applyApprovedTimeCorrections(entries, scope.correctionApplications, scope.organizationId).filter(
      (entry) => entry.jobId === job.jobId && (scope.isManager || entry.userId === scope.userId),
    );
  if (job.clockIns.length === 0) return projectJobEntries(job.canonicalEntries);

  const jobDayKeys = new Set(job.clockIns.map(userDayKey));
  const dedupedEntries = new Map(job.canonicalEntries.map((entry) => [entry.id, entry]));
  for (const [dayKey, sessions] of sessionsByUserDay) {
    if (!jobDayKeys.has(dayKey)) continue;
    for (const { clockIn, clockOut } of sessions) {
      if (clockIn?.jobId !== job.jobId) continue;
      dedupedEntries.set(clockIn.id, clockIn);
      if (clockOut) dedupedEntries.set(clockOut.id, clockOut);
    }
  }

  return projectJobEntries([...dedupedEntries.values()]).sort((a, b) => {
    const timestampDiff = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
    if (timestampDiff !== 0) return timestampDiff;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });
}

/**
 * The corrected time entries of each job the caller may see, in job order;
 * null when a read fails. The caller authorized the jobs and loaded the
 * approved corrections once for its whole request; the jobs' days are read
 * once for all of them.
 */
async function readJobsTimeEntries(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  scope: JobReadScope,
  jobIds: readonly string[],
): Promise<Array<{ jobId: string; entries: TimeEntry[] }> | null> {
  const sources = await mapInWindows(jobIds, (jobId) => readJobSources(admin, scope, jobId));
  const jobs = sources.flatMap((source) => (source ? [source] : []));
  if (jobs.length !== sources.length) return null;
  const entriesByUserDay = await readClockInDays(admin, scope.organizationId, jobs);
  if (!entriesByUserDay) return null;
  const sessionsByUserDay = new Map(
    [...entriesByUserDay].map(([dayKey, entries]) => [dayKey, calculateWorkSessions(entries)]),
  );
  return jobs.map((job) => ({ jobId: job.jobId, entries: jobTimeEntries(scope, job, sessionsByUserDay) }));
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
    const jobs = await readJobsTimeEntries(
      admin,
      {
        organizationId: job.organization_id,
        userId: user.id,
        isManager,
        projectionTime,
        correctionApplications,
      },
      [jobId],
    );
    const entries = jobs?.[0]?.entries;
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
 * approved corrections and the days read once for all of them; null when a
 * read fails.
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
  return readJobsTimeEntries(
    admin,
    {
      organizationId: scope.organizationId,
      userId: scope.userId,
      isManager: scope.isManager,
      projectionTime,
      correctionApplications,
    },
    scope.jobIds,
  );
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
