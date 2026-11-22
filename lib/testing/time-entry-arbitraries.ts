import fc from 'fast-check';
import type { TimeEntry, TimeEntryType } from '@/lib/time-tracking/types';
import { berlinDateArbitrary, berlinDayLengthHours, berlinMidnightMs } from './berlin-arbitraries';

/**
 * A recorded Berlin day for property tests of the time model, with what it holds counted while it
 * is built: sessions of work runs split by breaks, gaps between sessions, on any date before the
 * pinned clock of `RECORDED_DAY_CLOCK`, DST days included. The counts never read the module under
 * test.
 */

const MINUTE_MS = 60_000;

/** The clock the tests pin with `setSystemTime`: every generated day lies before it. */
export const RECORDED_DAY_CLOCK = new Date('2026-11-22T12:00:00Z');

export type RecordedDay = {
  localDate: string;
  entries: TimeEntry[];
  /** Minutes between each work start (clock-in or break end) and its end (break start or clock-out). */
  workMinutes: number;
  breakMinutes: number;
  workRuns: number;
  breaks: number;
  /** Each work run in order, in minutes. */
  runs: number[];
};

type Session = { startGap: number; runs: number[]; breaks: number[] };

const sessionArbitrary: fc.Arbitrary<Session> = fc
  .tuple(
    fc.integer({ min: 1, max: 120 }),
    fc.array(fc.integer({ min: 1, max: 180 }), { minLength: 1, maxLength: 3 }),
    fc.array(fc.integer({ min: 1, max: 45 }), { minLength: 2, maxLength: 2 }),
  )
  .map(([startGap, runs, breaks]) => ({ startGap, runs, breaks: breaks.slice(0, runs.length - 1) }));

const sessionMinutes = (session: Session): number =>
  session.startGap + [...session.runs, ...session.breaks].reduce((sum, minutes) => sum + minutes, 0);

function entry(id: number, entryType: TimeEntryType, instant: number): TimeEntry {
  const timestamp = new Date(instant).toISOString();
  return {
    id: `${timestamp}#${id}`,
    userId: '00000000-0000-4000-8000-0000000000aa',
    organizationId: '00000000-0000-4000-8000-0000000000bb',
    entryType,
    timestamp,
    isManual: false,
    jobId: null,
    status: 'approved',
    reviewedBy: null,
    reviewedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

/** A recorded day of one to three sessions on `localDate` that ends before the Berlin date turns. */
export function recordedDayOn(localDate: string): fc.Arbitrary<RecordedDay> {
  return fc.array(sessionArbitrary, { minLength: 1, maxLength: 3 }).map((drawn) => {
    const dayMinutes = berlinDayLengthHours(localDate) * 60;
    const sessions: Session[] = [];
    let used = 0;
    for (const session of drawn) {
      if (used + sessionMinutes(session) >= dayMinutes) break;
      sessions.push(session);
      used += sessionMinutes(session);
    }
    const entries: TimeEntry[] = [];
    let cursor = berlinMidnightMs(localDate);
    const at = (minutes: number): number => (cursor += minutes * MINUTE_MS);
    for (const session of sessions) {
      entries.push(entry(entries.length + 1, 'clock_in', at(session.startGap)));
      session.runs.forEach((run, index) => {
        const pause = session.breaks[index];
        if (pause === undefined) {
          entries.push(entry(entries.length + 1, 'clock_out', at(run)));
          return;
        }
        entries.push(entry(entries.length + 1, 'break_start', at(run)));
        entries.push(entry(entries.length + 1, 'break_end', at(pause)));
      });
    }
    const runs = sessions.flatMap((session) => session.runs);
    const pauses = sessions.flatMap((session) => session.breaks);
    return {
      localDate,
      entries,
      workMinutes: runs.reduce((sum, minutes) => sum + minutes, 0),
      breakMinutes: pauses.reduce((sum, minutes) => sum + minutes, 0),
      workRuns: runs.length,
      breaks: pauses.length,
      runs,
    };
  });
}

/** A recorded day on any Berlin date before the pinned clock. */
export const recordedDayArbitrary: fc.Arbitrary<RecordedDay> = berlinDateArbitrary
  .filter((date) => date < '2026-11-01')
  .chain(recordedDayOn);
