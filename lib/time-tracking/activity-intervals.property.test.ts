import { afterAll, beforeAll, describe, expect, setSystemTime, test } from 'bun:test';
import fc from 'fast-check';
import { RECORDED_DAY_CLOCK, recordedDayArbitrary } from '@/lib/testing/time-entry-arbitraries';
import {
  type ActivityInterval,
  intervalMinutes,
  jobActivityIntervals,
  pairActivityIntervals,
} from './activity-intervals';

// Property tests (docs/technical/testing.md, "Property tests"). The rule comes from
// docs/features/time-tracking.md, "Activities": each start ends at the next clock-out or break of
// that day; an earlier start without an end reads „Ende fehlt“ and an end without a start
// „Beginn fehlt“, and the totals leave both uncounted. A clock-out without a job, or naming another,
// still ends the job's time.

beforeAll(() => setSystemTime(RECORDED_DAY_CLOCK));
afterAll(() => setSystemTime());

const closedMinutes = (intervals: ActivityInterval[], kind: 'work' | 'break'): number[] =>
  intervals.flatMap((interval) =>
    interval.state === 'closed' && (interval.kind === 'break') === (kind === 'break')
      ? [intervalMinutes(interval)]
      : [],
  );

describe('A day’s activities', () => {
  test('pair every start with the next end of that day, work and breaks alike, in any input order', () => {
    fc.assert(
      fc.property(
        recordedDayArbitrary.chain((day) =>
          fc.tuple(fc.constant(day), fc.shuffledSubarray(day.entries, { minLength: day.entries.length })),
        ),
        ([day, shuffled]) => {
          const intervals = pairActivityIntervals(shuffled, RECORDED_DAY_CLOCK);
          expect(intervals.every((interval) => interval.state === 'closed')).toBe(true);
          expect(closedMinutes(intervals, 'work')).toEqual(day.runs);
          // An end that names another job or none still ends the work; the work keeps its start's job.
          expect(
            intervals.flatMap((interval) =>
              interval.state === 'closed' && interval.kind !== 'break' ? [interval.jobId] : [],
            ),
          ).toEqual(day.runJobs);
          expect(closedMinutes(intervals, 'break').reduce((sum, minutes) => sum + minutes, 0)).toBe(
            day.breakMinutes,
          );
        },
      ),
    );
  });

  test('show a missing end or start instead of counting it', () => {
    fc.assert(
      fc.property(recordedDayArbitrary, (day) => {
        const withoutEnd = pairActivityIntervals(day.entries.slice(0, -1), RECORDED_DAY_CLOCK);
        expect(withoutEnd.map((interval) => interval.state).filter((state) => state !== 'closed')).toEqual([
          'unclosed',
        ]);
        expect(closedMinutes(withoutEnd, 'work')).toEqual(day.runs.slice(0, -1));
        // Only a clock-out reads „Beginn fehlt“; whether a break start without a start should too is
        // an open question of the spec, so the property removes a start that a clock-out ends.
        if (day.entries[1]?.entryType !== 'clock_out') return;
        const withoutStart = pairActivityIntervals(day.entries.slice(1), RECORDED_DAY_CLOCK);
        expect(withoutStart.map((interval) => interval.state).filter((state) => state !== 'closed')).toEqual([
          'unopened',
        ]);
        expect(closedMinutes(withoutStart, 'work')).toEqual(day.runs.slice(1));
      }),
    );
  });

  test('give a job exactly its own work runs, whatever job the ends name', () => {
    fc.assert(
      fc.property(recordedDayArbitrary, fc.constantFrom('job-a', 'job-b'), (day, jobId) => {
        const own = day.runs.filter((_, index) => day.runJobs[index] === jobId);
        expect(closedMinutes(jobActivityIntervals(day.entries, jobId, RECORDED_DAY_CLOCK), 'work')).toEqual(
          own,
        );
      }),
    );
  });
});
