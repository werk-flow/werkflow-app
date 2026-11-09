'use client';

import { PlainButton } from '@/components/ui/plain-button';
import { EmptyState } from '@/components/ui/empty-state';
import { ListRow } from '@/components/ui/list-row';
import { isStartedOccurrence } from '@/lib/calendar/board';
import { dayRowLabel } from '@/lib/calendar/day-row-status';
import { formatMinutesOfDay } from '@/lib/calendar/drag-math';
import { createSessionFromCalendarBlock } from '@/lib/time-tracking/calendar-blocks';
import type { OrganizationTimeTrackingSettings } from '@/lib/time-tracking/settings';
import {
  TIME_ACTIVITY_LABELS,
  type EntryChangeRequestMap,
  type InteractiveCalendarSession,
} from '@/lib/time-tracking/types';
import type { CalendarSurfaceActions } from '../board/types';
import type { CalendarJob } from '@/lib/jobs/types';
import { useBoardAbsences } from '../board-absences-context';
import { CalendarCard, unavailableAssigneeWarnings } from '../surface/calendar-card';
import { useClock } from '../surface/use-now-tick';
import type { DayRow, DayRowItem } from '@/lib/calendar/day-rows';

/** A recorded block in the phone's list: activity, span, its segments and what still waits. */
function dayListBlock(
  item: Extract<DayRowItem, { kind: 'block' }>,
  changeRequestMap: EntryChangeRequestMap,
  onOpen: () => void,
): React.JSX.Element {
  return (
    <ListRow key={item.key} interactive asChild className="block">
      <PlainButton type="button" className="min-h-11 w-full text-left" onClick={onOpen}>
        <span className="block text-sm font-medium">
          {item.block.isOnBreak
            ? 'Pause'
            : TIME_ACTIVITY_LABELS[item.block.startEntry.activityKind ?? 'work']}
        </span>
        <span className="block text-sm tabular-nums text-muted-foreground">
          {formatMinutesOfDay(item.startMinutes)}–
          {item.block.isOpen ? 'jetzt' : formatMinutesOfDay(item.endMinutes)}
        </span>
        {item.segments.length > 1 &&
          item.segments.map((segment) => (
            <span key={segment.id} className="block text-xs tabular-nums text-muted-foreground">
              {segment.type === 'break' ? 'Pause' : 'Arbeitszeit'} {formatMinutesOfDay(segment.startMinutes)}–
              {formatMinutesOfDay(segment.endMinutes)}
            </span>
          ))}
        {item.block.isPending && <span className="block text-xs text-warning-text">Freigabe ausstehend</span>}
        {item.block.sourceEntries.some((entry) => changeRequestMap[entry.id]) && (
          <span className="block text-xs text-warning-text">Korrektur ausstehend</span>
        )}
      </PlainButton>
    </ListRow>
  );
}

/** The day on a phone: one section per person with the untimed visits first, then the day in time order. */
export function DayViewList({
  dateIso,
  headerLabel,
  rows,
  nowTick,
  actions,
  organizationSettings,
  changeRequestMap,
  onSessionClick,
}: {
  dateIso: string;
  headerLabel: string | null;
  rows: DayRow[];
  nowTick: number;
  actions: CalendarSurfaceActions;
  organizationSettings: OrganizationTimeTrackingSettings;
  changeRequestMap: EntryChangeRequestMap;
  onSessionClick: (session: InteractiveCalendarSession) => void;
}): React.JSX.Element {
  const clock = useClock();
  const { people } = useBoardAbsences();
  const warningProps = (job: CalendarJob) => {
    const warnings = unavailableAssigneeWarnings(job, people);
    return { chips: warnings.chips, alert: warnings.alert };
  };
  return (
    <div
      data-day-view={dateIso}
      data-layout="list"
      aria-label="Tageskalender"
      className="space-y-5 px-4 py-3"
    >
      {headerLabel && <p className="text-sm text-muted-foreground">{headerLabel}</p>}
      {rows.map(({ model, boardDay, items, untimed }) => (
        <section key={model.key} aria-label={model.name} className="space-y-2">
          {actions.isManager && <h2 className="break-words text-sm font-medium">{model.name}</h2>}
          {dayRowLabel(boardDay) && <p className="text-sm text-muted-foreground">{dayRowLabel(boardDay)}</p>}
          {untimed.map((job) => (
            <CalendarCard
              key={job.id}
              job={job}
              size="board"
              {...warningProps(job)}
              locked={isStartedOccurrence(job, nowTick)}
              className="min-h-11 w-full"
              onOpen={(element) => actions.onOpenCard(job, element, model.row)}
            />
          ))}
          {[...items]
            .sort((left, right) => left.startMinutes - right.startMinutes)
            .map((item) =>
              item.kind === 'job' ? (
                <CalendarCard
                  key={item.key}
                  job={item.job}
                  size="board"
                  {...warningProps(item.job)}
                  locked={isStartedOccurrence(item.job, nowTick)}
                  className="min-h-11 w-full"
                  onOpen={(element) => actions.onOpenCard(item.job, element, model.row)}
                />
              ) : (
                dayListBlock(item, changeRequestMap, () =>
                  onSessionClick(
                    createSessionFromCalendarBlock(item.block, new Date(clock()), organizationSettings),
                  ),
                )
              ),
            )}
          {items.length === 0 && untimed.length === 0 && (
            <EmptyState size="compact" title="Keine Einträge für diesen Tag." />
          )}
        </section>
      ))}
      {rows.length === 0 && <EmptyState size="compact" title="Keine Mitarbeiter für diese Auswahl." />}
    </div>
  );
}
