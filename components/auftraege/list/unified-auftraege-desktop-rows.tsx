'use client';

import { memo } from 'react';
import { useRouter } from 'next/navigation';

import { ListPagination } from '@/components/shared/list-pagination';
import { SectionError } from '@/components/ui/section-error';
import { TableCell, TableRow } from '@/components/ui/table';
import { PendingRow } from '@/components/ui/pending-row';
import { jobDetailHref, projectDetailHref } from '@/lib/jobs/routes';
import type { Job, ProjectWithDetails } from '@/lib/jobs/types';
import type { AuftraegeColumnId } from '@/lib/jobs/auftraege-table-columns';
import { memoPropsEqual } from '@/lib/ui/memo-equality';
import { rowIntentPrefetch } from '@/lib/ui/row-intent';
import type { OrgMemberOption } from '../shared/employee-multi-select';
import { jobPendingCells, projectPendingCells, type AuftraegeTableColumn } from './unified-auftraege-columns';
import type { AuftraegeRowFeedback, UnifiedAuftraegeEntryListProps } from './unified-auftraege-entry-list';
import {
  UnifiedAuftraegeJobRowCells,
  UnifiedAuftraegeProjectRowCells,
  type UnifiedAuftraegeJobMenuProps,
  type UnifiedAuftraegeJobRowCellsProps,
  type UnifiedAuftraegeProjectMenuProps,
} from './unified-auftraege-row-cells';
import {
  JOB_ROW_CONTENT_CHECKS,
  PROJECT_ROW_CONTENT_CHECKS,
  TABLE_ROW_CONTENT_CHECKS,
} from './unified-auftraege-row-memo';
import { useUnifiedAuftraegeProjectEntry } from './use-unified-auftraege-project-entry';

type JobTableRowProps = Omit<UnifiedAuftraegeJobRowCellsProps, 'detailHref'>;

/** One job's table row: a standalone job, or an indented child job of an expanded project. */
const JobTableRow = memo(
  function JobTableRow({ job, project, ...cellProps }: JobTableRowProps) {
    const router = useRouter();
    const detailHref = jobDetailHref(job, project);

    return (
      <TableRow
        interactive
        unconfirmed={cellProps.isSettling}
        className={cellProps.indented ? 'bg-muted/10' : undefined}
        onClick={() => router.push(detailHref)}
        {...rowIntentPrefetch(() => router.prefetch(detailHref))}
      >
        <UnifiedAuftraegeJobRowCells job={job} project={project} detailHref={detailHref} {...cellProps} />
      </TableRow>
    );
  },
  memoPropsEqual<JobTableRowProps>({ ...JOB_ROW_CONTENT_CHECKS, ...TABLE_ROW_CONTENT_CHECKS }),
);

type UnifiedAuftraegeChildPaginationProps = {
  childPage: ReturnType<typeof useUnifiedAuftraegeProjectEntry>['childPage'];
};

/** Paging (or the load error) of an expanded project's child jobs. */
export function UnifiedAuftraegeChildPagination({ childPage }: UnifiedAuftraegeChildPaginationProps) {
  return childPage.error ? (
    <SectionError onRetry={childPage.retry}>{childPage.error}</SectionError>
  ) : (
    <ListPagination
      label="Projektaufträge"
      page={childPage.page}
      total={childPage.total}
      busy={childPage.busy}
      onPageChange={childPage.setPage}
    />
  );
}

type ProjectRowProps = UnifiedAuftraegeJobMenuProps &
  UnifiedAuftraegeProjectMenuProps & {
    project: ProjectWithDetails;
    childJobs: Job[];
    pagedChildren?: boolean | undefined;
    projectAssignedUserIds?: string[] | undefined;
    clientName: string;
    isAdminOrManager: boolean;
    isExpanded: boolean;
    onToggle: (projectId: string) => void;
    clientMap: Record<string, string>;
    activeJobIds: Set<string>;
    rowFeedback: AuftraegeRowFeedback;
    columns: readonly AuftraegeTableColumn[];
    memberLookup: Map<string, OrgMemberOption>;
    jobAssignmentMap: Record<string, string[]>;
    visibleColumns: AuftraegeColumnId[];
  };

type ProjectEntry = ReturnType<typeof useUnifiedAuftraegeProjectEntry>;

type ProjectHeaderRowProps = UnifiedAuftraegeProjectMenuProps &
  Pick<
    ProjectRowProps,
    'project' | 'clientName' | 'isAdminOrManager' | 'isExpanded' | 'memberLookup' | 'visibleColumns'
  > & {
    entry: ProjectEntry;
    projectHref: string;
    isSettling: boolean;
    onToggle: () => void;
    onOpen: () => void;
    onPrefetch: () => void;
  };

/** The project's own row, above its child jobs. */
function ProjectHeaderRow({
  project,
  entry,
  projectHref,
  isSettling,
  onOpen,
  onPrefetch,
  ...cellProps
}: ProjectHeaderRowProps) {
  return (
    <TableRow
      interactive
      unconfirmed={isSettling}
      className="bg-muted/30"
      onClick={onOpen}
      {...rowIntentPrefetch(onPrefetch)}
    >
      <UnifiedAuftraegeProjectRowCells
        project={project}
        projectHref={projectHref}
        hasActiveWork={entry.hasActiveWork}
        isSettling={isSettling}
        effectiveStatus={entry.effectiveStatus}
        progress={entry.progress}
        trafficLight={entry.trafficLight}
        allProjectUserIds={entry.allProjectUserIds}
        {...cellProps}
      />
    </TableRow>
  );
}

type ProjectExpandedRowsProps = UnifiedAuftraegeJobMenuProps &
  Pick<
    ProjectRowProps,
    | 'project'
    | 'pagedChildren'
    | 'clientName'
    | 'isAdminOrManager'
    | 'activeJobIds'
    | 'rowFeedback'
    | 'columns'
    | 'memberLookup'
    | 'visibleColumns'
  > & {
    entry: ProjectEntry;
  };

/** The rows under an expanded project: child paging, then its indented child jobs (a pending draft as a pending row). */
function ProjectExpandedRows({
  project,
  entry,
  pagedChildren,
  clientName,
  isAdminOrManager,
  activeJobIds,
  rowFeedback,
  columns,
  memberLookup,
  visibleColumns,
  ...jobMenuProps
}: ProjectExpandedRowsProps) {
  const { childPage, childJobs, clientMap, jobAssignmentMap } = entry;
  return (
    <>
      {pagedChildren && (
        <TableRow>
          <TableCell colSpan={columns.length}>
            <UnifiedAuftraegeChildPagination childPage={childPage} />
          </TableCell>
        </TableRow>
      )}
      {childJobs.map((job) => {
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
        return (
          <JobTableRow
            key={job.id}
            job={job}
            project={project}
            clientName={childClientName}
            isAdminOrManager={isAdminOrManager}
            isActive={activeJobIds.has(job.id)}
            isSettling={rowFeedback.settlingIds.has(job.id)}
            indented
            memberLookup={memberLookup}
            assignedUserIds={jobAssignmentMap[job.id] ?? []}
            visibleColumns={visibleColumns}
            {...jobMenuProps}
          />
        );
      })}
    </>
  );
}

const ProjectRow = memo(
  function ProjectRow({
    project,
    childJobs: initialChildJobs,
    pagedChildren = false,
    projectAssignedUserIds,
    clientName,
    isAdminOrManager,
    isExpanded,
    onToggle,
    clientMap: initialClientMap,
    activeJobIds,
    rowFeedback,
    columns,
    memberLookup,
    jobAssignmentMap: initialAssignmentMap,
    visibleColumns,
    jobs,
    onProjectUpdated,
    onProjectDeleted,
    onProjectDeleteRequested,
    ...jobMenuProps
  }: ProjectRowProps) {
    const router = useRouter();
    const entry = useUnifiedAuftraegeProjectEntry({
      project,
      expanded: isExpanded,
      initialChildJobs,
      pagedChildren,
      projectAssignedUserIds,
      initialClientMap,
      initialAssignmentMap,
      activeJobIds,
    });
    const projectHref = projectDetailHref(project);

    return (
      <>
        <ProjectHeaderRow
          project={project}
          entry={entry}
          projectHref={projectHref}
          isSettling={rowFeedback.settlingIds.has(project.id)}
          onOpen={() => router.push(projectHref)}
          onPrefetch={() => router.prefetch(projectHref)}
          clientName={clientName}
          isAdminOrManager={isAdminOrManager}
          isExpanded={isExpanded}
          onToggle={() => onToggle(project.id)}
          memberLookup={memberLookup}
          visibleColumns={visibleColumns}
          jobs={jobs}
          onProjectUpdated={onProjectUpdated}
          onProjectDeleted={onProjectDeleted}
          onProjectDeleteRequested={onProjectDeleteRequested}
        />
        {isExpanded && (
          <ProjectExpandedRows
            project={project}
            entry={entry}
            pagedChildren={pagedChildren}
            clientName={clientName}
            isAdminOrManager={isAdminOrManager}
            activeJobIds={activeJobIds}
            rowFeedback={rowFeedback}
            columns={columns}
            memberLookup={memberLookup}
            visibleColumns={visibleColumns}
            {...jobMenuProps}
          />
        )}
      </>
    );
  },
  memoPropsEqual<ProjectRowProps>({ ...PROJECT_ROW_CONTENT_CHECKS, ...TABLE_ROW_CONTENT_CHECKS }),
);

type UnifiedAuftraegeDesktopRowsProps = UnifiedAuftraegeEntryListProps & {
  columns: readonly AuftraegeTableColumn[];
  effectiveVisibleColumns: AuftraegeColumnId[];
  expandedProjects: Set<string>;
  toggleProject: (projectId: string) => void;
};

/** The desktop table body: standalone jobs and projects with their expandable child jobs. */
export function UnifiedAuftraegeDesktopRows({
  entries,
  pagedChildren,
  projectAssignmentMap,
  clientMap,
  isAdminOrManager,
  activeJobIds,
  rowFeedback,
  memberLookup,
  jobAssignmentMap,
  jobMenuProps,
  projectMenuProps,
  columns,
  effectiveVisibleColumns,
  expandedProjects,
  toggleProject,
}: UnifiedAuftraegeDesktopRowsProps) {
  return entries.map((entry) => {
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
        <JobTableRow
          key={`job-${entry.job.id}`}
          job={entry.job}
          clientName={clientName}
          isAdminOrManager={isAdminOrManager}
          isActive={activeJobIds.has(entry.job.id)}
          isSettling={rowFeedback.settlingIds.has(entry.job.id)}
          memberLookup={memberLookup}
          assignedUserIds={jobAssignmentMap[entry.job.id] ?? []}
          visibleColumns={effectiveVisibleColumns}
          {...jobMenuProps}
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
        pagedChildren={pagedChildren}
        projectAssignedUserIds={projectAssignmentMap[entry.project.id]}
        clientName={clientName}
        isAdminOrManager={isAdminOrManager}
        isExpanded={expandedProjects.has(entry.project.id)}
        onToggle={toggleProject}
        clientMap={clientMap}
        activeJobIds={activeJobIds}
        rowFeedback={rowFeedback}
        columns={columns}
        memberLookup={memberLookup}
        jobAssignmentMap={jobAssignmentMap}
        visibleColumns={effectiveVisibleColumns}
        {...jobMenuProps}
        {...projectMenuProps}
      />
    );
  });
}
