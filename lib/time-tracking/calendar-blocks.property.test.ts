import { afterAll, beforeAll, describe, expect, setSystemTime, test } from 'bun:test';
import fc from 'fast-check';
import { addLocalDays, getLocalWeekday } from '@/lib/date-time/berlin';
import { berlinMidnightMs } from '@/lib/testing/berlin-arbitraries';
import { automaticBreakRuleArbitrary } from '@/lib/testing/break-rule-arbitraries';
import { RECORDED_DAY_CLOCK, recordedDayArbitrary } from '@/lib/testing/time-entry-arbitraries';
import { calculateCalendarWorkBlocks, getCalendarBlockDisplaySegments } from './calendar-blocks';
import type { BreakPolicyValues, OrganizationTimeTrackingSettings } from './settings';
import { buildWeeklyTimeData } from './weekly';

// Property tests (docs/technical/testing.md, "Property tests"). The rule comes from
// docs/features/time-tracking.md, "Break rule": the steps count the whole day's work across jobs
// and blocks, in the totals and in the calendar alike; each share of the break lies where the day's
// work reaches its threshold; and the calendar's blocks add up to the break the totals deduct.

beforeAll(() => setSystemTime(RECORDED_DAY_CLOCK));
afterAll(() => setSystemTime());

const MINUTE_MS = 60_000;

const settingsOf = (rule: BreakPolicyValues): OrganizationTimeTrackingSettings => ({
  ...rule,
  organizationId: '00000000-0000-4000-8000-0000000000bb',
  breakPolicyHistory: [],
});

/** The last threshold a day's presence reached, by the rule without the module. */
function lastReachedThreshold(presence: number, rule: BreakPolicyValues): number | null {
  if (rule.secondStep && presence >= rule.secondStep.thresholdMinutes)
    return rule.secondStep.thresholdMinutes;
  return presence >= rule.autoBreakThresholdMinutes ? rule.autoBreakThresholdMinutes : null;
}

describe('The calendar of a recorded day under the automatic break', () => {
  test('shows the break the totals deduct, inside the blocks, no later than the last threshold reached', () => {
    fc.assert(
      fc.property(recordedDayArbitrary, automaticBreakRuleArbitrary, (day, rule) => {
        const settings = settingsOf(rule);
        const blocks = calculateCalendarWorkBlocks(day.entries);
        const automatic = blocks.flatMap((block) =>
          getCalendarBlockDisplaySegments(block, RECORDED_DAY_CLOCK, settings)
            .filter((segment) => segment.type === 'break' && segment.id.includes('auto-break'))
            .map((segment) => ({
              block,
              start: Date.parse(segment.start),
              end: Date.parse(segment.end ?? segment.start),
            })),
        );
        const monday = addLocalDays(day.localDate, -getLocalWeekday(day.localDate));
        const week = buildWeeklyTimeData(day.entries, new Date(berlinMidnightMs(monday)), settings);
        const deducted = week.find((point) => point.date === day.localDate)?.breakMinutes;
        const shown = automatic.reduce((sum, range) => sum + (range.end - range.start) / MINUTE_MS, 0);
        expect(shown).toBeCloseTo(deducted ?? Number.NaN, 6);

        const presenceUntil = (instant: number): number =>
          blocks.reduce((sum, block) => {
            const from = Date.parse(block.start);
            const to = Math.min(Date.parse(block.end ?? block.start), instant);
            return sum + Math.max(0, to - from) / MINUTE_MS;
          }, 0);
        const presence = presenceUntil(Number.POSITIVE_INFINITY);
        const threshold = lastReachedThreshold(presence, rule);
        for (const range of automatic) {
          expect(range.start).toBeGreaterThanOrEqual(Date.parse(range.block.start));
          expect(range.end).toBeLessThanOrEqual(Date.parse(range.block.end ?? range.block.start));
          expect(presenceUntil(range.end)).toBeLessThanOrEqual((threshold ?? 0) + 1e-9);
        }
      }),
    );
  });
});
