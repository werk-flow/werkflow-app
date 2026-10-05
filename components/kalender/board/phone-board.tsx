'use client';

import { cn } from '@/lib/utils';
import { isNoteEntry } from '@/lib/calendar/board';
import { WEEKDAY_SHORT, type BoardColumn } from '@/lib/calendar/board-layout';
import type { BoardRowModel } from '@/lib/calendar/board-model';
import { formatRefusalDate } from '@/lib/calendar/messages';
import type { CalendarJob } from '@/lib/jobs/types';
import { CalendarCard, dispatchChip, readinessChips } from '../surface/calendar-card';
import type { CalendarSurfaceActions } from './types';

/** The Plantafel at phone width: one list per day instead of a cropped grid. */
export function PhoneBoard({
  columns,
  rowModels,
  jobsByRow,
  dispatch,
  materialDemandJobIds,
  actions,
  headerLabels,
}: {
  columns: BoardColumn[];
  rowModels: BoardRowModel[];
  jobsByRow: ReadonlyMap<string, CalendarJob[]>;
  dispatch: ReadonlyMap<
    string,
    'ausstehend' | 'bestaetigt' | 'uebernommen' | 'rueckfrage' | 'nicht_moeglich'
  >;
  materialDemandJobIds: ReadonlySet<string>;
  actions: CalendarSurfaceActions;
  headerLabels: ReadonlyMap<string, string>;
}): React.JSX.Element {
  // Every row's visits, day by day: a manager's phone list carries the person's name on each card.
  const showNames = rowModels.length > 1;
  return (
    <div data-plantafel="" data-layout="list" className="divide-y" aria-label="Woche">
      {columns.map((column) => {
        const dayJobs = rowModels.flatMap((model) =>
          (jobsByRow.get(model.key) ?? [])
            .filter(
              (job) =>
                job.plannedDate &&
                column.date >= job.plannedDate &&
                column.date < (job.endDateExclusive ?? `${job.plannedDate}!`),
            )
            .map((job) => ({ job, model })),
        );
        const label = headerLabels.get(column.date);
        return (
          <section
            key={column.date}
            className={cn('space-y-1.5 px-4 py-2', column.isToday && 'bg-calendar-today')}
            aria-label={`${WEEKDAY_SHORT[column.weekday]} ${formatRefusalDate(column.date)}`}
          >
            <h3 className="flex items-baseline gap-2 text-sm">
              <span className={cn('font-medium', column.isToday && 'text-calendar-planning-strong')}>
                {WEEKDAY_SHORT[column.weekday]} {formatRefusalDate(column.date)}
              </span>
              {label && <span className="text-[11px] text-muted-foreground">{label}</span>}
            </h3>
            {dayJobs.length === 0 ? (
              <p className="text-xs text-muted-foreground">Keine Termine</p>
            ) : (
              dayJobs.map(({ job, model }) => {
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
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {model.kind === 'person' ? model.row.displayName : 'Ohne Zuweisung'}
                      </span>
                    )}
                  </CalendarCard>
                );
              })
            )}
          </section>
        );
      })}
    </div>
  );
}
