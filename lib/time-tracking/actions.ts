'use server';

import { cookies } from 'next/headers';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { resolveActiveOrgId } from '@/lib/org/cookies';
import { getCachedMemberships } from '@/lib/data/cached';
import {
  type TimeEntry,
  type TimeEntryRow,
  type OrgRole,
  type ClockResult,
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
  type EntryChangeRequestMap,
  toTimeEntry,
  toTimeEntries,
  toChangeRequest,
  MANAGED_ROLES
} from './types';
import {
  hasOpenSession,
  determineApprovalStatus,
  canManageEntries,
  canApproveEntries,
  canAddEntriesFor,
  needsChangeRequest
} from './helpers';
import { validateManualEntries, validateTimestampUpdate } from './validation';

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
 * Get only today's entries for the user in an org.
 * Much faster than getUserEntries for clock status checks.
 */
async function getUserTodayEntries(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  userId: string,
  orgId: string
): Promise<TimeEntryRow[]> {
  const { start, end } = getTodayBounds();

  const { data, error } = await admin
    .from('time_entries')
    .select('*')
    .eq('user_id', userId)
    .eq('organization_id', orgId)
    .gte('timestamp', start.toISOString())
    .lte('timestamp', end.toISOString())
    .neq('status', 'rejected')
    .neq('status', 'pending_delete')
    .order('timestamp', { ascending: false });

  if (error) {
    console.error('Error fetching user today entries:', error);
    return [];
  }

  return data || [];
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

type TodayBounds = {
  start: Date;
  end: Date;
};

function getTodayBounds(): TodayBounds {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    23,
    59,
    59,
    999
  );
  return { start, end };
}

type OpenSessionOrg = { organizationId: string; organizationName: string };

async function getOpenSessionOrgsForUserToday(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  userId: string
): Promise<OpenSessionOrg[]> {
  const { start, end } = getTodayBounds();

  const { data: rows, error } = await admin
    .from('time_entries')
    .select('organization_id, entry_type, timestamp, status')
    .eq('user_id', userId)
    .gte('timestamp', start.toISOString())
    .lte('timestamp', end.toISOString())
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

    if (row.entry_type === 'clock_in') {
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

// ============================================
// Real-Time Clock In/Out Actions
// ============================================

/**
 * Clock in for the current user (real-time)
 */
export async function clockIn(organizationId?: string): Promise<ClockResult> {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user }
    } = await supabase.auth.getUser();

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
    if (hasOpenSession(timeEntries)) {
      return { success: false, error: 'already_clocked_in' };
    }

    const { data: newEntry, error: insertError } = await admin
      .from('time_entries')
      .insert({
        user_id: user.id,
        organization_id: orgId,
        entry_type: 'clock_in',
        timestamp: new Date().toISOString(),
        is_manual: false,
        status: 'approved'
      })
      .select()
      .single();

    if (insertError || !newEntry) {
      console.error('Error inserting clock_in:', insertError);
      return { success: false, error: 'insert_failed' };
    }

    return { success: true, entry: toTimeEntry(newEntry) };
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
    const supabase = await createSupabaseServerClient();
    const {
      data: { user }
    } = await supabase.auth.getUser();

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
    if (!hasOpenSession(timeEntries)) {
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

/**
 * Best-effort: clock out the current user in any org where they are currently working today.
 * Used before sign-out so users don't get "stuck clocked in".
 */
export async function clockOutBeforeSignOut(): Promise<
  | { success: true; clockedOutOrgIds: string[] }
  | { success: false; error: string }
> {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user }
    } = await supabase.auth.getUser();

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
    const supabase = await createSupabaseServerClient();
    const {
      data: { user }
    } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: 'not_authenticated' };
    }

    const { organizationId, targetUserId, entries } = params;

    const callerRole = await verifyMembershipFromCache(user.id, organizationId);
    if (!callerRole) {
      return { success: false, error: 'not_a_member' };
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

    // Get target user's existing entries
    const existingEntries = await getUserEntries(
      admin,
      targetUserId,
      organizationId
    );
    const timeEntries = toTimeEntries(existingEntries);

    // Validate the new entries
    const validationResult = validateManualEntries(timeEntries, entries);
    if (!validationResult.valid) {
      return {
        success: false,
        error: validationResult.error || 'validation_failed'
      };
    }

    // Determine approval status
    const status = determineApprovalStatus(callerRole, targetUserId, user.id);

    // Cross-org guard: only run if these entries would result in an "open session" today
    const simulatedEntries: TimeEntry[] = entries.map((e, idx) => ({
      id: `simulated-${idx}`,
      userId: targetUserId,
      organizationId,
      entryType: e.entryType,
      timestamp: e.timestamp,
      isManual: true,
      status,
      reviewedBy: null,
      reviewedAt: null,
      createdAt: e.timestamp,
      updatedAt: e.timestamp
    }));

    const wouldBeClockedIn = hasOpenSession([
      ...timeEntries,
      ...simulatedEntries
    ]);
    if (wouldBeClockedIn) {
      const openOrgs = await getOpenSessionOrgsForUserToday(
        admin,
        targetUserId
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

    // Insert entries
    const insertData = entries.map((entry) => ({
      user_id: targetUserId,
      organization_id: organizationId,
      entry_type: entry.entryType,
      timestamp: entry.timestamp,
      is_manual: true,
      status,
      // If immediately approved by admin/manager, record who approved
      reviewed_by: status === 'approved' ? user.id : null,
      reviewed_at: status === 'approved' ? new Date().toISOString() : null
    }));

    const { data: newEntries, error: insertError } = await admin
      .from('time_entries')
      .insert(insertData)
      .select();

    if (insertError || !newEntries) {
      console.error('Error inserting manual entries:', insertError);
      return { success: false, error: 'insert_failed' };
    }

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
    const supabase = await createSupabaseServerClient();
    const {
      data: { user }
    } = await supabase.auth.getUser();

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

    const callerRole = await verifyMembershipFromCache(user.id, entry.organization_id);
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
  fields: { timestamp?: string }
): Promise<UpdateEntryResult | RequestChangeResult> {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user }
    } = await supabase.auth.getUser();

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

    const callerRole = await verifyMembershipFromCache(user.id, entry.organization_id);
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
      if (fields.timestamp) {
        const { error: updateError } = await admin
          .from('time_entries')
          .update({ timestamp: fields.timestamp })
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
    const supabase = await createSupabaseServerClient();
    const {
      data: { user }
    } = await supabase.auth.getUser();

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

    const callerRole = await verifyMembershipFromCache(user.id, entry.organization_id);
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
    const supabase = await createSupabaseServerClient();
    const {
      data: { user }
    } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: 'not_authenticated' };
    }

    const { organizationId, from, to, userId, status } = params;

    // Verify caller is member of org (cache hit for repeated calls)
    const callerRole = await verifyMembershipFromCache(user.id, organizationId);
    if (!callerRole) {
      return { success: false, error: 'not_a_member' };
    }

    // Build query - RLS will handle visibility
    let query = supabase
      .from('time_entries')
      .select('*')
      .eq('organization_id', organizationId)
      .gte('timestamp', from)
      .lte('timestamp', to)
      .order('timestamp', { ascending: true });

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

    return { success: true, entries: toTimeEntries(data || []) };
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
    const supabase = await createSupabaseServerClient();
    const {
      data: { user }
    } = await supabase.auth.getUser();

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
    if (callerRole !== 'admin' && callerRole !== 'manager') {
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
      // Admin can review all pending entries
      return { success: true, entries: toTimeEntries(pendingEntries || []) };
    }

    // Manager can only review entries for managed roles
    const filteredEntries: TimeEntryRow[] = [];

    for (const entry of pendingEntries || []) {
      // Get the entry owner's role
      const { data: targetMember } = await admin
        .from('organization_members')
        .select('role')
        .eq('user_id', entry.user_id)
        .eq('organization_id', orgId)
        .single();

      if (
        targetMember &&
        MANAGED_ROLES.includes(targetMember.role as OrgRole)
      ) {
        filteredEntries.push(entry);
      }
    }

    return { success: true, entries: toTimeEntries(filteredEntries) };
  } catch (error) {
    console.error('Unexpected error in getPendingEntries:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

/**
 * Get pending sessions (entries grouped as pairs with user profile info)
 */
export async function getPendingSessions(
  organizationId?: string
): Promise<GetPendingSessionsResult> {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user }
    } = await supabase.auth.getUser();

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
    if (callerRole !== 'admin' && callerRole !== 'manager') {
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
    const filteredEntries: TimeEntryRow[] = [];

    for (const entry of pendingEntries) {
      if (callerRole === 'admin') {
        filteredEntries.push(entry);
      } else {
        // Manager - check if target user is in managed roles
        const { data: targetMember } = await admin
          .from('organization_members')
          .select('role')
          .eq('user_id', entry.user_id)
          .eq('organization_id', orgId)
          .single();

        if (
          targetMember &&
          MANAGED_ROLES.includes(targetMember.role as OrgRole)
        ) {
          filteredEntries.push(entry);
        }
      }
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
          date: clockIn.timestamp.split('T')[0],
          createdAt: entry.created_at
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
          date: entry.timestamp.split('T')[0],
          createdAt: entry.created_at
        });
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
    const supabase = await createSupabaseServerClient();
    const {
      data: { user }
    } = await supabase.auth.getUser();

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

    if (callerRole !== 'admin' && callerRole !== 'manager') {
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

    // Filter members based on caller's role
    const visibleMembers = (members || []).filter((member) => {
      if (callerRole === 'admin') {
        return true;
      }
      // Manager can see managed roles AND themselves
      return (
        MANAGED_ROLES.includes(member.role as OrgRole) ||
        member.user_id === user.id
      );
    });

    // For each visible member, check if they have an open session
    const clockedInUsers: Array<{
      userId: string;
      clockInTime: string;
      firstName: string | null;
      lastName: string | null;
    }> = [];

    for (const member of visibleMembers) {
      const entries = await getUserEntries(admin, member.user_id, orgId);
      const timeEntries = toTimeEntries(entries);

      if (hasOpenSession(timeEntries)) {
        // Get the clock_in timestamp (include pending entries as they take immediate effect)
        // Exclude rejected and pending_delete entries
        const lastClockIn = timeEntries
          .filter(
            (e) =>
              e.status !== 'rejected' &&
              e.status !== 'pending_delete' &&
              e.entryType === 'clock_in'
          )
          .sort(
            (a, b) =>
              new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
          )[0];

        // Handle profiles which may be returned as array or single object from Supabase
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
          clockInTime: lastClockIn?.timestamp || '',
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
    const supabase = await createSupabaseServerClient();
    const {
      data: { user }
    } = await supabase.auth.getUser();

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
    const isClockedIn = hasOpenSession(timeEntries);
    const lastEntry = timeEntries.length > 0 ? timeEntries[0] : null;

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
    const supabase = await createSupabaseServerClient();
    const {
      data: { user }
    } = await supabase.auth.getUser();

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

    // Enrich requests with entry and requester info
    const enrichedRequests: ChangeRequestWithDetails[] = [];

    for (const request of requests || []) {
      // Get the entry
      const { data: entry } = await admin
        .from('time_entries')
        .select('*')
        .eq('id', request.entry_id)
        .single();

      if (!entry) continue;

      // Get paired entry if exists (for paired delete requests)
      let pairedEntry: typeof entry | null = null;
      if (request.paired_entry_id) {
        const { data: paired } = await admin
          .from('time_entries')
          .select('*')
          .eq('id', request.paired_entry_id)
          .single();
        pairedEntry = paired;
      }

      // Get requester profile
      const { data: profile } = await admin
        .from('profiles')
        .select('first_name, last_name')
        .eq('id', request.requested_by)
        .single();

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
    const supabase = await createSupabaseServerClient();
    const {
      data: { user }
    } = await supabase.auth.getUser();

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

    const callerRole = await verifyMembershipFromCache(user.id, request.organization_id);
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
    const supabase = await createSupabaseServerClient();
    const {
      data: { user }
    } = await supabase.auth.getUser();

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
