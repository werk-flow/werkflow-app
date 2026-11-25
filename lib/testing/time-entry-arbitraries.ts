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
  /** The job each work run's start names, in order. */
  runJobs: Array<string | null>;
};

const JOBS = ['job-a', 'job-b', null] as const;

/**
 * One session: the gap before it (0 lets it touch the session before), its work runs and the breaks
 * between them, the job its starts name and the job its ends name, which may differ or be missing,
 * as legacy entries wrote them, and for each break whether work resumes the legacy way, with a
 * break end and a clock-in at the same minute.
 */
type Session = {
  startGap: number;
  runs: number[];
  breaks: number[];
  legacyResumes: boolean[];
  startJob: string | null;
  endJob: string | null;
};

const sessionArbitrary: fc.Arbitrary<Session> = fc
  .record({
    startGap: fc.oneof(fc.constant(0), fc.integer({ min: 1, max: 120 })),
    runs: fc.array(fc.integer({ min: 1, max: 180 }), { minLength: 1, maxLength: 3 }),
    breaks: fc.array(fc.integer({ min: 1, max: 45 }), { minLength: 2, maxLength: 2 }),
    legacyResumes: fc.array(fc.boolean(), { minLength: 2, maxLength: 2 }),
    startJob: fc.constantFrom(...JOBS),
    endJob: fc.constantFrom(...JOBS),
  })
  .map((session) => ({ ...session, breaks: session.breaks.slice(0, session.runs.length - 1) }));

const sessionMinutes = (session: Session): number =>
  session.startGap + [...session.runs, ...session.breaks].reduce((sum, minutes) => sum + minutes, 0);

function entry(id: number, entryType: TimeEntryType, instant: number, jobId: string | null): TimeEntry {
  const timestamp = new Date(instant).toISOString();
  return {
    id: `${timestamp}#${id}`,
    userId: '00000000-0000-4000-8000-0000000000aa',
    organizationId: '00000000-0000-4000-8000-0000000000bb',
    entryType,
    timestamp,
    isManual: false,
    jobId,
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
    const add = (entryType: TimeEntryType, instant: number, jobId: string | null) =>
      entries.push(entry(entries.length + 1, entryType, instant, jobId));
    for (const session of sessions) {
      add('clock_in', at(session.startGap), session.startJob);
      session.runs.forEach((run, index) => {
        const pause = session.breaks[index];
        if (pause === undefined) {
          add('clock_out', at(run), session.endJob);
          return;
        }
        add('break_start', at(run), session.endJob);
        const resumed = at(pause);
        add('break_end', resumed, session.startJob);
        if (session.legacyResumes[index]) add('clock_in', resumed, session.startJob);
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
      runJobs: sessions.flatMap((session) => session.runs.map(() => session.startJob)),
    };
  });
}

/** A recorded day on any Berlin date before the pinned clock. */
export const recordedDayArbitrary: fc.Arbitrary<RecordedDay> = berlinDateArbitrary
  .filter((date) => date < '2026-11-01')
  .chain(recordedDayOn);
