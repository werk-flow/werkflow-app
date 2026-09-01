import {
  addLocalDays,
  formatBerlinLocalDate,
  resolveBerlinWallTime,
} from "@/lib/planning/date-time";
import type {
  EmployeePeriodCalculation,
  EmployeePeriodCalculationInput,
  RoundedTimeBucket,
  SupplementBucket,
  TimeAccountPolicy,
  TimeActivityContext,
  TimeActivityInterval,
  TimeCreditPercentage,
  TimeCreditRule,
  TimeSupplementKind,
} from "./types";

const SECOND_MS = 1_000;

function assertIsoDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("invalid_local_date");
}

export function roundSecondsToMinutes(seconds: number): {
  minutes: number;
  roundingDeltaSeconds: number;
} {
  if (!Number.isFinite(seconds) || seconds < 0)
    throw new Error("invalid_seconds");
  const minutes = Math.floor(seconds / 60 + 0.5);
  return { minutes, roundingDeltaSeconds: minutes * 60 - seconds };
}

function contextKey(localDate: string, context: TimeActivityContext): string {
  return [
    localDate,
    context.activityKind,
    context.travelRoute ?? "",
    context.travelRole ?? "",
    context.standbyContext ?? "",
  ].join("|");
}

function ruleMatches(
  rule: TimeCreditRule,
  context: TimeActivityContext,
): boolean {
  if (rule.activityKind !== context.activityKind) return false;
  if (rule.activityKind === "travel") {
    return (
      context.travelRoute === rule.travelRoute &&
      context.travelRole === rule.travelRole
    );
  }
  if (rule.activityKind === "standby") {
    return context.standbyContext === rule.standbyContext;
  }
  return true;
}

export function resolveCreditPercentage(
  policy: TimeAccountPolicy,
  context: TimeActivityContext,
): TimeCreditPercentage {
  const matches = policy.creditRules.filter((rule) =>
    ruleMatches(rule, context),
  );
  if (matches.length !== 1) throw new Error("credit_rule_not_resolved");
  return matches[0].percentage;
}

function getBerlinDayBounds(localDate: string): { start: Date; end: Date } {
  const start = resolveBerlinWallTime(`${localDate}T00:00`);
  const end = resolveBerlinWallTime(`${addLocalDays(localDate, 1)}T00:00`);
  if (!start || !end) throw new Error("invalid_berlin_day");
  return { start: start.instant, end: end.instant };
}

function eachLocalDate(start: Date, end: Date): string[] {
  const dates: string[] = [];
  let date = formatBerlinLocalDate(start);
  const finalDate = formatBerlinLocalDate(
    new Date(Math.max(start.getTime(), end.getTime() - 1)),
  );
  while (date <= finalDate) {
    dates.push(date);
    date = addLocalDays(date, 1);
  }
  return dates;
}

function overlapSeconds(
  intervalStart: Date,
  intervalEnd: Date,
  rangeStart: Date,
  rangeEnd: Date,
): number {
  const start = Math.max(intervalStart.getTime(), rangeStart.getTime());
  const end = Math.min(intervalEnd.getTime(), rangeEnd.getTime());
  return Math.max(0, (end - start) / SECOND_MS);
}

function getNightRanges(
  localDate: string,
  window: { start: string; end: string },
): Array<{ start: Date; end: Date }> {
  const starts = [addLocalDays(localDate, -1), localDate];
  return starts.flatMap((startDate) => {
    const endDate =
      window.end <= window.start ? addLocalDays(startDate, 1) : startDate;
    const start = resolveBerlinWallTime(`${startDate}T${window.start}`);
    const end = resolveBerlinWallTime(`${endDate}T${window.end}`);
    return start && end && end.instant > start.instant
      ? [{ start: start.instant, end: end.instant }]
      : [];
  });
}

function isSunday(localDate: string): boolean {
  return new Date(`${localDate}T00:00:00.000Z`).getUTCDay() === 0;
}

function supplementSecondsForDay(args: {
  interval: TimeActivityInterval;
  localDate: string;
  supplementKind: TimeSupplementKind;
  policy: TimeAccountPolicy;
  publicHolidayDates: ReadonlySet<string>;
}): number {
  const { interval, localDate, supplementKind, policy, publicHolidayDates } =
    args;
  const start = new Date(interval.startedAt);
  const end = new Date(interval.endedAt);
  const day = getBerlinDayBounds(localDate);

  if (supplementKind === "sunday") {
    return isSunday(localDate)
      ? overlapSeconds(start, end, day.start, day.end)
      : 0;
  }
  if (supplementKind === "public_holiday") {
    return publicHolidayDates.has(localDate)
      ? overlapSeconds(start, end, day.start, day.end)
      : 0;
  }
  if (!policy.nightWindow) return 0;

  return getNightRanges(localDate, policy.nightWindow).reduce(
    (total, range) =>
      total +
      overlapSeconds(
        start,
        end,
        new Date(Math.max(range.start.getTime(), day.start.getTime())),
        new Date(Math.min(range.end.getTime(), day.end.getTime())),
      ),
    0,
  );
}

function buildActivityBuckets(
  policy: TimeAccountPolicy,
  intervals: readonly TimeActivityInterval[],
  policyByDate?: ReadonlyMap<string, TimeAccountPolicy>,
): RoundedTimeBucket[] {
  const grouped = new Map<
    string,
    {
      localDate: string;
      context: TimeActivityContext;
      sourceSeconds: number;
      sourceIds: Set<string>;
    }
  >();

  for (const interval of intervals) {
    const start = new Date(interval.startedAt);
    const end = new Date(interval.endedAt);
    if (
      !Number.isFinite(start.getTime()) ||
      !Number.isFinite(end.getTime()) ||
      end <= start
    ) {
      throw new Error("invalid_activity_interval");
    }
    const context: TimeActivityContext = {
      activityKind: interval.activityKind,
      travelRoute: interval.travelRoute,
      travelRole: interval.travelRole,
      standbyContext: interval.standbyContext,
    };
    for (const localDate of eachLocalDate(start, end)) {
      const day = getBerlinDayBounds(localDate);
      const seconds = overlapSeconds(start, end, day.start, day.end);
      if (seconds === 0) continue;
      const key = contextKey(localDate, context);
      const current = grouped.get(key) ?? {
        localDate,
        context,
        sourceSeconds: 0,
        sourceIds: new Set<string>(),
      };
      current.sourceSeconds += seconds;
      current.sourceIds.add(interval.sourceId);
      grouped.set(key, current);
    }
  }

  return [...grouped.values()]
    .map((bucket) => {
      const percentage = resolveCreditPercentage(
        policyByDate?.get(bucket.localDate) ?? policy,
        bucket.context,
      );
      const creditedSeconds = (bucket.sourceSeconds * percentage) / 100;
      const sourceRounded = roundSecondsToMinutes(bucket.sourceSeconds);
      const creditedRounded = roundSecondsToMinutes(creditedSeconds);
      return {
        ...bucket.context,
        localDate: bucket.localDate,
        sourceSeconds: bucket.sourceSeconds,
        sourceMinutes: sourceRounded.minutes,
        creditedSeconds,
        creditedMinutes: creditedRounded.minutes,
        roundingDeltaSeconds: creditedRounded.roundingDeltaSeconds,
        percentage,
        sourceIds: [...bucket.sourceIds].sort(),
      } satisfies RoundedTimeBucket;
    })
    .sort((left, right) => {
      const leftKey = contextKey(left.localDate, left);
      const rightKey = contextKey(right.localDate, right);
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    });
}

function buildSupplementBuckets(
  policy: TimeAccountPolicy,
  intervals: readonly TimeActivityInterval[],
  publicHolidayDates: ReadonlySet<string>,
  policyByDate?: ReadonlyMap<string, TimeAccountPolicy>,
): SupplementBucket[] {
  const grouped = new Map<
    string,
    { seconds: number; sourceIds: Set<string> }
  >();
  for (const interval of intervals) {
    const start = new Date(interval.startedAt);
    const end = new Date(interval.endedAt);
    for (const localDate of eachLocalDate(start, end)) {
      const effectivePolicy = policyByDate?.get(localDate) ?? policy;
      for (const rule of effectivePolicy.supplementRules) {
        if (
          !rule.enabled ||
          !rule.eligibleActivityKinds.includes(interval.activityKind)
        )
          continue;
        const seconds = supplementSecondsForDay({
          interval,
          localDate,
          supplementKind: rule.supplementKind,
          policy: effectivePolicy,
          publicHolidayDates,
        });
        if (seconds === 0) continue;
        const key = `${localDate}|${rule.supplementKind}`;
        const current = grouped.get(key) ?? {
          seconds: 0,
          sourceIds: new Set<string>(),
        };
        current.seconds += seconds;
        current.sourceIds.add(interval.sourceId);
        grouped.set(key, current);
      }
    }
  }

  return [...grouped.entries()]
    .map(([key, value]) => {
      const [localDate, supplementKind] = key.split("|") as [
        string,
        TimeSupplementKind,
      ];
      const rounded = roundSecondsToMinutes(value.seconds);
      return {
        localDate,
        supplementKind,
        sourceSeconds: value.seconds,
        minutes: rounded.minutes,
        roundingDeltaSeconds: rounded.roundingDeltaSeconds,
        sourceIds: [...value.sourceIds].sort(),
      };
    })
    .sort((left, right) => {
      const leftKey = `${left.localDate}|${left.supplementKind}`;
      const rightKey = `${right.localDate}|${right.supplementKind}`;
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    });
}

export function calculateEmployeePeriod(
  input: EmployeePeriodCalculationInput,
): EmployeePeriodCalculation {
  assertIsoDate(input.periodStart);
  assertIsoDate(input.periodEnd);
  if (input.periodEnd < input.periodStart) throw new Error("invalid_period");

  const inPeriod = (localDate: string): boolean =>
    localDate >= input.periodStart && localDate <= input.periodEnd;
  const activityBuckets = buildActivityBuckets(
    input.policy,
    input.activityIntervals,
    input.policyByDate,
  ).filter((bucket) => inPeriod(bucket.localDate));
  const supplementBuckets = buildSupplementBuckets(
    input.policy,
    input.activityIntervals,
    input.publicHolidayDates,
    input.policyByDate,
  ).filter((bucket) => inPeriod(bucket.localDate));
  const relevantTargets = input.dailyTargets.filter(
    (target) =>
      target.localDate >= input.periodStart &&
      target.localDate <= input.periodEnd,
  );
  const relevantEvents = input.accountEvents.filter(
    (event) =>
      event.effectiveDate >= input.periodStart &&
      event.effectiveDate <= input.periodEnd,
  );
  const targetMinutes = relevantTargets.reduce(
    (total, target) => total + target.targetMinutes,
    0,
  );
  const sourceMinutes = activityBuckets.reduce(
    (total, bucket) => total + bucket.sourceMinutes,
    0,
  );
  const creditedMinutes = activityBuckets.reduce(
    (total, bucket) => total + bucket.creditedMinutes,
    0,
  );
  const vacationMinutes = relevantTargets.reduce(
    (total, target) => total + target.vacationMinutes,
    0,
  );
  const sicknessMinutes = relevantTargets.reduce(
    (total, target) => total + target.sicknessMinutes,
    0,
  );
  const accountEventMinutes = relevantEvents.reduce(
    (total, event) => total + event.minutes,
    0,
  );
  const periodDeltaMinutes =
    creditedMinutes - targetMinutes + accountEventMinutes;

  return {
    employeeRecordId: input.employeeRecordId,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    policyId: input.policy.id,
    policyVersion: input.policy.version,
    activityBuckets,
    supplementBuckets,
    targetMinutes,
    sourceMinutes,
    creditedMinutes,
    vacationMinutes,
    sicknessMinutes,
    accountEventMinutes,
    periodDeltaMinutes,
    overtimeCandidateMinutes: Math.max(0, creditedMinutes - targetMinutes),
    previousBalanceMinutes: input.previousBalanceMinutes,
    closingBalanceMinutes: input.previousBalanceMinutes + periodDeltaMinutes,
    hasAuthoritativeTargets:
      relevantTargets.length > 0 &&
      relevantTargets.every((target) => target.source === "schedule"),
  };
}
