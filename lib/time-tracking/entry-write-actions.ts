'use server';
import { loggedRead } from '@/lib/data/read-request-cache';
import { revalidatePath } from 'next/cache';
import { logError } from '@/lib/logging';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import { readInBatches } from '@/lib/supabase/query-batches';
import { getAuthenticatedUser } from '@/lib/data/cached';
import { readOrganizationSettings } from './organization-settings-read';
import {
  addManualEntryInputSchema,
  deleteEntryInputSchema,
  entryIdListSchema,
  updateEntryInputSchema,
} from './action-schemas';
import {
  type TimeEntryType,
  type AddManualEntryParams,
  type AddManualEntryResult,
  type UpdateEntryResult,
  type DeleteEntryResult,
  type RequestChangeResult,
  toTimeEntry,
  toTimeEntries,
} from './types';
import { canManageEntries, canAddEntriesFor } from './helpers';
import {
  entriesTouchClosedTimePeriod,
  timeEntryBatchFailure,
  timeWriteFailure,
  touchesClosedTimePeriod,
} from './closed-periods';
import { refuseEntryEdit } from './entry-edit-checks';
import { verifyCurrentMembership } from './action-access';
import { stageManualEntries } from './manual-entry-staging';

// The Server Actions that write time entries: manual entries, edits and deletes.

/**
 * The action failure of a refused manual entry insert. The database refuses
 * an employee's job whose assignment was removed after
 * attachManualEntryJob (manual-entry-staging.ts) read it (migration
 * 20261029212937_recheck_manual_entry_job_assignment.sql).
 */
function manualEntryInsertFailure(error: { message: string } | null): string {
  if (error?.message === 'manual_entry_job_not_assigned') return 'job_not_assigned';
  return timeWriteFailure('Error inserting manual entries:', error, 'insert_failed');
}

function isManualBreakEntry(entry: { entryType: TimeEntryType }): boolean {
  return entry.entryType === 'break_start' || entry.entryType === 'break_end';
}

// ============================================
// Manual Entry Actions
// ============================================

/**
 * Add manual time entries
 */
export async function addManualEntry(rawParams: AddManualEntryParams): Promise<AddManualEntryResult> {
  try {
    const parsed = addManualEntryInputSchema.safeParse(rawParams);
    if (!parsed.success) return { success: false, error: 'invalid_input' };
    const params = parsed.data;
    const user = await getAuthenticatedUser();
    if (!user) {
      return { success: false, error: 'not_authenticated' };
    }

    const { organizationId, targetUserId, entries } = params;

    const [firstEntry] = entries;
    if (!firstEntry) return { success: false, error: 'validation_failed' };

    const [callerRole, organizationSettings] = await Promise.all([
      verifyCurrentMembership(organizationId),
      readOrganizationSettings(organizationId),
    ]);
    if (!callerRole) {
      return { success: false, error: 'not_a_member' };
    }
    if (!organizationSettings) return { success: false, error: 'fetch_failed' };

    if (organizationSettings.breakMode === 'automatic' && entries.some(isManualBreakEntry)) {
      return { success: false, error: 'break_mode_automatic' };
    }

    const admin = createSupabaseAdminClient();

    // Get target user's role
    const { data: targetMember, error: targetMemberError } = await loggedRead(
      'addManualEntry: organization_members read failed',
      admin
        .from('organization_members')
        .select('role')
        .eq('user_id', targetUserId)
        .eq('organization_id', organizationId)
        .maybeSingle(),
    );
    if (targetMemberError) return { success: false, error: 'load_failed' };
    if (!targetMember) return { success: false, error: 'target_not_a_member' };

    const targetRole = targetMember.role;

    // Check if caller can add entries for target
    if (!canAddEntriesFor(callerRole, targetRole, user.id, targetUserId)) {
      return { success: false, error: 'not_authorized' };
    }
    // A closed month gains no entries; the database refuses them as well.
    const entryTimestamps = entries.map((entry) => entry.timestamp);
    if (await touchesClosedTimePeriod(admin, organizationId, entryTimestamps)) {
      return { success: false, error: 'period_closed' };
    }

    const staged = await stageManualEntries(admin, {
      params,
      day: new Date(firstEntry.timestamp),
      callerRole,
      callerId: user.id,
      targetRole,
    });
    if ('refusal' in staged) return staged.refusal;
    const { entries: normalizedEntries, status } = staged;

    const insertData = normalizedEntries.map((entry) => ({
      user_id: targetUserId,
      organization_id: organizationId,
      entry_type: entry.entryType,
      timestamp: entry.timestamp,
      is_manual: true,
      status,
      reviewed_by: status === 'approved' ? user.id : null,
      reviewed_at: status === 'approved' ? new Date().toISOString() : null,
      job_id: entry.jobId ?? null,
    }));

    const { data: newEntries, error: insertError } = await admin
      .from('time_entries')
      .insert(insertData)
      .select();

    if (insertError || !newEntries) return { success: false, error: manualEntryInsertFailure(insertError) };

    revalidatePath('/zeiterfassung');

    return { success: true, entries: toTimeEntries(newEntries) };
  } catch (error) {
    logError('Unexpected error in addManualEntry:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

// ============================================
// Update/Delete Actions
// ============================================

/** Edits a time entry directly: Admin any entry, Büro an employee's entry. */
export async function updateEntry(
  rawEntryId: string,
  rawFields: { timestamp?: string; entryType?: TimeEntryType; jobId?: string | null },
): Promise<UpdateEntryResult | RequestChangeResult> {
  try {
    const parsed = updateEntryInputSchema.safeParse({ entryId: rawEntryId, fields: rawFields });
    if (!parsed.success) return { success: false, error: 'invalid_input' };
    const { entryId, fields } = parsed.data;
    const user = await getAuthenticatedUser();
    if (!user) {
      return { success: false, error: 'not_authenticated' };
    }

    const admin = createSupabaseAdminClient();

    // tenant-scope: by-id-then-verified — the caller's membership in the entry's organization is verified next, and every write filters by that organization.
    const { data: entry, error: entryError } = await admin
      .from('time_entries')
      .select('*')
      .eq('id', entryId)
      .maybeSingle();

    if (entryError) return { success: false, error: 'load_failed' };
    if (!entry) return { success: false, error: 'entry_not_found' };

    const callerRole = await verifyCurrentMembership(entry.organization_id);
    if (!callerRole) {
      return { success: false, error: 'not_a_member' };
    }

    // Get target user's role
    const { data: targetMember, error: targetMemberError } = await loggedRead(
      'updateEntry: organization_members read failed',
      admin
        .from('organization_members')
        .select('role')
        .eq('user_id', entry.user_id)
        .eq('organization_id', entry.organization_id)
        .maybeSingle(),
    );
    if (targetMemberError) return { success: false, error: 'load_failed' };
    if (!targetMember) return { success: false, error: 'target_not_found' };

    const targetRole = targetMember.role;
    const isOwnEntry = entry.user_id === user.id;

    // Check if caller can manage this entry
    if (!canManageEntries(callerRole, targetRole, isOwnEntry)) {
      return { success: false, error: 'not_authorized' };
    }

    const targetTimestamp = new Date(fields.timestamp ?? entry.timestamp);
    // A closed month changes only after a reasoned reopen (P1-23). The
    // recorded day and the new day both count.
    if (
      await touchesClosedTimePeriod(admin, entry.organization_id, [
        entry.timestamp,
        targetTimestamp.toISOString(),
      ])
    ) {
      return { success: false, error: 'period_closed' };
    }

    const editRefusal = await refuseEntryEdit(admin, entry, fields, targetTimestamp);
    if (editRefusal) return editRefusal;

    // Only the named fields change. The function refuses an own entry for
    // every caller but an Admin, and records an Admin's own change.
    const changes: { timestamp?: string; entry_type?: TimeEntryType; job_id?: string | null } = {};
    if (fields.timestamp) changes.timestamp = fields.timestamp;
    if (fields.entryType !== undefined) changes.entry_type = fields.entryType;
    if (fields.jobId !== undefined) changes.job_id = fields.jobId;

    const { data: updatedEntry, error: updateError } = await admin.rpc('update_time_entry', {
      p_actor_id: user.id,
      p_organization_id: entry.organization_id,
      p_entry_id: entryId,
      p_changes: changes,
    });
    if (updateError) return timeEntryBatchFailure('Error updating entry:', updateError, 'update_failed');
    if (!updatedEntry) return { success: false, error: 'update_failed' };

    return { success: true, entry: toTimeEntry(updatedEntry) };
  } catch (error) {
    logError('Unexpected error in updateEntry:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

/**
 * Deletes a time entry directly: Admin any entry, Büro an employee's entry.
 * @param entryId - The ID of the entry to delete (typically clock_in for pairs)
 * @param pairedEntryId - Optional ID of paired entry (clock_out) for paired delete requests
 */
export async function deleteEntry(
  rawEntryId: string,
  rawPairedEntryId?: string,
): Promise<DeleteEntryResult | RequestChangeResult> {
  try {
    const parsed = deleteEntryInputSchema.safeParse({ entryId: rawEntryId, pairedEntryId: rawPairedEntryId });
    if (!parsed.success) return { success: false, error: 'invalid_input' };
    const { entryId, pairedEntryId } = parsed.data;
    const user = await getAuthenticatedUser();
    if (!user) {
      return { success: false, error: 'not_authenticated' };
    }

    const admin = createSupabaseAdminClient();

    // tenant-scope: by-id-then-verified — the caller's membership in the entry's organization is verified next, and every delete filters by that organization.
    const { data: entry, error: entryError } = await admin
      .from('time_entries')
      .select('*')
      .eq('id', entryId)
      .maybeSingle();

    if (entryError) return { success: false, error: 'load_failed' };
    if (!entry) return { success: false, error: 'entry_not_found' };

    const callerRole = await verifyCurrentMembership(entry.organization_id);
    if (!callerRole) {
      return { success: false, error: 'not_a_member' };
    }

    // Get target user's role
    const { data: targetMember, error: targetMemberError } = await loggedRead(
      'deleteEntry: organization_members read failed',
      admin
        .from('organization_members')
        .select('role')
        .eq('user_id', entry.user_id)
        .eq('organization_id', entry.organization_id)
        .maybeSingle(),
    );
    if (targetMemberError) return { success: false, error: 'load_failed' };
    if (!targetMember) return { success: false, error: 'target_not_found' };

    const targetRole = targetMember.role;
    const isOwnEntry = entry.user_id === user.id;

    // Check if caller can manage this entry
    if (!canManageEntries(callerRole, targetRole, isOwnEntry)) {
      return { success: false, error: 'not_authorized' };
    }

    if (await entriesTouchClosedTimePeriod(admin, entry.organization_id, [entryId, pairedEntryId])) {
      return { success: false, error: 'period_closed' };
    }

    // The paired entry is caller-supplied: it must be a row of the same
    // person in the same organization as the authorized entry.
    if (pairedEntryId) {
      const { data: pairedEntry, error: pairedEntryError } = await loggedRead(
        'deleteEntry: time_entries read failed',
        admin
          .from('time_entries')
          .select('id')
          .eq('id', pairedEntryId)
          .eq('organization_id', entry.organization_id)
          .eq('user_id', entry.user_id)
          .maybeSingle(),
      );
      if (pairedEntryError) return { success: false, error: 'load_failed' };
      if (!pairedEntry) {
        return { success: false, error: 'entry_not_found' };
      }
    }

    // One function call deletes the entry and its verified pair together, so a
    // refused delete (an entry a work artifact or correction still references)
    // never leaves half of the pair behind. It refuses an own entry for every
    // caller but an Admin, and records an Admin's own deletion.
    const { error: deleteError } = await admin.rpc(
      'delete_time_entries',
      rpcArgs('delete_time_entries', {
        p_actor_id: user.id,
        p_organization_id: entry.organization_id,
        p_entry_ids: [...new Set([entryId, pairedEntryId ?? entryId])],
        p_authorized_user_ids: [entry.user_id],
      }),
    );
    if (deleteError) return timeEntryBatchFailure('Error deleting entry:', deleteError, 'delete_failed');

    return { success: true };
  } catch (error) {
    logError('Unexpected error in deleteEntry:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

/** Deletes entries of one organization that the caller may manage: all of them or none. */
export async function deleteEntriesBatch(rawEntryIds: string[]): Promise<DeleteEntryResult> {
  const parsed = entryIdListSchema.safeParse(rawEntryIds);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  if (parsed.data.length === 0) {
    return { success: true };
  }

  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return { success: false, error: 'not_authenticated' };
    }

    const admin = createSupabaseAdminClient();
    const uniqueEntryIds = [...new Set(parsed.data)];
    const { data: entries, error: entriesError } = await readInBatches(uniqueEntryIds, (batch) =>
      // tenant-scope: by-id-then-verified — every entry must share one organization, whose membership and per-person rights are verified before the delete.
      admin
        .from('time_entries')
        .select('*')
        .in('id', [...batch]),
    );

    if (entriesError || !entries) return { success: false, error: 'load_failed' };
    if (entries.length !== uniqueEntryIds.length) {
      return { success: false, error: 'entry_not_found' };
    }

    const organizationId = entries[0]?.organization_id;
    if (!organizationId || entries.some((entry) => entry.organization_id !== organizationId)) {
      return { success: false, error: 'not_authorized' };
    }

    const callerRole = await verifyCurrentMembership(organizationId);
    if (!callerRole) {
      return { success: false, error: 'not_a_member' };
    }

    const uniqueUserIds = [...new Set(entries.map((entry) => entry.user_id))];
    const { data: memberRows, error: memberError } = await readInBatches(uniqueUserIds, (batch) =>
      admin
        .from('organization_members')
        .select('user_id, role')
        .eq('organization_id', organizationId)
        .in('user_id', [...batch]),
    );

    if (memberError) {
      return { success: false, error: 'target_not_found' };
    }

    const roleMap = new Map(memberRows.map((member) => [member.user_id, member.role]));

    for (const entry of entries) {
      const targetRole = roleMap.get(entry.user_id);
      if (!targetRole) {
        return { success: false, error: 'target_not_found' };
      }

      const isOwnEntry = entry.user_id === user.id;
      if (!canManageEntries(callerRole, targetRole, isOwnEntry)) {
        return { success: false, error: 'not_authorized' };
      }
    }
    if (
      await touchesClosedTimePeriod(
        admin,
        organizationId,
        entries.map((entry) => entry.timestamp),
      )
    ) {
      return { success: false, error: 'period_closed' };
    }

    // One transaction: the function re-checks every entry under lock and deletes all or none.
    const { error: deleteError } = await admin.rpc(
      'delete_time_entries',
      rpcArgs('delete_time_entries', {
        p_actor_id: user.id,
        p_organization_id: organizationId,
        p_entry_ids: uniqueEntryIds,
        p_authorized_user_ids: uniqueUserIds,
      }),
    );
    if (deleteError) return timeEntryBatchFailure('Error deleting entries:', deleteError, 'delete_failed');

    return { success: true };
  } catch (error) {
    logError('Unexpected error in deleteEntriesBatch:', error);
    return { success: false, error: 'unexpected_error' };
  }
}
