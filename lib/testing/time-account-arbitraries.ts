import fc from 'fast-check';
import type {
  TimeAccountPolicy,
  TimeActivityContext,
  TimeActivityInterval,
  TimeCreditRule,
} from '@/lib/time-accounts/types';
import {
  TIME_ENTRY_TYPES,
  type TimeEntry,
  type TimeTravelRole,
  type TimeTravelRoute,
} from '@/lib/time-tracking/types';
import { daysInMonth } from './berlin-arbitraries';

/**
 * Inputs for property tests of the Zeitkonto, periods and payroll (lib/time-accounts): Berlin
 * months, credit policies and recorded activities. A period is one Berlin calendar month
 * (docs/features/time-tracking.md, "Period close"); the months come from the calendar, not from
 * the module under test.
 */

const SECOND_MS = 1_000;
const HOUR_SECONDS = 3_600;

const TRAVEL_ROUTES = [
  'company_to_site',
  'home_to_site',
  'site_to_site',
  'site_to_company',
  'other',
  'unspecified',
] as const satisfies readonly TimeTravelRoute[];
const TRAVEL_ROLES = ['driver', 'passenger', 'unspecified'] as const satisfies readonly TimeTravelRole[];

/** One credit rule per activity context a policy must resolve, each at 100 percent. */
const CREDIT_RULE_SHAPES: readonly TimeCreditRule[] = [
  { activityKind: 'work', percentage: 100 },
  { activityKind: 'break', percentage: 100 },
  { activityKind: 'callout', percentage: 100 },
  { activityKind: 'internal_activity', percentage: 100 },
  ...TRAVEL_ROUTES.flatMap((travelRoute) =>
    TRAVEL_ROLES.map((travelRole) => ({
      activityKind: 'travel' as const,
      travelRoute,
      travelRole,
      percentage: 100 as const,
    })),
  ),
  ...(['on_site', 'remote', 'unspecified'] as const).map((standbyContext) => ({
    activityKind: 'standby' as const,
    standbyContext,
    percentage: 100 as const,
  })),
];

/** The activity a credit rule weights, without its percentage. */
function contextOf(rule: TimeCreditRule): TimeActivityContext {
  if (rule.activityKind === 'travel')
    return { activityKind: 'travel', travelRoute: rule.travelRoute, travelRole: rule.travelRole };
  if (rule.activityKind === 'standby')
    return { activityKind: 'standby', standbyContext: rule.standbyContext };
  return { activityKind: rule.activityKind };
}

const percentageArbitrary = fc.constantFrom(0, 50, 100);

/** A policy version with a 0, 50 or 100 percent credit for every activity context. */
export const policyArbitrary: fc.Arbitrary<TimeAccountPolicy> = fc
  .record({
    id: fc.constantFrom('policy-a', 'policy-b', 'policy-c'),
    version: fc.integer({ min: 1, max: 9 }),
    percentages: fc.array(percentageArbitrary, {
      minLength: CREDIT_RULE_SHAPES.length,
      maxLength: CREDIT_RULE_SHAPES.length,
    }),
    nightWindow: fc.constantFrom(
      null,
      { start: '22:00', end: '06:00' },
      { start: '23:00', end: '05:00' },
      { start: '20:00', end: '23:00' },
    ),
    supplements: fc.array(fc.boolean(), { minLength: 3, maxLength: 3 }),
    treatment: fc.constantFrom('paid' as const, 'unpaid' as const, 'informational' as const),
  })
  .map(({ id, version, percentages, nightWindow, supplements, treatment }) => ({
    id,
    version,
    effectiveFrom: '2000-01-01',
    creditRules: CREDIT_RULE_SHAPES.map((rule, index) => ({ ...rule, percentage: percentages[index] ?? 0 })),
    supplementRules: (['night', 'sunday', 'public_holiday'] as const).map((supplementKind, index) => ({
      supplementKind,
      enabled: supplements[index] ?? false,
      eligibleActivityKinds: ['work', 'callout', 'travel'] as const,
    })),
    nightWindow,
    vacationTreatment: treatment,
    sicknessTreatment: treatment,
    warningRules: [],
  }));

const pad = (value: number): string => String(value).padStart(2, '0');

/** A Berlin calendar month: its first day, last day and the first day after it. */
export type BerlinMonth = { start: string; end: string; endExclusive: string };

/** The month of a year and a 1-based month number; 13 is January of the next year. */
export function berlinMonth(year: number, month: number): BerlinMonth {
  const [y, m] = month > 12 ? [year + 1, month - 12] : [year, month];
  const [nextYear, nextMonth] = m === 12 ? [y + 1, 1] : [y, m + 1];
  return {
    start: `${y}-${pad(m)}-01`,
    end: `${y}-${pad(m)}-${pad(daysInMonth(y, m))}`,
    endExclusive: `${nextYear}-${pad(nextMonth)}-01`,
  };
}

/** A year and month, with the DST months and the year turn drawn often. */
export const yearMonthArbitrary: fc.Arbitrary<{ year: number; month: number }> = fc.record({
  year: fc.integer({ min: 2000, max: 2098 }),
  month: fc.oneof(fc.integer({ min: 1, max: 12 }), fc.constantFrom(2, 3, 10, 12)),
});

/**
 * Recorded activities that never overlap, in time order, around an instant: a chain of gaps and
 * durations to the second, so a minute rounds and an activity runs over midnight or a month turn.
 */
export function activityIntervalsAround(anchorMs: number): fc.Arbitrary<TimeActivityInterval[]> {
  return fc
    .record({
      firstOffset: fc.integer({ min: -40 * HOUR_SECONDS, max: 8 * HOUR_SECONDS }),
      steps: fc.array(
        fc.record({
          gap: fc.integer({ min: 0, max: 16 * HOUR_SECONDS }),
          length: fc.integer({ min: 1, max: 14 * HOUR_SECONDS }),
          rule: fc.constantFrom(...CREDIT_RULE_SHAPES),
          unallocated: fc.boolean(),
        }),
        { maxLength: 5 },
      ),
    })
    .map(({ firstOffset, steps }) => {
      let cursor = anchorMs + firstOffset * SECOND_MS;
      return steps.map(({ gap, length, rule, unallocated }, index) => {
        const start = cursor + gap * SECOND_MS;
        cursor = start + length * SECOND_MS;
        return {
          ...contextOf(rule),
          sourceId: `source-${index}`,
          startedAt: new Date(start).toISOString(),
          endedAt: new Date(cursor).toISOString(),
          allocationKind: unallocated ? 'unallocated' : 'job',
        };
      });
    });
}

/**
 * Clock entries of the time model before segments around an instant, at distinct whole seconds
 * and in time order: every entry type and review status, some with a job.
 */
export function legacyEntriesAround(anchorMs: number): fc.Arbitrary<TimeEntry[]> {
  return fc
    .array(
      fc.record({
        gap: fc.integer({ min: 1, max: 20 * HOUR_SECONDS }),
        entryType: fc.constantFrom(...TIME_ENTRY_TYPES),
        status: fc.constantFrom(
          'approved' as const,
          'approved' as const,
          'pending' as const,
          'rejected' as const,
          'pending_delete' as const,
        ),
        jobId: fc.option(fc.constantFrom('job-1', 'job-2'), { nil: null }),
        activityKind: fc.option(fc.constantFrom('work' as const, 'travel' as const, 'callout' as const), {
          nil: undefined,
        }),
      }),
      { maxLength: 10 },
    )
    .map((steps) => {
      let cursor = anchorMs - 30 * HOUR_SECONDS * SECOND_MS;
      return steps.map(({ gap, entryType, status, jobId, activityKind }, index) => {
        cursor += gap * SECOND_MS;
        const timestamp = new Date(cursor).toISOString();
        return {
          id: `entry-${index}`,
          userId: 'user-1',
          organizationId: 'org-1',
          entryType,
          timestamp,
          isManual: false,
          jobId,
          status,
          reviewedBy: null,
          reviewedAt: null,
          createdAt: timestamp,
          updatedAt: timestamp,
          activityKind,
        };
      });
    });
}
