'use client';
import { useListNavigation } from '@/hooks/use-list-navigation';
import type { JobListPagination } from '@/lib/jobs/list-page';

import { useState, type ComponentProps } from 'react';
import { RefreshButton } from '@/components/ui/refresh-button';

import { usePageAction } from '@/components/shared/page-action';
import { UsableContent } from '@/components/shared/usable-content';
import type { Job, ProjectWithDetails } from '@/lib/jobs/types';
import type { UnifiedListEntry } from '@/lib/jobs/unified-list';
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
import { useAuftraegeSectionQuery, type AuftraegeSectionQuery } from './use-auftraege-section-query';

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

type AuftraegeSectionTableSharedProps = Omit<
  ComponentProps<typeof AuftraegeSectionTable>,
  'section' | 'paginationLabel' | 'rawEntries' | 'query' | 'statusFilter' | 'isArchive'
>;

/** The search, filters and sort of the three sections, in the URL for a paged list. */
function useAuftraegeSectionQueries(
  pagination: JobListPagination | undefined,
  navigation: ReturnType<typeof useListNavigation>,
) {
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
  return { activeQuery, parkedQuery, archivedQuery };
}

type AuftraegeActiveSectionProps = {
  activeStatusFilter: AuftraegeActiveStatusFilter;
  onStatusFilterChange: (status: AuftraegeActiveStatusFilter) => void;
  rawActive: UnifiedListEntry[];
  query: AuftraegeSectionQuery;
  members: OrgMemberOption[];
  sectionTableProps: AuftraegeSectionTableSharedProps;
};

function AuftraegeActiveSection({
  activeStatusFilter,
  onStatusFilterChange,
  rawActive,
  query,
  members,
  sectionTableProps,
}: AuftraegeActiveSectionProps) {
  return (
    <section aria-labelledby="auftraege-active-title">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 id="auftraege-active-title" className="text-base font-semibold sm:text-lg">
          Aktuelle Aufträge und Projekte
        </h2>
        <RefreshButton label="Tabelle aktualisieren" />
      </div>

      <AuftraegeStatusFilterPills
        activeStatusFilter={activeStatusFilter}
        onChange={onStatusFilterChange}
        rawActive={rawActive}
        pagination={sectionTableProps.pagination}
      />

      <AuftraegeSectionFilterBar query={query} members={members} />

      <div className="mt-3">
        <AuftraegeSectionTable
          section="active"
          paginationLabel="Aktuelle Aufträge"
          rawEntries={rawActive}
          query={query}
          statusFilter={activeStatusFilter}
          {...sectionTableProps}
        />
      </div>
    </section>
  );
}

type AuftraegeSecondarySectionProps = {
  section: 'parked' | 'archived';
  /** The disclosure heading, also the label of the section's pagination. */
  title: string;
  rawEntries: UnifiedListEntry[];
  query: AuftraegeSectionQuery;
  members: OrgMemberOption[];
  expanded: boolean;
  onToggle: () => void;
  isArchive?: boolean;
  sectionTableProps: AuftraegeSectionTableSharedProps;
};

/** The Parkplatz or Archiv section, shown only while it holds entries. */
function AuftraegeSecondarySection({
  section,
  title,
  rawEntries,
  query,
  members,
  expanded,
  onToggle,
  isArchive,
  sectionTableProps,
}: AuftraegeSecondarySectionProps) {
  const { pagination } = sectionTableProps;
  if (!(pagination ? pagination.pages[section].sectionTotal > 0 : rawEntries.length > 0)) return null;
  return (
    <AuftraegeCollapsibleSection
      title={title}
      count={pagination?.pages[section].sectionTotal ?? rawEntries.length}
      expanded={expanded}
      onToggle={onToggle}
    >
      <AuftraegeSectionFilterBar query={query} members={members} />
      <AuftraegeSectionTable
        section={section}
        paginationLabel={title}
        rawEntries={rawEntries}
        query={query}
        isArchive={isArchive}
        {...sectionTableProps}
      />
    </AuftraegeCollapsibleSection>
  );
}

/** The live list, the section queries and the section disclosure state of the Aufträge page. */
function useAuftraegeContentState({
  jobs: initialJobs,
  projects: initialProjects,
  jobAssignmentMap: initialJobAssignmentMap,
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
  const queries = useAuftraegeSectionQueries(pagination, navigation);
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

  return {
    jobs,
    jobAssignmentMap,
    navigation,
    ...queries,
    activeStatusFilter,
    setActiveStatusFilter,
    parkplatzExpanded,
    setParkplatzExpanded,
    archiveExpanded,
    setArchiveExpanded,
    createDialogOpen,
    setCreateDialogOpen,
    list,
  };
}

export function AuftraegeContent(props: AuftraegeContentProps) {
  const { clientMap, members, isAdminOrManager, visibleColumns, pagination } = props;
  const state = useAuftraegeContentState(props);
  const { list, navigation, activeQuery, archivedQuery, archiveExpanded } = state;
  const { rawActive, rawParked, rawArchived } = list;

  const sectionTableProps: AuftraegeSectionTableSharedProps = {
    pagination,
    navigationBusy: navigation.busy,
    initialIds: list.initialIds,
    localPendingIds: list.localPendingIds,
    clientMap,
    isAdminOrManager,
    jobAssignmentMap: state.jobAssignmentMap,
    members,
    visibleColumns,
    rowFeedback: list.rowFeedback,
    onJobUpdated: list.handleJobEdited,
    onJobDeleteRequested: list.handleJobDeleteRequested,
    onProjectUpdated: list.handleProjectEdited,
    onProjectDeleteRequested: list.handleProjectDeleteRequested,
  };

  return (
    <UsableContent name="auftraege" count={state.jobs.length}>
      <div className="space-y-6">
        <AuftraegeActiveSection
          activeStatusFilter={state.activeStatusFilter}
          onStatusFilterChange={(status) => {
            state.setActiveStatusFilter(status);
            if (pagination) activeQuery.navigate({ status });
          }}
          rawActive={rawActive}
          query={activeQuery}
          members={members}
          sectionTableProps={sectionTableProps}
        />

        <AuftraegeSecondarySection
          section="parked"
          title="Parkplatz"
          rawEntries={rawParked}
          query={state.parkedQuery}
          members={members}
          expanded={state.parkplatzExpanded}
          onToggle={() => state.setParkplatzExpanded((v) => !v)}
          sectionTableProps={sectionTableProps}
        />

        <AuftraegeSecondarySection
          section="archived"
          title="Archiv"
          rawEntries={rawArchived}
          query={archivedQuery}
          members={members}
          expanded={archiveExpanded}
          onToggle={() => {
            state.setArchiveExpanded((value) => !value);
            if (pagination) archivedQuery.navigate({ open: archiveExpanded ? null : '1' });
          }}
          isArchive
          sectionTableProps={sectionTableProps}
        />

        {isAdminOrManager && (
          <AuftraegeCreateDialogs
            members={members}
            open={state.createDialogOpen}
            onOpenChange={state.setCreateDialogOpen}
            list={list}
          />
        )}
      </div>
    </UsableContent>
  );
}
