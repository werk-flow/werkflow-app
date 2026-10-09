'use client';
import { useListNavigation } from '@/hooks/use-list-navigation';
import type { JobListPagination } from '@/lib/jobs/list-page';

import { useState } from 'react';
import { RefreshButton } from '@/components/ui/refresh-button';

import { usePageAction } from '@/components/shared/page-action';
import { UsableContent } from '@/components/shared/usable-content';
import type { Job, ProjectWithDetails } from '@/lib/jobs/types';
import type { AuftraegeColumnId } from '@/lib/jobs/auftraege-table-columns';
import type { OrgMemberOption } from '../shared/employee-multi-select';
import { useLiveAuftraegeData } from '@/hooks/use-live-auftraege-data';
import { AuftraegeCreateDialogs } from './auftraege-create-dialogs';
import type { AuftraegeActiveStatusFilter } from './auftraege-list-filters';
import {
  AuftraegeCollapsibleSection,
  AuftraegeSectionFilterBar,
  AuftraegeSectionTable,
  AuftraegeStatusFilterPills,
} from './auftraege-list-sections';
import { useAuftraegeOptimisticList } from './use-auftraege-optimistic-list';
import { useAuftraegeSectionQuery } from './use-auftraege-section-query';

interface AuftraegeContentProps {
  jobs: Job[];
  projects: ProjectWithDetails[];
  clientMap: Record<string, string>;
  members: OrgMemberOption[];
  jobAssignmentMap: Record<string, string[]>;
  isAdminOrManager: boolean;
  visibleColumns: AuftraegeColumnId[];
  pagination?: JobListPagination;
}

export function AuftraegeContent({
  jobs: initialJobs,
  projects: initialProjects,
  clientMap,
  members,
  jobAssignmentMap: initialJobAssignmentMap,
  isAdminOrManager,
  visibleColumns,
  pagination,
}: AuftraegeContentProps) {
  const { jobs, setJobs, setRawProjects, projects, jobAssignmentMap, setJobAssignmentMap } =
    useLiveAuftraegeData({
      initialJobs,
      initialProjects,
      initialJobAssignmentMap,
      preserveProjectCounts: Boolean(pagination),
    });

  const navigation = useListNavigation();
  const activeQuery = useAuftraegeSectionQuery({
    section: 'active',
    pagination,
    navigation,
    firstSortDirection: 'asc',
  });
  const parkedQuery = useAuftraegeSectionQuery({
    section: 'parked',
    pagination,
    navigation,
    firstSortDirection: 'desc',
  });
  const archivedQuery = useAuftraegeSectionQuery({
    section: 'archived',
    pagination,
    navigation,
    firstSortDirection: 'desc',
  });
  const [activeStatusFilterState, setActiveStatusFilter] = useState<AuftraegeActiveStatusFilter>(
    pagination?.queries.active.status ?? 'alle',
  );
  const [parkplatzExpanded, setParkplatzExpanded] = useState(true);
  const [archiveExpandedState, setArchiveExpanded] = useState(pagination?.queries.archived.enabled ?? false);
  const activeStatusFilter =
    pagination && !navigation.busy ? pagination.queries.active.status : activeStatusFilterState;
  const archiveExpanded =
    pagination && !navigation.busy ? pagination.queries.archived.enabled : archiveExpandedState;
  // The create button lives in the page header outside the data boundary.
  const { open: createDialogOpen, setOpen: setCreateDialogOpen } = usePageAction();

  const list = useAuftraegeOptimisticList({
    jobs,
    projects,
    setJobs,
    setRawProjects,
    setJobAssignmentMap,
    initialJobs,
    initialProjects,
  });
  const { rawActive, rawParked, rawArchived } = list;

  const sectionTableProps = {
    pagination,
    navigationBusy: navigation.busy,
    initialIds: list.initialIds,
    localPendingIds: list.localPendingIds,
    clientMap,
    isAdminOrManager,
    jobAssignmentMap,
    members,
    visibleColumns,
    rowFeedback: list.rowFeedback,
    onJobUpdated: list.handleJobEdited,
    onJobDeleteRequested: list.handleJobDeleteRequested,
    onProjectUpdated: list.handleProjectEdited,
    onProjectDeleteRequested: list.handleProjectDeleteRequested,
  };

  return (
    <UsableContent name="auftraege" count={jobs.length}>
      <div className="space-y-6">
        {/* Active section */}
        <section aria-labelledby="auftraege-active-title">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 id="auftraege-active-title" className="text-base font-semibold sm:text-lg">
              Aktuelle Aufträge und Projekte
            </h2>
            <RefreshButton label="Tabelle aktualisieren" />
          </div>

          <AuftraegeStatusFilterPills
            activeStatusFilter={activeStatusFilter}
            onChange={(status) => {
              setActiveStatusFilter(status);
              if (pagination) activeQuery.navigate({ status });
            }}
            rawActive={rawActive}
            pagination={pagination}
          />

          <AuftraegeSectionFilterBar query={activeQuery} members={members} />

          <div className="mt-3">
            <AuftraegeSectionTable
              section="active"
              paginationLabel="Aktuelle Aufträge"
              rawEntries={rawActive}
              query={activeQuery}
              statusFilter={activeStatusFilter}
              {...sectionTableProps}
            />
          </div>
        </section>

        {/* Parkplatz section */}
        {(pagination ? pagination.pages.parked.sectionTotal > 0 : rawParked.length > 0) && (
          <AuftraegeCollapsibleSection
            title="Parkplatz"
            count={pagination?.pages.parked.sectionTotal ?? rawParked.length}
            expanded={parkplatzExpanded}
            onToggle={() => setParkplatzExpanded((v) => !v)}
          >
            <AuftraegeSectionFilterBar query={parkedQuery} members={members} />
            <AuftraegeSectionTable
              section="parked"
              paginationLabel="Parkplatz"
              rawEntries={rawParked}
              query={parkedQuery}
              {...sectionTableProps}
            />
          </AuftraegeCollapsibleSection>
        )}

        {/* Archive section */}
        {(pagination ? pagination.pages.archived.sectionTotal > 0 : rawArchived.length > 0) && (
          <AuftraegeCollapsibleSection
            title="Archiv"
            count={pagination?.pages.archived.sectionTotal ?? rawArchived.length}
            expanded={archiveExpanded}
            onToggle={() => {
              setArchiveExpanded((value) => !value);
              if (pagination) archivedQuery.navigate({ open: archiveExpanded ? null : '1' });
            }}
          >
            <AuftraegeSectionFilterBar query={archivedQuery} members={members} />
            <AuftraegeSectionTable
              section="archived"
              paginationLabel="Archiv"
              rawEntries={rawArchived}
              query={archivedQuery}
              isArchive
              {...sectionTableProps}
            />
          </AuftraegeCollapsibleSection>
        )}

        {isAdminOrManager && (
          <AuftraegeCreateDialogs
            members={members}
            open={createDialogOpen}
            onOpenChange={setCreateDialogOpen}
            list={list}
          />
        )}
      </div>
    </UsableContent>
  );
}
