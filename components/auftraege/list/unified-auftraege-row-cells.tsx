'use client';

import { ChevronRight } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { PlainButton } from '@/components/ui/plain-button';
import { Progress } from '@/components/ui/progress';
import { TableCell } from '@/components/ui/table';
import {
  JOB_PRIORITY_LABELS,
  getJobDisplayTitle,
  getProjectDisplayTitle,
  type Client,
  type Job,
  type Project,
  type ProjectStatus,
  type ProjectWithDetails,
} from '@/lib/jobs/types';
import { isAuftraegeColumnVisible, type AuftraegeColumnId } from '@/lib/jobs/auftraege-table-columns';
import { cn, formatGermanDate } from '@/lib/utils';
import type { OrgMemberOption } from '../shared/employee-multi-select';
import { JobActionsMenu } from './job-actions-menu';
import { ProjectActionsMenu } from './project-actions-menu';
import { ActiveWorkIndicator, AvatarStack, SettlingIndicator } from './unified-auftraege-display';
import {
  getJobStatusClass,
  getJobStatusLabel,
  getProjectStatusClass,
  getProjectStatusLabel,
} from '../status-classes';
import { PRIORITY_CLASSES } from '../job-detail/job-detail-format';
import { TrafficLight } from '../project-detail/project-detail-status';

/** What a row hands to its `JobActionsMenu`. */
export type UnifiedAuftraegeJobMenuProps = {
  clients: Client[];
  members: OrgMemberOption[];
  projects: ProjectWithDetails[];
  onJobUpdated?:
    | ((payload: { job: Job; selectedEmployeeIds?: string[] }) => void | Promise<void>)
    | undefined;
  onJobDeleted?: ((jobId: string) => void | Promise<void>) | undefined;
  onJobDeleteRequested?: ((jobId: string) => void) | undefined;
};

/** What a row hands to its `ProjectActionsMenu`. */
export type UnifiedAuftraegeProjectMenuProps = {
  clients: Client[];
  jobs: Job[];
  onProjectUpdated?:
    | ((payload: { project: Project; selectedJobIds?: string[] }) => void | Promise<void>)
    | undefined;
  onProjectDeleted?: ((projectId: string) => void | Promise<void>) | undefined;
  onProjectDeleteRequested?: ((projectId: string) => void) | undefined;
};

export type UnifiedAuftraegeJobRowCellsProps = UnifiedAuftraegeJobMenuProps & {
  job: Job;
  detailHref: string;
  clientName: string;
  isAdminOrManager: boolean;
  isActive: boolean;
  isSettling: boolean;
  /** A project's child row: number and title are indented. */
  indented?: boolean | undefined;
  memberLookup: Map<string, OrgMemberOption>;
  assignedUserIds: string[];
  visibleColumns: AuftraegeColumnId[];
};

/** The cells of one job row; the owning table keeps the `TableRow`. */
export function UnifiedAuftraegeJobRowCells({
  job,
  detailHref,
  clientName,
  isAdminOrManager,
  isActive,
  isSettling,
  indented = false,
  memberLookup,
  assignedUserIds,
  visibleColumns,
  clients,
  members,
  projects,
  onJobUpdated,
  onJobDeleted,
  onJobDeleteRequested,
}: UnifiedAuftraegeJobRowCellsProps) {
  return (
    <>
      <TableCell className="w-[36px]" />
      {isAuftraegeColumnVisible(visibleColumns, 'nr') && (
        <TableCell
          className={
            indented
              ? 'whitespace-nowrap pl-8 font-mono text-xs text-muted-foreground'
              : 'whitespace-nowrap font-mono text-xs text-muted-foreground'
          }
        >
          {job.jobNumber || '—'}
        </TableCell>
      )}
      {isAuftraegeColumnVisible(visibleColumns, 'bezeichnung') && (
        <TableCell className={indented ? 'pl-8 font-medium' : 'font-medium'}>
          <div className="flex items-start gap-2">
            <span className="line-clamp-4 break-words whitespace-pre-wrap">{getJobDisplayTitle(job)}</span>
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
          {formatGermanDate(job.plannedDate, { empty: '—' })}
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
    </>
  );
}

type UnifiedAuftraegeProjectRowCellsProps = UnifiedAuftraegeProjectMenuProps & {
  project: ProjectWithDetails;
  projectHref: string;
  clientName: string;
  isAdminOrManager: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  hasActiveWork: boolean;
  isSettling: boolean;
  effectiveStatus: ProjectStatus;
  progress: number;
  trafficLight: 'green' | 'yellow' | 'red';
  allProjectUserIds: string[];
  memberLookup: Map<string, OrgMemberOption>;
  visibleColumns: AuftraegeColumnId[];
};

/** The cells of one project row; the owning table keeps the `TableRow`. */
export function UnifiedAuftraegeProjectRowCells({
  project,
  projectHref,
  clientName,
  isAdminOrManager,
  isExpanded,
  onToggle,
  hasActiveWork,
  isSettling,
  effectiveStatus,
  progress,
  trafficLight,
  allProjectUserIds,
  memberLookup,
  visibleColumns,
  clients,
  jobs,
  onProjectUpdated,
  onProjectDeleted,
  onProjectDeleteRequested,
}: UnifiedAuftraegeProjectRowCellsProps) {
  return (
    <>
      <TableCell className="w-[36px] pr-0" onClick={(e) => e.stopPropagation()}>
        <PlainButton
          onClick={onToggle}
          className="flex size-6 items-center justify-center rounded-sm hover:bg-accent"
          aria-label={isExpanded ? 'Projekt zuklappen' : 'Projekt aufklappen'}
          aria-expanded={isExpanded}
        >
          <ChevronRight
            className={cn(
              'size-4 text-muted-foreground transition-transform duration-200',
              isExpanded && 'rotate-90',
            )}
          />
        </PlainButton>
      </TableCell>
      {isAuftraegeColumnVisible(visibleColumns, 'nr') && (
        <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
          {project.projectNumber || '—'}
        </TableCell>
      )}
      {isAuftraegeColumnVisible(visibleColumns, 'bezeichnung') && (
        <TableCell className="font-medium">
          <div className="flex items-start gap-2">
            <span className="line-clamp-4 break-words whitespace-pre-wrap">
              {getProjectDisplayTitle(project)}
            </span>
            {hasActiveWork && <ActiveWorkIndicator />}
            <SettlingIndicator active={isSettling} className="mt-0.5" />
          </div>
        </TableCell>
      )}
      {isAuftraegeColumnVisible(visibleColumns, 'kunde') && <TableCell>{clientName}</TableCell>}
      {isAuftraegeColumnVisible(visibleColumns, 'status') && (
        <TableCell>
          <div className="flex items-center gap-2">
            <Badge
              variant="secondary"
              className={cn(
                'max-w-48 justify-center truncate',
                getProjectStatusClass(project, effectiveStatus),
              )}
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
          {!isExpanded && <AvatarStack userIds={allProjectUserIds} memberLookup={memberLookup} max={4} />}
        </TableCell>
      )}
      {isAuftraegeColumnVisible(visibleColumns, 'datum') && (
        <TableCell className="text-muted-foreground">
          {project.plannedStartDate || project.plannedEndDate
            ? `${formatGermanDate(project.plannedStartDate, { empty: '—' })} – ${formatGermanDate(project.plannedEndDate, { empty: '—' })}`
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
    </>
  );
}
