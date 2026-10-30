import 'server-only';

// P1-23 period preparation: computes the employee, daily, source, and finding
// rows that the prepare_time_period RPC stores, from the sources
// period-sources.ts reads and the policies period-policies.ts resolves. This is
// an internal server module, not a Server Action: prepareTimePeriod authorizes
// the caller and passes the admin client in. The row order is the
// payroll-relevant contract; change it only together with that action.

import { randomUUID } from 'node:crypto';
import { buildLegacyIntervals } from './legacy-intervals';

import { toEmploymentCondition } from '@/lib/personnel/types';
import { toWorkSchedule } from '@/lib/personnel/schedule';
import { resolveDailyTargets, type DailyTarget } from '@/lib/personnel/targets';
import type { AdminClient } from '@/lib/supabase/admin';
import { calculateEmployeePeriod } from './calculation';
import { pushEmployeeFindings } from './period-findings';
import { resolvePoliciesForPeriod } from './period-policies';
import {
  hashPayload,
  loadIndexedPeriodSources,
  type PeriodBounds,
  type PeriodEmployee,
  type PeriodPolicies,
  type PeriodShared,
  type PeriodSources,
  type TimePeriodPreparationPayload,
} from './period-sources';
import type {
  DailyTargetInput,
  EmployeePeriodCalculation,
  EmployeePeriodCalculationInput,
  RoundedTimeBucket,
  TimeAccountPolicy,
  TimeActivityInterval,
} from './types';
import { requirePresent } from './validation';

type PeriodAccountEventInput = EmployeePeriodCalculationInput['accountEvents'][number];

function buildEmployeeActivityIntervals(
  employee: PeriodEmployee,
  shared: PeriodShared,
): TimeActivityInterval[] {
  const { segments } = shared.sources;
  const { suppressedSegmentIds, jobById, projectNumberById, legacyByUser } = shared.index;
  const employeeSegments = (segments ?? []).filter(
    (segment) => segment.employee_record_id === employee.id && !suppressedSegmentIds.has(segment.id),
  );
  const intervals: TimeActivityInterval[] = employeeSegments.map((segment) => {
    const job = segment.job_id ? jobById.get(segment.job_id) : undefined;
    const projectId = job?.project_id ?? undefined;
    const jobNumber = job?.job_number;
    const projectNumber = projectId ? projectNumberById.get(projectId) : undefined;
    return {
      sourceId: `segment:${segment.id}`,
      startedAt: segment.started_at,
      endedAt: requirePresent(segment.ended_at, 'period_segment_open'),
      activityKind: segment.kind,
      travelRoute: segment.travel_route ?? undefined,
      travelRole: segment.travel_role ?? undefined,
      standbyContext: segment.standby_context ?? undefined,
      allocationKind: segment.allocation_kind,
      jobId: segment.job_id ?? undefined,
      ...(typeof jobNumber === 'string' ? { jobNumber } : {}),
      projectId,
      ...(typeof projectNumber === 'string' ? { projectNumber } : {}),
    };
  });
  if (employee.user_id)
    intervals.push(...buildLegacyIntervals(legacyByUser.get(employee.user_id) ?? [], employee.id));
  for (const interval of intervals) {
    if (!interval.jobId || interval.jobNumber) continue;
    const job = jobById.get(interval.jobId);
    const projectId = job?.project_id ?? interval.projectId;
    const jobNumber = job?.job_number;
    const projectNumber = projectId ? projectNumberById.get(projectId) : undefined;
    if (typeof jobNumber === 'string') interval.jobNumber = jobNumber;
    interval.projectId = projectId;
    if (typeof projectNumber === 'string') interval.projectNumber = projectNumber;
    else delete interval.projectNumber;
  }
  return intervals;
}

/**
 * One employee's resolved targets for the period's dates, bounded by the
 * record's entry and exit dates. The unit test pins the exit boundary here
 * (werk-flow/werkflow-planning#79).
 * @internal
 */
export function resolveEmployeeDailyTargets(
  employee: Pick<PeriodEmployee, 'id' | 'entry_date' | 'exit_date'>,
  policiesByDate: PeriodPolicies,
  shared: {
    sources: Pick<
      PeriodShared['sources'],
      'schedules' | 'conditions' | 'vacations' | 'sickness' | 'calendar'
    >;
    index: Pick<PeriodShared['index'], 'dates'>;
  },
): { resolvedTargets: DailyTarget[]; dailyTargets: DailyTargetInput[] } {
  const { schedules, conditions, vacations, sickness, calendar } = shared.sources;
  const { dates } = shared.index;
  const employeeSchedules = (schedules ?? [])
    .filter((schedule) => schedule.employee_record_id === employee.id)
    .map(toWorkSchedule);
  const employeeConditions = (conditions ?? [])
    .filter((condition) => condition.employee_record_id === employee.id)
    .map(toEmploymentCondition);
  const absenceSpans = [...(vacations.get(employee.id) ?? []), ...(sickness.get(employee.id) ?? [])];
  const resolvedTargets = resolveDailyTargets(dates, {
    schedules: employeeSchedules,
    conditions: employeeConditions,
    calendar,
    employment: { entryDate: employee.entry_date, exitDate: employee.exit_date },
    absences: absenceSpans,
  });
  const dailyTargets: DailyTargetInput[] = resolvedTargets.map((target) => {
    const vacationMinutes =
      target.absence?.type === 'vacation' ? target.baseTargetMinutes - target.targetMinutes : 0;
    const sicknessMinutes =
      target.absence?.type === 'sickness' ? target.baseTargetMinutes - target.targetMinutes : 0;
    const treatment =
      target.absence?.type === 'vacation'
        ? policiesByDate.get(target.date)?.vacationTreatment
        : policiesByDate.get(target.date)?.sicknessTreatment;
    const targetMinutes =
      target.absence && treatment === 'informational' ? target.baseTargetMinutes : target.targetMinutes;
    return {
      localDate: target.date,
      targetMinutes,
      source:
        target.source === 'schedule'
          ? 'schedule'
          : target.source === 'derived'
            ? 'employment_condition'
            : 'default',
      vacationMinutes,
      sicknessMinutes,
    };
  });
  return { resolvedTargets, dailyTargets };
}

function calculateEmployeePeriodResult(input: {
  employee: PeriodEmployee;
  policy: TimeAccountPolicy | null;
  account: PeriodSources['accounts'][number] | undefined;
  hasCompletePolicyHistory: boolean;
  policiesByDate: PeriodPolicies;
  intervals: TimeActivityInterval[];
  resolvedTargets: DailyTarget[];
  dailyTargets: DailyTargetInput[];
  shared: PeriodShared;
}): EmployeePeriodCalculation {
  const { employee, policy, account, hasCompletePolicyHistory, policiesByDate, intervals } = input;
  const { resolvedTargets, dailyTargets } = input;
  const { bounds } = input.shared;
  const { eventsByEmployee } = input.shared.index;
  const employeeEvents = eventsByEmployee.get(employee.id) ?? [];
  const previousBalanceMinutes = employeeEvents
    .filter((event) => event.effective_date < bounds.start)
    .reduce((sum, event) => sum + event.minutes, 0);
  const eventInputs = employeeEvents
    .filter((event) => event.effective_date >= bounds.start)
    .flatMap((event): PeriodAccountEventInput[] => {
      const { event_kind: kind } = event;
      if (
        kind !== 'opening_balance' &&
        kind !== 'manual_adjustment' &&
        kind !== 'expiry' &&
        kind !== 'payout'
      )
        return [];
      return [{ id: event.id, kind, effectiveDate: event.effective_date, minutes: event.minutes }];
    });
  let calculation: EmployeePeriodCalculation;
  if (policy && account && hasCompletePolicyHistory) {
    calculation = calculateEmployeePeriod({
      employeeRecordId: employee.id,
      periodStart: bounds.start,
      periodEnd: bounds.end,
      previousBalanceMinutes,
      policy,
      policyByDate: new Map(
        [...policiesByDate].flatMap(([date, datedPolicy]) =>
          datedPolicy ? [[date, datedPolicy] as const] : [],
        ),
      ),
      activityIntervals: intervals,
      dailyTargets,
      accountEvents: eventInputs,
      publicHolidayDates: new Set(
        resolvedTargets.filter((target) => target.isHoliday).map((target) => target.date),
      ),
    });
  } else {
    calculation = {
      employeeRecordId: employee.id,
      periodStart: bounds.start,
      periodEnd: bounds.end,
      policyId: policy?.id ?? '',
      policyVersion: policy?.version ?? 0,
      activityBuckets: [],
      supplementBuckets: [],
      targetMinutes: dailyTargets.reduce((sum, target) => sum + target.targetMinutes, 0),
      sourceMinutes: 0,
      creditedMinutes: 0,
      vacationMinutes: dailyTargets.reduce((sum, target) => sum + target.vacationMinutes, 0),
      sicknessMinutes: dailyTargets.reduce((sum, target) => sum + target.sicknessMinutes, 0),
      accountEventMinutes: 0,
      periodDeltaMinutes: 0,
      overtimeCandidateMinutes: 0,
      previousBalanceMinutes,
      closingBalanceMinutes: previousBalanceMinutes,
      hasAuthoritativeTargets: false,
    };
  }
  return calculation;
}

type EmployeeDailyInput = {
  employee: PeriodEmployee;
  employeeResultId: string;
  policiesByDate: PeriodPolicies;
  calculation: EmployeePeriodCalculation;
  intervals: TimeActivityInterval[];
  targetsByDate: Map<string, DailyTargetInput>;
  shared: PeriodShared;
};

function pushDailySourceRows(input: {
  bucket: RoundedTimeBucket;
  date: string;
  dailyId: string;
  intervalBySourceId: Map<string, TimeActivityInterval>;
  daily: EmployeeDailyInput;
}): void {
  const { bucket, date, dailyId, intervalBySourceId } = input;
  const { employeeResultId, policiesByDate } = input.daily;
  const { sourcePayload } = input.daily.shared.payloads;
  const { dateBounds } = input.daily.shared.index;
  for (const sourceId of bucket.sourceIds) {
    const sourceParts = sourceId.split(':');
    const sourceKind = sourceId.startsWith('segment:')
      ? 'time_segment'
      : sourceId.startsWith('correction:')
        ? 'correction_application'
        : 'legacy_entry';
    const sourceRecordId = sourceKind === 'correction_application' ? sourceParts[1] : sourceParts.at(-1);
    const interval = intervalBySourceId.get(sourceId);
    const { start: dayStart, end: dayEnd } = requirePresent(dateBounds.get(date), 'period_date_out_of_range');
    const overlapSeconds = interval
      ? Math.max(
          0,
          Math.min(new Date(interval.endedAt).getTime(), dayEnd) -
            Math.max(new Date(interval.startedAt).getTime(), dayStart),
        ) / 1000
      : 0;
    sourcePayload.push({
      employee_result_id: employeeResultId,
      daily_result_id: dailyId,
      source_kind: sourceKind,
      source_id: sourceRecordId,
      source_key: null,
      source_fingerprint: hashPayload(sourceId),
      source_snapshot: {
        sourceId,
        startedAt: interval?.startedAt ?? null,
        endedAt: interval?.endedAt ?? null,
        sourceSeconds: overlapSeconds,
        policyVersionId: policiesByDate.get(date)?.id ?? null,
        allocationKind: interval?.allocationKind ?? 'unallocated',
        jobId: interval?.jobId ?? null,
        jobNumber: interval?.jobNumber ?? '',
        projectId: interval?.projectId ?? null,
        projectNumber: interval?.projectNumber ?? '',
      },
    });
  }
}

// The day's targets and supplements go on its first row only.
function toDailyResultRow(input: {
  bucket: RoundedTimeBucket;
  isFirstRow: boolean;
  date: string;
  dailyId: string;
  supplements: EmployeePeriodCalculation['supplementBuckets'];
  daily: EmployeeDailyInput;
}): Record<string, unknown> {
  const { bucket, isFirstRow, date, dailyId, supplements } = input;
  const { employee, employeeResultId, targetsByDate } = input.daily;
  return {
    id: dailyId,
    employee_result_id: employeeResultId,
    employee_record_id: employee.id,
    local_date: date,
    activity_kind: bucket.activityKind,
    travel_route: bucket.travelRoute ?? null,
    travel_role: bucket.travelRole ?? null,
    standby_context: bucket.standbyContext ?? null,
    credit_percentage: bucket.percentage,
    source_seconds: bucket.sourceSeconds,
    source_minutes: bucket.sourceMinutes,
    credited_seconds: bucket.creditedSeconds,
    credited_minutes: bucket.creditedMinutes,
    rounding_delta_seconds: bucket.roundingDeltaSeconds,
    target_minutes: isFirstRow ? (targetsByDate.get(date)?.targetMinutes ?? 0) : 0,
    vacation_minutes: isFirstRow ? (targetsByDate.get(date)?.vacationMinutes ?? 0) : 0,
    sickness_minutes: isFirstRow ? (targetsByDate.get(date)?.sicknessMinutes ?? 0) : 0,
    night_minutes: isFirstRow
      ? (supplements.find((item) => item.supplementKind === 'night')?.minutes ?? 0)
      : 0,
    sunday_minutes: isFirstRow
      ? (supplements.find((item) => item.supplementKind === 'sunday')?.minutes ?? 0)
      : 0,
    public_holiday_minutes: isFirstRow
      ? (supplements.find((item) => item.supplementKind === 'public_holiday')?.minutes ?? 0)
      : 0,
  };
}

function pushEmployeeDailyResults(input: EmployeeDailyInput): void {
  const { calculation, intervals } = input;
  const { dailyPayload } = input.shared.payloads;
  const { dates } = input.shared.index;
  const bucketsByDate = new Map<string, typeof calculation.activityBuckets>();
  for (const bucket of calculation.activityBuckets) {
    const list = bucketsByDate.get(bucket.localDate) ?? [];
    bucketsByDate.set(bucket.localDate, [...list, bucket]);
  }
  const supplementsByDate = new Map<string, typeof calculation.supplementBuckets>();
  for (const supplement of calculation.supplementBuckets) {
    const list = supplementsByDate.get(supplement.localDate) ?? [];
    supplementsByDate.set(supplement.localDate, [...list, supplement]);
  }
  const intervalBySourceId = new Map(intervals.map((interval) => [interval.sourceId, interval]));
  for (const date of dates) {
    const buckets = bucketsByDate.get(date) ?? [];
    const rows: readonly RoundedTimeBucket[] =
      buckets.length > 0
        ? buckets
        : [
            {
              activityKind: 'work',
              localDate: date,
              sourceSeconds: 0,
              sourceMinutes: 0,
              creditedSeconds: 0,
              creditedMinutes: 0,
              roundingDeltaSeconds: 0,
              percentage: 100,
              sourceIds: [],
            },
          ];
    const supplements = supplementsByDate.get(date) ?? [];
    rows.forEach((bucket, index) => {
      const dailyId = randomUUID();
      dailyPayload.push(
        toDailyResultRow({ bucket, isFirstRow: index === 0, date, dailyId, supplements, daily: input }),
      );
      pushDailySourceRows({ bucket, date, dailyId, intervalBySourceId, daily: input });
    });
  }
}

function appendEmployeePeriodResults(
  employee: PeriodEmployee,
  policiesByEmployee: Map<string, PeriodPolicies>,
  shared: PeriodShared,
): void {
  const { bounds } = shared;
  const { dates, accountByEmployee } = shared.index;
  const { employeePayload } = shared.payloads;
  const policiesByDate = policiesByEmployee.get(employee.id) ?? new Map(dates.map((date) => [date, null]));
  const policy = policiesByDate.get(bounds.end) ?? null;
  const hasCompletePolicyHistory = dates.every((date) => policiesByDate.get(date) !== null);
  const employeeResultId = randomUUID();
  const accountCandidate = accountByEmployee.get(employee.id);
  const account = accountCandidate && accountCandidate.opened_on <= bounds.end ? accountCandidate : undefined;
  const intervals = buildEmployeeActivityIntervals(employee, shared);
  const { resolvedTargets, dailyTargets } = resolveEmployeeDailyTargets(employee, policiesByDate, shared);
  const calculation = calculateEmployeePeriodResult({
    employee,
    policy,
    account,
    hasCompletePolicyHistory,
    policiesByDate,
    intervals,
    resolvedTargets,
    dailyTargets,
    shared,
  });
  const targetsByDate = new Map(dailyTargets.map((target) => [target.localDate, target]));
  employeePayload.push({
    id: employeeResultId,
    employee_record_id: employee.id,
    policy_version_id: policy?.id ?? null,
    previous_balance_minutes: calculation.previousBalanceMinutes,
    target_minutes: calculation.targetMinutes,
    source_seconds: calculation.activityBuckets.reduce((sum, bucket) => sum + bucket.sourceSeconds, 0),
    source_minutes: calculation.sourceMinutes,
    credited_minutes: calculation.creditedMinutes,
    vacation_minutes: calculation.vacationMinutes,
    sickness_minutes: calculation.sicknessMinutes,
    account_event_minutes: calculation.accountEventMinutes,
    period_delta_minutes: calculation.periodDeltaMinutes,
    overtime_candidate_minutes: calculation.overtimeCandidateMinutes,
    closing_balance_minutes: calculation.closingBalanceMinutes,
    authoritative_targets: calculation.hasAuthoritativeTargets,
  });
  pushEmployeeFindings({
    employee,
    policy,
    account,
    hasCompletePolicyHistory,
    policiesByDate,
    calculation,
    intervals,
    targetsByDate,
    shared,
  });
  pushEmployeeDailyResults({
    employee,
    employeeResultId,
    policiesByDate,
    calculation,
    intervals,
    targetsByDate,
    shared,
  });
}

/**
 * Computes the rows prepare_time_period stores for one month. Throws the same
 * named errors as before the split (`period_source_incomplete`,
 * `period_segment_open`, `period_date_out_of_range`, `invalid_berlin_time`).
 */
export async function buildTimePeriodPreparation(input: {
  admin: AdminClient;
  context: { orgId: string };
  bounds: PeriodBounds;
  startInstant: string;
  endInstant: string;
}): Promise<TimePeriodPreparationPayload> {
  const { admin, context, bounds, startInstant, endInstant } = input;
  const { sources, index } = await loadIndexedPeriodSources({
    admin,
    context,
    bounds,
    startInstant,
    endInstant,
  });
  const policiesByEmployee = await resolvePoliciesForPeriod(
    context.orgId,
    bounds.start,
    bounds.end,
    index.periodEmployees.map((employee) => employee.id),
  );
  const payloads: TimePeriodPreparationPayload = {
    employeePayload: [],
    dailyPayload: [],
    sourcePayload: [],
    findingPayload: [],
  };
  const shared: PeriodShared = { bounds, startInstant, endInstant, sources, index, payloads };
  for (const employee of index.periodEmployees) {
    appendEmployeePeriodResults(employee, policiesByEmployee, shared);
  }
  return payloads;
}
