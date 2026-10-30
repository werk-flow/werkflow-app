'use client';

import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/utils';
import { isNoteEntry } from '@/lib/calendar/board';
import { WEEKDAY_SHORT, type BoardColumn } from '@/lib/calendar/board-layout';
import { absenceItems, type BoardAbsenceItem, type BoardRowModel } from '@/lib/calendar/board-model';
import { formatRefusalDate } from '@/lib/calendar/messages';
import type { CalendarJob } from '@/lib/jobs/types';
import type { SicknessCalendarEntry } from '@/lib/sickness/actions';
import type { VacationCalendarEntry } from '@/lib/vacation/calendar-actions';
import { BarSegment } from '../surface/bar-segment';
import { CalendarCard, dispatchChip, readinessChips } from '../surface/calendar-card';
import type { CalendarSurfaceActions } from './types';

type DispatchByRecipient = ReadonlyMap<
  string,
  'ausstehend' | 'bestaetigt' | 'uebernommen' | 'rueckfrage' | 'nicht_moeglich'
>;

/** The Plantafel at phone width: one list per day instead of a cropped grid. */
export function PhoneBoard({
  columns,
  rowModels,
  jobsByRow,
  vacation,
  sickness,
  dispatch,
  materialDemandJobIds,
  actions,
  headerLabels,
}: {
  columns: BoardColumn[];
  rowModels: BoardRowModel[];
  jobsByRow: ReadonlyMap<string, CalendarJob[]>;
  vacation: readonly VacationCalendarEntry[];
  sickness: readonly SicknessCalendarEntry[];
  dispatch: DispatchByRecipient;
  materialDemandJobIds: ReadonlySet<string>;
  actions: CalendarSurfaceActions;
  headerLabels: ReadonlyMap<string, string>;
}): React.JSX.Element {
  // The visible people's absences; each label already names the person.
  const absences = rowModels.flatMap((model) =>
    model.kind === 'person'
      ? absenceItems({ vacation, sickness, employeeRecordId: model.row.employeeRecordId })
      : [],
  );
  return (
    <div data-plantafel="" data-layout="list" className="divide-y" aria-label="Woche">
      {columns.map((column) => (
        <PhoneBoardDay
          key={column.date}
          column={column}
          label={headerLabels.get(column.date)}
          absences={absences.filter(
            (absence) => column.date >= absence.startDate && column.date < absence.endDateExclusive,
          )}
          visits={rowModels.flatMap((model) =>
            (jobsByRow.get(model.key) ?? [])
              .filter(
                (job) =>
                  job.plannedDate &&
                  column.date >= job.plannedDate &&
                  column.date < (job.endDateExclusive ?? `${job.plannedDate}!`),
              )
              .map((job) => ({ job, model })),
          )}
          // A manager's phone list carries the person's name on each card.
          showNames={rowModels.length > 1}
          dispatch={dispatch}
          materialDemandJobIds={materialDemandJobIds}
          actions={actions}
        />
      ))}
    </div>
  );
}

/** One day of the phone list: its absences, then every row's visits in time order. */
function PhoneBoardDay({
  column,
  label,
  absences,
  visits,
  showNames,
  dispatch,
  materialDemandJobIds,
  actions,
}: {
  column: BoardColumn;
  label: string | undefined;
  absences: BoardAbsenceItem[];
  visits: { job: CalendarJob; model: BoardRowModel }[];
  showNames: boolean;
  dispatch: DispatchByRecipient;
  materialDemandJobIds: ReadonlySet<string>;
  actions: CalendarSurfaceActions;
}): React.JSX.Element {
  return (
    <section
      className={cn('space-y-1.5 px-4 py-2', column.isToday && 'bg-calendar-today')}
      aria-label={`${WEEKDAY_SHORT[column.weekday]} ${formatRefusalDate(column.date)}`}
    >
      <h2 className="flex items-baseline gap-2 text-sm">
        <span className={cn('font-medium', column.isToday && 'text-calendar-planning-strong')}>
          {WEEKDAY_SHORT[column.weekday]} {formatRefusalDate(column.date)}
        </span>
        {label && <span className="text-xs text-muted-foreground">{label}</span>}
      </h2>
      {absences.map((absence) => (
        <BarSegment
          key={absence.key}
          tone={absence.pending ? 'absence-pending' : 'absence'}
          edge="single"
          label={absence.label}
          startDate={absence.startDate}
          className="h-6"
        />
      ))}
      {visits.length === 0 ? (
        <EmptyState size="compact" className="text-xs" title="Keine Termine" />
      ) : (
        visits.map(({ job, model }) => {
          const recordId = model.kind === 'person' ? model.row.employeeRecordId : null;
          return (
            <CalendarCard
              key={`${model.key}:${job.id}`}
              job={job}
              size="board"
              chips={
                isNoteEntry(job) || job.entryKind === 'internal'
                  ? []
                  : [
                      dispatchChip(dispatch.get(`${job.occurrenceId}:${recordId}`) ?? 'nicht_gesendet'),
                      ...readinessChips(materialDemandJobIds.has(job.jobId ?? '')),
                    ]
              }
              className="min-h-11 w-full"
              onOpen={(element) =>
                actions.onOpenCard(job, element, model.kind === 'person' ? model.row : null)
              }
            >
              {showNames && (
                <span className="block truncate text-xs text-muted-foreground">
                  {model.kind === 'person' ? model.row.displayName : 'Ohne Zuweisung'}
                </span>
              )}
            </CalendarCard>
          );
        })
      )}
    </section>
  );
}
