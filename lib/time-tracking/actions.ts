'use server';

import { cookies } from 'next/headers';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { CURRENT_ORG_COOKIE } from '@/lib/org/cookies';
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
  toTimeEntry,
  toTimeEntries,
  MANAGED_ROLES
} from './types';
import {
  hasOpenSession,
  determineApprovalStatus,
  canManageEntries,
  canApproveEntries,
  canAddEntriesFor
} from './helpers';
import { validateManualEntries, validateTimestampUpdate } from './validation';

/**
 * Get the current organization ID from cookies
 */
async function getCurrentOrgId(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(CURRENT_ORG_COOKIE)?.value || null;
}

/**
 * Get user's role in the organization
 */
async function getUserRole(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  userId: string,
  orgId: string
): Promise<OrgRole | null> {
  const { data } = await supabase
    .from('organization_members')
    .select('role')
    .eq('user_id', userId)
    .eq('organization_id', orgId)
    .single();

  return data?.role as OrgRole | null;
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

    const orgId = organizationId || (await getCurrentOrgId());
    if (!orgId) {
      return { success: false, error: 'no_active_org' };
    }

    // Verify user is member of org
    const userRole = await getUserRole(supabase, user.id, orgId);
    if (!userRole) {
      return { success: false, error: 'not_a_member' };
    }

    const admin = createSupabaseAdminClient();

    // Get user's entries
    const entries = await getUserEntries(admin, user.id, orgId);
    const timeEntries = toTimeEntries(entries);

    // Check if user already has an open session
    if (hasOpenSession(timeEntries)) {
      return { success: false, error: 'already_clocked_in' };
    }

    // Insert clock_in entry
    const { data: newEntry, error: insertError } = await admin
      .from('time_entries')
      .insert({
        user_id: user.id,
        organization_id: orgId,
        entry_type: 'clock_in',
        timestamp: new Date().toISOString(),
        is_manual: false,
        status: 'approved' // Real-time entries are always approved
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

    const orgId = organizationId || (await getCurrentOrgId());
    if (!orgId) {
      return { success: false, error: 'no_active_org' };
    }

    // Verify user is member of org
    const userRole = await getUserRole(supabase, user.id, orgId);
    if (!userRole) {
      return { success: false, error: 'not_a_member' };
    }

    const admin = createSupabaseAdminClient();

    // Get user's entries
    const entries = await getUserEntries(admin, user.id, orgId);
    const timeEntries = toTimeEntries(entries);

    // Check if user has an open session
    if (!hasOpenSession(timeEntries)) {
      return { success: false, error: 'not_clocked_in' };
    }

    // Insert clock_out entry
    const { data: newEntry, error: insertError } = await admin
      .from('time_entries')
      .insert({
        user_id: user.id,
        organization_id: orgId,
        entry_type: 'clock_out',
        timestamp: new Date().toISOString(),
        is_manual: false,
        status: 'approved' // Real-time entries are always approved
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

    // Verify caller is member of org
    const callerRole = await getUserRole(supabase, user.id, organizationId);
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

    // Get caller's role in the org
    const callerRole = await getUserRole(
      supabase,
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

    // Update the entry
    const { data: updatedEntry, error: updateError } = await admin
      .from('time_entries')
      .update({
        status: decision,
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
 */
export async function updateEntry(
  entryId: string,
  fields: { timestamp?: string }
): Promise<UpdateEntryResult> {
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

    // Get caller's role in the org
    const callerRole = await getUserRole(
      supabase,
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

    // Update the entry
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
 */
export async function deleteEntry(entryId: string): Promise<DeleteEntryResult> {
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

    // Get caller's role in the org
    const callerRole = await getUserRole(
      supabase,
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

    // Delete the entry
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

    // Verify caller is member of org
    const callerRole = await getUserRole(supabase, user.id, organizationId);
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

    // Filter by user if specified
    if (userId) {
      query = query.eq('user_id', userId);
    }

    // Filter by status if specified
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

    const orgId = organizationId || (await getCurrentOrgId());
    if (!orgId) {
      return { success: false, error: 'no_active_org' };
    }

    // Verify caller is member of org
    const callerRole = await getUserRole(supabase, user.id, orgId);
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

    const orgId = organizationId || (await getCurrentOrgId());
    if (!orgId) {
      return { success: false, error: 'no_active_org' };
    }

    // Verify caller is member of org
    const callerRole = await getUserRole(supabase, user.id, orgId);
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

    const orgId = organizationId || (await getCurrentOrgId());
    if (!orgId) {
      return { success: false, error: 'no_active_org' };
    }

    // Verify caller is member of org and is admin or manager
    const callerRole = await getUserRole(supabase, user.id, orgId);
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
      // Manager can only see managed roles
      return MANAGED_ROLES.includes(member.role as OrgRole);
    });

    // For each visible member, check if they have an open session
    const clockedInUsers: GetCurrentlyClockedInResult['users'] = [];

    for (const member of visibleMembers) {
      const entries = await getUserEntries(admin, member.user_id, orgId);
      const timeEntries = toTimeEntries(entries);

      if (hasOpenSession(timeEntries)) {
        // Get the clock_in timestamp
        const lastClockIn = timeEntries
          .filter((e) => e.status === 'approved' && e.entryType === 'clock_in')
          .sort(
            (a, b) =>
              new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
          )[0];

        const profile = member.profiles as {
          first_name: string | null;
          last_name: string | null;
        } | null;

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

    const orgId = organizationId || (await getCurrentOrgId());
    if (!orgId) {
      return { success: false, error: 'no_active_org' };
    }

    // Verify user is member of org
    const userRole = await getUserRole(supabase, user.id, orgId);
    if (!userRole) {
      return { success: false, error: 'not_a_member' };
    }

    const admin = createSupabaseAdminClient();
    const entries = await getUserEntries(admin, user.id, orgId);
    const timeEntries = toTimeEntries(entries);

    const isClockedIn = hasOpenSession(timeEntries);
    const lastEntry = timeEntries.length > 0 ? timeEntries[0] : null;

    return { success: true, isClockedIn, lastEntry };
  } catch (error) {
    console.error('Unexpected error in getClockStatus:', error);
    return { success: false, error: 'unexpected_error' };
  }
}
