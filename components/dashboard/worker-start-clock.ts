import { computeZeiterfassungLiveTotals } from '@/components/zeiterfassung/zeiterfassung-dashboard-live-totals';
import { formatBerlinLocalDate } from '@/lib/date-time/berlin';
import { describeClockActivity } from '@/lib/time-tracking/clock-day-summary';
import { liveMinutes, todayRunningSince } from '@/lib/time-tracking/helpers';
import type { LiveClockState } from '@/lib/time-tracking/types';
import { formatBerlinTime } from '@/lib/utils';

// The clock part of a field worker's start page, from the clock state the app
// already holds (components/clock-state-provider.tsx): no read of its own.

/** Where the clock stands and today's working time at one instant. */
export type WorkerStartClockView =
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | {
      kind: 'ready';
      /** „Du arbeitest gerade. Seit 07:12 Uhr.“ or „Du bist nicht eingestempelt.“ */
      status: string;
      /**
       * Today's working time, breaks taken off as the Zeiterfassung counts them; null while the
       * clock state is of an earlier Berlin day (a page left open past midnight).
       */
      workingMinutes: number | null;
      /** The instant the minutes count to while the clock runs; null while it stands. */
      asOf: string | null;
    };

/**
 * The minutes count to the instant the clock state stands for (`fetchedAt`): the read, an echoed
 * action, or the provider's catch-up when the page becomes visible again. They never tick, so the
 * start page rests while the clock runs; the clock dock shows the running time.
 */
export function workerStartClockView(
  clock: { state: LiveClockState | null; isReady: boolean; statusError: string | null },
  /** Today's Berlin date (`YYYY-MM-DD`). */
  today: string,
): WorkerStartClockView {
  const { state } = clock;
  if (!state || !clock.isReady) return clock.statusError ? { kind: 'unavailable' } : { kind: 'loading' };
  const nowMs = Date.parse(state.fetchedAt);
  const runningSince = state.isClockedIn ? todayRunningSince(state.statusStartedAt, nowMs) : null;
  const liveTotal = liveMinutes(state.todayMinutes, runningSince, nowMs);
  const { breakdown } = computeZeiterfassungLiveTotals(
    state,
    liveTotal,
    undefined,
    state.isClockedIn ? nowMs : null,
  );
  const since =
    state.isClockedIn && state.statusStartedAt ? ` Seit ${formatBerlinTime(state.statusStartedAt)} Uhr.` : '';
  return {
    kind: 'ready',
    status: `${describeClockActivity(state).sentence}${since}`,
    workingMinutes:
      formatBerlinLocalDate(state.fetchedAt) === today
        ? breakdown.workMinutes + breakdown.overtimeMinutes
        : null,
    asOf: state.isClockedIn ? state.fetchedAt : null,
  };
}
