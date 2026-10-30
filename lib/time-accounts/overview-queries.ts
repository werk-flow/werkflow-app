import 'server-only';

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import type { Tables } from '@/lib/supabase/database.types';
import { readInBatches } from '@/lib/supabase/query-batches';
import { requireAuth } from './access';
import { requirePeriodRows } from './period-preparation';
import type { TimePeriodState } from './presentation';
import { readRegion, type ReaderContext, requireRead, type TimeAccountRead } from './read-support';

// The caller's own Zeitkonto: balance, newest account events and the periods
// calculated for them.

export type TimeAccountOverview = {
  account: {
    id: string;
    currentBalanceMinutes: number;
    openedOn: string;
  } | null;
  events: Array<{
    id: string;
    kind: string;
    effectiveDate: string;
    minutes: number;
    reason: string;
  }>;
  periods: Array<{
    id: string;
    startDate: string;
    endDate: string;
    state: TimePeriodState;
    targetMinutes: number;
    creditedMinutes: number;
    deltaMinutes: number;
    closingBalanceMinutes: number;
  }>;
  /** More account events exist than `events` shows. */
  hasMoreEvents: boolean;
  /** More periods exist than `periods` covers. */
  hasMorePeriods: boolean;
};

/** The overview shows the newest events and periods and reports when older ones exist. */
export const OVERVIEW_EVENT_LIMIT = 50;
export const OVERVIEW_PERIOD_LIMIT = 24;

export async function getTimeAccountOverview(): Promise<TimeAccountRead<TimeAccountOverview>> {
  const context = await requireAuth();
  return readRegion('getTimeAccountOverview: account overview failed', () =>
    readTimeAccountOverview(context),
  );
}

async function readTimeAccountOverview(context: ReaderContext): Promise<TimeAccountOverview> {
  const admin = createSupabaseAdminClient();
  const employee = requireRead(
    await admin
      .from('employee_records')
      .select('id')
      .eq('organization_id', context.orgId)
      .eq('user_id', context.userId)
      .maybeSingle(),
  );
  if (!employee)
    return { account: null, events: [], periods: [], hasMoreEvents: false, hasMorePeriods: false };
  const [accountResult, periodResult] = await Promise.all([
    admin
      .from('time_accounts')
      .select('id, opened_on, current_balance_minutes')
      .eq('organization_id', context.orgId)
      .eq('employee_record_id', employee.id)
      .maybeSingle(),
    admin
      .from('time_periods')
      .select('id, period_start_date, period_end_date, state, current_calculation_id')
      .eq('organization_id', context.orgId)
      .not('current_calculation_id', 'is', null)
      .order('period_start_date', { ascending: false })
      .limit(OVERVIEW_PERIOD_LIMIT + 1),
  ]);
  const account = requireRead(accountResult);
  const periodRows = requireRead(periodResult);
  const periods = periodRows.slice(0, OVERVIEW_PERIOD_LIMIT);
  const currentCalculationIds = periods.flatMap((period) =>
    period.current_calculation_id ? [period.current_calculation_id] : [],
  );
  const [{ data: results }, events] = await Promise.all([
    readInBatches(currentCalculationIds, (batch) =>
      admin
        .from('time_period_employee_results')
        .select(
          'target_minutes, credited_minutes, period_delta_minutes, closing_balance_minutes, calculation_id',
        )
        .eq('organization_id', context.orgId)
        .eq('employee_record_id', employee.id)
        .in('calculation_id', [...batch]),
    ).then(requirePeriodRows),
    account
      ? admin
          .from('time_account_events')
          .select('id, event_kind, effective_date, minutes, reason')
          .eq('organization_id', context.orgId)
          .eq('account_id', account.id)
          .order('effective_date', { ascending: false })
          .order('id')
          .limit(OVERVIEW_EVENT_LIMIT + 1)
          .then(requireRead)
      : Promise.resolve([]),
  ]);
  return toTimeAccountOverview({
    account,
    periods,
    hasMorePeriods: periodRows.length > OVERVIEW_PERIOD_LIMIT,
    results,
    events,
  });
}

function toTimeAccountOverview(input: {
  account: Pick<Tables<'time_accounts'>, 'id' | 'opened_on' | 'current_balance_minutes'> | null;
  periods: Pick<
    Tables<'time_periods'>,
    'id' | 'period_start_date' | 'period_end_date' | 'state' | 'current_calculation_id'
  >[];
  hasMorePeriods: boolean;
  results: Pick<
    Tables<'time_period_employee_results'>,
    | 'target_minutes'
    | 'credited_minutes'
    | 'period_delta_minutes'
    | 'closing_balance_minutes'
    | 'calculation_id'
  >[];
  events: Pick<
    Tables<'time_account_events'>,
    'id' | 'event_kind' | 'effective_date' | 'minutes' | 'reason'
  >[];
}): TimeAccountOverview {
  const { account, periods, hasMorePeriods, results, events } = input;
  const periodByCalculation = new Map(
    periods.flatMap((period) =>
      period.current_calculation_id ? [[period.current_calculation_id, period] as const] : [],
    ),
  );
  return {
    account: account
      ? {
          id: account.id,
          currentBalanceMinutes: account.current_balance_minutes,
          openedOn: account.opened_on,
        }
      : null,
    hasMoreEvents: events.length > OVERVIEW_EVENT_LIMIT,
    hasMorePeriods,
    events: events.slice(0, OVERVIEW_EVENT_LIMIT).map((event) => ({
      id: event.id,
      kind: event.event_kind,
      effectiveDate: event.effective_date,
      minutes: event.minutes,
      reason: event.reason,
    })),
    periods: results.flatMap((result) => {
      const period = periodByCalculation.get(result.calculation_id);
      return period
        ? [
            {
              id: period.id,
              startDate: period.period_start_date,
              endDate: period.period_end_date,
              state: period.state,
              targetMinutes: result.target_minutes,
              creditedMinutes: result.credited_minutes,
              deltaMinutes: result.period_delta_minutes,
              closingBalanceMinutes: result.closing_balance_minutes,
            },
          ]
        : [];
    }),
  };
}
