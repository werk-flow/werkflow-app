'use client';

import { useMemo } from 'react';
import { packLanes, type BoardColumn, type BoardSpanItem } from '@/lib/calendar/board-layout';
import { absenceItems } from '@/lib/calendar/board-model';
import { isMultiDay, type MonthCellItem } from '@/lib/calendar/month-cell-items';
import { monthRowTemplate, type MonthCell } from '@/lib/calendar/month-layout';
import type { CalendarJob } from '@/lib/jobs/types';
import type { SicknessCalendarEntry } from '@/lib/sickness/actions';
import type { VacationCalendarEntry } from '@/lib/vacation/actions';
import { BarSegment } from '../surface/bar-segment';
import { CalendarCard } from '../surface/calendar-card';
import { MonthDayCell } from './month-day-cell';

type MonthBar = BoardSpanItem &
  (
    | { kind: 'absence'; label: string; tone: 'absence' | 'absence-pending' }
    | { kind: 'job'; job: CalendarJob }
  );

type MonthWeekProps = {
  week: MonthCell[];
  labels: ReadonlyMap<string, string>;
  vacation: VacationCalendarEntry[];
  sickness: SicknessCalendarEntry[];
  jobs: CalendarJob[];
  itemsByDate: ReadonlyMap<string, MonthCellItem[]>;
  itemFor: (item: MonthCellItem, full: boolean) => React.JSX.Element;
  openMore: string | null;
  onOpenMore: (dateIso: string | null) => void;
  onOpenDay: (date: Date) => void;
  canAdd: boolean;
  onAdd: (dateIso: string) => void;
  onOpenCard: (job: CalendarJob, element: HTMLElement) => void;
};

/**
 * One week row of the month grid: seven day cells, then absences and
 * multi-day visits as bars packed into lanes between the date headers and
 * the item lists.
 */
export function MonthWeek(props: MonthWeekProps): React.JSX.Element {
  const {
    week,
    labels,
    vacation,
    sickness,
    jobs,
    itemsByDate,
    itemFor,
    openMore,
    onOpenMore,
    onOpenDay,
    canAdd,
    onAdd,
    onOpenCard,
  } = props;
  const columns = useMemo<BoardColumn[]>(
    () =>
      week.map((cell) => ({
        date: cell.date,
        weekday: cell.weekday,
        isToday: cell.isToday,
        isWeekend: cell.isWeekend,
      })),
    [week],
  );
  const bars = useMemo(() => {
    const items: MonthBar[] = [
      ...absenceItems({ vacation, sickness, employeeRecordId: null }).map(
        (absence): MonthBar => ({
          kind: 'absence',
          key: absence.key,
          startDate: absence.startDate,
          endDateExclusive: absence.endDateExclusive,
          sortMinutes: absence.sortMinutes,
          label: absence.label,
          tone: absence.pending ? 'absence-pending' : 'absence',
        }),
      ),
      ...jobs.filter(isMultiDay).flatMap((job): MonthBar[] =>
        job.plannedDate
          ? [
              {
                kind: 'job',
                key: `job:${job.id}`,
                startDate: job.plannedDate,
                endDateExclusive: job.endDateExclusive ?? job.plannedDate,
                sortMinutes: 0,
                job,
              },
            ]
          : [],
      ),
    ];
    return packLanes(items, columns);
  }, [columns, jobs, sickness, vacation]);
  return (
    <div
      role="row"
      className="grid grid-cols-7 border-b border-calendar-grid"
      style={{ gridTemplateRows: monthRowTemplate(bars.laneCount) }}
    >
      {week.map((cell, index) => (
        <MonthDayCell
          key={cell.date}
          cell={cell}
          index={index}
          label={labels.get(cell.date)}
          items={itemsByDate.get(cell.date) ?? []}
          itemFor={itemFor}
          openMore={openMore}
          onOpenMore={onOpenMore}
          onOpenDay={onOpenDay}
          canAdd={canAdd}
          onAdd={onAdd}
        />
      ))}
      {bars.lanes.map(({ item, lane, column, span }) => (
        <div
          key={item.key}
          className="relative z-[1] min-w-0 px-0.5"
          style={{ gridColumn: `${column + 1} / span ${span}`, gridRow: lane + 2 }}
        >
          {item.kind === 'job' ? (
            <CalendarCard
              job={item.job}
              size="month"
              className="h-5 w-full"
              onOpen={(element) => onOpenCard(item.job, element)}
            />
          ) : (
            <BarSegment
              tone={item.tone}
              edge="single"
              label={item.label}
              title={item.label}
              startDate={item.startDate}
              className="h-5"
            />
          )}
        </div>
      ))}
    </div>
  );
}
