import 'server-only';

import type { ActionFailure } from '@/lib/action-result';
import { logError } from '@/lib/logging';
import type { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { LIST_ROW_CAP, readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';
import { getLocalDayKey } from './day-utils';

/**
 * The SQLSTATE the database raises, with the message `period_closed`, for a
 * write to time_entries, time_sessions or time_segments on a day of a closed
 * period (migration 20261002110000_refuse_writes_in_closed_periods.sql).
 */
const PERIOD_CLOSED_SQLSTATE = 'WFP01';

/** True when a database error is the closed-period refusal of the time-fact trigger. */
export function isPeriodClosedError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && Reflect.get(error, 'code') === PERIOD_CLOSED_SQLSTATE;
}

/**
 * The action failure code for a failed time-fact write. The trigger refusal
 * (a close that won the race against the action's own check) is
 * `period_closed`; every other failure is logged and becomes `fallback`.
 */
export function timeWriteFailure(label: string, error: unknown, fallback: string): string {
  if (isPeriodClosedError(error)) return 'period_closed';
  logError(label, error);
  return fallback;
}

/**
 * The refusals of review_time_entries and delete_time_entries
 * (migration 20261003110000): each message is an action failure code.
 */
const TIME_ENTRY_BATCH_REFUSALS: ReadonlySet<string> = new Set([
  'invalid_input',
  'entry_not_found',
  'not_a_member',
  'target_not_found',
  'entry_not_pending',
  'self_approval_not_allowed',
  'not_responsible',
  'not_authorized',
]);

/** The action failure of a refused or failed review_time_entries or delete_time_entries call. */
export function timeEntryBatchFailure(
  label: string,
  error: { message: string },
  fallback: string,
): ActionFailure {
  if (TIME_ENTRY_BATCH_REFUSALS.has(error.message)) return { success: false, error: error.message };
  return { success: false, error: timeWriteFailure(label, error, fallback) };
}

/**
 * True when one of the timestamps falls on a Europe/Berlin date inside a
 * closed period of the organization. A direct entry write must refuse then:
 * the close froze the month, and only a reasoned reopen may change it. A
 * failed read throws, so the caller never treats an unknown period as open.
 */
export async function touchesClosedTimePeriod(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  organizationId: string,
  timestamps: readonly string[],
): Promise<boolean> {
  const dates = [...new Set(timestamps.map((timestamp) => getLocalDayKey(new Date(timestamp))))].sort();
  const earliest = dates[0];
  const latest = dates.at(-1);
  if (!earliest || !latest) return false;
  // One read for the whole span: a 1,000-entry review batch can cover many days.
  const { data, error } = await readCompleteRows(
    (from, to) =>
      admin
        .from('time_periods')
        .select('id, period_start_date, period_end_date')
        .eq('organization_id', organizationId)
        .eq('state', 'closed')
        .lte('period_start_date', latest)
        .gte('period_end_date', earliest)
        .order('period_start_date')
        .order('id')
        .range(from, to),
    LIST_ROW_CAP,
  );
  if (error) throw new Error('closed_period_read_failed');
  return dates.some((date) =>
    data.some((period) => period.period_start_date <= date && date <= period.period_end_date),
  );
}

/**
 * The same rule for recorded entries named by id: true when one of them, or
 * one of the further timestamps a write would restore, lies in a closed period.
 */
export async function entriesTouchClosedTimePeriod(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  organizationId: string,
  entryIds: ReadonlyArray<string | null | undefined>,
  furtherTimestamps: ReadonlyArray<string | null> = [],
): Promise<boolean> {
  const ids = entryIds.filter((id): id is string => Boolean(id));
  const { data, error } = await readInBatches(ids, (batch) =>
    admin
      .from('time_entries')
      .select('timestamp')
      .eq('organization_id', organizationId)
      .in('id', [...batch]),
  );
  if (error) throw new Error('closed_period_read_failed');
  const further = furtherTimestamps.filter((timestamp): timestamp is string => timestamp !== null);
  return touchesClosedTimePeriod(admin, organizationId, [
    ...data.map((entry) => entry.timestamp),
    ...further,
  ]);
}
