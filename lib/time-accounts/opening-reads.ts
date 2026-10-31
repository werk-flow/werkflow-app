import 'server-only';

import { formatBerlinLocalDate } from '@/lib/date-time/berlin';
import type { AdminClient } from '@/lib/supabase/admin';
import { readCompleteRows } from '@/lib/supabase/query-batches';
import { suggestTimeAccountStartDate } from './opening-dates';
import { PERIOD_SOURCE_ROW_CAP, requirePeriodRows } from './period-sources';
import { requireRead, type ReaderContext } from './read-support';

/** One correction of an account's opening date, as the history shows it. */
export type OpeningDateCorrection = {
  id: string;
  previousOpenedOn: string;
  correctedOpenedOn: string;
  reason: string;
  createdAt: string;
};

export type OpeningDateFacts = {
  latestClosedPeriodEnd: string | null;
  suggestedStartDate: string;
  correctionsByAccount: ReadonlyMap<string, OpeningDateCorrection[]>;
};

const earlier = (left: string | null, right: string | null): string | null =>
  left === null ? right : right === null || left < right ? left : right;

/**
 * What the rule and account setup needs about opening dates: the last closed
 * period, the proposed start date and each account's corrections. A failed
 * read throws.
 */
export async function readOpeningDateFacts(
  admin: AdminClient,
  context: ReaderContext,
  today: string,
): Promise<OpeningDateFacts> {
  const [latestClosed, oldestOpen, firstSession, firstEntry, { data: corrections }] = await Promise.all([
    admin
      .from('time_periods')
      .select('period_end_date')
      .eq('organization_id', context.orgId)
      .eq('state', 'closed')
      .order('period_end_date', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(requireRead),
    admin
      .from('time_periods')
      .select('period_start_date')
      .eq('organization_id', context.orgId)
      .neq('state', 'closed')
      .order('period_start_date')
      .limit(1)
      .maybeSingle()
      .then(requireRead),
    admin
      .from('time_sessions')
      .select('started_at')
      .eq('organization_id', context.orgId)
      .order('started_at')
      .limit(1)
      .maybeSingle()
      .then(requireRead),
    admin
      .from('time_entries')
      .select('timestamp')
      .eq('organization_id', context.orgId)
      .order('timestamp')
      .limit(1)
      .maybeSingle()
      .then(requireRead),
    readCompleteRows(
      (from, to) =>
        admin
          .from('time_account_opening_corrections')
          .select('id, account_id, previous_opened_on, corrected_opened_on, reason, created_at')
          .eq('organization_id', context.orgId)
          .order('created_at')
          .order('id')
          .range(from, to),
      PERIOD_SOURCE_ROW_CAP,
    ).then(requirePeriodRows),
  ]);
  const latestClosedPeriodEnd = latestClosed?.period_end_date ?? null;
  const earliestActivityDate = [
    oldestOpen?.period_start_date ?? null,
    firstSession ? formatBerlinLocalDate(firstSession.started_at) : null,
    firstEntry ? formatBerlinLocalDate(firstEntry.timestamp) : null,
  ].reduce(earlier, null);
  const correctionsByAccount = new Map<string, OpeningDateCorrection[]>();
  for (const correction of corrections) {
    const history = correctionsByAccount.get(correction.account_id) ?? [];
    history.push({
      id: correction.id,
      previousOpenedOn: correction.previous_opened_on,
      correctedOpenedOn: correction.corrected_opened_on,
      reason: correction.reason,
      createdAt: correction.created_at,
    });
    correctionsByAccount.set(correction.account_id, history);
  }
  return {
    latestClosedPeriodEnd,
    suggestedStartDate: suggestTimeAccountStartDate({ today, latestClosedPeriodEnd, earliestActivityDate }),
    correctionsByAccount,
  };
}
