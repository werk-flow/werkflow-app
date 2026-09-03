'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowDown, ArrowUp, ArrowUpDown, Briefcase, ChevronRight } from 'lucide-react';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { InlinePending } from '@/components/ui/inline-pending';
import { ListRow } from '@/components/ui/list-row';
import { PendingRow } from '@/components/ui/pending-row';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonList, SkeletonRows, type SkeletonColumn } from '@/components/ui/skeleton-table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { JobActionsMenu } from './job-actions-menu';
import { ProjectActionsMenu } from './project-actions-menu';
import {
  JOB_STATUS_LABELS,
  JOB_PRIORITY_LABELS,
  PROJECT_STATUS_LABELS,
  calculateTrafficLightFromCounts,
  getJobDisplayTitle,
  getProjectDisplayTitle,
  getEffectiveProjectStatusFromCounts,
  type Client,
  type Job,
  type JobStatus,
  type JobPriority,
  type Project,
  type ProjectStatus,
  type ProjectWithDetails,
  type UnifiedListEntry,
  type SortColumn,
} from '@/lib/jobs/types';
import {
  AUFTRAEGE_VISIBLE_COLUMN_LABELS,
  DEFAULT_VISIBLE_AUFTRAEGE_COLUMNS,
  isAuftraegeColumnVisible,
  resolveVisibleAuftraegeColumns,
  type AuftraegeColumnId,
} from '@/lib/jobs/auftraege-table-columns';
import type { OrgMemberOption } from './employee-multi-select';
import { cn } from '@/lib/utils';
import { useActiveJobs } from '@/hooks/use-active-jobs';
import { WORK_EXECUTION_LABELS, type WorkExecutionState } from '@/lib/work-lifecycle/types';

function getJobStatusLabel(job: Job): string {
  return job.executionState
    ? WORK_EXECUTION_LABELS[job.executionState]
    : `${JOB_STATUS_LABELS[job.status]} · Altbestand`;
}

function getProjectStatusLabel(project: ProjectWithDetails): string {
  if (project.executionStateOverride) {
    return WORK_EXECUTION_LABELS[project.executionStateOverride];
  }
  if (project.statusOverride) {
    return `${PROJECT_STATUS_LABELS[project.statusOverride]} · Altbestand`;
  }
  return `${PROJECT_STATUS_LABELS[getEffectiveProjectStatusFromCounts(project)]} · automatisch`;
}

function ActiveWorkIndicator() {
  return (
    <span
      className="relative ml-2 inline-flex h-2.5 w-2.5 shrink-0"
      title="Jemand arbeitet gerade an diesem Auftrag"
    >
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-500" />
    </span>
  );
}

// ============================================
// Style Constants
// ============================================

const JOB_STATUS_CLASSES: Record<JobStatus, string> = {
  nicht_bearbeitet: 'bg-secondary text-secondary-foreground',
  in_bearbeitung: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  fertig: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  geparkt: 'bg-brand-purple/15 text-brand-purple-dark dark:text-brand-purple-light',
};

const PRIORITY_CLASSES: Record<JobPriority, string> = {
  niedrig: 'bg-secondary text-secondary-foreground',
  mittel: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  hoch: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
};

const PROJECT_STATUS_CLASSES: Record<ProjectStatus, string> = {
  nicht_begonnen: 'bg-secondary text-secondary-foreground',
  in_bearbeitung: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  abgeschlossen: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  geparkt: 'bg-brand-purple/15 text-brand-purple-dark dark:text-brand-purple-light',
};

const WORK_EXECUTION_CLASSES: Record<WorkExecutionState, string> = {
  not_started: 'bg-secondary text-secondary-foreground',
  in_progress: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  interrupted: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  execution_complete: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  handed_over: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  cancelled: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
};

function getJobStatusClass(job: Job): string {
  return job.executionState
    ? WORK_EXECUTION_CLASSES[job.executionState]
    : JOB_STATUS_CLASSES[job.status];
}

function getProjectStatusClass(
  project: ProjectWithDetails,
  effectiveStatus: ProjectStatus,
): string {
  return project.executionStateOverride
    ? WORK_EXECUTION_CLASSES[project.executionStateOverride]
    : PROJECT_STATUS_CLASSES[effectiveStatus];
}

function TrafficLight({ status }: { status: 'green' | 'yellow' | 'red' }) {
  const base = 'size-2.5 rounded-full shrink-0 transition-colors';
  const inactive = 'bg-muted-foreground/20';
  return (
    <div
      className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/50 px-1.5 py-0.5"
      title={
        status === 'green'
          ? 'Im Zeitplan'
          : status === 'yellow'
            ? 'Leicht verzögert'
            : 'Stark verzögert'
      }
    >
      <span className={cn(base, status === 'red' ? 'bg-red-500' : inactive)} />
      <span className={cn(base, status === 'yellow' ? 'bg-yellow-500' : inactive)} />
      <span className={cn(base, status === 'green' ? 'bg-green-500' : inactive)} />
    </div>
  );
}

// ============================================
// Helpers
// ============================================

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function getInitials(firstName: string, lastName: string): string {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
}

function buildMemberLookup(members: OrgMemberOption[]): Map<string, OrgMemberOption> {
  const map = new Map<string, OrgMemberOption>();
  for (const m of members) map.set(m.userId, m);
  return map;
}

function AvatarStack({
  userIds,
  memberLookup,
  max = 3,
}: {
  userIds: string[];
  memberLookup: Map<string, OrgMemberOption>;
  max?: number;
}) {
  if (userIds.length === 0) return <span className="text-muted-foreground/50">—</span>;

  const visible = userIds.slice(0, max);
  const overflow = userIds.length - max;

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex -space-x-1.5">
        {visible.map((uid) => {
          const member = memberLookup.get(uid);
          const initials = member ? getInitials(member.firstName, member.lastName) : '?';
          const fullName = member ? `${member.firstName} ${member.lastName}` : 'Unbekannt';
          return (
            <Tooltip key={uid}>
              <TooltipTrigger asChild>
                <span className="inline-flex size-6 items-center justify-center rounded-full border-2 border-background bg-muted text-[9px] font-medium text-muted-foreground">
                  {initials}
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">{fullName}</TooltipContent>
            </Tooltip>
          );
        })}
        {overflow > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex size-6 items-center justify-center rounded-full border-2 border-background bg-muted text-[9px] font-medium text-muted-foreground">
                +{overflow}
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              {userIds.slice(max).map((uid) => {
                const m = memberLookup.get(uid);
                return m ? `${m.firstName} ${m.lastName}` : 'Unbekannt';
              }).join(', ')}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </TooltipProvider>
  );
}

function MarqueeText({ children, className }: { children: React.ReactNode; className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [shouldAnimate, setShouldAnimate] = useState(false);

  const check = useCallback(() => {
    const container = containerRef.current;
    const text = textRef.current;
    if (!container || !text) return;
    const overflow = text.scrollWidth - container.clientWidth;
    if (overflow > 1) {
      setShouldAnimate(true);
      text.style.setProperty('--marquee-distance', `-${overflow}px`);
      const speed = 30;
      text.style.setProperty('--marquee-duration', `${Math.max(4, overflow / speed)}s`);
    } else {
      setShouldAnimate(false);
    }
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(check);
    const observer = new ResizeObserver(check);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [check, children]);

  return (
    <div ref={containerRef} className={cn('overflow-hidden', className)}>
      <span
        ref={textRef}
        className={cn('inline-block whitespace-nowrap', shouldAnimate && 'animate-marquee')}
      >
        {children}
      </span>
    </div>
  );
}

// ============================================
// Columns And Skeletons
// ============================================

type AuftraegeTableColumnId = AuftraegeColumnId | 'selection' | 'actions';

interface AuftraegeTableColumn extends SkeletonColumn {
  id: AuftraegeTableColumnId;
}

// One definition for the header row and the skeleton rows, so widths,
// responsive visibility, and placeholder shapes cannot drift apart. The
// header of a sortable column still renders through `SortableHeader`.
export const AUFTRAEGE_COLUMNS: readonly AuftraegeTableColumn[] = [
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

/**
 * Per-row feedback the list owner derives from its optimistic overlay
 * (feedback canon): drafts the server has not confirmed render as a
 * `PendingRow` / dimmed card; rows saved through a dialog keep an inline
 * indicator until the authoritative read lands.
 */
export interface AuftraegeRowFeedback {
  pendingIds: ReadonlySet<string>;
  settlingIds: ReadonlySet<string>;
}

const NO_ROW_FEEDBACK: AuftraegeRowFeedback = {
  pendingIds: new Set(),
  settlingIds: new Set(),
};

const SETTLING_LABEL = 'Wird aktualisiert';

function SettlingIndicator({ active, className }: { active: boolean; className?: string }) {
  return <InlinePending active={active} label={SETTLING_LABEL} className={className} />;
}

/** Known draft values for a pending job row; unknown columns stay bars. */
function jobPendingCells(job: Job, clientName: string): Partial<Record<AuftraegeTableColumnId, React.ReactNode>> {
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
    datum: <span className="text-muted-foreground">{formatDate(job.plannedDate)}</span>,
    actions: '',
  };
}

function projectPendingCells(
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
        className={cn('max-w-48 justify-center truncate', getProjectStatusClass(project, getEffectiveProjectStatusFromCounts(project)))}
      >
        {getProjectStatusLabel(project)}
      </Badge>
    ),
    prioritaet: '',
    mitarbeiter: '',
    datum: (
      <span className="text-muted-foreground">
        {project.plannedStartDate || project.plannedEndDate
          ? `${formatDate(project.plannedStartDate)} – ${formatDate(project.plannedEndDate)}`
          : '—'}
      </span>
    ),
    actions: '',
  };
}

function isSortableColumn(columnId: AuftraegeTableColumnId): columnId is SortColumn {
  return columnId !== 'selection' && columnId !== 'actions' && columnId !== 'mitarbeiter';
}

interface AuftraegeSortState {
  column: SortColumn;
  direction: 'asc' | 'desc';
  onSort: (column: SortColumn) => void;
  /** Archived entries keep a fixed status column. */
  isArchive?: boolean;
}

function AuftraegeTableHeaderRow({
  columns,
  sort,
}: {
  columns: readonly AuftraegeTableColumn[];
  /** Omitted by route skeletons, which render plain headers. */
  sort?: AuftraegeSortState;
}) {
  return (
    <TableRow>
      {columns.map((column) =>
        sort && isSortableColumn(column.id) && !(sort.isArchive && column.id === 'status') ? (
          <SortableHeader
            key={column.id}
            label={column.header}
            column={column.id}
            currentColumn={sort.column}
            currentDirection={sort.direction}
            onSort={sort.onSort}
            className={column.className}
          />
        ) : (
          <TableHead key={column.id} className={column.className}>
            {column.header}
          </TableHead>
        )
      )}
    </TableRow>
  );
}

/** Loading placeholder with the exact frame of the loaded list; every row is a link, so rows hover. */
export function AuftraegeTableSkeleton({
  count,
  showActions,
  visibleColumns = DEFAULT_VISIBLE_AUFTRAEGE_COLUMNS,
  sort,
}: {
  count: number;
  showActions: boolean;
  visibleColumns?: AuftraegeColumnId[];
  sort?: AuftraegeSortState;
}) {
  const columns = auftraegeColumns(visibleColumns, showActions);
  return (
    <>
      <SkeletonList count={count} interactive className="md:hidden">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-center gap-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-4 w-32" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-3 rounded-full" />
            <Skeleton className="h-3 w-20" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-5 w-24 rounded-full" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
        </div>
        {showActions && <Skeleton className="h-8 w-8 shrink-0 rounded" />}
      </SkeletonList>
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <AuftraegeTableHeaderRow columns={columns} sort={sort} />
          </TableHeader>
          <TableBody>
            <SkeletonRows columns={columns} rows={count} interactive />
          </TableBody>
        </Table>
      </div>
    </>
  );
}

// ============================================
// Desktop Table Rows
// ============================================

function StandaloneJobRow({
  job,
  clientName,
  isAdminOrManager,
  isActive,
  isSettling,
  memberLookup,
  assignedUserIds,
  visibleColumns,
  clients,
  members,
  projects,
  onJobUpdated,
  onJobDeleted,
  onJobDeleteRequested,
}: {
  job: Job;
  clientName: string;
  isAdminOrManager: boolean;
  isActive: boolean;
  isSettling: boolean;
  memberLookup: Map<string, OrgMemberOption>;
  assignedUserIds: string[];
  visibleColumns: AuftraegeColumnId[];
  clients: Client[];
  members: OrgMemberOption[];
  projects: ProjectWithDetails[];
  onJobUpdated?: (payload: {
    job: Job;
    selectedEmployeeIds?: string[];
  }) => void | Promise<void>;
  onJobDeleted?: (jobId: string) => void | Promise<void>;
  onJobDeleteRequested?: (jobId: string) => void;
}) {
  const router = useRouter();
  const detailHref = `/auftraege/${encodeURIComponent(job.jobNumber!)}`;

  return (
    <TableRow interactive onClick={() => router.push(detailHref)}>
      <TableCell className="w-[36px]" />
      {isAuftraegeColumnVisible(visibleColumns, 'nr') && (
        <TableCell className="font-mono text-xs text-muted-foreground">
          {job.jobNumber || '—'}
        </TableCell>
      )}
      {isAuftraegeColumnVisible(visibleColumns, 'bezeichnung') && (
        <TableCell className="font-medium">
          <div className="flex items-start gap-2">
            <span className="line-clamp-4 break-words whitespace-pre-wrap">
              {getJobDisplayTitle(job)}
            </span>
            {isActive && <ActiveWorkIndicator />}
            <SettlingIndicator active={isSettling} className="mt-0.5" />
          </div>
        </TableCell>
      )}
      {isAuftraegeColumnVisible(visibleColumns, 'kunde') && <TableCell>{clientName}</TableCell>}
      {isAuftraegeColumnVisible(visibleColumns, 'status') && (
        <TableCell>
          <Badge variant="secondary" className={getJobStatusClass(job)}>
            {getJobStatusLabel(job)}
          </Badge>
        </TableCell>
      )}
      {isAuftraegeColumnVisible(visibleColumns, 'prioritaet') && (
        <TableCell>
          <Badge variant="secondary" className={PRIORITY_CLASSES[job.priority]}>
            {JOB_PRIORITY_LABELS[job.priority]}
          </Badge>
        </TableCell>
      )}
      {isAuftraegeColumnVisible(visibleColumns, 'mitarbeiter') && (
        <TableCell className="hidden xl:table-cell">
          <AvatarStack userIds={assignedUserIds} memberLookup={memberLookup} />
        </TableCell>
      )}
      {isAuftraegeColumnVisible(visibleColumns, 'datum') && (
        <TableCell className="text-muted-foreground">
          {formatDate(job.plannedDate)}
        </TableCell>
      )}
      {isAdminOrManager && (
        <TableCell onClick={(e) => e.stopPropagation()}>
          <JobActionsMenu
            job={job}
            detailHref={detailHref}
            clients={clients}
            members={members}
            projects={projects}
            onJobUpdated={onJobUpdated}
            onJobDeleted={onJobDeleted}
            onDeleteRequested={onJobDeleteRequested}
          />
        </TableCell>
      )}
    </TableRow>
  );
}

function ProjectRow({
  project,
  childJobs,
  clientName,
  isAdminOrManager,
  isExpanded,
  onToggle,
  clientMap,
  activeJobIds,
  rowFeedback,
  columns,
  memberLookup,
  jobAssignmentMap,
  visibleColumns,
  clients,
  jobs,
  members,
  projects,
  onJobUpdated,
  onJobDeleted,
  onJobDeleteRequested,
  onProjectUpdated,
  onProjectDeleted,
  onProjectDeleteRequested,
}: {
  project: ProjectWithDetails;
  childJobs: Job[];
  clientName: string;
  isAdminOrManager: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  clientMap: Record<string, string>;
  activeJobIds: Set<string>;
  rowFeedback: AuftraegeRowFeedback;
  columns: readonly AuftraegeTableColumn[];
  memberLookup: Map<string, OrgMemberOption>;
  jobAssignmentMap: Record<string, string[]>;
  visibleColumns: AuftraegeColumnId[];
  clients: Client[];
  jobs: Job[];
  members: OrgMemberOption[];
  projects: ProjectWithDetails[];
  onJobUpdated?: (payload: {
    job: Job;
    selectedEmployeeIds?: string[];
  }) => void | Promise<void>;
  onJobDeleted?: (jobId: string) => void | Promise<void>;
  onJobDeleteRequested?: (jobId: string) => void;
  onProjectUpdated?: (payload: {
    project: Project;
    selectedJobIds?: string[];
  }) => void | Promise<void>;
  onProjectDeleted?: (projectId: string) => void | Promise<void>;
  onProjectDeleteRequested?: (projectId: string) => void;
}) {
  const router = useRouter();
  const projectHref = `/auftraege/projekt/${encodeURIComponent(project.projectNumber!)}`;
  const effectiveStatus = project.statusOverride ?? getEffectiveProjectStatusFromCounts(project);
  const progress = project.jobCount > 0
    ? Math.round((project.completedJobCount / project.jobCount) * 100)
    : 0;
  const trafficLight = calculateTrafficLightFromCounts(
    project,
    project.jobCount,
    project.completedJobCount,
  );

  const allProjectUserIds = [...new Set(childJobs.flatMap((j) => jobAssignmentMap[j.id] ?? []))];

  return (
    <>
      <TableRow
        interactive
        className="bg-muted/30"
        onClick={() => router.push(projectHref)}
      >
        <TableCell className="w-[36px] pr-0" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={onToggle}
            className="flex size-6 items-center justify-center rounded-sm hover:bg-accent"
            aria-label={isExpanded ? 'Projekt zuklappen' : 'Projekt aufklappen'}
          >
            <ChevronRight
              className={cn(
                'size-4 text-muted-foreground transition-transform duration-200',
                isExpanded && 'rotate-90'
              )}
            />
          </button>
        </TableCell>
        {isAuftraegeColumnVisible(visibleColumns, 'nr') && (
          <TableCell className="font-mono text-xs text-muted-foreground">
            {project.projectNumber || '—'}
          </TableCell>
        )}
        {isAuftraegeColumnVisible(visibleColumns, 'bezeichnung') && (
          <TableCell className="font-medium">
          <div className="flex items-start gap-2">
            <span className="line-clamp-4 break-words whitespace-pre-wrap">
              {getProjectDisplayTitle(project)}
            </span>
            {childJobs.some((j) => activeJobIds.has(j.id)) && <ActiveWorkIndicator />}
            <SettlingIndicator active={rowFeedback.settlingIds.has(project.id)} className="mt-0.5" />
          </div>
          </TableCell>
        )}
        {isAuftraegeColumnVisible(visibleColumns, 'kunde') && <TableCell>{clientName}</TableCell>}
        {isAuftraegeColumnVisible(visibleColumns, 'status') && (
          <TableCell>
            <div className="flex items-center gap-2">
              <Badge
                variant="secondary"
                className={cn('max-w-48 justify-center truncate', getProjectStatusClass(project, effectiveStatus))}
                title={getProjectStatusLabel(project)}
              >
                {getProjectStatusLabel(project)}
              </Badge>
              <div className="flex items-center gap-1.5">
                <Progress value={progress} className="h-1.5 w-12" />
                <span className="text-[10px] tabular-nums text-muted-foreground">
                  {project.completedJobCount}/{project.jobCount}
                </span>
              </div>
              <TrafficLight status={trafficLight} />
            </div>
          </TableCell>
        )}
        {isAuftraegeColumnVisible(visibleColumns, 'prioritaet') && <TableCell />}
        {isAuftraegeColumnVisible(visibleColumns, 'mitarbeiter') && (
          <TableCell className="hidden xl:table-cell">
            {!isExpanded && (
              <AvatarStack userIds={allProjectUserIds} memberLookup={memberLookup} max={4} />
            )}
          </TableCell>
        )}
        {isAuftraegeColumnVisible(visibleColumns, 'datum') && (
          <TableCell className="text-muted-foreground">
            {project.plannedStartDate || project.plannedEndDate
              ? `${formatDate(project.plannedStartDate)} – ${formatDate(project.plannedEndDate)}`
              : '—'}
          </TableCell>
        )}
        {isAdminOrManager && (
          <TableCell onClick={(e) => e.stopPropagation()}>
            <ProjectActionsMenu
              project={project}
              detailHref={projectHref}
              clients={clients}
              jobs={jobs}
              onProjectUpdated={onProjectUpdated}
              onProjectDeleted={onProjectDeleted}
              onDeleteRequested={onProjectDeleteRequested}
            />
          </TableCell>
        )}
      </TableRow>

      {isExpanded &&
        childJobs.map((job) => {
          const childClientName = job.clientId ? clientMap[job.clientId] || '—' : clientName;
          if (rowFeedback.pendingIds.has(job.id)) {
            return (
              <PendingRow
                key={job.id}
                columns={columns}
                cells={jobPendingCells(job, childClientName)}
                interactive
              />
            );
          }
          const childHref = `/auftraege/projekt/${encodeURIComponent(project.projectNumber!)}/${encodeURIComponent(job.jobNumber!)}`;
          const childAssigned = jobAssignmentMap[job.id] ?? [];
          return (
            <TableRow
              key={job.id}
              interactive
              className="bg-muted/10"
              onClick={() => router.push(childHref)}
            >
              <TableCell className="w-[36px]" />
              {isAuftraegeColumnVisible(visibleColumns, 'nr') && (
                <TableCell className="pl-8 font-mono text-xs text-muted-foreground">
                  {job.jobNumber || '—'}
                </TableCell>
              )}
              {isAuftraegeColumnVisible(visibleColumns, 'bezeichnung') && (
                <TableCell className="pl-8 font-medium">
                  <div className="flex items-start gap-2">
                    <span className="line-clamp-4 break-words whitespace-pre-wrap">
                      {getJobDisplayTitle(job)}
                    </span>
                    {activeJobIds.has(job.id) && <ActiveWorkIndicator />}
                    <SettlingIndicator active={rowFeedback.settlingIds.has(job.id)} className="mt-0.5" />
                  </div>
                </TableCell>
              )}
              {isAuftraegeColumnVisible(visibleColumns, 'kunde') && (
                <TableCell>{childClientName}</TableCell>
              )}
              {isAuftraegeColumnVisible(visibleColumns, 'status') && (
                <TableCell>
                  <Badge variant="secondary" className={getJobStatusClass(job)}>
                    {getJobStatusLabel(job)}
                  </Badge>
                </TableCell>
              )}
              {isAuftraegeColumnVisible(visibleColumns, 'prioritaet') && (
                <TableCell>
                  <Badge variant="secondary" className={PRIORITY_CLASSES[job.priority]}>
                    {JOB_PRIORITY_LABELS[job.priority]}
                  </Badge>
                </TableCell>
              )}
              {isAuftraegeColumnVisible(visibleColumns, 'mitarbeiter') && (
                <TableCell className="hidden xl:table-cell">
                  <AvatarStack userIds={childAssigned} memberLookup={memberLookup} />
                </TableCell>
              )}
              {isAuftraegeColumnVisible(visibleColumns, 'datum') && (
                <TableCell className="text-muted-foreground">
                  {formatDate(job.plannedDate)}
                </TableCell>
              )}
              {isAdminOrManager && (
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <JobActionsMenu
                    job={job}
                    detailHref={childHref}
                    clients={clients}
                    members={members}
                    projects={projects}
                    onJobUpdated={onJobUpdated}
                    onJobDeleted={onJobDeleted}
                    onDeleteRequested={onJobDeleteRequested}
                  />
                </TableCell>
              )}
            </TableRow>
          );
        })}
    </>
  );
}

// ============================================
// Mobile Cards
// ============================================

function JobCard({
  job,
  clientName,
  isAdminOrManager,
  indented,
  projectNumber,
  isActive,
  isPending = false,
  isSettling = false,
  memberLookup,
  assignedUserIds,
  clients,
  members,
  projects,
  onJobUpdated,
  onJobDeleted,
  onJobDeleteRequested,
}: {
  job: Job;
  clientName: string;
  isAdminOrManager: boolean;
  indented?: boolean;
  projectNumber?: string;
  isActive?: boolean;
  /** A draft the server has not confirmed: dimmed, not navigable, no actions. */
  isPending?: boolean;
  isSettling?: boolean;
  memberLookup: Map<string, OrgMemberOption>;
  assignedUserIds: string[];
  clients: Client[];
  members: OrgMemberOption[];
  projects: ProjectWithDetails[];
  onJobUpdated?: (payload: {
    job: Job;
    selectedEmployeeIds?: string[];
  }) => void | Promise<void>;
  onJobDeleted?: (jobId: string) => void | Promise<void>;
  onJobDeleteRequested?: (jobId: string) => void;
}) {
  const router = useRouter();
  const detailHref = projectNumber
    ? `/auftraege/projekt/${encodeURIComponent(projectNumber)}/${encodeURIComponent(job.jobNumber!)}`
    : `/auftraege/${encodeURIComponent(job.jobNumber!)}`;

  return (
    <ListRow
      interactive={!isPending}
      role={isPending ? 'status' : undefined}
      aria-label={isPending ? 'Wird gespeichert' : undefined}
      className={cn('items-start', indented && 'ml-6', isPending && 'opacity-70')}
      onClick={isPending ? undefined : () => router.push(detailHref)}
    >
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-center gap-2">
          <InlinePending active={isPending || isSettling} label={isPending ? 'Wird gespeichert' : SETTLING_LABEL} />
          {job.jobNumber && (
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
              {job.jobNumber}
            </span>
          )}
          <MarqueeText className="flex-1 text-sm font-medium">
            <span className="inline-flex items-center">
              {getJobDisplayTitle(job)}
              {isActive && <ActiveWorkIndicator />}
            </span>
          </MarqueeText>
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <span className="truncate">{clientName}</span>
          {job.plannedDate && (
            <>
              <span className="text-muted-foreground/60">&middot;</span>
              <span>{formatDate(job.plannedDate)}</span>
            </>
          )}
        </div>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Badge variant="secondary" className={cn('text-[10px]', getJobStatusClass(job))}>
              {getJobStatusLabel(job)}
            </Badge>
            <Badge variant="secondary" className={cn('text-[10px]', PRIORITY_CLASSES[job.priority])}>
              {JOB_PRIORITY_LABELS[job.priority]}
            </Badge>
          </div>
          {assignedUserIds.length > 0 && (
            <AvatarStack userIds={assignedUserIds} memberLookup={memberLookup} max={3} />
          )}
        </div>
      </div>
      {isAdminOrManager && !isPending && (
        <div onClick={(e) => e.stopPropagation()}>
          <JobActionsMenu
            job={job}
            detailHref={detailHref}
            clients={clients}
            members={members}
            projects={projects}
            onJobUpdated={onJobUpdated}
            onJobDeleted={onJobDeleted}
            onDeleteRequested={onJobDeleteRequested}
          />
        </div>
      )}
    </ListRow>
  );
}

function ProjectCard({
  project,
  childJobs,
  clientName,
  isAdminOrManager,
  clientMap,
  activeJobIds,
  rowFeedback,
  memberLookup,
  jobAssignmentMap,
  clients,
  jobs,
  members,
  projects,
  onJobUpdated,
  onJobDeleted,
  onJobDeleteRequested,
  onProjectUpdated,
  onProjectDeleted,
  onProjectDeleteRequested,
}: {
  project: ProjectWithDetails;
  childJobs: Job[];
  clientName: string;
  isAdminOrManager: boolean;
  clientMap: Record<string, string>;
  activeJobIds: Set<string>;
  rowFeedback: AuftraegeRowFeedback;
  memberLookup: Map<string, OrgMemberOption>;
  jobAssignmentMap: Record<string, string[]>;
  clients: Client[];
  jobs: Job[];
  members: OrgMemberOption[];
  projects: ProjectWithDetails[];
  onJobUpdated?: (payload: {
    job: Job;
    selectedEmployeeIds?: string[];
  }) => void | Promise<void>;
  onJobDeleted?: (jobId: string) => void | Promise<void>;
  onJobDeleteRequested?: (jobId: string) => void;
  onProjectUpdated?: (payload: {
    project: Project;
    selectedJobIds?: string[];
  }) => void | Promise<void>;
  onProjectDeleted?: (projectId: string) => void | Promise<void>;
  onProjectDeleteRequested?: (projectId: string) => void;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const isPending = rowFeedback.pendingIds.has(project.id);
  const projectHref = `/auftraege/projekt/${encodeURIComponent(project.projectNumber!)}`;
  const effectiveStatus = project.statusOverride ?? getEffectiveProjectStatusFromCounts(project);
  const progress = project.jobCount > 0
    ? Math.round((project.completedJobCount / project.jobCount) * 100)
    : 0;
  const trafficLight = calculateTrafficLightFromCounts(
    project,
    project.jobCount,
    project.completedJobCount,
  );

  const allProjectUserIds = [...new Set(childJobs.flatMap((j) => jobAssignmentMap[j.id] ?? []))];

  return (
    <div>
      <ListRow
        interactive={!isPending}
        role={isPending ? 'status' : undefined}
        aria-label={isPending ? 'Wird gespeichert' : undefined}
        className={cn('items-start gap-2 bg-muted/30', isPending && 'opacity-70')}
        onClick={isPending ? undefined : () => router.push(projectHref)}
      >
        {isPending ? (
          <InlinePending active className="mt-0.5" />
        ) : (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
            className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-sm hover:bg-accent"
            aria-label={expanded ? 'Projekt zuklappen' : 'Projekt aufklappen'}
          >
            <ChevronRight
              className={cn(
                'size-3.5 text-muted-foreground transition-transform duration-200',
                expanded && 'rotate-90'
              )}
            />
          </button>
        )}
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-center gap-2">
            <SettlingIndicator active={rowFeedback.settlingIds.has(project.id)} />
            {project.projectNumber && (
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                {project.projectNumber}
              </span>
            )}
            <MarqueeText className="flex-1 text-sm font-medium">
              <span className="inline-flex items-center">
                {getProjectDisplayTitle(project)}
                {childJobs.some((j) => activeJobIds.has(j.id)) && <ActiveWorkIndicator />}
              </span>
            </MarqueeText>
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            <span className="truncate">{clientName}</span>
            {(project.plannedStartDate || project.plannedEndDate) && (
              <>
                <span className="text-muted-foreground/60">&middot;</span>
                <span>
                  {formatDate(project.plannedStartDate)} – {formatDate(project.plannedEndDate)}
                </span>
              </>
            )}
          </div>
          <div className="flex items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className={cn('text-[10px]', getProjectStatusClass(project, effectiveStatus))}>
                {getProjectStatusLabel(project)}
              </Badge>
              <div className="flex items-center gap-1.5">
                <Progress value={progress} className="h-1.5 w-12" />
                <span className="text-[10px] tabular-nums text-muted-foreground">
                  {project.completedJobCount}/{project.jobCount}
                </span>
              </div>
              <TrafficLight status={trafficLight} />
            </div>
            {!expanded && allProjectUserIds.length > 0 && (
              <AvatarStack userIds={allProjectUserIds} memberLookup={memberLookup} max={3} />
            )}
          </div>
        </div>
        {isAdminOrManager && !isPending && (
          <div onClick={(e) => e.stopPropagation()}>
            <ProjectActionsMenu
              project={project}
              detailHref={projectHref}
              clients={clients}
              jobs={jobs}
              onProjectUpdated={onProjectUpdated}
              onProjectDeleted={onProjectDeleted}
              onDeleteRequested={onProjectDeleteRequested}
            />
          </div>
        )}
      </ListRow>

      {expanded && childJobs.length > 0 && (
        <div className="mt-1 space-y-1">
          {childJobs.map((job) => (
            <JobCard
              key={job.id}
              job={job}
              clientName={job.clientId ? clientMap[job.clientId] || '—' : clientName}
              isAdminOrManager={isAdminOrManager}
              indented
              projectNumber={project.projectNumber!}
              isActive={activeJobIds.has(job.id)}
              isPending={rowFeedback.pendingIds.has(job.id)}
              isSettling={rowFeedback.settlingIds.has(job.id)}
              memberLookup={memberLookup}
              assignedUserIds={jobAssignmentMap[job.id] ?? []}
              clients={clients}
              members={members}
              projects={projects}
              onJobUpdated={onJobUpdated}
              onJobDeleted={onJobDeleted}
              onJobDeleteRequested={onJobDeleteRequested}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================
// Main Component
// ============================================

function SortableHeader({
  label,
  column,
  currentColumn,
  currentDirection,
  onSort,
  className,
}: {
  label: React.ReactNode;
  column: SortColumn;
  currentColumn: SortColumn;
  currentDirection: 'asc' | 'desc';
  onSort: (column: SortColumn) => void;
  className?: string;
}) {
  const isActive = currentColumn === column;
  return (
    <TableHead className={className}>
      <button
        onClick={() => onSort(column)}
        className="flex items-center gap-1 hover:text-foreground transition-colors -ml-1 px-1 py-0.5 rounded"
      >
        {label}
        {isActive ? (
          currentDirection === 'asc' ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" />
        ) : (
          <ArrowUpDown className="size-3.5 text-muted-foreground/50" />
        )}
      </button>
    </TableHead>
  );
}

interface UnifiedAuftraegeTableProps {
  entries: UnifiedListEntry[];
  clientMap: Record<string, string>;
  isAdminOrManager: boolean;
  sortColumn: SortColumn;
  sortDirection: 'asc' | 'desc';
  onSort: (column: SortColumn) => void;
  isArchive?: boolean;
  jobAssignmentMap?: Record<string, string[]>;
  clients?: Client[];
  members?: OrgMemberOption[];
  hideClientColumn?: boolean;
  visibleColumns: AuftraegeColumnId[];
  /** Pending drafts and settling rows from the owner's optimistic overlay. */
  rowFeedback?: AuftraegeRowFeedback;
  onJobUpdated?: (payload: {
    job: Job;
    selectedEmployeeIds?: string[];
  }) => void | Promise<void>;
  onJobDeleted?: (jobId: string) => void | Promise<void>;
  /** Optimistic delete owned by the list; see `JobActionsMenu`. */
  onJobDeleteRequested?: (jobId: string) => void;
  onProjectUpdated?: (payload: {
    project: Project;
    selectedJobIds?: string[];
  }) => void | Promise<void>;
  onProjectDeleted?: (projectId: string) => void | Promise<void>;
  onProjectDeleteRequested?: (projectId: string) => void;
}

export function UnifiedAuftraegeTable({
  entries,
  clientMap,
  isAdminOrManager,
  sortColumn,
  sortDirection,
  onSort,
  isArchive = false,
  jobAssignmentMap = {},
  members = [],
  clients = [],
  hideClientColumn = false,
  visibleColumns,
  rowFeedback = NO_ROW_FEEDBACK,
  onJobUpdated,
  onJobDeleted,
  onJobDeleteRequested,
  onProjectUpdated,
  onProjectDeleted,
  onProjectDeleteRequested,
}: UnifiedAuftraegeTableProps) {
  const { activeJobIds } = useActiveJobs();
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const memberLookup = buildMemberLookup(members);
  const allProjects = useMemo(
    () =>
      entries
        .filter(
          (item): item is Extract<UnifiedListEntry, { type: 'project' }> =>
            item.type === 'project'
        )
        .map((item) => item.project),
    [entries]
  );
  const allJobs = useMemo(
    () =>
      entries.flatMap((item) =>
        item.type === 'standalone-job' ? [item.job] : item.childJobs
      ),
    [entries]
  );
  const effectiveVisibleColumns = useMemo(
    () =>
      resolveVisibleAuftraegeColumns(visibleColumns, {
        hideClientColumn,
      }),
    [hideClientColumn, visibleColumns]
  );

  const toggleProject = (projectId: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  };

  const sort: AuftraegeSortState = { column: sortColumn, direction: sortDirection, onSort, isArchive };
  const columns = auftraegeColumns(effectiveVisibleColumns, isAdminOrManager);

  // No loading prop on purpose: the table never turns into a skeleton over
  // data it already has (feedback canon); `AuftraegeTableSkeleton` serves the
  // loading files.
  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-muted">
          <Briefcase className="size-6 text-muted-foreground" />
        </div>
        <h2 className="text-lg font-semibold">Keine Einträge</h2>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          {isAdminOrManager
            ? 'Es gibt noch keine Aufträge oder Projekte. Erstelle einen neuen Eintrag über die Schaltfläche oben.'
            : 'Dir sind noch keine Aufträge zugewiesen.'}
        </p>
      </div>
    );
  }

  return (
    <>
      {/* Mobile */}
      <div className="space-y-2 md:hidden">
        {entries.map((entry) => {
          if (entry.type === 'standalone-job') {
            return (
              <JobCard
                key={`job-${entry.job.id}`}
                job={entry.job}
                clientName={entry.job.clientId ? clientMap[entry.job.clientId] || '—' : '—'}
                isAdminOrManager={isAdminOrManager}
                isActive={activeJobIds.has(entry.job.id)}
                isPending={rowFeedback.pendingIds.has(entry.job.id)}
                isSettling={rowFeedback.settlingIds.has(entry.job.id)}
                memberLookup={memberLookup}
                assignedUserIds={jobAssignmentMap[entry.job.id] ?? []}
                clients={clients}
                members={members}
                projects={allProjects}
                onJobUpdated={onJobUpdated}
                onJobDeleted={onJobDeleted}
                onJobDeleteRequested={onJobDeleteRequested}
              />
            );
          }
          return (
            <ProjectCard
              key={`project-${entry.project.id}`}
              project={entry.project}
              childJobs={entry.childJobs}
              clientName={entry.project.clientId ? clientMap[entry.project.clientId] || '—' : '—'}
              isAdminOrManager={isAdminOrManager}
              clientMap={clientMap}
              activeJobIds={activeJobIds}
              rowFeedback={rowFeedback}
              memberLookup={memberLookup}
              jobAssignmentMap={jobAssignmentMap}
              clients={clients}
              jobs={allJobs}
              members={members}
              projects={allProjects}
              onJobUpdated={onJobUpdated}
              onJobDeleted={onJobDeleted}
              onJobDeleteRequested={onJobDeleteRequested}
              onProjectUpdated={onProjectUpdated}
              onProjectDeleted={onProjectDeleted}
              onProjectDeleteRequested={onProjectDeleteRequested}
            />
          );
        })}
      </div>

      {/* Desktop */}
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <AuftraegeTableHeaderRow columns={columns} sort={sort} />
          </TableHeader>
          <TableBody>
            {entries.map((entry) => {
              if (entry.type === 'standalone-job') {
                const clientName = entry.job.clientId ? clientMap[entry.job.clientId] || '—' : '—';
                if (rowFeedback.pendingIds.has(entry.job.id)) {
                  return (
                    <PendingRow
                      key={`job-${entry.job.id}`}
                      columns={columns}
                      cells={jobPendingCells(entry.job, clientName)}
                      interactive
                    />
                  );
                }
                return (
                  <StandaloneJobRow
                    key={`job-${entry.job.id}`}
                    job={entry.job}
                    clientName={clientName}
                    isAdminOrManager={isAdminOrManager}
                    isActive={activeJobIds.has(entry.job.id)}
                    isSettling={rowFeedback.settlingIds.has(entry.job.id)}
                    memberLookup={memberLookup}
                    assignedUserIds={jobAssignmentMap[entry.job.id] ?? []}
                    visibleColumns={effectiveVisibleColumns}
                    clients={clients}
                    members={members}
                    projects={allProjects}
                    onJobUpdated={onJobUpdated}
                    onJobDeleted={onJobDeleted}
                    onJobDeleteRequested={onJobDeleteRequested}
                  />
                );
              }
              const clientName = entry.project.clientId ? clientMap[entry.project.clientId] || '—' : '—';
              if (rowFeedback.pendingIds.has(entry.project.id)) {
                return (
                  <PendingRow
                    key={`project-${entry.project.id}`}
                    columns={columns}
                    cells={projectPendingCells(entry.project, clientName)}
                    interactive
                  />
                );
              }
              return (
                <ProjectRow
                  key={`project-${entry.project.id}`}
                  project={entry.project}
                  childJobs={entry.childJobs}
                  clientName={clientName}
                  isAdminOrManager={isAdminOrManager}
                  isExpanded={expandedProjects.has(entry.project.id)}
                  onToggle={() => toggleProject(entry.project.id)}
                  clientMap={clientMap}
                  activeJobIds={activeJobIds}
                  rowFeedback={rowFeedback}
                  columns={columns}
                  memberLookup={memberLookup}
                  jobAssignmentMap={jobAssignmentMap}
                  visibleColumns={effectiveVisibleColumns}
                  clients={clients}
                  jobs={allJobs}
                  members={members}
                  projects={allProjects}
                  onJobUpdated={onJobUpdated}
                  onJobDeleted={onJobDeleted}
                  onJobDeleteRequested={onJobDeleteRequested}
                  onProjectUpdated={onProjectUpdated}
                  onProjectDeleted={onProjectDeleted}
                  onProjectDeleteRequested={onProjectDeleteRequested}
                />
              );
            })}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
