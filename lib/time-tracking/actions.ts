'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { resolveActiveOrgId } from '@/lib/org/cookies';
import {
  getAuthenticatedUser,
  getCachedMemberships,
  getCachedOrganizationSettings,
} from '@/lib/data/cached';
import {
  type TimeEntry,
  type TimeEntryRow,
  type TimeEntryType,
  type TimeEntryInsert,
  type JobTimeParticipant,
  type OrgRole,
  type ClockResult,
  type LiveClockState,
  type AddManualEntryParams,
  type AddManualEntryResult,
  type ReviewEntryResult,
  type UpdateEntryResult,
  type DeleteEntryResult,
  type GetTimeEntriesParams,
  type GetTimeEntriesResult,
  type GetPendingEntriesResult,
  type GetPendingSessionsResult,
  type GetCurrentlyClockedInResult,
  type PendingSession,
  type ChangeRequest,
  type ChangeRequestWithDetails,
  type RequestChangeResult,
  type ReviewChangeRequestResult,
  type GetChangeRequestsResult,
  toTimeEntry,
  toTimeEntries,
  toChangeRequest,
  MANAGED_ROLES
} from './types';
import {
  buildClockTimelineSegments,
  calculateBreakMinutes,
  hasOpenSession,
  deriveCurrentClockState,
  calculateTotalMinutes,
  calculateBreakSessions,
  calculateWorkSessions,
  determineApprovalStatus,
  canManageEntries,
  canApproveEntries,
  canViewEntries,
  canAddEntriesFor,
  needsChangeRequest
} from './helpers';
import {
  getLocalDayEnd,
  getLocalDayKey,
  getLocalDayStart,
  isSameLocalDay
} from './day-utils';
import {
  validateManualEntries,
  validateManualEntryJobOwnership,
  validateTimestampUpdate,
  validateDayEntrySequence
} from './validation';
import { getEffectiveTimeEntries } from './effective-entries';
import { computeBreakdownForSettings } from './settings';
import { getJobDisplayTitle } from '@/lib/jobs/types';

function isWorkingEntryType(entryType: string): boolean {
  return entryType === 'clock_in' || entryType === 'break_end';
}

function isAttendanceOpenEntryType(entryType: string): boolean {
  return entryType !== 'clock_out';
}

function getJobIdBeforeCurrentBreak(entries: TimeEntry[]): string | null {
  const effectiveEntries = getEffectiveTimeEntries(entries);
  let activeJobId: string | null = null;
  let jobIdBeforeCurrentBreak: string | null = null;

  for (const entry of effectiveEntries) {
    switch (entry.entryType) {
      case 'clock_in':
      case 'break_end':
        activeJobId = entry.jobId ?? null;
        break;
      case 'break_start':
        jobIdBeforeCurrentBreak = activeJobId;
        activeJobId = null;
        break;
      case 'clock_out':
        activeJobId = null;
        jobIdBeforeCurrentBreak = null;
        break;
    }
  }

  return jobIdBeforeCurrentBreak;
}

/**
 * Get the current organization ID from cookies (with membership fallback).
 */
async function getCurrentOrgId(userId: string): Promise<string | null> {
  const cookieStore = await cookies();
  return resolveActiveOrgId(cookieStore, userId);
}

/**
 * Get user's entries for the current organization
 */
async function getUserEntries(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  userId: string,
  orgId: string
): Promise<TimeEntryRow[]> {
  await closeStaleOpenSessionsForUser(admin, userId, orgId);

  const { data, error } = await admin
    .from('time_entries')
    .select('*')
    .eq('user_id', userId)
    .eq('organization_id', orgId)
    .order('timestamp', { ascending: false });

  if (error) {
    console.error('Error fetching user entries:', error);
    return [];
  }

  return data || [];
}

/**
 * Get entries for a specific local day for the user in an org.
 */
async function getUserEntriesForDay(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  userId: string,
  orgId: string,
  date: Date
): Promise<TimeEntryRow[]> {
  await closeStaleOpenSessionsForUser(admin, userId, orgId, date);
  const { start, end } = getDayBounds(date);

  const { data, error } = await admin
    .from('time_entries')
    .select('*')
    .eq('user_id', userId)
    .eq('organization_id', orgId)
    .gte('timestamp', start.toISOString())
    .lte('timestamp', end.toISOString())
    .neq('status', 'rejected')
    .neq('status', 'pending_delete')
    .order('timestamp', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching user day entries:', error);
    return [];
  }

  return data || [];
}

/**
 * Get only today's entries for the user in an org.
 * Much faster than getUserEntries for clock status checks.
 */
async function getUserTodayEntries(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  userId: string,
  orgId: string
): Promise<TimeEntryRow[]> {
  return getUserEntriesForDay(admin, userId, orgId, new Date());
}

/**
 * Verify user is a member of the org using cached memberships.
 * Falls back to a direct DB query if cache is empty.
 */
async function verifyMembershipFromCache(
  userId: string,
  orgId: string
): Promise<OrgRole | null> {
  const memberships = await getCachedMemberships(userId);
  const membership = memberships.find((m) => m.orgId === orgId);
  return (membership?.role as OrgRole) ?? null;
}

async function getClockJobInfo(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  jobId: string,
  options?: { includeRelations?: boolean; touchStatus?: boolean }
): Promise<import('./types').ClockJobInfo | null> {
  const includeRelations = options?.includeRelations ?? true;
  const touchStatus = options?.touchStatus ?? false;

  const { data: job } = await admin
    .from('jobs')
    .select('id, title, description, job_number, status, project_id, client_id')
    .eq('id', jobId)
    .single();

  if (!job) {
    return null;
  }

  if (touchStatus && job.status === 'nicht_bearbeitet') {
    await admin
      .from('jobs')
      .update({ status: 'in_bearbeitung' })
      .eq('id', jobId);
  }

  if (!includeRelations) {
    return {
      id: job.id,
      title: getJobDisplayTitle({
        title: job.title,
        description: job.description
      }),
      jobNumber: job.job_number,
      status: job.status === 'nicht_bearbeitet' ? 'in_bearbeitung' : job.status,
      projectName: null,
      clientName: null
    };
  }

  const [projectData, clientData] = await Promise.all([
    job.project_id
      ? admin.from('projects').select('name').eq('id', job.project_id).single()
      : Promise.resolve({ data: null }),
    job.client_id
      ? admin.from('clients').select('name').eq('id', job.client_id).single()
      : Promise.resolve({ data: null })
  ]);

  return {
    id: job.id,
    title: getJobDisplayTitle({
      title: job.title,
      description: job.description
    }),
    jobNumber: job.job_number,
    status: job.status === 'nicht_bearbeitet' ? 'in_bearbeitung' : job.status,
    projectName: (projectData.data as { name: string } | null)?.name ?? null,
    clientName: (clientData.data as { name: string } | null)?.name ?? null
  };
}

type TodayBounds = {
  start: Date;
  end: Date;
};

function getDayBounds(date: Date): TodayBounds {
  return {
    start: getLocalDayStart(date),
    end: getLocalDayEnd(date)
  };
}

function getTodayBounds(): TodayBounds {
  return getDayBounds(new Date());
}

function getManualEntryJobId(
  entryType: TimeEntry['entryType'],
  jobId?: string | null
): string | null {
  if (entryType !== 'clock_in') {
    return null;
  }

  return jobId ?? null;
}

function buildAutoCloseInsert(entry: TimeEntry): TimeEntryInsert {
  const dayStart = getLocalDayStart(new Date(entry.timestamp));
  const fivePmCutoff = new Date(dayStart.getTime() + 17 * 60 * 60 * 1000);
  const autoCloseAt =
    new Date(entry.timestamp).getTime() < fivePmCutoff.getTime()
      ? fivePmCutoff.toISOString()
      : getLocalDayEnd(new Date(entry.timestamp)).toISOString();

  return {
    user_id: entry.userId,
    organization_id: entry.organizationId,
    entry_type: 'clock_out',
    timestamp: autoCloseAt,
    is_manual: true,
    status: entry.status === 'pending' ? 'pending' : 'approved',
    reviewed_by: entry.status === 'approved' ? entry.reviewedBy : null,
    reviewed_at: entry.status === 'approved' ? entry.reviewedAt : null,
    job_id: null
  };
}

async function closeStaleOpenSessionsForUser(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  userId: string,
  orgId: string,
  referenceDate = new Date()
): Promise<void> {
  const effectiveReferenceDate =
    referenceDate.getTime() > Date.now() ? new Date() : referenceDate;
  const staleCutoff = getLocalDayStart(effectiveReferenceDate).toISOString();

  const { data, error } = await admin
    .from('time_entries')
    .select('*')
    .eq('user_id', userId)
    .eq('organization_id', orgId)
    .lt('timestamp', staleCutoff)
    .neq('status', 'rejected')
    .neq('status', 'pending_delete')
    .order('timestamp', { ascending: true })
    .order('created_at', { ascending: true });

  if (error || !data || data.length === 0) {
    if (error) {
      console.error('Error loading stale time entries:', error);
    }
    return;
  }

  const entries = toTimeEntries(data);
  const inserts: TimeEntryInsert[] = [];
  let attendanceAnchor: TimeEntry | null = null;
  let openWorkBlockStart: TimeEntry | null = null;
  let hasOpenAttendance = false;

  for (const entry of entries) {
    if (
      attendanceAnchor &&
      !isSameLocalDay(
        new Date(attendanceAnchor.timestamp),
        new Date(entry.timestamp)
      )
    ) {
      if (hasOpenAttendance) {
        inserts.push(buildAutoCloseInsert(openWorkBlockStart ?? attendanceAnchor));
      }
      attendanceAnchor = null;
      openWorkBlockStart = null;
      hasOpenAttendance = false;
    }

    if (entry.entryType === 'clock_in') {
      attendanceAnchor = entry;
      openWorkBlockStart = entry;
      hasOpenAttendance = true;
      continue;
    }

    if (entry.entryType === 'break_start') {
      hasOpenAttendance = attendanceAnchor !== null;
      continue;
    }

    if (entry.entryType === 'break_end') {
      hasOpenAttendance = attendanceAnchor !== null;
      if (attendanceAnchor) {
        openWorkBlockStart = entry;
      }
      continue;
    }

    if (entry.entryType === 'clock_out') {
      attendanceAnchor = null;
      openWorkBlockStart = null;
      hasOpenAttendance = false;
    }
  }

  if (attendanceAnchor && hasOpenAttendance) {
    inserts.push(buildAutoCloseInsert(openWorkBlockStart ?? attendanceAnchor));
  }

  if (inserts.length === 0) {
    return;
  }

  const autoCloseTimestamps = [
    ...new Set(inserts.map((entry) => entry.timestamp))
  ];
  const { data: existingClosures, error: existingError } = await admin
    .from('time_entries')
    .select('timestamp')
    .eq('user_id', userId)
    .eq('organization_id', orgId)
    .eq('entry_type', 'clock_out')
    .in('timestamp', autoCloseTimestamps);

  if (existingError) {
    console.error('Error checking existing auto-close entries:', existingError);
    return;
  }

  const existingTimestampSet = new Set(
    (existingClosures || []).map((entry) => entry.timestamp)
  );
  const missingInserts = inserts.filter(
    (entry) => !existingTimestampSet.has(entry.timestamp)
  );

  if (missingInserts.length === 0) {
    return;
  }

  const { error: insertError } = await admin
    .from('time_entries')
    .insert(missingInserts);

  if (insertError) {
    console.error('Error auto-closing stale sessions:', insertError);
  }
}

type OpenSessionOrg = { organizationId: string; organizationName: string };

async function getOpenSessionOrgsForUserOnDay(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  userId: string,
  referenceDate: Date
): Promise<OpenSessionOrg[]> {
  const { start, end } = getDayBounds(referenceDate);
  const effectiveEnd = new Date(
    Math.min(end.getTime(), Date.now())
  ).toISOString();

  const { data: rows, error } = await admin
    .from('time_entries')
    .select('organization_id, entry_type, timestamp, status')
    .eq('user_id', userId)
    .gte('timestamp', start.toISOString())
    .lte('timestamp', effectiveEnd)
    .neq('status', 'rejected')
    .neq('status', 'pending_delete')
    .order('timestamp', { ascending: false });

  if (error) {
    console.error('Error fetching user entries for open-session check:', error);
    return [];
  }

  const seenOrgs = new Set<string>();
  const openOrgIds: string[] = [];

  for (const row of rows || []) {
    const orgId = row.organization_id as string;
    if (!orgId || seenOrgs.has(orgId)) continue;
    seenOrgs.add(orgId);

    if (isAttendanceOpenEntryType(row.entry_type)) {
      openOrgIds.push(orgId);
    }
  }

  if (openOrgIds.length === 0) return [];

  const { data: orgs, error: orgErr } = await admin
    .from('organizations')
    .select('id, name')
    .in('id', openOrgIds);

  if (orgErr) {
    console.error('Error fetching org names for open-session check:', orgErr);
  }

  const nameById = new Map<string, string>();
  for (const o of orgs || []) {
    nameById.set(o.id, o.name);
  }

  return openOrgIds.map((id) => ({
    organizationId: id,
    organizationName: nameById.get(id) || 'Unbekannte Organisation'
  }));
}

async function getOpenSessionOrgsForUserToday(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  userId: string
): Promise<OpenSessionOrg[]> {
  return getOpenSessionOrgsForUserOnDay(admin, userId, new Date());
}

// ============================================
// Real-Time Clock In/Out Actions
// ============================================

/**
 * Clock in for the current user (real-time)
 */
export async function clockIn(
  organizationId?: string,
  jobId?: string | null
): Promise<ClockResult> {
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return { success: false, error: 'not_authenticated' };
    }

    const orgId = organizationId || (await getCurrentOrgId(user.id));
    if (!orgId) {
      return { success: false, error: 'no_active_org' };
    }

    const admin = createSupabaseAdminClient();

    // Run membership check, cross-org guard, and today's entries in parallel
    const [userRole, openOrgs, todayRows] = await Promise.all([
      verifyMembershipFromCache(user.id, orgId),
      getOpenSessionOrgsForUserToday(admin, user.id),
      getUserTodayEntries(admin, user.id, orgId)
    ]);

    if (!userRole) {
      return { success: false, error: 'not_a_member' };
    }

    const openOther = openOrgs.find((o) => o.organizationId !== orgId);
    if (openOther) {
      return {
        success: false,
        error: 'working_in_other_org',
        otherOrgId: openOther.organizationId,
        otherOrgName: openOther.organizationName
      };
    }

    const timeEntries = toTimeEntries(todayRows);
    const currentState = deriveCurrentClockState(timeEntries);
    if (currentState.isClockedIn) {
      return { success: false, error: 'already_clocked_in' };
    }

    const resolvedJobId = jobId || null;

    const { data: newEntry, error: insertError } = await admin
      .from('time_entries')
      .insert({
        user_id: user.id,
        organization_id: orgId,
        entry_type: 'clock_in',
        timestamp: new Date().toISOString(),
        is_manual: false,
        status: 'approved',
        job_id: resolvedJobId
      })
      .select()
      .single();

    if (insertError || !newEntry) {
      console.error('Error inserting clock_in:', insertError);
      return { success: false, error: 'insert_failed' };
    }

    let jobInfo: import('./types').ClockJobInfo | null = null;

    if (resolvedJobId) {
      jobInfo = await getClockJobInfo(admin, resolvedJobId, {
        includeRelations: false,
        touchStatus: true
      });
    }

    return { success: true, entry: toTimeEntry(newEntry), jobInfo };
  } catch (error) {
    console.error('Unexpected error in clockIn:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

/**
 * Clock out for the current user (real-time)
 */
export async function clockOut(organizationId?: string): Promise<ClockResult> {
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return { success: false, error: 'not_authenticated' };
    }

    const orgId = organizationId || (await getCurrentOrgId(user.id));
    if (!orgId) {
      return { success: false, error: 'no_active_org' };
    }

    const admin = createSupabaseAdminClient();

    // Run membership check and today's entries in parallel
    const [userRole, todayRows] = await Promise.all([
      verifyMembershipFromCache(user.id, orgId),
      getUserTodayEntries(admin, user.id, orgId)
    ]);

    if (!userRole) {
      return { success: false, error: 'not_a_member' };
    }

    const timeEntries = toTimeEntries(todayRows);
    const currentState = deriveCurrentClockState(timeEntries);
    if (!currentState.isClockedIn) {
      return { success: false, error: 'not_clocked_in' };
    }

    const { data: newEntry, error: insertError } = await admin
      .from('time_entries')
      .insert({
        user_id: user.id,
        organization_id: orgId,
        entry_type: 'clock_out',
        timestamp: new Date().toISOString(),
        is_manual: false,
        status: 'approved'
      })
      .select()
      .single();

    if (insertError || !newEntry) {
      console.error('Error inserting clock_out:', insertError);
      return { success: false, error: 'insert_failed' };
    }

    return { success: true, entry: toTimeEntry(newEntry) };
  } catch (error) {
    console.error('Unexpected error in clockOut:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

export async function startBreak(
  organizationId?: string
): Promise<ClockResult> {
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return { success: false, error: 'not_authenticated' };
    }

    const orgId = organizationId || (await getCurrentOrgId(user.id));
    if (!orgId) {
      return { success: false, error: 'no_active_org' };
    }

    const admin = createSupabaseAdminClient();
    const [userRole, todayRows, organizationSettings] = await Promise.all([
      verifyMembershipFromCache(user.id, orgId),
      getUserTodayEntries(admin, user.id, orgId),
      getCachedOrganizationSettings(orgId)
    ]);

    if (!userRole) {
      return { success: false, error: 'not_a_member' };
    }

    if (organizationSettings.breakMode === 'automatic') {
      return { success: false, error: 'break_mode_automatic' };
    }

    const timeEntries = toTimeEntries(todayRows);
    const currentState = deriveCurrentClockState(timeEntries);

    if (currentState.status !== 'working') {
      return { success: false, error: 'not_working' };
    }

    const { data: newEntry, error: insertError } = await admin
      .from('time_entries')
      .insert({
        user_id: user.id,
        organization_id: orgId,
        entry_type: 'break_start',
        timestamp: new Date().toISOString(),
        is_manual: false,
        status: 'approved',
        job_id: null
      })
      .select()
      .single();

    if (insertError || !newEntry) {
      console.error('Error inserting break_start:', insertError);
      return { success: false, error: 'insert_failed' };
    }

    return { success: true, entry: toTimeEntry(newEntry) };
  } catch (error) {
    console.error('Unexpected error in startBreak:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

export async function endBreak(
  organizationId: string,
  jobId: string | null
): Promise<ClockResult> {
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return { success: false, error: 'not_authenticated' };
    }

    const admin = createSupabaseAdminClient();
    const [userRole, todayRows, organizationSettings] = await Promise.all([
      verifyMembershipFromCache(user.id, organizationId),
      getUserTodayEntries(admin, user.id, organizationId),
      getCachedOrganizationSettings(organizationId)
    ]);

    if (!userRole) {
      return { success: false, error: 'not_a_member' };
    }

    if (organizationSettings.breakMode === 'automatic') {
      return { success: false, error: 'break_mode_automatic' };
    }

    const timeEntries = toTimeEntries(todayRows);
    const currentState = deriveCurrentClockState(timeEntries);

    if (currentState.status !== 'on_break') {
      return { success: false, error: 'not_on_break' };
    }

    const jobIdBeforeBreak = getJobIdBeforeCurrentBreak(timeEntries);
    const shouldStartSeparateWorkBlock =
      (jobIdBeforeBreak ?? null) !== (jobId ?? null);
    const breakEndTimestamp = new Date();
    const breakEndIso = breakEndTimestamp.toISOString();

    const { data: breakEndEntry, error: insertError } = await admin
      .from('time_entries')
      .insert({
        user_id: user.id,
        organization_id: organizationId,
        entry_type: 'break_end',
        timestamp: breakEndIso,
        is_manual: false,
        status: 'approved',
        job_id: jobId
      })
      .select()
      .single();

    if (insertError || !breakEndEntry) {
      console.error('Error inserting break_end:', insertError);
      return { success: false, error: 'insert_failed' };
    }

    let returnedEntry = breakEndEntry;

    if (shouldStartSeparateWorkBlock) {
      const resumeClockInIso = new Date(
        breakEndTimestamp.getTime() + 1
      ).toISOString();

      const { data: resumeClockInEntry, error: resumeClockInError } = await admin
        .from('time_entries')
        .insert({
          user_id: user.id,
          organization_id: organizationId,
          entry_type: 'clock_in',
          timestamp: resumeClockInIso,
          is_manual: false,
          status: 'approved',
          job_id: jobId
        })
        .select()
        .single();

      if (resumeClockInError || !resumeClockInEntry) {
        console.error('Error inserting continuation clock_in after break_end:', resumeClockInError);
        await admin.from('time_entries').delete().eq('id', breakEndEntry.id);
        return { success: false, error: 'insert_failed' };
      }

      returnedEntry = resumeClockInEntry;
    }

    let jobInfo: import('./types').ClockJobInfo | null = null;
    if (jobId) {
      jobInfo = await getClockJobInfo(admin, jobId, {
        includeRelations: false,
        touchStatus: true
      });
    }

    return { success: true, entry: toTimeEntry(returnedEntry), jobInfo };
  } catch (error) {
    console.error('Unexpected error in endBreak:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

/**
 * Best-effort: clock out the current user in any org where they are currently working today.
 * Used before sign-out so users don't get "stuck clocked in".
 */
export async function clockOutBeforeSignOut(): Promise<
  | { success: true; clockedOutOrgIds: string[] }
  | { success: false; error: string }
> {
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return { success: true, clockedOutOrgIds: [] };
    }

    const admin = createSupabaseAdminClient();
    const openOrgs = await getOpenSessionOrgsForUserToday(admin, user.id);

    if (openOrgs.length === 0) {
      return { success: true, clockedOutOrgIds: [] };
    }

    const nowIso = new Date().toISOString();
    const clockedOutOrgIds: string[] = [];

    for (const org of openOrgs) {
      const { error: insertError } = await admin.from('time_entries').insert({
        user_id: user.id,
        organization_id: org.organizationId,
        entry_type: 'clock_out',
        timestamp: nowIso,
        is_manual: false,
        status: 'approved'
      });

      if (insertError) {
        console.error(
          'Error inserting clock_out before sign-out:',
          insertError,
          { orgId: org.organizationId }
        );
        // Best-effort: continue trying other orgs
        continue;
      }

      clockedOutOrgIds.push(org.organizationId);
    }

    return { success: true, clockedOutOrgIds };
  } catch (error) {
    console.error('Unexpected error in clockOutBeforeSignOut:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

// ============================================
// Manual Entry Actions
// ============================================

/**
 * Add manual time entries
 */
export async function addManualEntry(
  params: AddManualEntryParams
): Promise<AddManualEntryResult> {
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return { success: false, error: 'not_authenticated' };
    }

    const { organizationId, targetUserId, entries } = params;

    if (entries.length === 0) {
      return { success: false, error: 'validation_failed' };
    }

    const [callerRole, organizationSettings] = await Promise.all([
      verifyMembershipFromCache(user.id, organizationId),
      getCachedOrganizationSettings(organizationId)
    ]);
    if (!callerRole) {
      return { success: false, error: 'not_a_member' };
    }

    const containsManualBreakEntries = entries.some(
      (entry) => entry.entryType === 'break_start' || entry.entryType === 'break_end'
    );

    if (organizationSettings.breakMode === 'automatic' && containsManualBreakEntries) {
      return { success: false, error: 'break_mode_automatic' };
    }

    const admin = createSupabaseAdminClient();

    // Get target user's role
    const { data: targetMember } = await admin
      .from('organization_members')
      .select('role')
      .eq('user_id', targetUserId)
      .eq('organization_id', organizationId)
      .single();

    if (!targetMember) {
      return { success: false, error: 'target_not_a_member' };
    }

    const targetRole = targetMember.role as OrgRole;

    // Check if caller can add entries for target
    if (!canAddEntriesFor(callerRole, targetRole, user.id, targetUserId)) {
      return { success: false, error: 'not_authorized' };
    }

    const targetDay = new Date(entries[0]?.timestamp);
    const existingEntries = await getUserEntriesForDay(
      admin,
      targetUserId,
      organizationId,
      targetDay
    );
    const timeEntries = toTimeEntries(existingEntries);

    // Validate the new entries
    const validationResult = validateManualEntries(timeEntries, entries, {
      allowFutureTimestamps: callerRole === 'admin'
    });
    if (!validationResult.valid) {
      return {
        success: false,
        error: validationResult.error || 'validation_failed'
      };
    }

    const normalizedEntries = entries.map((entry) => ({
      ...entry,
      jobId: getManualEntryJobId(entry.entryType, params.jobId)
    }));
    const jobOwnershipResult = validateManualEntryJobOwnership(normalizedEntries);
    if (!jobOwnershipResult.valid) {
      return {
        success: false,
        error: jobOwnershipResult.error || 'validation_failed'
      };
    }

    // Determine approval status
    const status = determineApprovalStatus(callerRole, targetUserId, user.id);

    // Cross-org guard: only run if these entries would result in an "open session" today
    const simulatedEntries: TimeEntry[] = normalizedEntries.map((e, idx) => ({
      id: `simulated-${idx}`,
      userId: targetUserId,
      organizationId,
      entryType: e.entryType,
      timestamp: e.timestamp,
      isManual: true,
      jobId: e.jobId ?? null,
      status,
      reviewedBy: null,
      reviewedAt: null,
      createdAt: e.timestamp,
      updatedAt: e.timestamp
    }));

    const wouldBeClockedIn = hasOpenSession(
      [...timeEntries, ...simulatedEntries],
      getLocalDayEnd(targetDay)
    );
    if (wouldBeClockedIn) {
      const openOrgs = await getOpenSessionOrgsForUserOnDay(
        admin,
        targetUserId,
        targetDay
      );
      const openOther = openOrgs.find(
        (o) => o.organizationId !== organizationId
      );
      if (openOther) {
        return {
          success: false,
          error: 'working_in_other_org',
          otherOrgId: openOther.organizationId,
          otherOrgName: openOther.organizationName
        };
      }
    }

    const insertData = normalizedEntries.map((entry) => ({
      user_id: targetUserId,
      organization_id: organizationId,
      entry_type: entry.entryType,
      timestamp: entry.timestamp,
      is_manual: true,
      status,
      reviewed_by: status === 'approved' ? user.id : null,
      reviewed_at: status === 'approved' ? new Date().toISOString() : null,
      job_id: entry.jobId ?? null
    }));

    const { data: newEntries, error: insertError } = await admin
      .from('time_entries')
      .insert(insertData)
      .select();

    if (insertError || !newEntries) {
      console.error('Error inserting manual entries:', insertError);
      return { success: false, error: 'insert_failed' };
    }

    revalidatePath('/kalender');
    revalidatePath('/zeiterfassung');

    return { success: true, entries: toTimeEntries(newEntries) };
  } catch (error) {
    console.error('Unexpected error in addManualEntry:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

// ============================================
// Review Actions
// ============================================

/**
 * Approve or reject a pending entry
 */
export async function reviewEntry(
  entryId: string,
  decision: 'approved' | 'rejected'
): Promise<ReviewEntryResult> {
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return { success: false, error: 'not_authenticated' };
    }

    const admin = createSupabaseAdminClient();

    // Get the entry
    const { data: entry, error: entryError } = await admin
      .from('time_entries')
      .select('*')
      .eq('id', entryId)
      .single();

    if (entryError || !entry) {
      return { success: false, error: 'entry_not_found' };
    }

    // Check if entry is pending
    if (entry.status !== 'pending') {
      return { success: false, error: 'entry_not_pending' };
    }

    const callerRole = await verifyMembershipFromCache(
      user.id,
      entry.organization_id
    );
    if (!callerRole) {
      return { success: false, error: 'not_a_member' };
    }

    // Get target user's role
    const { data: targetMember } = await admin
      .from('organization_members')
      .select('role')
      .eq('user_id', entry.user_id)
      .eq('organization_id', entry.organization_id)
      .single();

    if (!targetMember) {
      return { success: false, error: 'target_not_found' };
    }

    const targetRole = targetMember.role as OrgRole;

    // Check if caller can approve this entry
    if (!canApproveEntries(callerRole, targetRole)) {
      return { success: false, error: 'not_authorized' };
    }

    if (decision === 'approved') {
      // Approval: Update the entry status to approved
      const { data: updatedEntry, error: updateError } = await admin
        .from('time_entries')
        .update({
          status: 'approved',
          reviewed_by: user.id,
          reviewed_at: new Date().toISOString()
        })
        .eq('id', entryId)
        .select()
        .single();

      if (updateError || !updatedEntry) {
        console.error('Error updating entry:', updateError);
        return { success: false, error: 'update_failed' };
      }

      return { success: true, entry: toTimeEntry(updatedEntry) };
    } else {
      // Rejection: Update entry status to 'rejected' so it appears in history
      const { data: updatedEntry, error: updateError } = await admin
        .from('time_entries')
        .update({
          status: 'rejected',
          reviewed_by: user.id,
          reviewed_at: new Date().toISOString()
        })
        .eq('id', entryId)
        .select()
        .single();

      if (updateError || !updatedEntry) {
        console.error('Error rejecting entry:', updateError);
        return { success: false, error: 'update_failed' };
      }

      return { success: true, entry: toTimeEntry(updatedEntry) };
    }
  } catch (error) {
    console.error('Unexpected error in reviewEntry:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

// ============================================
// Update/Delete Actions
// ============================================

/**
 * Update a time entry (admin/manager only)
 * For managers editing their own entries, creates a change request for admin approval
 */
export async function updateEntry(
  entryId: string,
  fields: { timestamp?: string; entryType?: TimeEntryType; jobId?: string | null }
): Promise<UpdateEntryResult | RequestChangeResult> {
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return { success: false, error: 'not_authenticated' };
    }

    const admin = createSupabaseAdminClient();

    // Get the entry
    const { data: entry, error: entryError } = await admin
      .from('time_entries')
      .select('*')
      .eq('id', entryId)
      .single();

    if (entryError || !entry) {
      return { success: false, error: 'entry_not_found' };
    }

    const callerRole = await verifyMembershipFromCache(
      user.id,
      entry.organization_id
    );
    if (!callerRole) {
      return { success: false, error: 'not_a_member' };
    }

    // Get target user's role
    const { data: targetMember } = await admin
      .from('organization_members')
      .select('role')
      .eq('user_id', entry.user_id)
      .eq('organization_id', entry.organization_id)
      .single();

    if (!targetMember) {
      return { success: false, error: 'target_not_found' };
    }

    const targetRole = targetMember.role as OrgRole;
    const isOwnEntry = entry.user_id === user.id;

    // Check if caller can manage this entry
    if (!canManageEntries(callerRole, targetRole, isOwnEntry)) {
      return { success: false, error: 'not_authorized' };
    }

    const targetTimestamp = fields.timestamp
      ? new Date(fields.timestamp)
      : new Date(entry.timestamp);

    // Validate timestamp update if provided
    if (fields.timestamp) {
      const existingEntries = await getUserEntries(
        admin,
        entry.user_id,
        entry.organization_id
      );
      const timeEntries = toTimeEntries(existingEntries);

      const validationResult = validateTimestampUpdate(
        timeEntries,
        entryId,
        new Date(fields.timestamp)
      );

      if (!validationResult.valid) {
        return {
          success: false,
          error: validationResult.error || 'validation_failed'
        };
      }
    }

    if (
      fields.entryType !== undefined ||
      Object.prototype.hasOwnProperty.call(fields, 'jobId')
    ) {
      const existingEntries = await getUserEntries(
        admin,
        entry.user_id,
        entry.organization_id
      );
      const timeEntries = toTimeEntries(existingEntries);

      const simulatedEntries = timeEntries.map((existingEntry) =>
        existingEntry.id === entryId
          ? {
              ...existingEntry,
              entryType: fields.entryType ?? existingEntry.entryType,
              jobId:
                fields.jobId !== undefined ? fields.jobId : existingEntry.jobId,
              timestamp: fields.timestamp ?? existingEntry.timestamp
            }
          : existingEntry
      );

      const dayReference = new Date(targetTimestamp);
      const dayEntries = simulatedEntries.filter((timeEntry) =>
        isSameLocalDay(new Date(timeEntry.timestamp), dayReference)
      );
      const sequenceResult = validateDayEntrySequence(dayEntries);

      if (!sequenceResult.valid) {
        return {
          success: false,
          error: sequenceResult.error || 'validation_failed'
        };
      }
    }

    // Check if this needs to be a change request (manager editing own entry)
    if (needsChangeRequest(callerRole, targetRole, isOwnEntry)) {
      // Check if there's already a pending request for this entry
      const { data: existingRequest } = await admin
        .from('entry_change_requests')
        .select('id')
        .eq('entry_id', entryId)
        .eq('status', 'pending')
        .single();

      if (existingRequest) {
        return { success: false, error: 'pending_request_exists' };
      }

      // Store original timestamp and apply edit immediately (immediate effect model)
      const originalTimestamp = entry.timestamp;

      // Create a change request with original timestamp stored for potential revert
      const { data: request, error: requestError } = await admin
        .from('entry_change_requests')
        .insert({
          entry_id: entryId,
          organization_id: entry.organization_id,
          requested_by: user.id,
          change_type: 'edit',
          proposed_timestamp: fields.timestamp || null,
          original_timestamp: originalTimestamp // Store original for revert on rejection
        })
        .select()
        .single();

      if (requestError || !request) {
        console.error('Error creating change request:', requestError);
        return { success: false, error: 'request_failed' };
      }

      // Apply the edit immediately (immediate effect)
      if (fields.timestamp || fields.entryType !== undefined || fields.jobId !== undefined) {
        const immediateUpdateData: Record<string, unknown> = {};
        if (fields.timestamp) {
          immediateUpdateData.timestamp = fields.timestamp;
        }
        if (fields.entryType !== undefined) {
          immediateUpdateData.entry_type = fields.entryType;
        }
        if (fields.jobId !== undefined) {
          immediateUpdateData.job_id = fields.jobId;
        }

        const { error: updateError } = await admin
          .from('time_entries')
          .update(immediateUpdateData)
          .eq('id', entryId);

        if (updateError) {
          console.error('Error applying immediate edit:', updateError);
          // Rollback: delete the change request since we couldn't apply the edit
          await admin
            .from('entry_change_requests')
            .delete()
            .eq('id', request.id);
          return { success: false, error: 'update_failed' };
        }
      }

      return { success: true, request: toChangeRequest(request) };
    }

    // Direct update (admin or manager editing managed role's entry)
    const updateData: Record<string, unknown> = {};
    if (fields.timestamp) {
      updateData.timestamp = fields.timestamp;
    }
    if (fields.entryType !== undefined) {
      updateData.entry_type = fields.entryType;
    }
    if (fields.jobId !== undefined) {
      updateData.job_id = fields.jobId;
    }

    const { data: updatedEntry, error: updateError } = await admin
      .from('time_entries')
      .update(updateData)
      .eq('id', entryId)
      .select()
      .single();

    if (updateError || !updatedEntry) {
      console.error('Error updating entry:', updateError);
      return { success: false, error: 'update_failed' };
    }

    return { success: true, entry: toTimeEntry(updatedEntry) };
  } catch (error) {
    console.error('Unexpected error in updateEntry:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

/**
 * Delete a time entry (admin/manager only)
 * For managers deleting their own entries, creates a change request for admin approval
 * @param entryId - The ID of the entry to delete (typically clock_in for pairs)
 * @param pairedEntryId - Optional ID of paired entry (clock_out) for paired delete requests
 */
export async function deleteEntry(
  entryId: string,
  pairedEntryId?: string
): Promise<DeleteEntryResult | RequestChangeResult> {
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return { success: false, error: 'not_authenticated' };
    }

    const admin = createSupabaseAdminClient();

    // Get the entry
    const { data: entry, error: entryError } = await admin
      .from('time_entries')
      .select('*')
      .eq('id', entryId)
      .single();

    if (entryError || !entry) {
      return { success: false, error: 'entry_not_found' };
    }

    const callerRole = await verifyMembershipFromCache(
      user.id,
      entry.organization_id
    );
    if (!callerRole) {
      return { success: false, error: 'not_a_member' };
    }

    // Get target user's role
    const { data: targetMember } = await admin
      .from('organization_members')
      .select('role')
      .eq('user_id', entry.user_id)
      .eq('organization_id', entry.organization_id)
      .single();

    if (!targetMember) {
      return { success: false, error: 'target_not_found' };
    }

    const targetRole = targetMember.role as OrgRole;
    const isOwnEntry = entry.user_id === user.id;

    // Check if caller can manage this entry
    if (!canManageEntries(callerRole, targetRole, isOwnEntry)) {
      return { success: false, error: 'not_authorized' };
    }

    // Check if this needs to be a change request (manager deleting own entry)
    if (needsChangeRequest(callerRole, targetRole, isOwnEntry)) {
      // Check if there's already a pending request for this entry
      const { data: existingRequest } = await admin
        .from('entry_change_requests')
        .select('id')
        .eq('entry_id', entryId)
        .eq('status', 'pending')
        .single();

      if (existingRequest) {
        return { success: false, error: 'pending_request_exists' };
      }

      // Also check if there's a pending request for the paired entry
      if (pairedEntryId) {
        const { data: existingPairedRequest } = await admin
          .from('entry_change_requests')
          .select('id')
          .eq('entry_id', pairedEntryId)
          .eq('status', 'pending')
          .single();

        if (existingPairedRequest) {
          return { success: false, error: 'pending_request_exists' };
        }
      }

      // Create a delete request
      const { data: request, error: requestError } = await admin
        .from('entry_change_requests')
        .insert({
          entry_id: entryId,
          paired_entry_id: pairedEntryId || null,
          organization_id: entry.organization_id,
          requested_by: user.id,
          change_type: 'delete'
        })
        .select()
        .single();

      if (requestError || !request) {
        console.error('Error creating change request:', requestError);
        return { success: false, error: 'request_failed' };
      }

      // Mark main entry as pending_delete immediately (immediate effect)
      const { error: markMainError } = await admin
        .from('time_entries')
        .update({ status: 'pending_delete' })
        .eq('id', entryId);

      if (markMainError) {
        console.error('Error marking entry as pending_delete:', markMainError);
        // Rollback: delete the change request
        await admin.from('entry_change_requests').delete().eq('id', request.id);
        return { success: false, error: 'update_failed' };
      }

      // Mark paired entry as pending_delete if provided
      if (pairedEntryId) {
        const { error: markPairedError } = await admin
          .from('time_entries')
          .update({ status: 'pending_delete' })
          .eq('id', pairedEntryId);

        if (markPairedError) {
          console.error(
            'Error marking paired entry as pending_delete:',
            markPairedError
          );
          // Rollback: restore main entry and delete the request
          await admin
            .from('time_entries')
            .update({ status: 'approved' })
            .eq('id', entryId);
          await admin
            .from('entry_change_requests')
            .delete()
            .eq('id', request.id);
          return { success: false, error: 'update_failed' };
        }
      }

      return { success: true, request: toChangeRequest(request) };
    }

    // Direct delete (admin or manager deleting managed role's entry)
    // Delete paired entry first if provided
    if (pairedEntryId) {
      const { error: pairedDeleteError } = await admin
        .from('time_entries')
        .delete()
        .eq('id', pairedEntryId);

      if (pairedDeleteError) {
        console.error('Error deleting paired entry:', pairedDeleteError);
        return { success: false, error: 'delete_failed' };
      }
    }

    const { error: deleteError } = await admin
      .from('time_entries')
      .delete()
      .eq('id', entryId);

    if (deleteError) {
      console.error('Error deleting entry:', deleteError);
      return { success: false, error: 'delete_failed' };
    }

    return { success: true };
  } catch (error) {
    console.error('Unexpected error in deleteEntry:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

export async function deleteEntriesBatch(
  entryIds: string[]
): Promise<DeleteEntryResult> {
  if (entryIds.length === 0) {
    return { success: true };
  }

  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return { success: false, error: 'not_authenticated' };
    }

    const admin = createSupabaseAdminClient();
    const uniqueEntryIds = [...new Set(entryIds)];
    const { data: entries, error: entriesError } = await admin
      .from('time_entries')
      .select('*')
      .in('id', uniqueEntryIds);

    if (entriesError || !entries || entries.length !== uniqueEntryIds.length) {
      return { success: false, error: 'entry_not_found' };
    }

    const organizationId = entries[0]?.organization_id;
    if (!organizationId || entries.some((entry) => entry.organization_id !== organizationId)) {
      return { success: false, error: 'not_authorized' };
    }

    const callerRole = await verifyMembershipFromCache(user.id, organizationId);
    if (!callerRole) {
      return { success: false, error: 'not_a_member' };
    }

    const uniqueUserIds = [...new Set(entries.map((entry) => entry.user_id))];
    const { data: memberRows, error: memberError } = await admin
      .from('organization_members')
      .select('user_id, role')
      .eq('organization_id', organizationId)
      .in('user_id', uniqueUserIds);

    if (memberError || !memberRows) {
      return { success: false, error: 'target_not_found' };
    }

    const roleMap = new Map(
      memberRows.map((member) => [member.user_id, member.role as OrgRole])
    );

    for (const entry of entries) {
      const targetRole = roleMap.get(entry.user_id);
      if (!targetRole) {
        return { success: false, error: 'target_not_found' };
      }

      const isOwnEntry = entry.user_id === user.id;
      if (!canManageEntries(callerRole, targetRole, isOwnEntry)) {
        return { success: false, error: 'not_authorized' };
      }

      if (needsChangeRequest(callerRole, targetRole, isOwnEntry)) {
        return { success: false, error: 'request_failed' };
      }
    }

    const { error: deleteError } = await admin
      .from('time_entries')
      .delete()
      .in('id', uniqueEntryIds);

    if (deleteError) {
      console.error('Error deleting entries batch:', deleteError);
      return { success: false, error: 'delete_failed' };
    }

    return { success: true };
  } catch (error) {
    console.error('Unexpected error in deleteEntriesBatch:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

// ============================================
// Query Actions
// ============================================

/**
 * Get time entries with filters
 * RLS will automatically filter based on user's permissions
 */
export async function getTimeEntries(
  params: GetTimeEntriesParams
): Promise<GetTimeEntriesResult> {
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return { success: false, error: 'not_authenticated' };
    }

    const { organizationId, from, to, userId, status } = params;

    const callerRole = await verifyMembershipFromCache(user.id, organizationId);
    if (!callerRole) {
      return { success: false, error: 'not_a_member' };
    }

    const admin = createSupabaseAdminClient();

    if (
      userId &&
      !canViewEntries(callerRole, userId, user.id)
    ) {
      return { success: false, error: 'not_authorized' };
    }

    let query = admin
      .from('time_entries')
      .select('*')
      .eq('organization_id', organizationId)
      .gte('timestamp', from)
      .lte('timestamp', to)
      .order('timestamp', { ascending: true })
      .order('created_at', { ascending: true });

    if (userId) {
      query = query.eq('user_id', userId);
    }

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching time entries:', error);
      return { success: false, error: 'fetch_failed' };
    }

    const visibleEntries = (data || []).filter((entry) =>
      canViewEntries(callerRole, entry.user_id, user.id)
    );

    return { success: true, entries: toTimeEntries(visibleEntries) };
  } catch (error) {
    console.error('Unexpected error in getTimeEntries:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

/**
 * Get pending entries that the caller can review
 */
export async function getPendingEntries(
  organizationId?: string
): Promise<GetPendingEntriesResult> {
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return { success: false, error: 'not_authenticated' };
    }

    const orgId = organizationId || (await getCurrentOrgId(user.id));
    if (!orgId) {
      return { success: false, error: 'no_active_org' };
    }

    const callerRole = await verifyMembershipFromCache(user.id, orgId);
    if (!callerRole) {
      return { success: false, error: 'not_a_member' };
    }

    // Only admin and manager can see pending entries
    if (callerRole !== 'admin' && callerRole !== 'buero') {
      return { success: true, entries: [] };
    }

    const admin = createSupabaseAdminClient();

    // Get all pending entries in the org
    const { data: pendingEntries, error: entriesError } = await admin
      .from('time_entries')
      .select('*')
      .eq('organization_id', orgId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (entriesError) {
      console.error('Error fetching pending entries:', entriesError);
      return { success: false, error: 'fetch_failed' };
    }

    // Filter based on what the caller can review
    if (callerRole === 'admin') {
      return { success: true, entries: toTimeEntries(pendingEntries || []) };
    }

    // Manager: batch-fetch roles for all unique users in pending entries
    const uniqueUserIds = [
      ...new Set((pendingEntries || []).map((e) => e.user_id))
    ];
    const { data: memberRows } = await admin
      .from('organization_members')
      .select('user_id, role')
      .eq('organization_id', orgId)
      .in('user_id', uniqueUserIds);

    const roleMap = new Map<string, OrgRole>();
    for (const m of memberRows || []) {
      roleMap.set(m.user_id, m.role as OrgRole);
    }

    const filteredEntries = (pendingEntries || []).filter((entry) => {
      const targetRole = roleMap.get(entry.user_id);
      return targetRole && MANAGED_ROLES.includes(targetRole);
    });

    return { success: true, entries: toTimeEntries(filteredEntries) };
  } catch (error) {
    console.error('Unexpected error in getPendingEntries:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

/**
 * Canonical pending approval badge count.
 * Uses the same grouped-session semantics as the approvals list so paired
 * clock-in/clock-out requests count as exactly one everywhere.
 */
export async function getPendingApprovalCount(
  orgId: string,
  _isAdmin: boolean
): Promise<number> {
  void _isAdmin;

  try {
    const user = await getAuthenticatedUser();
    if (!user) return 0;

    const callerRole = await verifyMembershipFromCache(user.id, orgId);
    if (!callerRole || (callerRole !== 'admin' && callerRole !== 'buero')) {
      return 0;
    }

    const pendingSessionsResult = await getPendingSessions(orgId);
    if (!pendingSessionsResult.success) {
      return 0;
    }

    let count = pendingSessionsResult.sessions.length;

    if (callerRole === 'admin') {
      const changeRequestsResult = await getPendingChangeRequests(orgId);
      if (changeRequestsResult.success) {
        count += changeRequestsResult.requests.length;
      }
    }

    return count;
  } catch {
    return 0;
  }
}

/**
 * Get pending sessions (entries grouped as pairs with user profile info)
 */
export async function getPendingSessions(
  organizationId?: string
): Promise<GetPendingSessionsResult> {
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return { success: false, error: 'not_authenticated' };
    }

    const orgId = organizationId || (await getCurrentOrgId(user.id));
    if (!orgId) {
      return { success: false, error: 'no_active_org' };
    }

    const callerRole = await verifyMembershipFromCache(user.id, orgId);
    if (!callerRole) {
      return { success: false, error: 'not_a_member' };
    }

    // Only admin and manager can see pending entries
    if (callerRole !== 'admin' && callerRole !== 'buero') {
      return { success: true, sessions: [] };
    }

    const admin = createSupabaseAdminClient();

    // Get all pending entries in the org
    const { data: pendingEntries, error: entriesError } = await admin
      .from('time_entries')
      .select('*')
      .eq('organization_id', orgId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (entriesError) {
      console.error('Error fetching pending entries:', entriesError);
      return { success: false, error: 'fetch_failed' };
    }

    // If no pending entries, return empty array
    if (!pendingEntries || pendingEntries.length === 0) {
      return { success: true, sessions: [] };
    }

    // Get unique user IDs and fetch their profiles
    const userIds = [...new Set(pendingEntries.map((e) => e.user_id))];
    const { data: profiles } = await admin
      .from('profiles')
      .select('id, first_name, last_name')
      .in('id', userIds);

    // Create a map for quick profile lookup
    const profileMap = new Map<
      string,
      { first_name: string | null; last_name: string | null }
    >();
    for (const profile of profiles || []) {
      profileMap.set(profile.id, {
        first_name: profile.first_name,
        last_name: profile.last_name
      });
    }

    // Filter based on what the caller can review (manager can only review managed roles)
    let filteredEntries: TimeEntryRow[];

    if (callerRole === 'admin') {
      filteredEntries = pendingEntries;
    } else {
      // Manager: batch-fetch roles for all unique users
      const uniqueUserIds = [...new Set(pendingEntries.map((e) => e.user_id))];
      const { data: memberRows } = await admin
        .from('organization_members')
        .select('user_id, role')
        .eq('organization_id', orgId)
        .in('user_id', uniqueUserIds);

      const roleMap = new Map<string, OrgRole>();
      for (const m of memberRows || []) {
        roleMap.set(m.user_id, m.role as OrgRole);
      }

      filteredEntries = pendingEntries.filter((entry) => {
        const targetRole = roleMap.get(entry.user_id);
        return targetRole && MANAGED_ROLES.includes(targetRole);
      });
    }

    // Group entries into sessions (pairs of clock_in/clock_out with same createdAt within 5 seconds)
    const sessions: PendingSession[] = [];
    const processedIds = new Set<string>();

    for (const entry of filteredEntries) {
      if (processedIds.has(entry.id)) continue;

      const profile = profileMap.get(entry.user_id) || null;

      // Find a matching pair (same user, created within 5 seconds, opposite entry type)
      const matchingEntry = filteredEntries.find(
        (e) =>
          e.id !== entry.id &&
          !processedIds.has(e.id) &&
          e.user_id === entry.user_id &&
          Math.abs(
            new Date(e.created_at).getTime() -
              new Date(entry.created_at).getTime()
          ) < 5000 &&
          e.entry_type !== entry.entry_type
      );

      if (matchingEntry) {
        processedIds.add(entry.id);
        processedIds.add(matchingEntry.id);

        const clockIn =
          entry.entry_type === 'clock_in'
            ? toTimeEntry(entry)
            : toTimeEntry(matchingEntry);
        const clockOut =
          entry.entry_type === 'clock_out'
            ? toTimeEntry(entry)
            : toTimeEntry(matchingEntry);

        sessions.push({
          id: clockIn.id,
          userId: entry.user_id,
          firstName: profile?.first_name || null,
          lastName: profile?.last_name || null,
          clockIn,
          clockOut,
          date: getLocalDayKey(new Date(clockIn.timestamp)),
          createdAt: entry.created_at,
          jobTitle: null
        });
      } else {
        // Single entry (only clock_in or only clock_out)
        processedIds.add(entry.id);
        const timeEntry = toTimeEntry(entry);

        sessions.push({
          id: entry.id,
          userId: entry.user_id,
          firstName: profile?.first_name || null,
          lastName: profile?.last_name || null,
          clockIn: entry.entry_type === 'clock_in' ? timeEntry : null,
          clockOut: entry.entry_type === 'clock_out' ? timeEntry : null,
          date: getLocalDayKey(new Date(entry.timestamp)),
          createdAt: entry.created_at,
          jobTitle: null
        });
      }
    }

    // Resolve job titles for sessions that have a linked job
    const jobIds = [
      ...new Set(
        sessions
          .map((s) => s.clockIn?.jobId ?? s.clockOut?.jobId)
          .filter((id): id is string => !!id)
      )
    ];

    if (jobIds.length > 0) {
      const { data: jobs } = await admin
        .from('jobs')
        .select('id, title, description')
        .in('id', jobIds);

      if (jobs) {
        const jobMap = new Map(
          jobs.map((j) => [
            j.id,
            getJobDisplayTitle({
              title: j.title,
              description: j.description
            })
          ])
        );
        for (const session of sessions) {
          const jid = session.clockIn?.jobId ?? session.clockOut?.jobId;
          if (jid) {
            session.jobTitle = jobMap.get(jid) ?? null;
          }
        }
      }
    }

    // Sort by createdAt descending
    sessions.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    return { success: true, sessions };
  } catch (error) {
    console.error('Unexpected error in getPendingSessions:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

/**
 * Review (approve/reject) a pending session (handles pairs)
 */
export async function reviewSession(
  sessionId: string,
  decision: 'approved' | 'rejected',
  pairedEntryId?: string
): Promise<ReviewEntryResult> {
  try {
    // Review the main entry
    const result = await reviewEntry(sessionId, decision);

    // If there's a paired entry, review it too
    if (pairedEntryId && result.success) {
      await reviewEntry(pairedEntryId, decision);
    }

    return result;
  } catch (error) {
    console.error('Unexpected error in reviewSession:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

/**
 * Get list of users currently clocked in
 */
export async function getCurrentlyClockedIn(
  organizationId?: string
): Promise<GetCurrentlyClockedInResult> {
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return { success: false, error: 'not_authenticated' };
    }

    const orgId = organizationId || (await getCurrentOrgId(user.id));
    if (!orgId) {
      return { success: false, error: 'no_active_org' };
    }

    const callerRole = await verifyMembershipFromCache(user.id, orgId);
    if (!callerRole) {
      return { success: false, error: 'not_a_member' };
    }

    if (callerRole !== 'admin' && callerRole !== 'buero') {
      return { success: false, error: 'not_authorized' };
    }

    const admin = createSupabaseAdminClient();

    // Get all members of the org (with profile info)
    const { data: members, error: membersError } = await admin
      .from('organization_members')
      .select(
        `
        user_id,
        role,
        profiles (
          first_name,
          last_name
        )
      `
      )
      .eq('organization_id', orgId);

    if (membersError) {
      console.error('Error fetching members:', membersError);
      return { success: false, error: 'fetch_failed' };
    }

    // Admin and Büro can see all members
    const visibleMembers = members || [];

    // Batch-fetch today's entries for all visible members at once
    // instead of one query per member (N+1 elimination).
    const memberUserIds = visibleMembers.map((m) => m.user_id);
    const { start } = getTodayBounds();

    const { data: allTodayEntries, error: todayError } = await admin
      .from('time_entries')
      .select('*')
      .eq('organization_id', orgId)
      .in('user_id', memberUserIds)
      .gte('timestamp', start.toISOString())
      .lte('timestamp', new Date().toISOString())
      .neq('status', 'rejected')
      .neq('status', 'pending_delete')
      .order('timestamp', { ascending: false });

    if (todayError) {
      console.error('Error fetching today entries:', todayError);
      return { success: false, error: 'fetch_failed' };
    }

    // Group entries by user
    const entriesByUser = new Map<string, TimeEntryRow[]>();
    for (const entry of allTodayEntries || []) {
      const uid = entry.user_id as string;
      if (!entriesByUser.has(uid)) entriesByUser.set(uid, []);
      entriesByUser.get(uid)!.push(entry);
    }

    const clockedInUsers: Array<{
      userId: string;
      clockInTime: string;
      firstName: string | null;
      lastName: string | null;
    }> = [];

    for (const member of visibleMembers) {
      const memberEntries = entriesByUser.get(member.user_id) || [];
      const timeEntries = toTimeEntries(memberEntries);

      const currentState = deriveCurrentClockState(timeEntries);

      if (currentState.isClockedIn && currentState.clockInTime) {

        const profileData = member.profiles as unknown;
        const profile = Array.isArray(profileData)
          ? (profileData[0] as
              | { first_name: string | null; last_name: string | null }
              | undefined)
          : (profileData as {
              first_name: string | null;
              last_name: string | null;
            } | null);

        clockedInUsers.push({
          userId: member.user_id,
          clockInTime: currentState.clockInTime,
          firstName: profile?.first_name || null,
          lastName: profile?.last_name || null
        });
      }
    }

    return { success: true, users: clockedInUsers };
  } catch (error) {
    console.error('Unexpected error in getCurrentlyClockedIn:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

/**
 * Get the current clock status for the authenticated user
 */
export async function getClockStatus(organizationId?: string): Promise<
  | {
      success: true;
      isClockedIn: boolean;
      lastEntry: TimeEntry | null;
    }
  | { success: false; error: string }
> {
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return { success: false, error: 'not_authenticated' };
    }

    const orgId = organizationId || (await getCurrentOrgId(user.id));
    if (!orgId) {
      return { success: false, error: 'no_active_org' };
    }

    const admin = createSupabaseAdminClient();

    // Run membership check and today's entries in parallel
    const [userRole, todayRows] = await Promise.all([
      verifyMembershipFromCache(user.id, orgId),
      getUserTodayEntries(admin, user.id, orgId)
    ]);

    if (!userRole) {
      return { success: false, error: 'not_a_member' };
    }

    const timeEntries = toTimeEntries(todayRows);
    const currentState = deriveCurrentClockState(timeEntries);
    const isClockedIn = currentState.isClockedIn;
    const lastEntry = currentState.lastEntry;

    return { success: true, isClockedIn, lastEntry };
  } catch (error) {
    console.error('Unexpected error in getClockStatus:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

// ============================================
// Change Request Actions
// ============================================

/**
 * Get pending change requests for the organization (admin only)
 */
export async function getPendingChangeRequests(
  organizationId?: string
): Promise<GetChangeRequestsResult> {
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return { success: false, error: 'not_authenticated' };
    }

    const orgId = organizationId || (await getCurrentOrgId(user.id));
    if (!orgId) {
      return { success: false, error: 'no_active_org' };
    }

    const callerRole = await verifyMembershipFromCache(user.id, orgId);
    if (!callerRole) {
      return { success: false, error: 'not_a_member' };
    }

    if (callerRole !== 'admin') {
      return { success: false, error: 'not_authorized' };
    }

    const admin = createSupabaseAdminClient();

    // Get all pending change requests for this org
    const { data: requests, error: requestsError } = await admin
      .from('entry_change_requests')
      .select('*')
      .eq('organization_id', orgId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (requestsError) {
      console.error('Error fetching change requests:', requestsError);
      return { success: false, error: 'fetch_failed' };
    }

    // Batch-enrich requests with entries and requester profiles
    if (!requests || requests.length === 0) {
      return { success: true, requests: [] };
    }

    // Collect all entry IDs and requester IDs for batch fetching
    const allEntryIds = new Set<string>();
    const requesterIds = new Set<string>();
    for (const req of requests) {
      allEntryIds.add(req.entry_id);
      if (req.paired_entry_id) allEntryIds.add(req.paired_entry_id);
      requesterIds.add(req.requested_by);
    }

    // Batch fetch entries and profiles in parallel
    const [entriesResult, profilesResult] = await Promise.all([
      admin
        .from('time_entries')
        .select('*')
        .in('id', [...allEntryIds]),
      admin
        .from('profiles')
        .select('id, first_name, last_name')
        .in('id', [...requesterIds])
    ]);

    const entryMap = new Map<string, TimeEntryRow>();
    for (const e of entriesResult.data || []) {
      entryMap.set(e.id, e);
    }

    const profileMap = new Map<
      string,
      { first_name: string | null; last_name: string | null }
    >();
    for (const p of profilesResult.data || []) {
      profileMap.set(p.id, {
        first_name: p.first_name,
        last_name: p.last_name
      });
    }

    const enrichedRequests: ChangeRequestWithDetails[] = [];
    for (const request of requests) {
      const entry = entryMap.get(request.entry_id);
      if (!entry) continue;

      const pairedEntry = request.paired_entry_id
        ? (entryMap.get(request.paired_entry_id) ?? null)
        : null;
      const profile = profileMap.get(request.requested_by) ?? null;

      enrichedRequests.push({
        ...toChangeRequest(request),
        entry: toTimeEntry(entry),
        pairedEntry: pairedEntry ? toTimeEntry(pairedEntry) : null,
        requesterFirstName: profile?.first_name || null,
        requesterLastName: profile?.last_name || null
      });
    }

    return { success: true, requests: enrichedRequests };
  } catch (error) {
    console.error('Unexpected error in getPendingChangeRequests:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

/**
 * Review a change request (edit or delete) from a manager.
 *
 * IMMEDIATE EFFECT MODEL:
 * - Edits are applied immediately when requested, original_timestamp stores the pre-edit value
 * - Deletes mark entries as 'pending_delete' immediately
 *
 * On approval:
 * - Edit: Nothing to do, the edit is already applied
 * - Delete: Actually delete the entries (they're currently marked pending_delete)
 *
 * On rejection:
 * - Edit: Revert timestamp to original_timestamp
 * - Delete: Restore entries to 'approved' status
 */
export async function reviewChangeRequest(
  requestId: string,
  action: 'approve' | 'reject'
): Promise<ReviewChangeRequestResult> {
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return { success: false, error: 'not_authenticated' };
    }

    const admin = createSupabaseAdminClient();

    // Get the change request
    const { data: request, error: requestError } = await admin
      .from('entry_change_requests')
      .select('*')
      .eq('id', requestId)
      .single();

    if (requestError || !request) {
      return { success: false, error: 'request_not_found' };
    }

    const callerRole = await verifyMembershipFromCache(
      user.id,
      request.organization_id
    );
    if (!callerRole) {
      return { success: false, error: 'not_a_member' };
    }

    if (callerRole !== 'admin') {
      return { success: false, error: 'not_authorized' };
    }

    // Check request is still pending
    if (request.status !== 'pending') {
      return { success: false, error: 'request_already_reviewed' };
    }

    // Update the request status FIRST
    const { data: updatedRequest, error: updateRequestError } = await admin
      .from('entry_change_requests')
      .update({
        status: action === 'approve' ? 'approved' : 'rejected',
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString()
      })
      .eq('id', requestId)
      .select()
      .single();

    if (updateRequestError || !updatedRequest) {
      console.error('Error updating request:', updateRequestError);
      return { success: false, error: 'update_failed' };
    }

    if (action === 'approve') {
      // APPROVAL LOGIC
      if (request.change_type === 'edit') {
        // Edit is already applied - nothing to do
        // The timestamp was updated when the request was created
      } else if (request.change_type === 'delete') {
        // Entries are marked as pending_delete - now actually delete them
        // Delete paired entry first if exists
        if (request.paired_entry_id) {
          const { error: pairedDeleteError } = await admin
            .from('time_entries')
            .delete()
            .eq('id', request.paired_entry_id);

          if (pairedDeleteError) {
            console.error('Error deleting paired entry:', pairedDeleteError);
            await admin
              .from('entry_change_requests')
              .update({
                status: 'pending',
                reviewed_by: null,
                reviewed_at: null
              })
              .eq('id', requestId);
            return { success: false, error: 'apply_failed' };
          }
        }

        // Delete the main entry
        const { error: deleteError } = await admin
          .from('time_entries')
          .delete()
          .eq('id', request.entry_id);

        if (deleteError) {
          console.error('Error applying delete:', deleteError);
          await admin
            .from('entry_change_requests')
            .update({ status: 'pending', reviewed_by: null, reviewed_at: null })
            .eq('id', requestId);
          return { success: false, error: 'apply_failed' };
        }
      }
    } else {
      // REJECTION LOGIC - revert the changes
      if (request.change_type === 'edit') {
        // Revert to original timestamp
        if (request.original_timestamp) {
          const { error: revertError } = await admin
            .from('time_entries')
            .update({ timestamp: request.original_timestamp })
            .eq('id', request.entry_id);

          if (revertError) {
            console.error('Error reverting edit:', revertError);
            // Revert the request status since we couldn't revert the edit
            await admin
              .from('entry_change_requests')
              .update({
                status: 'pending',
                reviewed_by: null,
                reviewed_at: null
              })
              .eq('id', requestId);
            return { success: false, error: 'revert_failed' };
          }
        }
      } else if (request.change_type === 'delete') {
        // Restore entries from pending_delete to approved
        const { error: restoreMainError } = await admin
          .from('time_entries')
          .update({ status: 'approved' })
          .eq('id', request.entry_id);

        if (restoreMainError) {
          console.error('Error restoring main entry:', restoreMainError);
          await admin
            .from('entry_change_requests')
            .update({ status: 'pending', reviewed_by: null, reviewed_at: null })
            .eq('id', requestId);
          return { success: false, error: 'restore_failed' };
        }

        // Restore paired entry if exists
        if (request.paired_entry_id) {
          const { error: restorePairedError } = await admin
            .from('time_entries')
            .update({ status: 'approved' })
            .eq('id', request.paired_entry_id);

          if (restorePairedError) {
            console.error('Error restoring paired entry:', restorePairedError);
            // Main entry is already restored, just log the error
          }
        }
      }
    }

    return { success: true, request: toChangeRequest(updatedRequest) };
  } catch (error) {
    console.error('Unexpected error in reviewChangeRequest:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

/**
 * Move a paired session (clock_in + clock_out) to a different user,
 * optionally updating timestamps. Used for cross-row drag-and-drop.
 */
export async function reassignEntries(
  clockInId: string,
  clockOutId: string,
  newUserId: string,
  newClockInTimestamp: string,
  newClockOutTimestamp: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await getAuthenticatedUser();
    if (!user) return { success: false, error: 'not_authenticated' };

    const admin = createSupabaseAdminClient();

    const { data: ciEntry } = await admin
      .from('time_entries')
      .select('*')
      .eq('id', clockInId)
      .single();
    const { data: coEntry } = await admin
      .from('time_entries')
      .select('*')
      .eq('id', clockOutId)
      .single();

    if (!ciEntry || !coEntry) return { success: false, error: 'entries_not_found' };

    const orgId = ciEntry.organization_id;
    const callerRole = await verifyMembershipFromCache(user.id, orgId);
    if (!callerRole) return { success: false, error: 'not_a_member' };

    const { data: srcMember } = await admin
      .from('organization_members')
      .select('role')
      .eq('user_id', ciEntry.user_id)
      .eq('organization_id', orgId)
      .single();
    const { data: tgtMember } = await admin
      .from('organization_members')
      .select('role')
      .eq('user_id', newUserId)
      .eq('organization_id', orgId)
      .single();

    if (!srcMember || !tgtMember) return { success: false, error: 'member_not_found' };

    const srcRole = srcMember.role as OrgRole;
    const tgtRole = tgtMember.role as OrgRole;
    const isOwnSource = ciEntry.user_id === user.id;
    const isOwnTarget = newUserId === user.id;

    if (!canManageEntries(callerRole, srcRole, isOwnSource)) {
      return { success: false, error: 'not_authorized_source' };
    }
    if (!canManageEntries(callerRole, tgtRole, isOwnTarget)) {
      return { success: false, error: 'not_authorized_target' };
    }

    const ciNew = new Date(newClockInTimestamp);
    const coNew = new Date(newClockOutTimestamp);
    if (ciNew >= coNew) return { success: false, error: 'invalid_time_range' };

    const { data: targetExisting } = await admin
      .from('time_entries')
      .select('*')
      .eq('user_id', newUserId)
      .eq('organization_id', orgId)
      .neq('status', 'rejected')
      .neq('status', 'pending_delete')
      .neq('id', clockInId)
      .neq('id', clockOutId);

    if (targetExisting && targetExisting.length > 0) {
      const targetSessions = calculateWorkSessions(toTimeEntries(targetExisting));
      for (const s of targetSessions) {
        const sStart = s.clockIn ? new Date(s.clockIn.timestamp) : null;
        const sEnd = s.clockOut ? new Date(s.clockOut.timestamp) : null;
        if (sStart && sEnd && ciNew < sEnd && coNew > sStart) {
          return { success: false, error: 'overlapping_session' };
        }
      }
    }

    const { error: e1 } = await admin
      .from('time_entries')
      .update({ user_id: newUserId, timestamp: newClockInTimestamp })
      .eq('id', clockInId);
    if (e1) return { success: false, error: 'update_failed' };

    const { error: e2 } = await admin
      .from('time_entries')
      .update({ user_id: newUserId, timestamp: newClockOutTimestamp })
      .eq('id', clockOutId);
    if (e2) {
      await admin.from('time_entries')
        .update({ user_id: ciEntry.user_id, timestamp: ciEntry.timestamp })
        .eq('id', clockInId);
      return { success: false, error: 'update_failed' };
    }

    return { success: true };
  } catch (error) {
    console.error('Error in reassignEntries:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

export async function reassignEntryBatch(
  updates: Array<{
    entryId: string;
    newUserId: string;
    newTimestamp: string;
  }>
): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await getAuthenticatedUser();
    if (!user) return { success: false, error: 'not_authenticated' };
    if (updates.length === 0) return { success: true };

    const admin = createSupabaseAdminClient();
    const entryIds = updates.map((update) => update.entryId);

    const { data: fetchedEntries, error: entriesError } = await admin
      .from('time_entries')
      .select('*')
      .in('id', entryIds);

    if (entriesError || !fetchedEntries || fetchedEntries.length !== entryIds.length) {
      return { success: false, error: 'entries_not_found' };
    }

    const firstEntry = fetchedEntries[0];
    const orgId = firstEntry.organization_id;

    if (fetchedEntries.some((entry) => entry.organization_id !== orgId)) {
      return { success: false, error: 'mixed_organizations' };
    }

    const callerRole = await verifyMembershipFromCache(user.id, orgId);
    if (!callerRole) return { success: false, error: 'not_a_member' };

    const sourceUserIds = [...new Set(fetchedEntries.map((entry) => entry.user_id))];
    const targetUserIds = [...new Set(updates.map((update) => update.newUserId))];
    const memberIds = [...new Set([...sourceUserIds, ...targetUserIds])];

    const { data: memberRows } = await admin
      .from('organization_members')
      .select('user_id, role')
      .eq('organization_id', orgId)
      .in('user_id', memberIds);

    const roleMap = new Map(
      (memberRows ?? []).map((row) => [row.user_id, row.role as OrgRole])
    );

    for (const entry of fetchedEntries) {
      const sourceRole = roleMap.get(entry.user_id);
      if (!sourceRole) return { success: false, error: 'member_not_found' };
      if (!canManageEntries(callerRole, sourceRole, entry.user_id === user.id)) {
        return { success: false, error: 'not_authorized_source' };
      }
    }

    for (const targetUserId of targetUserIds) {
      const targetRole = roleMap.get(targetUserId);
      if (!targetRole) return { success: false, error: 'member_not_found' };
      if (!canManageEntries(callerRole, targetRole, targetUserId === user.id)) {
        return { success: false, error: 'not_authorized_target' };
      }
    }

    const minTimestamp = updates.reduce(
      (min, update) =>
        new Date(update.newTimestamp).getTime() < new Date(min).getTime()
          ? update.newTimestamp
          : min,
      updates[0].newTimestamp
    );
    const maxTimestamp = updates.reduce(
      (max, update) =>
        new Date(update.newTimestamp).getTime() > new Date(max).getTime()
          ? update.newTimestamp
          : max,
      updates[0].newTimestamp
    );

    const { data: targetEntries } = await admin
      .from('time_entries')
      .select('*')
      .eq('organization_id', orgId)
      .in('user_id', targetUserIds)
      .gte('timestamp', getLocalDayStart(new Date(minTimestamp)).toISOString())
      .lte('timestamp', getLocalDayEnd(new Date(maxTimestamp)).toISOString())
      .neq('status', 'rejected')
      .neq('status', 'pending_delete');

    const updatesByEntryId = new Map(
      updates.map((update) => [update.entryId, update])
    );
    const affectedCombos = new Set(
      updates.map(
        (update) =>
          `${update.newUserId}:${getLocalDayKey(new Date(update.newTimestamp))}`
      )
    );

    for (const combo of affectedCombos) {
      const [targetUserId, dayKey] = combo.split(':');
      const existingEntries = toTimeEntries(
        (targetEntries ?? []).filter(
          (entry) =>
            entry.user_id === targetUserId &&
            getLocalDayKey(new Date(entry.timestamp)) === dayKey &&
            !updatesByEntryId.has(entry.id)
        )
      );

      const simulatedEntries = [
        ...existingEntries,
        ...fetchedEntries
          .filter((entry) => {
            const update = updatesByEntryId.get(entry.id);
            return (
              update &&
              update.newUserId === targetUserId &&
              getLocalDayKey(new Date(update.newTimestamp)) === dayKey
            );
          })
          .map((entry) => {
            const update = updatesByEntryId.get(entry.id)!;
            return toTimeEntry({
              ...entry,
              user_id: update.newUserId,
              timestamp: update.newTimestamp
            });
          })
      ];

      const validationResult = validateDayEntrySequence(simulatedEntries);
      if (!validationResult.valid) {
        return {
          success: false,
          error: validationResult.error || 'validation_failed'
        };
      }
    }

    const originals = fetchedEntries.map((entry) => ({
      id: entry.id,
      user_id: entry.user_id,
      timestamp: entry.timestamp
    }));

    for (const update of updates) {
      const { error } = await admin
        .from('time_entries')
        .update({
          user_id: update.newUserId,
          timestamp: update.newTimestamp
        })
        .eq('id', update.entryId);

      if (error) {
        for (const original of originals) {
          await admin
            .from('time_entries')
            .update({
              user_id: original.user_id,
              timestamp: original.timestamp
            })
            .eq('id', original.id);
        }
        return { success: false, error: 'update_failed' };
      }
    }

    return { success: true };
  } catch (error) {
    console.error('Error in reassignEntryBatch:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

/**
 * Cancel a pending change request created by the current user.
 * Reverts the entry to its original state and deletes the request.
 */
export async function cancelOwnChangeRequest(
  requestId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await getAuthenticatedUser();
    if (!user) return { success: false, error: 'not_authenticated' };

    const admin = createSupabaseAdminClient();

    const { data: request, error: reqError } = await admin
      .from('entry_change_requests')
      .select('*')
      .eq('id', requestId)
      .single();

    if (reqError || !request) return { success: false, error: 'request_not_found' };
    if (request.requested_by !== user.id) return { success: false, error: 'not_authorized' };
    if (request.status !== 'pending') return { success: false, error: 'request_not_pending' };

    if (request.change_type === 'edit' && request.original_timestamp) {
      await admin
        .from('time_entries')
        .update({ timestamp: request.original_timestamp })
        .eq('id', request.entry_id);
    }

    if (request.change_type === 'delete') {
      await admin
        .from('time_entries')
        .update({ status: 'approved' })
        .eq('id', request.entry_id);

      if (request.paired_entry_id) {
        await admin
          .from('time_entries')
          .update({ status: 'approved' })
          .eq('id', request.paired_entry_id);
      }
    }

    await admin
      .from('entry_change_requests')
      .delete()
      .eq('id', requestId);

    return { success: true };
  } catch (error) {
    console.error('Error cancelling change request:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

// ============================================
// Calendar Visualization Helpers
// ============================================

/**
 * Get pending change requests for a list of entry IDs
 * Used for calendar visualization to show edit/delete diffs
 */
export async function getChangeRequestsForEntries(
  entryIds: string[]
): Promise<
  | { success: true; requests: ChangeRequest[] }
  | { success: false; error: string }
> {
  if (entryIds.length === 0) {
    return { success: true, requests: [] };
  }

  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return { success: false, error: 'not_authenticated' };
    }

    const admin = createSupabaseAdminClient();

    // Get all pending change requests for these entries
    const { data: requests, error } = await admin
      .from('entry_change_requests')
      .select('*')
      .in('entry_id', entryIds)
      .eq('status', 'pending');

    if (error) {
      console.error('Error fetching change requests for entries:', error);
      return { success: false, error: 'fetch_failed' };
    }

    return {
      success: true,
      requests: (requests || []).map(toChangeRequest)
    };
  } catch (error) {
    console.error('Unexpected error in getChangeRequestsForEntries:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

// ============================================
// Job-Linked Time Tracking
// ============================================

/**
 * Switch the active job for the current session.
 * Atomically clocks out of the current session and clocks back in with the new job.
 */
export async function switchJob(
  organizationId: string,
  newJobId: string | null
): Promise<ClockResult> {
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return { success: false, error: 'not_authenticated' };
    }

    const admin = createSupabaseAdminClient();

    const [userRole, todayRows] = await Promise.all([
      verifyMembershipFromCache(user.id, organizationId),
      getUserTodayEntries(admin, user.id, organizationId)
    ]);

    if (!userRole) {
      return { success: false, error: 'not_a_member' };
    }

    const timeEntries = toTimeEntries(todayRows);
    const currentState = deriveCurrentClockState(timeEntries);
    if (currentState.status !== 'working') {
      return { success: false, error: 'not_working' };
    }

    const now = new Date();
    const clockOutIso = now.toISOString();
    const clockInIso = new Date(now.getTime() + 1).toISOString();

    const { error: clockOutError } = await admin.from('time_entries').insert({
      user_id: user.id,
      organization_id: organizationId,
      entry_type: 'clock_out',
      timestamp: clockOutIso,
      is_manual: false,
      status: 'approved'
    });

    if (clockOutError) {
      console.error(
        'Error inserting clock_out during switchJob:',
        clockOutError
      );
      return { success: false, error: 'insert_failed' };
    }

    const { data: newEntry, error: clockInError } = await admin
      .from('time_entries')
      .insert({
        user_id: user.id,
        organization_id: organizationId,
        entry_type: 'clock_in',
        timestamp: clockInIso,
        is_manual: false,
        status: 'approved',
        job_id: newJobId
      })
      .select()
      .single();

    if (clockInError || !newEntry) {
      console.error('Error inserting clock_in during switchJob:', clockInError);
      return { success: false, error: 'insert_failed' };
    }

    let jobInfo: import('./types').ClockJobInfo | null = null;

    if (newJobId) {
      jobInfo = await getClockJobInfo(admin, newJobId, {
        includeRelations: false,
        touchStatus: true
      });
    }

    return { success: true, entry: toTimeEntry(newEntry), jobInfo };
  } catch (error) {
    console.error('Unexpected error in switchJob:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

/**
 * Get all time entries linked to a specific job.
 */
export async function getTimeEntriesForJob(
  jobId: string
): Promise<GetTimeEntriesResult> {
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return { success: false, error: 'not_authenticated' };
    }

    const admin = createSupabaseAdminClient();
    const { data: job, error: jobError } = await admin
      .from('jobs')
      .select('id, organization_id')
      .eq('id', jobId)
      .single();

    if (jobError || !job) {
      return { success: false, error: 'fetch_failed' };
    }

    const callerRole = await verifyMembershipFromCache(user.id, job.organization_id);
    if (!callerRole) {
      return { success: false, error: 'not_a_member' };
    }

    if (callerRole !== 'admin' && callerRole !== 'buero') {
      const { data: assignment } = await admin
        .from('job_assignments')
        .select('id')
        .eq('job_id', jobId)
        .eq('user_id', user.id)
        .maybeSingle();

      if (!assignment) {
        return { success: false, error: 'not_authorized' };
      }
    }

    const { data: jobClockIns, error: jobClockInsError } = await admin
      .from('time_entries')
      .select('*')
      .eq('organization_id', job.organization_id)
      .eq('entry_type', 'clock_in')
      .eq('job_id', jobId)
      .neq('status', 'rejected')
      .order('timestamp', { ascending: true });

    if (jobClockInsError) {
      console.error('Error fetching clock-ins for job:', jobClockInsError);
      return { success: false, error: 'fetch_failed' };
    }

    const targetClockIns = toTimeEntries(jobClockIns || []);
    if (targetClockIns.length === 0) {
      return { success: true, entries: [] };
    }

    const userIds = [...new Set(targetClockIns.map((entry) => entry.userId))];
    const organizationIds = [
      ...new Set(targetClockIns.map((entry) => entry.organizationId))
    ];
    const targetDayKeys = new Set(
      targetClockIns.map(
        (entry) =>
          `${entry.userId}:${entry.organizationId}:${getLocalDayKey(new Date(entry.timestamp))}`
      )
    );
    const timestamps = targetClockIns.map((entry) =>
      new Date(entry.timestamp).getTime()
    );
    const rangeStart = getLocalDayStart(
      new Date(Math.min(...timestamps))
    ).toISOString();
    const rangeEnd = getLocalDayEnd(new Date(Math.max(...timestamps))).toISOString();

    const { data, error } = await admin
      .from('time_entries')
      .select('*')
      .in('user_id', userIds)
      .in('organization_id', organizationIds)
      .gte('timestamp', rangeStart)
      .lte('timestamp', rangeEnd)
      .neq('status', 'rejected')
      .order('timestamp', { ascending: true })
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error fetching session-aware time entries for job:', error);
      return { success: false, error: 'fetch_failed' };
    }

    const relevantEntries = toTimeEntries(data || []).filter((entry) =>
      targetDayKeys.has(
        `${entry.userId}:${entry.organizationId}:${getLocalDayKey(new Date(entry.timestamp))}`
      )
    );
    const entriesByUserDay = new Map<string, TimeEntry[]>();

    for (const entry of relevantEntries) {
      const key = `${entry.userId}:${entry.organizationId}:${getLocalDayKey(new Date(entry.timestamp))}`;
      const existing = entriesByUserDay.get(key);
      if (existing) {
        existing.push(entry);
      } else {
        entriesByUserDay.set(key, [entry]);
      }
    }

    const dedupedEntries = new Map<string, TimeEntry>();

    for (const entriesForDay of entriesByUserDay.values()) {
      const sessions = calculateWorkSessions(entriesForDay).filter(
        (session) => session.clockIn?.jobId === jobId
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

    const participantUserIds = [
      ...new Set([...dedupedEntries.values()].map((entry) => entry.userId))
    ];
    let participants: JobTimeParticipant[] = [];

    if (participantUserIds.length > 0) {
      const { data: participantProfiles, error: participantProfilesError } = await admin
        .from('profiles')
        .select('id, first_name, last_name, email, avatar_path')
        .in('id', participantUserIds);

      if (participantProfilesError) {
        console.error(
          'Error fetching participant profiles for job time entries:',
          participantProfilesError
        );
      } else {
        participants = (participantProfiles ?? []).map((profile) => ({
          userId: profile.id,
          firstName: profile.first_name ?? null,
          lastName: profile.last_name ?? null,
          email: profile.email ?? null,
          avatarPath: profile.avatar_path ?? null,
        }));
      }
    }

    return {
      success: true,
      entries: [...dedupedEntries.values()].sort((a, b) => {
          const timestampDiff =
            new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
          if (timestampDiff !== 0) return timestampDiff;
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        }),
      participants,
    };
  } catch (error) {
    console.error('Unexpected error in getTimeEntriesForJob:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

/**
 * Get the job_id from the user's currently open clock-in entry (if any).
 */
export async function getActiveJobId(
  organizationId: string
): Promise<
  | { success: true; jobId: string | null; isClockedIn: boolean }
  | { success: false; error: string }
> {
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return { success: false, error: 'not_authenticated' };
    }

    const admin = createSupabaseAdminClient();
    const todayRows = await getUserTodayEntries(admin, user.id, organizationId);
    const timeEntries = toTimeEntries(todayRows);

    const currentState = deriveCurrentClockState(timeEntries);
    if (!currentState.isClockedIn) {
      return { success: true, jobId: null, isClockedIn: false };
    }

    return {
      success: true,
      jobId: currentState.activeJobId,
      isClockedIn: true
    };
  } catch (error) {
    console.error('Unexpected error in getActiveJobId:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

/**
 * Combined clock status + active job in a single call.
 * Fetches today's entries only ONCE (instead of twice for getClockStatus + getActiveJobId).
 * Used by ClockFAB.
 */
export async function getClockStatusWithActiveJob(
  organizationId: string
): Promise<
  | {
      success: true;
      isClockedIn: boolean;
      lastEntry: TimeEntry | null;
      activeJobId: string | null;
    }
  | { success: false; error: string }
> {
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return { success: false, error: 'not_authenticated' };
    }

    const admin = createSupabaseAdminClient();
    const [userRole, todayRows] = await Promise.all([
      verifyMembershipFromCache(user.id, organizationId),
      getUserTodayEntries(admin, user.id, organizationId)
    ]);

    if (!userRole) {
      return { success: false, error: 'not_a_member' };
    }

    const timeEntries = toTimeEntries(todayRows);
    const currentState = deriveCurrentClockState(timeEntries);

    return {
      success: true,
      isClockedIn: currentState.isClockedIn,
      lastEntry: currentState.lastEntry,
      activeJobId: currentState.activeJobId
    };
  } catch (error) {
    console.error('Unexpected error in getClockStatusWithActiveJob:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

/**
 * Get the caller's current clock state together with active job info.
 * Used by the shared client clock state and Zeiterfassung overview prefetch.
 */
export async function getCurrentClockState(
  organizationId: string
): Promise<
  { success: true; state: LiveClockState } | { success: false; error: string }
> {
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return { success: false, error: 'not_authenticated' };
    }

    const admin = createSupabaseAdminClient();
    const [userRole, todayRows, organizationSettings] = await Promise.all([
      verifyMembershipFromCache(user.id, organizationId),
      getUserTodayEntries(admin, user.id, organizationId),
      getCachedOrganizationSettings(organizationId)
    ]);

    if (!userRole) {
      return { success: false, error: 'not_a_member' };
    }

    const timeEntries = toTimeEntries(todayRows);
    const currentState = deriveCurrentClockState(timeEntries);
    const workSessions = calculateWorkSessions(timeEntries);
    const breakSessions = calculateBreakSessions(timeEntries);
    const timelineSegments = buildClockTimelineSegments(timeEntries, new Date(), {
      sameLocalDayOnly: true,
      includeOpenSegment: false
    });
    const trackedWorkMinutes = calculateTotalMinutes(workSessions);
    const trackedBreakMinutes = calculateBreakMinutes(breakSessions);
    const todayMinutes = trackedWorkMinutes + trackedBreakMinutes;
    const breakdown = computeBreakdownForSettings(
      todayMinutes,
      trackedBreakMinutes,
      organizationSettings
    );
    const activeJobInfo = currentState.activeJobId
      ? await getClockJobInfo(admin, currentState.activeJobId)
      : null;

    return {
      success: true,
      state: {
        organizationId,
        breakMode: organizationSettings.breakMode,
        autoBreakThresholdMinutes: organizationSettings.autoBreakThresholdMinutes,
        autoBreakDurationMinutes: organizationSettings.autoBreakDurationMinutes,
        status: currentState.status,
        isClockedIn: currentState.isClockedIn,
        isOnBreak: currentState.isOnBreak,
        clockInTime: currentState.clockInTime,
        statusStartedAt: currentState.statusStartedAt,
        breakStartTime: currentState.breakStartTime,
        todayMinutes,
        workMinutes: breakdown.workMinutes,
        breakMinutes: breakdown.breakMinutes,
        timelineSegments,
        activeJobId: currentState.activeJobId,
        activeJobInfo,
        fetchedAt: new Date().toISOString()
      }
    };
  } catch (error) {
    console.error('Unexpected error in getCurrentClockState:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

/**
 * Get minimal info for a single job by ID.
 * Used by ClockFAB to display the active job pill without loading all org jobs.
 */
export async function getJobInfoById(jobId: string): Promise<
  | {
      success: true;
      job: {
        id: string;
        title: string;
        jobNumber: string | null;
        status: string;
        projectName: string | null;
        clientName: string | null;
      } | null;
    }
  | { success: false; error: string }
> {
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return { success: false, error: 'not_authenticated' };
    }

    const admin = createSupabaseAdminClient();
    const job = await getClockJobInfo(admin, jobId);
    if (!job) {
      return { success: true, job: null };
    }

    return {
      success: true,
      job
    };
  } catch (error) {
    console.error('Unexpected error in getJobInfoById:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

/**
 * Get jobs assigned to a specific user in an organization.
 * Used by clock-in job picker and Zeiterfassung dashboard.
 */
export async function getAssignedJobs(
  organizationId: string,
  userId?: string
): Promise<
  | {
      success: true;
      jobs: Array<{
        id: string;
        title: string;
        jobNumber: string | null;
        status: string;
        projectName: string | null;
      }>;
    }
  | { success: false; error: string }
> {
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return { success: false, error: 'not_authenticated' };
    }

    const targetUserId = userId || user.id;
    const admin = createSupabaseAdminClient();

    const { data: assignments, error: assignError } = await admin
      .from('job_assignments')
      .select('job_id')
      .eq('user_id', targetUserId);

    if (assignError) {
      console.error('Error fetching job assignments:', assignError);
      return { success: false, error: 'fetch_failed' };
    }

    if (!assignments || assignments.length === 0) {
      return { success: true, jobs: [] };
    }

    const jobIds = assignments.map((a) => a.job_id);

    const { data: jobs, error: jobsError } = await admin
      .from('jobs')
      .select('id, title, description, job_number, status, project_id')
      .eq('organization_id', organizationId)
      .in('id', jobIds)
      .neq('status', 'fertig')
      .order('planned_date', { ascending: true, nullsFirst: false });

    if (jobsError) {
      console.error('Error fetching assigned jobs:', jobsError);
      return { success: false, error: 'fetch_failed' };
    }

    const projectIds = (jobs || [])
      .map((j) => j.project_id)
      .filter((id): id is string => id !== null);

    let projectMap: Record<string, string> = {};
    if (projectIds.length > 0) {
      const { data: projects } = await admin
        .from('projects')
        .select('id, name')
        .in('id', projectIds);

      if (projects) {
        projectMap = Object.fromEntries(projects.map((p) => [p.id, p.name]));
      }
    }

    return {
      success: true,
      jobs: (jobs || []).map((j) => ({
        id: j.id,
        title: getJobDisplayTitle({
          title: j.title,
          description: j.description
        }),
        jobNumber: j.job_number,
        status: j.status,
        projectName: j.project_id ? (projectMap[j.project_id] ?? null) : null
      }))
    };
  } catch (error) {
    console.error('Unexpected error in getAssignedJobs:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

/**
 * Get ALL org jobs (for admin/manager use in manual entry dialog).
 */
export async function getAllOrgJobs(organizationId: string): Promise<
  | {
      success: true;
      jobs: Array<{
        id: string;
        title: string;
        jobNumber: string | null;
        status: string;
        projectName: string | null;
      }>;
    }
  | { success: false; error: string }
> {
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return { success: false, error: 'not_authenticated' };
    }

    const admin = createSupabaseAdminClient();

    const { data: jobs, error: jobsError } = await admin
      .from('jobs')
      .select('id, title, description, job_number, status, project_id')
      .eq('organization_id', organizationId)
      .neq('status', 'fertig')
      .order('planned_date', { ascending: true, nullsFirst: false });

    if (jobsError) {
      console.error('Error fetching all org jobs:', jobsError);
      return { success: false, error: 'fetch_failed' };
    }

    const projectIds = (jobs || [])
      .map((j) => j.project_id)
      .filter((id): id is string => id !== null);

    let projectMap: Record<string, string> = {};
    if (projectIds.length > 0) {
      const { data: projects } = await admin
        .from('projects')
        .select('id, name')
        .in('id', projectIds);

      if (projects) {
        projectMap = Object.fromEntries(projects.map((p) => [p.id, p.name]));
      }
    }

    return {
      success: true,
      jobs: (jobs || []).map((j) => ({
        id: j.id,
        title: getJobDisplayTitle({
          title: j.title,
          description: j.description
        }),
        jobNumber: j.job_number,
        status: j.status,
        projectName: j.project_id ? (projectMap[j.project_id] ?? null) : null
      }))
    };
  } catch (error) {
    console.error('Unexpected error in getAllOrgJobs:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

type PickerJob = {
  id: string;
  title: string;
  jobNumber: string | null;
  status: string;
  projectName: string | null;
  clientName: string | null;
};

/**
 * Get jobs for the clock-in / job-switch picker.
 * Admin/manager: all non-archived org jobs.
 * Employee: only assigned, non-archived jobs.
 */
export async function getJobsForPicker(
  organizationId: string
): Promise<
  { success: true; jobs: PickerJob[] } | { success: false; error: string }
> {
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return { success: false, error: 'not_authenticated' };
    }

    const role = await verifyMembershipFromCache(user.id, organizationId);
    if (!role) {
      return { success: false, error: 'not_a_member' };
    }

    const admin = createSupabaseAdminClient();
    const isManagerOrAbove = role === 'admin' || role === 'buero';

    let jobIds: string[] | null = null;

    if (!isManagerOrAbove) {
      const { data: assignments, error: assignError } = await admin
        .from('job_assignments')
        .select('job_id')
        .eq('user_id', user.id);

      if (assignError) {
        console.error('Error fetching job assignments:', assignError);
        return { success: false, error: 'fetch_failed' };
      }

      if (!assignments || assignments.length === 0) {
        return { success: true, jobs: [] };
      }

      jobIds = assignments.map((a) => a.job_id);
    }

    let query = admin
      .from('jobs')
      .select('id, title, description, job_number, status, project_id, client_id')
      .eq('organization_id', organizationId)
      .neq('status', 'fertig')
      .order('title', { ascending: true });

    if (jobIds) {
      query = query.in('id', jobIds);
    }

    const { data: jobs, error: jobsError } = await query;

    if (jobsError) {
      console.error('Error fetching picker jobs:', jobsError);
      return { success: false, error: 'fetch_failed' };
    }

    const projectIds = (jobs || [])
      .map((j) => j.project_id)
      .filter((id): id is string => id !== null);
    const clientIds = (jobs || [])
      .map((j) => j.client_id)
      .filter((id): id is string => id !== null);

    let projectMap: Record<string, string> = {};
    let clientMap: Record<string, string> = {};

    const [projectsData, clientsData] = await Promise.all([
      projectIds.length > 0
        ? admin
            .from('projects')
            .select('id, name')
            .in('id', [...new Set(projectIds)])
        : null,
      clientIds.length > 0
        ? admin
            .from('clients')
            .select('id, name')
            .in('id', [...new Set(clientIds)])
        : null
    ]);

    if (projectsData?.data) {
      projectMap = Object.fromEntries(
        projectsData.data.map((p) => [p.id, p.name])
      );
    }
    if (clientsData?.data) {
      clientMap = Object.fromEntries(
        clientsData.data.map((c) => [c.id, c.name])
      );
    }

    return {
      success: true,
      jobs: (jobs || []).map((j) => ({
        id: j.id,
        title: getJobDisplayTitle({
          title: j.title,
          description: j.description
        }),
        jobNumber: j.job_number,
        status: j.status,
        projectName: j.project_id ? (projectMap[j.project_id] ?? null) : null,
        clientName: j.client_id ? (clientMap[j.client_id] ?? null) : null
      }))
    };
  } catch (error) {
    console.error('Unexpected error in getJobsForPicker:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

/**
 * Get the set of job IDs that currently have at least one worker clocked in.
 * Used for the "active work" pulsation indicator across all tables.
 */
export async function getActiveJobIdsForOrg(
  organizationId: string
): Promise<
  { success: true; activeJobIds: string[] } | { success: false; error: string }
> {
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return { success: false, error: 'not_authenticated' };
    }

    const admin = createSupabaseAdminClient();
    const { start } = getTodayBounds();

    const { data: todayEntries, error } = await admin
      .from('time_entries')
      .select('user_id, entry_type, timestamp, job_id')
      .eq('organization_id', organizationId)
      .gte('timestamp', start.toISOString())
      .lte('timestamp', new Date().toISOString())
      .neq('status', 'rejected')
      .neq('status', 'pending_delete')
      .order('timestamp', { ascending: false });

    if (error) {
      console.error('Error fetching active job ids:', error);
      return { success: false, error: 'fetch_failed' };
    }

    const activeJobIds = new Set<string>();
    const seenUsers = new Set<string>();

    for (const row of todayEntries || []) {
      const uid = row.user_id as string;
      if (seenUsers.has(uid)) continue;
      seenUsers.add(uid);

      if (isWorkingEntryType(row.entry_type) && row.job_id) {
        activeJobIds.add(row.job_id as string);
      }
    }

    return { success: true, activeJobIds: [...activeJobIds] };
  } catch (error) {
    console.error('Unexpected error in getActiveJobIdsForOrg:', error);
    return { success: false, error: 'unexpected_error' };
  }
}
