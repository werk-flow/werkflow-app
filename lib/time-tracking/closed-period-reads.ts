import 'server-only';

import type { ActionResult } from '@/lib/action-result';
import { logReadFailure } from '@/lib/data/read-request-cache';
import { resolveActionContextFor } from '@/lib/org/action-context';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { LIST_ROW_CAP, readCompleteRows } from '@/lib/supabase/query-batches';
import { uuidSchema } from '@/lib/validation/uuid';
import type { ClosedTimePeriod } from './closed-period-dates';

export type ClosedTimePeriodsResult = ActionResult<{ periods: ClosedTimePeriod[] }>;

/**
 * The organization's closed periods for any current member: the surfaces
 * that edit recorded time ask `isDateInClosedPeriod` with them before they
 * offer an edit. The dates are no personal data, and every role needs them,
 * because an employee's own manual entry or correction is refused too.
 */
export async function getClosedTimePeriods(organizationId: string): Promise<ClosedTimePeriodsResult> {
  const parsed = uuidSchema.safeParse(organizationId);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const caller = await resolveActionContextFor(parsed.data);
  if (!caller.success) return caller;
  const { data, error } = await readCompleteRows(
    (from, to) =>
      createSupabaseAdminClient()
        .from('time_periods')
        .select('period_start_date, period_end_date')
        .eq('organization_id', parsed.data)
        .eq('state', 'closed')
        .order('period_start_date')
        .order('id')
        .range(from, to),
    LIST_ROW_CAP,
  );
  if (error) {
    logReadFailure('getClosedTimePeriods: time_periods read failed', error);
    return { success: false, error: 'load_failed' };
  }
  return {
    success: true,
    periods: data.map((period) => ({ startDate: period.period_start_date, endDate: period.period_end_date })),
  };
}
