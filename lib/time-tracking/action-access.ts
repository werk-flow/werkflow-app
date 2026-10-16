import 'server-only';

import { cookies } from 'next/headers';
import { logReadFailure } from '@/lib/data/read-request-cache';
import { resolveActionContextFor } from '@/lib/org/action-context';
import { resolveActiveOrgId } from '@/lib/org/cookies';
import type { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { getLocalDayEnd, getLocalDayStart } from '@/lib/date-time/berlin';
import type { OrgRole } from '@/lib/roles';
import type { TimeEntryRow } from './types';

// The shared steps of the time-tracking Server Actions (clock-state-actions,
// entry-write-actions, entry-read-actions, review-actions): the caller's
// organization and role, and the reads of one person's local day.

/**
 * Get the current organization ID from cookies (with membership fallback).
 */
export async function getCurrentOrgId(userId: string): Promise<string | null> {
  const cookieStore = await cookies();
  return resolveActiveOrgId(cookieStore, userId);
}

/**
 * Resolve the caller's current operational role in the organization from the
 * per-request membership read (never a cross-request cache); null when the
 * caller is not a current operational member.
 */
export async function verifyCurrentMembership(orgId: string): Promise<OrgRole | null> {
  const caller = await resolveActionContextFor(orgId);
  return caller.success ? caller.context.role : null;
}

type TodayBounds = {
  start: Date;
  end: Date;
};

/** The first and last instant of the date's local day. */
export function getDayBounds(date: Date): TodayBounds {
  return {
    start: getLocalDayStart(date),
    end: getLocalDayEnd(date),
  };
}

/**
 * Get entries for a specific local day for the user in an org; null when the
 * read fails, so a caller never validates against or reports a missing day.
 */
export async function getUserEntriesForDay(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  userId: string,
  orgId: string,
  date: Date,
): Promise<TimeEntryRow[] | null> {
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
    logReadFailure('Error fetching user day entries:', error);
    return null;
  }

  return data;
}
