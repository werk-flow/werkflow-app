import { formatDuration } from './helpers';
import { intervalMinutes, type ActivityInterval } from './activity-intervals';
import { formatBerlinTime } from '@/lib/utils';

// How the Verlauf and the work pack's „Meine Zeit“ name an activity's span and
// duration. Only today's open activity runs; a missing start or end says so.

/** From and to, „seit“ a running start, „ab“ a start whose end is missing, „bis“ an end without a start. */
export function intervalSpanLabel(interval: ActivityInterval): string {
  switch (interval.state) {
    case 'closed':
      return `${formatBerlinTime(interval.start.timestamp)}–${formatBerlinTime(interval.end.timestamp)}`;
    case 'running':
      return `seit ${formatBerlinTime(interval.start.timestamp)}`;
    case 'unclosed':
      return `ab ${formatBerlinTime(interval.start.timestamp)}`;
    case 'unopened':
      return `bis ${formatBerlinTime(interval.end.timestamp)}`;
  }
}

/** The whole minutes, as the clock shows them (seconds dropped), or why there are none. */
export function intervalDurationLabel(interval: ActivityInterval): string {
  switch (interval.state) {
    case 'closed':
      return formatDuration(Math.floor(intervalMinutes(interval) ?? 0));
    case 'running':
      return 'läuft';
    case 'unclosed':
      return 'Ende fehlt';
    case 'unopened':
      return 'Beginn fehlt';
  }
}
