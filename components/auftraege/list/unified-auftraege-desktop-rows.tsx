'use client';

import { useRouter } from 'next/navigation';

import { ListPagination } from '@/components/shared/list-pagination';
import { SectionError } from '@/components/ui/section-error';
import { TableCell, TableRow } from '@/components/ui/table';
import { PendingRow } from '@/components/ui/pending-row';
import { jobDetailHref, projectDetailHref } from '@/lib/jobs/routes';
import type { Job, ProjectWithDetails } from '@/lib/jobs/types';
import type { AuftraegeColumnId } from '@/lib/jobs/auftraege-table-columns';
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
import { useUnifiedAuftraegeProjectEntry } from './use-unified-auftraege-project-entry';

type StandaloneJobRowProps = Omit<UnifiedAuftraegeJobRowCellsProps, 'detailHref' | 'indented'>;

function StandaloneJobRow({ job, ...cellProps }: StandaloneJobRowProps) {
  const router = useRouter();
  const detailHref = jobDetailHref(job);

  return (
    <TableRow interactive unconfirmed={cellProps.isSettling} onClick={() => router.push(detailHref)}>
      <UnifiedAuftraegeJobRowCells job={job} detailHref={detailHref} {...cellProps} />
    </TableRow>
  );
}

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
    onToggle: () => void;
    clientMap: Record<string, string>;
    activeJobIds: Set<string>;
    rowFeedback: AuftraegeRowFeedback;
    columns: readonly AuftraegeTableColumn[];
    memberLookup: Map<string, OrgMemberOption>;
    jobAssignmentMap: Record<string, string[]>;
    visibleColumns: AuftraegeColumnId[];
  };

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
  const { childPage, childJobs, clientMap, jobAssignmentMap } = entry;
  const projectHref = projectDetailHref(project);

  return (
    <>
      <TableRow
        interactive
        unconfirmed={rowFeedback.settlingIds.has(project.id)}
        className="bg-muted/30"
        onClick={() => router.push(projectHref)}
      >
        <UnifiedAuftraegeProjectRowCells
          project={project}
          projectHref={projectHref}
          clientName={clientName}
          isAdminOrManager={isAdminOrManager}
          isExpanded={isExpanded}
          onToggle={onToggle}
          hasActiveWork={entry.hasActiveWork}
          isSettling={rowFeedback.settlingIds.has(project.id)}
          effectiveStatus={entry.effectiveStatus}
          progress={entry.progress}
          trafficLight={entry.trafficLight}
          allProjectUserIds={entry.allProjectUserIds}
          memberLookup={memberLookup}
          visibleColumns={visibleColumns}
          clients={clients}
          jobs={jobs}
          onProjectUpdated={onProjectUpdated}
          onProjectDeleted={onProjectDeleted}
          onProjectDeleteRequested={onProjectDeleteRequested}
        />
      </TableRow>

      {isExpanded && pagedChildren && (
        <TableRow>
          <TableCell colSpan={columns.length}>
            <UnifiedAuftraegeChildPagination childPage={childPage} />
          </TableCell>
        </TableRow>
      )}
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
          const childHref = jobDetailHref(job, project);
          const childAssigned = jobAssignmentMap[job.id] ?? [];
          return (
            <TableRow
              key={job.id}
              interactive
              unconfirmed={rowFeedback.settlingIds.has(job.id)}
              className="bg-muted/10"
              onClick={() => router.push(childHref)}
            >
              <UnifiedAuftraegeJobRowCells
                job={job}
                detailHref={childHref}
                clientName={childClientName}
                isAdminOrManager={isAdminOrManager}
                isActive={activeJobIds.has(job.id)}
                isSettling={rowFeedback.settlingIds.has(job.id)}
                indented
                memberLookup={memberLookup}
                assignedUserIds={childAssigned}
                visibleColumns={visibleColumns}
                clients={clients}
                members={members}
                projects={projects}
                onJobUpdated={onJobUpdated}
                onJobDeleted={onJobDeleted}
                onJobDeleteRequested={onJobDeleteRequested}
              />
            </TableRow>
          );
        })}
    </>
  );
}

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
        onToggle={() => toggleProject(entry.project.id)}
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
