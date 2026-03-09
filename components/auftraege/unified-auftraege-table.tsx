'use client';

import { useState } from 'react';
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
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { JobActionsMenu } from './job-actions-menu';
import { ProjectActionsMenu } from './project-actions-menu';
import {
  JOB_STATUS_LABELS,
  JOB_PRIORITY_LABELS,
  PROJECT_STATUS_LABELS,
  calculateTrafficLightFromCounts,
  getEffectiveProjectStatusFromCounts,
  type Job,
  type JobStatus,
  type JobPriority,
  type ProjectStatus,
  type ProjectWithDetails,
  type UnifiedListEntry,
  type SortColumn,
} from '@/lib/jobs/types';
import { cn } from '@/lib/utils';
import { useActiveJobs } from '@/hooks/use-active-jobs';

function ActiveWorkIndicator() {
  return (
    <span
      className="relative ml-1.5 inline-flex h-2 w-2 shrink-0"
      title="Jemand arbeitet gerade an diesem Auftrag"
    >
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
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
};

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

// ============================================
// Skeletons
// ============================================

function RowSkeleton({ showActions }: { showActions: boolean }) {
  return (
    <TableRow>
      <TableCell className="w-[36px]"><Skeleton className="size-4" /></TableCell>
      <TableCell><Skeleton className="h-5 w-24" /></TableCell>
      <TableCell><Skeleton className="h-5 w-32" /></TableCell>
      <TableCell><Skeleton className="h-5 w-24" /></TableCell>
      <TableCell><Skeleton className="h-[22px] w-32 rounded-full" /></TableCell>
      <TableCell><Skeleton className="h-[22px] w-16 rounded-full" /></TableCell>
      <TableCell><Skeleton className="h-5 w-20" /></TableCell>
      {showActions && <TableCell><Skeleton className="h-8 w-8 rounded" /></TableCell>}
    </TableRow>
  );
}

function CardSkeleton() {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border bg-card px-3 py-2.5">
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
      <Skeleton className="h-8 w-8 shrink-0 rounded" />
    </div>
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
}: {
  job: Job;
  clientName: string;
  isAdminOrManager: boolean;
  isActive: boolean;
}) {
  const router = useRouter();
  const detailHref = `/auftraege/${encodeURIComponent(job.jobNumber!)}`;

  return (
    <TableRow
      className="cursor-pointer transition-colors hover:bg-accent/50"
      onClick={() => router.push(detailHref)}
    >
      <TableCell className="w-[36px]" />
      <TableCell className="font-mono text-xs text-muted-foreground">
        {job.jobNumber || '—'}
      </TableCell>
      <TableCell className="font-medium">
        <span className="inline-flex items-center">
          {job.title}
          {isActive && <ActiveWorkIndicator />}
        </span>
      </TableCell>
      <TableCell>{clientName}</TableCell>
      <TableCell>
        <Badge variant="secondary" className={JOB_STATUS_CLASSES[job.status]}>
          {JOB_STATUS_LABELS[job.status]}
        </Badge>
      </TableCell>
      <TableCell>
        <Badge variant="secondary" className={PRIORITY_CLASSES[job.priority]}>
          {JOB_PRIORITY_LABELS[job.priority]}
        </Badge>
      </TableCell>
      <TableCell className="text-muted-foreground">
        {formatDate(job.plannedDate)}
      </TableCell>
      {isAdminOrManager && (
        <TableCell onClick={(e) => e.stopPropagation()}>
          <JobActionsMenu job={job} detailHref={detailHref} />
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
}: {
  project: ProjectWithDetails;
  childJobs: Job[];
  clientName: string;
  isAdminOrManager: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  clientMap: Record<string, string>;
  activeJobIds: Set<string>;
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

  return (
    <>
      <TableRow
        className="cursor-pointer bg-muted/30 transition-colors hover:bg-accent/50"
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
        <TableCell className="font-mono text-xs text-muted-foreground">
          {project.projectNumber || '—'}
        </TableCell>
        <TableCell className="font-medium">
          <span className="inline-flex items-center">
            {project.name}
            {childJobs.some((j) => activeJobIds.has(j.id)) && <ActiveWorkIndicator />}
          </span>
        </TableCell>
        <TableCell>{clientName}</TableCell>
        <TableCell>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className={cn('w-[105px] justify-center', PROJECT_STATUS_CLASSES[effectiveStatus])}>
              {PROJECT_STATUS_LABELS[effectiveStatus]}
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
        <TableCell />
        <TableCell className="text-muted-foreground">
          {project.plannedStartDate || project.plannedEndDate
            ? `${formatDate(project.plannedStartDate)} – ${formatDate(project.plannedEndDate)}`
            : '—'}
        </TableCell>
        {isAdminOrManager && (
          <TableCell onClick={(e) => e.stopPropagation()}>
            <ProjectActionsMenu project={project} detailHref={projectHref} />
          </TableCell>
        )}
      </TableRow>

      {isExpanded &&
        childJobs.map((job) => {
          const childHref = `/auftraege/projekt/${encodeURIComponent(project.projectNumber!)}/${encodeURIComponent(job.jobNumber!)}`;
          return (
            <TableRow
              key={job.id}
              className="cursor-pointer bg-muted/10 transition-colors hover:bg-accent/50"
              onClick={() => router.push(childHref)}
            >
              <TableCell className="w-[36px]" />
              <TableCell className="pl-8 font-mono text-xs text-muted-foreground">
                {job.jobNumber || '—'}
              </TableCell>
              <TableCell className="pl-8 font-medium">
                <span className="inline-flex items-center">
                  {job.title}
                  {activeJobIds.has(job.id) && <ActiveWorkIndicator />}
                </span>
              </TableCell>
              <TableCell>
                {job.clientId ? clientMap[job.clientId] || '—' : clientName}
              </TableCell>
              <TableCell>
                <Badge variant="secondary" className={JOB_STATUS_CLASSES[job.status]}>
                  {JOB_STATUS_LABELS[job.status]}
                </Badge>
              </TableCell>
              <TableCell>
                <Badge variant="secondary" className={PRIORITY_CLASSES[job.priority]}>
                  {JOB_PRIORITY_LABELS[job.priority]}
                </Badge>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {formatDate(job.plannedDate)}
              </TableCell>
              {isAdminOrManager && (
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <JobActionsMenu job={job} detailHref={childHref} />
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
}: {
  job: Job;
  clientName: string;
  isAdminOrManager: boolean;
  indented?: boolean;
  projectNumber?: string;
  isActive?: boolean;
}) {
  const router = useRouter();
  const detailHref = projectNumber
    ? `/auftraege/projekt/${encodeURIComponent(projectNumber)}/${encodeURIComponent(job.jobNumber!)}`
    : `/auftraege/${encodeURIComponent(job.jobNumber!)}`;

  return (
    <div
      className={cn(
        'flex cursor-pointer items-start justify-between gap-3 rounded-lg border bg-card px-3 py-2.5 transition-colors hover:bg-accent/50',
        indented && 'ml-6 border-l-2 border-l-muted-foreground/20'
      )}
      onClick={() => router.push(detailHref)}
    >
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-center gap-2">
          {job.jobNumber && (
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
              {job.jobNumber}
            </span>
          )}
          <p className="truncate text-sm font-medium inline-flex items-center">
            {job.title}
            {isActive && <ActiveWorkIndicator />}
          </p>
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
        <div className="flex items-center gap-1.5">
          <Badge variant="secondary" className={cn('text-[10px]', JOB_STATUS_CLASSES[job.status])}>
            {JOB_STATUS_LABELS[job.status]}
          </Badge>
          <Badge variant="secondary" className={cn('text-[10px]', PRIORITY_CLASSES[job.priority])}>
            {JOB_PRIORITY_LABELS[job.priority]}
          </Badge>
        </div>
      </div>
      {isAdminOrManager && (
        <div onClick={(e) => e.stopPropagation()}>
          <JobActionsMenu job={job} detailHref={detailHref} />
        </div>
      )}
    </div>
  );
}

function ProjectCard({
  project,
  childJobs,
  clientName,
  isAdminOrManager,
  clientMap,
  activeJobIds,
}: {
  project: ProjectWithDetails;
  childJobs: Job[];
  clientName: string;
  isAdminOrManager: boolean;
  clientMap: Record<string, string>;
  activeJobIds: Set<string>;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
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

  return (
    <div>
      <div
        className="flex cursor-pointer items-start gap-2 rounded-lg border bg-muted/30 px-3 py-2.5 transition-colors hover:bg-accent/50"
        onClick={() => router.push(projectHref)}
      >
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
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-center gap-2">
            {project.projectNumber && (
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                {project.projectNumber}
              </span>
            )}
            <p className="truncate text-sm font-medium inline-flex items-center">
              {project.name}
              {childJobs.some((j) => activeJobIds.has(j.id)) && <ActiveWorkIndicator />}
            </p>
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
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className={cn('text-[10px]', PROJECT_STATUS_CLASSES[effectiveStatus])}>
              {PROJECT_STATUS_LABELS[effectiveStatus]}
            </Badge>
            <div className="flex items-center gap-1.5">
              <Progress value={progress} className="h-1.5 w-12" />
              <span className="text-[10px] tabular-nums text-muted-foreground">
                {project.completedJobCount}/{project.jobCount}
              </span>
            </div>
            <TrafficLight status={trafficLight} />
          </div>
        </div>
        {isAdminOrManager && (
          <div onClick={(e) => e.stopPropagation()}>
            <ProjectActionsMenu project={project} detailHref={projectHref} />
          </div>
        )}
      </div>

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
  label: string;
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
  isLoading?: boolean;
  skeletonCount?: number;
  sortColumn: SortColumn;
  sortDirection: 'asc' | 'desc';
  onSort: (column: SortColumn) => void;
  isArchive?: boolean;
}

export function UnifiedAuftraegeTable({
  entries,
  clientMap,
  isAdminOrManager,
  isLoading = false,
  skeletonCount = 0,
  sortColumn,
  sortDirection,
  onSort,
  isArchive = false,
}: UnifiedAuftraegeTableProps) {
  const { activeJobIds } = useActiveJobs();
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());

  const toggleProject = (projectId: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  };

  if (isLoading && skeletonCount > 0) {
    return (
      <>
        <div className="space-y-2 md:hidden">
          {Array.from({ length: skeletonCount }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
        <div className="hidden md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[36px]" />
                <SortableHeader label="Nr" column="nr" currentColumn={sortColumn} currentDirection={sortDirection} onSort={onSort} className="w-[120px]" />
                <SortableHeader label="Bezeichnung" column="bezeichnung" currentColumn={sortColumn} currentDirection={sortDirection} onSort={onSort} />
                <SortableHeader label="Kunde" column="kunde" currentColumn={sortColumn} currentDirection={sortDirection} onSort={onSort} className="w-[140px]" />
                {isArchive ? (
                  <TableHead className="min-w-[280px]">Status</TableHead>
                ) : (
                  <SortableHeader label="Status" column="status" currentColumn={sortColumn} currentDirection={sortDirection} onSort={onSort} className="min-w-[280px]" />
                )}
                <SortableHeader label="Priorität" column="prioritaet" currentColumn={sortColumn} currentDirection={sortDirection} onSort={onSort} className="w-[100px]" />
                <SortableHeader label="Datum" column="datum" currentColumn={sortColumn} currentDirection={sortDirection} onSort={onSort} className="w-[170px]" />
                {isAdminOrManager && <TableHead className="w-[50px]" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {Array.from({ length: skeletonCount }).map((_, i) => (
                <RowSkeleton key={i} showActions={isAdminOrManager} />
              ))}
            </TableBody>
          </Table>
        </div>
      </>
    );
  }

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
            />
          );
        })}
      </div>

      {/* Desktop */}
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[36px]" />
              <SortableHeader label="Nr" column="nr" currentColumn={sortColumn} currentDirection={sortDirection} onSort={onSort} className="w-[120px]" />
              <SortableHeader label="Bezeichnung" column="bezeichnung" currentColumn={sortColumn} currentDirection={sortDirection} onSort={onSort} />
              <SortableHeader label="Kunde" column="kunde" currentColumn={sortColumn} currentDirection={sortDirection} onSort={onSort} className="w-[140px]" />
              {isArchive ? (
                <TableHead className="min-w-[280px]">Status</TableHead>
              ) : (
                <SortableHeader label="Status" column="status" currentColumn={sortColumn} currentDirection={sortDirection} onSort={onSort} className="min-w-[280px]" />
              )}
              <SortableHeader label="Priorität" column="prioritaet" currentColumn={sortColumn} currentDirection={sortDirection} onSort={onSort} className="w-[100px]" />
              <SortableHeader label="Datum" column="datum" currentColumn={sortColumn} currentDirection={sortDirection} onSort={onSort} className="w-[170px]" />
              {isAdminOrManager && <TableHead className="w-[50px]" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry) => {
              if (entry.type === 'standalone-job') {
                return (
                  <StandaloneJobRow
                    key={`job-${entry.job.id}`}
                    job={entry.job}
                    clientName={entry.job.clientId ? clientMap[entry.job.clientId] || '—' : '—'}
                    isAdminOrManager={isAdminOrManager}
                    isActive={activeJobIds.has(entry.job.id)}
                  />
                );
              }
              return (
                <ProjectRow
                  key={`project-${entry.project.id}`}
                  project={entry.project}
                  childJobs={entry.childJobs}
                  clientName={entry.project.clientId ? clientMap[entry.project.clientId] || '—' : '—'}
                  isAdminOrManager={isAdminOrManager}
                  isExpanded={expandedProjects.has(entry.project.id)}
                  onToggle={() => toggleProject(entry.project.id)}
                  clientMap={clientMap}
                  activeJobIds={activeJobIds}
                />
              );
            })}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
