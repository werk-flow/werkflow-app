import 'server-only';

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import type { Tables } from '@/lib/supabase/database.types';
import { readInBatches } from '@/lib/supabase/query-batches';
import { requireAuth } from './access';
import { type PeriodResultRow, toPeriodOutcomesByCalculation, type UncomputedResultCause } from './period-results';
import { requirePeriodRows } from './period-sources';
import type { TimePeriodState } from './presentation';
import { readRegion, type ReaderContext, requireRead, type TimeAccountRead } from './read-support';

// The caller's own Zeitkonto: balance, newest account events and the periods
// calculated for them. A month the preparation could not calculate for the
// caller (no Arbeitszeitregel or no opened Zeitkonto) carries no minutes: its
// stored zeros are placeholders (werk-flow/werkflow-planning#264).

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
    outcome: PeriodResultRow['outcome'];
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
  const [{ data: results }, { data: findings }, events] = await Promise.all([
    readInBatches(currentCalculationIds, (batch) =>
      admin
        .from('time_period_employee_results')
        .select(
          'employee_record_id, target_minutes, credited_minutes, period_delta_minutes, closing_balance_minutes, authoritative_targets, calculation_id',
        )
        .eq('organization_id', context.orgId)
        .eq('employee_record_id', employee.id)
        .in('calculation_id', [...batch]),
    ).then(requirePeriodRows),
    // At most one finding per gap, person and calculation: the setup gaps only.
    readInBatches(currentCalculationIds, (batch) =>
      admin
        .from('time_period_findings')
        .select('employee_record_id, finding_kind, calculation_id')
        .eq('organization_id', context.orgId)
        .eq('employee_record_id', employee.id)
        .in('finding_kind', SETUP_GAP_KINDS)
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
    outcomes: toPeriodOutcomesByCalculation(results, findings),
    events,
  });
}

const SETUP_GAP_KINDS: UncomputedResultCause[] = ['missing_policy', 'missing_opening_balance'];

function toTimeAccountOverview(input: {
  account: Pick<Tables<'time_accounts'>, 'id' | 'opened_on' | 'current_balance_minutes'> | null;
  periods: Pick<
    Tables<'time_periods'>,
    'id' | 'period_start_date' | 'period_end_date' | 'state' | 'current_calculation_id'
  >[];
  hasMorePeriods: boolean;
  outcomes: ReadonlyMap<string, PeriodResultRow['outcome']>;
  events: Pick<
    Tables<'time_account_events'>,
    'id' | 'event_kind' | 'effective_date' | 'minutes' | 'reason'
  >[];
}): TimeAccountOverview {
  const { account, periods, hasMorePeriods, outcomes, events } = input;
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
    // Newest first, as read; a period without a result row for the caller is not theirs.
    periods: periods.flatMap((period) => {
      const outcome = period.current_calculation_id ? outcomes.get(period.current_calculation_id) : undefined;
      return outcome
        ? [
            {
              id: period.id,
              startDate: period.period_start_date,
              endDate: period.period_end_date,
              state: period.state,
              outcome,
            },
          ]
        : [];
    }),
  };
}
