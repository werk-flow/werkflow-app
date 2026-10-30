import 'server-only';

// P1-23 period findings: the integrity, review and warning findings of one
// employee's period, pushed in the order prepare_time_period stores them.

import { formatBerlinLocalDate } from '@/lib/date-time/berlin';
import { hasUnclosedLegacySequence } from '@/lib/time-accounts/legacy-projection';
import { isTimeCorrectionSnapshot } from '@/lib/time-corrections/types';
import {
  hashPayload,
  type PeriodEmployee,
  type PeriodPolicies,
  type PeriodShared,
  type PeriodSources,
} from './period-sources';
import type {
  DailyTargetInput,
  EmployeePeriodCalculation,
  TimeAccountPolicy,
  TimeActivityInterval,
} from './types';

// P1-23 intentionally fixes the break-warning threshold at six hours.
const BREAK_REQUIRED_ABOVE_MINUTES = 360;

type EmployeeFindingInput = {
  employee: PeriodEmployee;
  policy: TimeAccountPolicy | null;
  account: PeriodSources['accounts'][number] | undefined;
  hasCompletePolicyHistory: boolean;
  policiesByDate: PeriodPolicies;
  calculation: EmployeePeriodCalculation;
  intervals: TimeActivityInterval[];
  targetsByDate: Map<string, DailyTargetInput>;
  shared: PeriodShared;
};

function pushEmployeeSetupFindings(input: EmployeeFindingInput): void {
  const { employee, policy, account, hasCompletePolicyHistory, policiesByDate, calculation } = input;
  const { findingPayload } = input.shared.payloads;
  const { dates } = input.shared.index;
  if (!policy || !hasCompletePolicyHistory)
    findingPayload.push({
      employee_record_id: employee.id,
      local_date: null,
      finding_kind: 'missing_policy',
      severity: 'close_blocked',
      source_fingerprint: hashPayload({
        employee: employee.id,
        kind: 'missing_policy',
        dates: dates.filter((date) => !policiesByDate.get(date)),
      }),
      explanation: {
        dates: dates.filter((date) => !policiesByDate.get(date)),
      },
    });
  if (!account)
    findingPayload.push({
      employee_record_id: employee.id,
      local_date: null,
      finding_kind: 'missing_opening_balance',
      severity: 'close_blocked',
      source_fingerprint: hashPayload({
        employee: employee.id,
        kind: 'missing_account',
      }),
      explanation: {},
    });
  if (!calculation.hasAuthoritativeTargets)
    findingPayload.push({
      employee_record_id: employee.id,
      local_date: null,
      finding_kind: 'missing_schedule',
      severity: 'close_blocked',
      source_fingerprint: hashPayload({
        employee: employee.id,
        kind: 'missing_schedule',
      }),
      explanation: {},
    });
}

function pushEmployeeSourceIntegrityFindings(
  input: EmployeeFindingInput,
  sortedIntervals: TimeActivityInterval[],
): void {
  const { employee } = input;
  const { findingPayload } = input.shared.payloads;
  const { sessions } = input.shared.sources;
  const { legacyByUser } = input.shared.index;
  const openSession = (sessions ?? []).find((session) => session.employee_record_id === employee.id);
  if (openSession)
    findingPayload.push({
      employee_record_id: employee.id,
      local_date: null,
      finding_kind: openSession.status === 'recovery_required' ? 'recovery_session' : 'open_session',
      severity: 'close_blocked',
      source_fingerprint: hashPayload(openSession),
      explanation: { startedAt: openSession.started_at },
    });
  const effectiveEmployeeEntries = employee.user_id ? (legacyByUser.get(employee.user_id) ?? []) : [];
  if (hasUnclosedLegacySequence(effectiveEmployeeEntries))
    findingPayload.push({
      employee_record_id: employee.id,
      local_date: null,
      finding_kind: 'missing_clock',
      severity: 'close_blocked',
      source_fingerprint: hashPayload({
        employee: employee.id,
        kind: 'missing_clock',
        entries: effectiveEmployeeEntries.map((entry) => entry.id),
      }),
      explanation: {},
    });
  const overlap = sortedIntervals.find(
    (interval, index) => index > 0 && interval.startedAt < (sortedIntervals[index - 1]?.endedAt ?? ''),
  );
  if (overlap)
    findingPayload.push({
      employee_record_id: employee.id,
      local_date: null,
      finding_kind: 'overlap',
      severity: 'close_blocked',
      source_fingerprint: hashPayload({
        employee: employee.id,
        kind: 'overlap',
        sourceId: overlap.sourceId,
      }),
      explanation: { sourceId: overlap.sourceId },
    });
}

// A submitted or clarifying correction whose current revision moves a fact
// into the period. The period close guard repeats this rule in SQL
// (20261028130000_keep_period_close_consistent_with_concurrent_writes.sql).
function findPendingCorrectionRequest(
  employee: PeriodEmployee,
  shared: PeriodShared,
): PeriodSources['correctionRequests'][number] | undefined {
  const { startInstant, endInstant } = shared;
  const { correctionRequests, correctionRevisions } = shared.sources;
  const pendingRequests = (correctionRequests ?? []).filter(
    (request) =>
      request.subject_employee_record_id === employee.id &&
      ['submitted', 'clarification_required'].includes(request.status),
  );
  // Merged snapshots mix `+00:00` database text with `Z` ISO text; compare
  // instants, not strings. Start inclusive, end exclusive.
  const periodStart = Date.parse(startInstant);
  const periodEnd = Date.parse(endInstant);
  return pendingRequests.find((request) => {
    const revision = (correctionRevisions ?? []).find(
      (item) => item.request_id === request.id && item.revision === request.current_revision,
    );
    return (
      revision &&
      isTimeCorrectionSnapshot(revision.proposed_snapshot) &&
      revision.proposed_snapshot.facts.some((fact) => {
        const instant = Date.parse(fact.timestamp);
        return instant >= periodStart && instant < periodEnd;
      })
    );
  });
}

function pushEmployeeReviewFindings(input: EmployeeFindingInput): void {
  const { employee, calculation, intervals, targetsByDate } = input;
  const { findingPayload } = input.shared.payloads;
  const unallocated = intervals.filter(
    (interval) =>
      interval.allocationKind === 'unallocated' &&
      !['break', 'standby', 'internal_activity'].includes(interval.activityKind),
  );
  if (unallocated.length > 0)
    findingPayload.push({
      employee_record_id: employee.id,
      local_date: null,
      finding_kind: 'unallocated_time',
      severity: 'approval_required',
      source_fingerprint: hashPayload({
        employee: employee.id,
        sources: unallocated.map((interval) => interval.sourceId).sort(),
      }),
      explanation: { count: unallocated.length },
    });
  const pendingRequest = findPendingCorrectionRequest(employee, input.shared);
  if (pendingRequest)
    findingPayload.push({
      employee_record_id: employee.id,
      local_date: null,
      finding_kind: 'pending_correction',
      severity: 'close_blocked',
      source_fingerprint: hashPayload({
        requestId: pendingRequest.id,
        revision: pendingRequest.current_revision,
      }),
      explanation: { requestId: pendingRequest.id },
    });
  const absenceConflictDates = calculation.activityBuckets
    .filter(
      (bucket) =>
        bucket.creditedMinutes > 0 &&
        (targetsByDate.get(bucket.localDate)?.vacationMinutes ?? 0) +
          (targetsByDate.get(bucket.localDate)?.sicknessMinutes ?? 0) >
          0,
    )
    .map((bucket) => bucket.localDate);
  if (absenceConflictDates.length > 0)
    findingPayload.push({
      employee_record_id: employee.id,
      local_date: null,
      finding_kind: 'absence_conflict',
      severity: 'approval_required',
      source_fingerprint: hashPayload({
        employee: employee.id,
        dates: [...new Set(absenceConflictDates)].sort(),
      }),
      explanation: { dates: [...new Set(absenceConflictDates)].sort() },
    });
}

type DailyWarningMinutes = {
  dailySourceMinutes: Map<string, number>;
  dailyBreakMinutes: Map<string, number>;
  restMinutesByDate: Map<string, number>;
};

function measureDailyWarningMinutes(
  calculation: EmployeePeriodCalculation,
  sortedIntervals: TimeActivityInterval[],
): DailyWarningMinutes {
  const dailySourceMinutes = new Map<string, number>();
  const dailyBreakMinutes = new Map<string, number>();
  for (const bucket of calculation.activityBuckets) {
    dailySourceMinutes.set(
      bucket.localDate,
      (dailySourceMinutes.get(bucket.localDate) ?? 0) + bucket.sourceMinutes,
    );
    if (bucket.activityKind === 'break')
      dailyBreakMinutes.set(
        bucket.localDate,
        (dailyBreakMinutes.get(bucket.localDate) ?? 0) + bucket.sourceMinutes,
      );
  }
  const restMinutesByDate = new Map<string, number>();
  const workedIntervals = sortedIntervals.filter((interval) => interval.activityKind !== 'break');
  for (const [index, current] of workedIntervals.entries()) {
    const previous = workedIntervals[index - 1];
    if (!previous) continue;
    const previousDate = formatBerlinLocalDate(previous.endedAt);
    const currentDate = formatBerlinLocalDate(current.startedAt);
    if (previousDate === currentDate) continue;
    const restMinutes = Math.max(
      0,
      Math.floor((new Date(current.startedAt).getTime() - new Date(previous.endedAt).getTime()) / 60_000),
    );
    restMinutesByDate.set(currentDate, Math.min(restMinutesByDate.get(currentDate) ?? Infinity, restMinutes));
  }
  return { dailySourceMinutes, dailyBreakMinutes, restMinutesByDate };
}

function isWarningDay(input: {
  localDate: string;
  warning: TimeAccountPolicy['warningRules'][number];
  calculation: EmployeePeriodCalculation;
  minutes: DailyWarningMinutes;
}): boolean {
  const { localDate, warning, calculation } = input;
  const { dailySourceMinutes, dailyBreakMinutes, restMinutesByDate } = input.minutes;
  const thresholdMinutes = warning.thresholdMinutes ?? 0;
  if (warning.warningKind === 'night_work')
    return calculation.supplementBuckets.some(
      (item) => item.localDate === localDate && item.supplementKind === 'night' && item.minutes > 0,
    );
  if (warning.warningKind === 'sunday_work')
    return calculation.supplementBuckets.some(
      (item) => item.localDate === localDate && item.supplementKind === 'sunday' && item.minutes > 0,
    );
  if (warning.warningKind === 'public_holiday_work')
    return calculation.supplementBuckets.some(
      (item) => item.localDate === localDate && item.supplementKind === 'public_holiday' && item.minutes > 0,
    );
  if (warning.warningKind === 'daily_duration')
    return (dailySourceMinutes.get(localDate) ?? 0) > thresholdMinutes;
  if (warning.warningKind === 'break_duration')
    return (
      (dailySourceMinutes.get(localDate) ?? 0) - (dailyBreakMinutes.get(localDate) ?? 0) >
        BREAK_REQUIRED_ABOVE_MINUTES && (dailyBreakMinutes.get(localDate) ?? 0) < thresholdMinutes
    );
  if (warning.warningKind === 'rest_duration')
    return (restMinutesByDate.get(localDate) ?? Infinity) < thresholdMinutes;
  return false;
}

function pushEmployeeWarningFindings(
  input: EmployeeFindingInput,
  sortedIntervals: TimeActivityInterval[],
): void {
  const { employee, policiesByDate, calculation } = input;
  const { findingPayload } = input.shared.payloads;
  const minutes = measureDailyWarningMinutes(calculation, sortedIntervals);
  const effectivePolicies = [
    ...new Map(
      [...policiesByDate.values()].flatMap((datedPolicy) =>
        datedPolicy ? [[datedPolicy.id, datedPolicy] as const] : [],
      ),
    ).values(),
  ];
  for (const effectivePolicy of effectivePolicies) {
    for (const warning of effectivePolicy.warningRules) {
      if (!warning.enabled) continue;
      const candidateDates = [...minutes.dailySourceMinutes.keys()].sort();
      const matchingDays = candidateDates.filter(
        (localDate) =>
          policiesByDate.get(localDate)?.id === effectivePolicy.id &&
          isWarningDay({ localDate, warning, calculation, minutes }),
      );
      if (matchingDays.length === 0) continue;
      findingPayload.push({
        employee_record_id: employee.id,
        local_date: null,
        finding_kind: warning.warningKind,
        severity: warning.severity,
        source_fingerprint: hashPayload({
          employee: employee.id,
          warning: warning.warningKind,
          dates: [...new Set(matchingDays)].sort(),
        }),
        explanation: { dates: [...new Set(matchingDays)].sort() },
      });
    }
  }
  if (calculation.overtimeCandidateMinutes > 0)
    findingPayload.push({
      employee_record_id: employee.id,
      local_date: null,
      finding_kind: 'positive_overtime',
      severity: 'approval_required',
      source_fingerprint: hashPayload({
        employee: employee.id,
        overtime: calculation.overtimeCandidateMinutes,
      }),
      explanation: { minutes: calculation.overtimeCandidateMinutes },
    });
}

/** Pushes one employee's findings: integrity first, then review, then warnings. */
export function pushEmployeeFindings(input: EmployeeFindingInput): void {
  const sortedIntervals = [...input.intervals].sort((left, right) =>
    left.startedAt.localeCompare(right.startedAt),
  );
  pushEmployeeSetupFindings(input);
  pushEmployeeSourceIntegrityFindings(input, sortedIntervals);
  pushEmployeeReviewFindings(input);
  pushEmployeeWarningFindings(input, sortedIntervals);
}
