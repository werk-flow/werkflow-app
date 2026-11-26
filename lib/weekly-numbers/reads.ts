import 'server-only';

import { z } from '@/lib/zod';

import type { ActionFailure } from '@/lib/action-result';
import { getBusinessTodayIso } from '@/lib/date-time/berlin';
import { logError } from '@/lib/logging';
import { resolveActionContext } from '@/lib/org/action-context';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import type { WeeklyNumbers } from './format';

/** The weeks the admin compares side by side. */
const WEEK_COUNT = 12;

const count = z.number().int().nonnegative();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const weeksSchema = z.array(
  z.object({
    weekStart: isoDate,
    lastDay: isoDate,
    overdue: z.object({
      followUps: count,
      requestCallbacks: count,
      maintenance: count,
      staleRequests: count,
      waitingHandovers: count,
      blockerReviews: count,
    }),
    handover: z.object({
      released: count,
      medianWorkdays: z.number().nonnegative().nullable(),
      withinTwoWorkdays: count,
    }),
    workReports: z.object({ finished: count, withReport: count }),
    timeCapture: z.object({ entries: count, byEmployee: count }),
  }),
);

type WeeklyNumbersResult =
  | { success: true; weeks: WeeklyNumbers[] }
  | ActionFailure<'not_authenticated' | 'no_active_org' | 'not_authorized' | 'load_failed'>;

/**
 * The company's numbers of the last twelve Berlin weeks, oldest first, for an
 * admin of the active organization. The organization and the role come from
 * the caller's membership, never from the client; a Büro or field member is
 * refused before any read. The numbers never break down by person.
 */
export async function readWeeklyOutcomeNumbers(): Promise<WeeklyNumbersResult> {
  const caller = await resolveActionContext();
  if (!caller.success) return caller;
  if (caller.context.role !== 'admin') return { success: false, error: 'not_authorized' };

  const { data, error } = await createSupabaseAdminClient().rpc('read_weekly_outcome_numbers', {
    p_organization_id: caller.context.orgId,
    p_today: getBusinessTodayIso(),
    p_week_count: WEEK_COUNT,
  });
  if (error) {
    logError('readWeeklyOutcomeNumbers: read failed', error);
    return { success: false, error: 'load_failed' };
  }
  const parsed = weeksSchema.safeParse(data);
  if (!parsed.success) {
    logError('readWeeklyOutcomeNumbers: unexpected shape', parsed.error);
    return { success: false, error: 'load_failed' };
  }
  return { success: true, weeks: parsed.data };
}
