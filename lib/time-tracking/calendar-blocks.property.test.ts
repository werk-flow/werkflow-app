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

type Span = { from: number; to: number };

/** Touching spans joined, empty ones dropped, in order. */
function joined(spans: readonly Span[]): Span[] {
  const result: Span[] = [];
  for (const span of [...spans].sort((left, right) => left.from - right.from)) {
    if (span.to - span.from < 1e-9) continue;
    const last = result.at(-1);
    if (last && span.from - last.to < 1e-9) last.to = Math.max(last.to, span.to);
    else result.push({ ...span });
  }
  return result;
}

/**
 * Where the spec puts the break, in minutes of the day's presence: the first step's break ends
 * at its threshold, and the second step's extra minutes end at the second threshold.
 */
function expectedSpans(presence: number, rule: BreakPolicyValues): Span[] {
  const spans: Span[] = [];
  if (presence >= rule.autoBreakThresholdMinutes)
    spans.push({
      from: rule.autoBreakThresholdMinutes - rule.autoBreakDurationMinutes,
      to: rule.autoBreakThresholdMinutes,
    });
  const second = rule.secondStep;
  if (second && presence >= second.thresholdMinutes)
    spans.push({
      from: second.thresholdMinutes - (second.durationMinutes - rule.autoBreakDurationMinutes),
      to: second.thresholdMinutes,
    });
  return joined(spans);
}

describe('The calendar of a recorded day under the automatic break', () => {
  test('shows the break the totals deduct, inside the blocks, each share ending at its threshold', () => {
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
        for (const range of automatic) {
          expect(range.start).toBeGreaterThanOrEqual(Date.parse(range.block.start));
          expect(range.end).toBeLessThanOrEqual(Date.parse(range.block.end ?? range.block.start));
        }
        const shownSpans = joined(
          automatic.map((range) => ({ from: presenceUntil(range.start), to: presenceUntil(range.end) })),
        );
        expect(shownSpans.map(({ from, to }) => [from, to])).toEqual(
          expectedSpans(presence, rule).map(({ from, to }) => [from, to]),
        );
      }),
    );
  });

  test('of a ten-hour day under ArbZG § 4 shows 30 minutes up to six hours and 15 more up to nine', () => {
    const at = (minutes: number) => new Date(Date.UTC(2026, 0, 15, 7) + minutes * MINUTE_MS).toISOString();
    const entry = (id: string, entryType: 'clock_in' | 'clock_out', timestamp: string) => ({
      id,
      userId: 'person',
      organizationId: 'organization',
      entryType,
      timestamp,
      isManual: false,
      jobId: null,
      status: 'approved' as const,
      reviewedBy: null,
      reviewedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const rule: BreakPolicyValues = {
      breakMode: 'automatic',
      autoBreakThresholdMinutes: 360,
      autoBreakDurationMinutes: 30,
      secondStep: { thresholdMinutes: 540, durationMinutes: 45 },
    };
    const [block] = calculateCalendarWorkBlocks([
      entry('in', 'clock_in', at(0)),
      entry('out', 'clock_out', at(600)),
    ]);
    if (!block) throw new Error('one block');
    const breaks = getCalendarBlockDisplaySegments(block, RECORDED_DAY_CLOCK, settingsOf(rule)).filter(
      (segment) => segment.type === 'break',
    );
    expect(breaks.map((segment) => [segment.start, segment.end])).toEqual([
      [at(330), at(360)],
      [at(525), at(540)],
    ]);
  });
});
