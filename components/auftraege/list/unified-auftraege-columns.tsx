import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import type { SkeletonColumn } from '@/components/ui/skeleton-table';
import {
  JOB_PRIORITY_LABELS,
  getJobDisplayTitle,
  getProjectDisplayTitle,
  getEffectiveProjectStatusFromCounts,
  type Job,
  type ProjectWithDetails,
} from '@/lib/jobs/types';
import {
  AUFTRAEGE_VISIBLE_COLUMN_LABELS,
  isAuftraegeColumnVisible,
  type AuftraegeColumnId,
} from '@/lib/jobs/auftraege-table-columns';
import { cn, formatGermanDate } from '@/lib/utils';
import {
  getJobStatusClass,
  getJobStatusLabel,
  getProjectStatusClass,
  getProjectStatusLabel,
} from '../status-classes';
import { PRIORITY_CLASSES } from '../job-detail/job-detail-format';

export type AuftraegeTableColumnId = AuftraegeColumnId | 'selection' | 'actions';

export interface AuftraegeTableColumn extends SkeletonColumn {
  id: AuftraegeTableColumnId;
}

// One definition for the header row and the skeleton rows, so widths,
// responsive visibility, and placeholder shapes cannot drift apart. The
// header of a sortable column still renders through `SortableHeader`.
const AUFTRAEGE_COLUMNS: readonly AuftraegeTableColumn[] = [
  { id: 'selection', header: null, className: 'w-[36px]', skeleton: <Skeleton className="size-4" /> },
  { id: 'nr', header: 'Nr', className: 'w-[120px]', skeleton: <Skeleton className="h-5 w-24" /> },
  {
    id: 'bezeichnung',
    header: AUFTRAEGE_VISIBLE_COLUMN_LABELS.bezeichnung,
    skeleton: <Skeleton className="h-5 w-32" />,
  },
  { id: 'kunde', header: 'Kunde', className: 'w-[140px]', skeleton: <Skeleton className="h-5 w-24" /> },
  {
    id: 'status',
    header: 'Status',
    className: 'min-w-[280px]',
    skeleton: <Skeleton className="h-[22px] w-32 rounded-full" />,
  },
  {
    id: 'prioritaet',
    header: 'Priorität',
    className: 'w-[100px]',
    skeleton: <Skeleton className="h-[22px] w-16 rounded-full" />,
  },
  {
    id: 'mitarbeiter',
    header: 'Mitarbeiter',
    className: 'hidden xl:table-cell w-[120px]',
    skeleton: <Skeleton className="h-5 w-20" />,
  },
  { id: 'datum', header: 'Datum', className: 'w-[170px]', skeleton: <Skeleton className="h-5 w-20" /> },
  { id: 'actions', header: null, className: 'w-[50px]', skeleton: <Skeleton className="h-8 w-8 rounded" /> },
];

/** The columns a table with these preferences renders, in order. */
export function auftraegeColumns(
  visibleColumns: AuftraegeColumnId[],
  showActions: boolean,
): AuftraegeTableColumn[] {
  return AUFTRAEGE_COLUMNS.filter((column) => {
    if (column.id === 'selection') return true;
    if (column.id === 'actions') return showActions;
    return isAuftraegeColumnVisible(visibleColumns, column.id);
  });
}

/** Known draft values for a pending job row; unknown columns stay bars. */
export function jobPendingCells(
  job: Job,
  clientName: string,
): Partial<Record<AuftraegeTableColumnId, React.ReactNode>> {
  return {
    selection: '',
    nr: <span className="font-mono text-xs text-muted-foreground">{job.jobNumber || '—'}</span>,
    bezeichnung: <span className="font-medium">{getJobDisplayTitle(job)}</span>,
    kunde: clientName,
    status: (
      <Badge variant="secondary" className={getJobStatusClass(job)}>
        {getJobStatusLabel(job)}
      </Badge>
    ),
    prioritaet: (
      <Badge variant="secondary" className={PRIORITY_CLASSES[job.priority]}>
        {JOB_PRIORITY_LABELS[job.priority]}
      </Badge>
    ),
    datum: <span className="text-muted-foreground">{formatGermanDate(job.plannedDate, { empty: '—' })}</span>,
    actions: '',
  };
}

export function projectPendingCells(
  project: ProjectWithDetails,
  clientName: string,
): Partial<Record<AuftraegeTableColumnId, React.ReactNode>> {
  return {
    selection: '',
    nr: <span className="font-mono text-xs text-muted-foreground">{project.projectNumber || '—'}</span>,
    bezeichnung: <span className="font-medium">{getProjectDisplayTitle(project)}</span>,
    kunde: clientName,
    status: (
      <Badge
        variant="secondary"
        className={cn(
          'max-w-48 justify-center truncate',
          getProjectStatusClass(project, getEffectiveProjectStatusFromCounts(project)),
        )}
      >
        {getProjectStatusLabel(project)}
      </Badge>
    ),
    prioritaet: '',
    mitarbeiter: '',
    datum: (
      <span className="text-muted-foreground">
        {project.plannedStartDate || project.plannedEndDate
          ? `${formatGermanDate(project.plannedStartDate, { empty: '—' })} – ${formatGermanDate(project.plannedEndDate, { empty: '—' })}`
          : '—'}
      </span>
    ),
    actions: '',
  };
}
