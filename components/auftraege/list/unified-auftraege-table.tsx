'use client';

import { useState, useMemo } from 'react';

import { Table, TableBody, TableHeader } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonList, SkeletonRows } from '@/components/ui/skeleton-table';
import {
  type Client,
  type Job,
  type Project,
  type UnifiedListEntry,
  type SortColumn,
} from '@/lib/jobs/types';
import {
  DEFAULT_VISIBLE_AUFTRAEGE_COLUMNS,
  resolveVisibleAuftraegeColumns,
  type AuftraegeColumnId,
} from '@/lib/jobs/auftraege-table-columns';
import type { OrgMemberOption } from '../shared/employee-multi-select';
import { useActiveJobs } from '@/hooks/use-active-jobs';
import { auftraegeColumns } from './unified-auftraege-columns';
import { UnifiedAuftraegeDesktopRows } from './unified-auftraege-desktop-rows';
import { buildMemberLookup } from './unified-auftraege-display';
import { UnifiedAuftraegeEmptyState } from './unified-auftraege-empty-state';
import type { AuftraegeRowFeedback, UnifiedAuftraegeEntryListProps } from './unified-auftraege-entry-list';
import { UnifiedAuftraegeMobileCards } from './unified-auftraege-mobile-cards';
import { AuftraegeTableHeaderRow, type AuftraegeSortState } from './unified-auftraege-table-header';

const NO_ROW_FEEDBACK: AuftraegeRowFeedback = {
  pendingIds: new Set(),
  settlingIds: new Set(),
};

/** Loading placeholder with the exact frame of the loaded list; every row is a link, so rows hover. */
export function AuftraegeTableSkeleton({
  count,
  showActions,
  visibleColumns = DEFAULT_VISIBLE_AUFTRAEGE_COLUMNS,
  sort,
}: {
  count: number;
  showActions: boolean;
  visibleColumns?: AuftraegeColumnId[] | undefined;
  sort?: AuftraegeSortState | undefined;
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

interface UnifiedAuftraegeTableProps {
  /** A search or filter is active, so an empty list means "no match", not "nothing yet". */
  isFiltered?: boolean | undefined;
  pagedChildren?: boolean | undefined;
  projectAssignmentMap?: Record<string, string[]> | undefined;
  entries: UnifiedListEntry[];
  clientMap: Record<string, string>;
  isAdminOrManager: boolean;
  sortColumn: SortColumn;
  sortDirection: 'asc' | 'desc';
  onSort: (column: SortColumn) => void;
  isArchive?: boolean | undefined;
  jobAssignmentMap?: Record<string, string[]> | undefined;
  clients?: Client[] | undefined;
  members?: OrgMemberOption[] | undefined;
  hideClientColumn?: boolean | undefined;
  visibleColumns: AuftraegeColumnId[];
  /** Pending drafts and settling rows from the owner's optimistic overlay. */
  rowFeedback?: AuftraegeRowFeedback | undefined;
  onJobUpdated?:
    | ((payload: { job: Job; selectedEmployeeIds?: string[] }) => void | Promise<void>)
    | undefined;
  onJobDeleted?: ((jobId: string) => void | Promise<void>) | undefined;
  /** Optimistic delete owned by the list; see `JobActionsMenu`. */
  onJobDeleteRequested?: ((jobId: string) => void) | undefined;
  onProjectUpdated?:
    | ((payload: { project: Project; selectedJobIds?: string[] }) => void | Promise<void>)
    | undefined;
  onProjectDeleted?: ((projectId: string) => void | Promise<void>) | undefined;
  onProjectDeleteRequested?: ((projectId: string) => void) | undefined;
}

export function UnifiedAuftraegeTable({
  isFiltered = false,
  pagedChildren = false,
  projectAssignmentMap = {},
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
        .filter((item): item is Extract<UnifiedListEntry, { type: 'project' }> => item.type === 'project')
        .map((item) => item.project),
    [entries],
  );
  const allJobs = useMemo(
    () => entries.flatMap((item) => (item.type === 'standalone-job' ? [item.job] : item.childJobs)),
    [entries],
  );
  const effectiveVisibleColumns = useMemo(
    () =>
      resolveVisibleAuftraegeColumns(visibleColumns, {
        hideClientColumn,
      }),
    [hideClientColumn, visibleColumns],
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
      <UnifiedAuftraegeEmptyState
        isFiltered={isFiltered}
        isArchive={isArchive}
        isAdminOrManager={isAdminOrManager}
      />
    );
  }

  const listProps: UnifiedAuftraegeEntryListProps = {
    entries,
    pagedChildren,
    projectAssignmentMap,
    clientMap,
    isAdminOrManager,
    activeJobIds,
    rowFeedback,
    memberLookup,
    jobAssignmentMap,
    jobMenuProps: {
      clients,
      members,
      projects: allProjects,
      onJobUpdated,
      onJobDeleted,
      onJobDeleteRequested,
    },
    projectMenuProps: {
      jobs: allJobs,
      onProjectUpdated,
      onProjectDeleted,
      onProjectDeleteRequested,
    },
  };

  return (
    <>
      {/* Mobile */}
      <UnifiedAuftraegeMobileCards {...listProps} />

      {/* Desktop */}
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <AuftraegeTableHeaderRow columns={columns} sort={sort} />
          </TableHeader>
          <TableBody>
            <UnifiedAuftraegeDesktopRows
              {...listProps}
              columns={columns}
              effectiveVisibleColumns={effectiveVisibleColumns}
              expandedProjects={expandedProjects}
              toggleProject={toggleProject}
            />
          </TableBody>
        </Table>
      </div>
    </>
  );
}
