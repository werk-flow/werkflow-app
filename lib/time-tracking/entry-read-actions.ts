'use server';
import type { ActionFailure } from '@/lib/action-result';
import { logReadFailure, loggedRead, logReadErrors } from '@/lib/data/read-request-cache';
import { logError } from '@/lib/logging';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { readCompleteRows, readInBatches, LIST_ROW_CAP } from '@/lib/supabase/query-batches';
import { getAuthenticatedUser } from '@/lib/data/cached';
import { getTimeEntriesInputSchema } from './action-schemas';
import {
  type TimeEntry,
  type JobTimeParticipant,
  type GetTimeEntriesParams,
  type GetTimeEntriesResult,
  toTimeEntries,
} from './types';
import { calculateWorkSessions, canViewEntries } from './helpers';
import { uuidSchema } from '@/lib/validation/uuid';
import { formatBerlinLocalDate, getLocalDayEnd, getLocalDayStart } from '@/lib/date-time/berlin';
import { getCanonicalTimeEntries } from './canonical-entries';
import { getProvisionalTimeCorrectionProjection } from '@/lib/time-corrections/actions';
import { loadApprovedCorrectionProjection } from '@/lib/time-corrections/approved-projection';
import { applyApprovedTimeCorrections } from '@/lib/time-corrections/projection';
import { verifyCurrentMembership } from './action-access';

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
    const [legacyResult, canonicalResult, applications, provisionalProjection] = await Promise.all([
      readCompleteRows((from, to) => query.range(from, to), LIST_ROW_CAP),
      status && status !== 'approved'
        ? Promise.resolve({ success: true as const, entries: [] })
        : getCanonicalTimeEntries({
            organizationId,
            from: normalizedFrom,
            to: normalizedTo,
            userId: userId ?? (callerRole === 'employee' ? user.id : undefined),
          }),
      status && status !== 'approved'
        ? Promise.resolve([])
        : loadApprovedCorrectionProjection(admin, {
            organizationId,
            from: normalizedFrom,
            to: normalizedTo,
            ...(effectiveUserId ? { userIds: [effectiveUserId] } : {}),
          }),
      status
        ? Promise.resolve({ entries: [], sources: [] })
        : getProvisionalTimeCorrectionProjection({
            organizationId,
            from: normalizedFrom,
            to: normalizedTo,
            userId: userId ?? (callerRole === 'employee' ? user.id : undefined),
          }),
    ]);
    if (legacyResult.error) {
      logError('Error fetching time entries:', legacyResult.error);
      return { success: false, error: 'fetch_failed' };
    }
    const visibleEntries = (legacyResult.data ?? []).filter((entry) =>
      canViewEntries(callerRole, entry.user_id, user.id),
    );
    if (!canonicalResult.success) {
      return { success: false, error: 'fetch_failed' };
    }
    const canonicalEntries = canonicalResult.entries;
    const visibleCanonicalEntries = canonicalEntries.filter((entry) =>
      canViewEntries(callerRole, entry.userId, user.id),
    );
    const projectedEntries = applyApprovedTimeCorrections(
      [...toTimeEntries(visibleEntries), ...visibleCanonicalEntries],
      applications,
      organizationId,
    ).filter((entry) => {
      const timestamp = Date.parse(entry.timestamp);
      return (
        canViewEntries(callerRole, entry.userId, user.id) &&
        timestamp >= fromTimestamp &&
        timestamp <= toTimestamp &&
        (!userId || entry.userId === userId) &&
        (!status || entry.status === status)
      );
    });
    const officialEntries = markPendingCorrections(projectedEntries, provisionalProjection.sources);
    return {
      success: true,
      entries: officialEntries.sort(
        (left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime(),
      ),
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
      const { data: assignment, error: assignmentError } = await loggedRead(
        'getTimeEntriesForJob: job_assignments read failed',
        admin
          .from('job_assignments')
          .select('id')
          .eq('organization_id', job.organization_id)
          .eq('job_id', jobId)
          .eq('user_id', user.id)
          .maybeSingle(),
      );
      if (assignmentError) return { success: false, error: 'fetch_failed' };

      if (!assignment) {
        return { success: false, error: 'not_authorized' };
      }
    }

    const isManager = callerRole === 'admin' || callerRole === 'buero';
    const projectionTime = new Date().toISOString();
    const canonicalResult = await getCanonicalTimeEntries({
      organizationId: job.organization_id,
      from: '1970-01-01T00:00:00.000Z',
      to: projectionTime,
      userId: isManager ? undefined : user.id,
      jobId,
      referenceTime: projectionTime,
    });
    if (!canonicalResult.success) {
      return { success: false, error: 'fetch_failed' };
    }
    const canonicalEntries = canonicalResult.entries;
    const correctionApplications = await loadApprovedCorrectionProjection(admin, {
      organizationId: job.organization_id,
      from: '1970-01-01T00:00:00.000Z',
      to: projectionTime,
      ...(!isManager ? { userIds: [user.id] } : {}),
    });
    const projectJobEntries = (entries: readonly TimeEntry[]): TimeEntry[] =>
      applyApprovedTimeCorrections(entries, correctionApplications, job.organization_id).filter(
        (entry) => entry.jobId === jobId && (isManager || entry.userId === user.id),
      );
    let jobClockInsQuery = admin
      .from('time_entries')
      .select('*')
      .eq('organization_id', job.organization_id)
      .eq('entry_type', 'clock_in')
      .eq('job_id', jobId)
      .neq('status', 'rejected');

    if (!isManager) {
      jobClockInsQuery = jobClockInsQuery.eq('user_id', user.id);
    }

    const orderedJobClockIns = jobClockInsQuery.order('timestamp', { ascending: true }).order('id');
    const { data: jobClockIns, error: jobClockInsError } = await readCompleteRows(
      (from, to) => orderedJobClockIns.range(from, to),
      LIST_ROW_CAP,
    );

    if (jobClockInsError) {
      logError('Error fetching clock-ins for job:', jobClockInsError);
      return { success: false, error: 'fetch_failed' };
    }

    const targetClockIns = toTimeEntries(jobClockIns || []);
    if (targetClockIns.length === 0) {
      const correctedCanonicalEntries = projectJobEntries(canonicalEntries);
      const canonicalParticipants = await loadJobParticipants(admin, isManager, correctedCanonicalEntries);
      if (!canonicalParticipants) return { success: false, error: 'fetch_failed' };
      return { success: true, entries: correctedCanonicalEntries, participants: canonicalParticipants };
    }

    const sessionEntries = await collectJobSessionEntries(
      admin,
      { organizationId: job.organization_id, jobId },
      targetClockIns,
      canonicalEntries,
    );
    if (!sessionEntries) return { success: false, error: 'fetch_failed' };

    const correctedEntries = projectJobEntries(sessionEntries);
    const participants = await loadJobParticipants(admin, isManager, correctedEntries);
    if (!participants) return { success: false, error: 'fetch_failed' };

    return {
      success: true,
      entries: correctedEntries.sort((a, b) => {
        const timestampDiff = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
        if (timestampDiff !== 0) return timestampDiff;
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      }),
      participants,
    };
  } catch (error) {
    logError('Unexpected error in getTimeEntriesForJob:', error);
    return { success: false, error: 'unexpected_error' };
  }
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

    const results: Array<{
      jobId: string;
      result: Awaited<ReturnType<typeof getTimeEntriesForJob>>;
    }> = [];
    const jobReadConcurrency = 4;
    for (let offset = 0; offset < visibleJobIds.length; offset += jobReadConcurrency) {
      const batch = visibleJobIds.slice(offset, offset + jobReadConcurrency);
      results.push(
        ...(await Promise.all(
          batch.map(async (jobId) => ({
            jobId,
            result: await getTimeEntriesForJob(jobId),
          })),
        )),
      );
    }
    const failedResult = results.find(({ result }) => !result.success);
    if (failedResult && !failedResult.result.success) {
      return { success: false, error: failedResult.result.error };
    }
    return {
      success: true,
      jobs: results.map(({ jobId, result }) => ({
        jobId,
        entries: result.success ? result.entries : [],
      })),
    };
  } catch (error) {
    logError('Unexpected error in getTimeEntriesForProjectJobs:', error);
    return { success: false, error: 'unexpected_error' };
  }
}
