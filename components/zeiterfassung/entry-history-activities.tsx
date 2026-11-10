'use client';

import { ListRow } from '@/components/ui/list-row';
import {
  intervalAnchor,
  type ActivityDay,
  type ActivityInterval,
} from '@/lib/time-tracking/activity-intervals';
import { intervalDurationLabel, intervalSpanLabel } from '@/lib/time-tracking/activity-interval-labels';
import { TIME_ACTIVITY_LABELS, type TimeEntry } from '@/lib/time-tracking/types';
import { cn, formatBerlin } from '@/lib/utils';
import { STATUS_LABELS } from './entry-history-labels';
import { EntryHistoryRowAction, type EntryHistoryRowActionProps } from './entry-history-row-action';

// An employee's Verlauf: their days, newest first, each with one row per
// activity in time order (from, to, duration, job). The office keeps the
// entry table (entry-history.tsx).

export type EntryHistoryActivitiesProps = Omit<EntryHistoryRowActionProps, 'entry' | 'align'> & {
  days: readonly ActivityDay[];
  /** Number and title of each job the activities name, by id. */
  jobLabels: Readonly<Record<string, string>>;
};

/**
 * The entry the row's action works on: one with a correction in review, else
 * the viewer's pending submission, else the activity's start.
 */
function actionEntry(interval: ActivityInterval): TimeEntry {
  const edges = [interval.start, interval.end].filter((edge) => edge !== null);
  return (
    edges.find((edge) => edge.pendingCorrectionRequestId) ??
    edges.find((edge) => edge.status === 'pending' && edge.isManual) ??
    intervalAnchor(interval)
  );
}

function ActivityRow({
  interval,
  jobLabels,
  ...actionProps
}: Omit<EntryHistoryActivitiesProps, 'days'> & { interval: ActivityInterval }) {
  const entry = actionEntry(interval);
  const jobLabel = interval.jobId ? jobLabels[interval.jobId] : undefined;
  const isManual = interval.start?.isManual === true || interval.end?.isManual === true;
  return (
    <ListRow className="flex-wrap" data-time-entry={entry.id} data-time-entry-status={interval.status}>
      {/* A phone puts the action below the activity, so the job keeps the row's width. */}
      <div className="min-w-0 flex-1 basis-64 space-y-0.5">
        <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <span className="font-medium">{TIME_ACTIVITY_LABELS[interval.kind]}</span>
          <span className="tabular-nums">{intervalSpanLabel(interval)}</span>
          <span className="tabular-nums text-muted-foreground">{intervalDurationLabel(interval)}</span>
        </p>
        {jobLabel ? <p className="break-words text-sm text-muted-foreground">{jobLabel}</p> : null}
        {interval.status !== 'approved' || isManual ? (
          <p className="flex flex-wrap gap-1.5">
            {interval.status !== 'approved' ? (
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-xs font-medium',
                  STATUS_LABELS[interval.status].className,
                )}
              >
                {STATUS_LABELS[interval.status].label}
              </span>
            ) : null}
            {isManual ? <span className="rounded bg-muted px-1.5 py-0.5 text-xs">Nachgetragen</span> : null}
          </p>
        ) : null}
      </div>
      <EntryHistoryRowAction entry={entry} {...actionProps} />
    </ListRow>
  );
}

/** The employee's days with their activities (`activityDays`). */
export function EntryHistoryActivities({ days, ...rowProps }: EntryHistoryActivitiesProps) {
  return (
    <div className="space-y-5">
      {days.map((day) => (
        <section key={day.date} aria-labelledby={`history-day-${day.date}`} className="space-y-2">
          <h3 id={`history-day-${day.date}`} className="text-sm font-medium text-muted-foreground">
            {formatBerlin(day.date, 'longWeekdayDate')}
          </h3>
          {day.intervals.map((interval) => (
            <ActivityRow key={interval.id} interval={interval} {...rowProps} />
          ))}
        </section>
      ))}
    </div>
  );
}
