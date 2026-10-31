'use client';

import { useId, type ComponentProps, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

import { PlainButton } from '@/components/ui/plain-button';
import { FilterBar } from '@/components/auftraege/list/filter-bar';
import { UnifiedAuftraegeTable } from '@/components/auftraege/list/unified-auftraege-table';
import { UNIFIED_STATUS_LABELS } from '@/lib/jobs/unified-list';
import { resolveAuftraegeSortColumn, type AuftraegeColumnId } from '@/lib/jobs/auftraege-table-columns';
import type { OrgMemberOption } from '@/components/auftraege/shared/employee-multi-select';
import { cn } from '@/lib/utils';
import type {
  ActiveStatusFilter,
  EmbeddedAuftraegeListState,
  useEmbeddedAuftraegeEntries,
  useEmbeddedAuftraegeSortHandlers,
} from '@/components/shared/use-embedded-auftraege-state';
import type { useEmbeddedAuftraegeMutations } from '@/components/shared/use-embedded-auftraege-mutations';

const ACTIVE_FILTER_OPTIONS: { value: ActiveStatusFilter; label: string }[] = [
  { value: 'alle', label: 'Alle' },
  { value: 'not_started', label: UNIFIED_STATUS_LABELS.not_started },
  { value: 'in_progress', label: UNIFIED_STATUS_LABELS.in_progress },
  { value: 'interrupted', label: UNIFIED_STATUS_LABELS.interrupted },
];

function EmbeddedAuftraegeCollapsibleSection({
  title,
  count,
  expanded,
  onToggle,
  children,
}: {
  title: string;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const contentId = useId();
  return (
    <section>
      <PlainButton
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={contentId}
        className="group mb-2 flex items-center gap-2"
      >
        <ChevronRight
          className={cn(
            'size-4 text-muted-foreground transition-transform duration-200',
            expanded && 'rotate-90',
          )}
        />
        <span className="text-sm font-semibold text-muted-foreground transition-colors group-hover:text-foreground">
          {title}
        </span>
        <span className="text-xs tabular-nums text-muted-foreground">({count})</span>
      </PlainButton>

      {expanded && (
        <div id={contentId} className="space-y-2">
          {children}
        </div>
      )}
    </section>
  );
}

type SharedTableProps = Pick<
  ComponentProps<typeof UnifiedAuftraegeTable>,
  | 'clientMap'
  | 'isAdminOrManager'
  | 'jobAssignmentMap'
  | 'members'
  | 'hideClientColumn'
  | 'visibleColumns'
  | 'onJobUpdated'
  | 'onJobDeleted'
  | 'onProjectUpdated'
  | 'onProjectDeleted'
>;

type SharedFilterBarProps = Pick<
  ComponentProps<typeof FilterBar>,
  'members' | 'lockedEmployeeLabel' | 'lockedClientLabel'
>;

interface EmbeddedAuftraegeSectionsProps {
  listState: EmbeddedAuftraegeListState;
  entries: ReturnType<typeof useEmbeddedAuftraegeEntries>;
  sortHandlers: ReturnType<typeof useEmbeddedAuftraegeSortHandlers>;
  filterBarProps: SharedFilterBarProps;
  tableProps: SharedTableProps;
}

function EmbeddedAuftraegeStatusChips({
  activeStatusFilter,
  setActiveStatusFilter,
  activeStatusCounts,
}: {
  activeStatusFilter: ActiveStatusFilter;
  setActiveStatusFilter: (filter: ActiveStatusFilter) => void;
  activeStatusCounts: Record<string, number>;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {ACTIVE_FILTER_OPTIONS.map((opt) => (
        <PlainButton
          key={opt.value}
          onClick={() => setActiveStatusFilter(opt.value)}
          aria-pressed={activeStatusFilter === opt.value}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors',
            activeStatusFilter === opt.value
              ? 'border-primary bg-primary/10 text-primary-text'
              : 'border-border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground',
          )}
        >
          {opt.label}
          <span
            className={cn(
              'tabular-nums',
              activeStatusFilter === opt.value ? 'text-primary-text' : 'text-muted-foreground',
            )}
          >
            {activeStatusCounts[opt.value] || 0}
          </span>
        </PlainButton>
      ))}
    </div>
  );
}

function EmbeddedAuftraegeActiveSection({
  listState,
  entries,
  sortHandlers,
  filterBarProps,
  tableProps,
  createButton,
}: EmbeddedAuftraegeSectionsProps & { createButton: ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <EmbeddedAuftraegeStatusChips
          activeStatusFilter={listState.activeStatusFilter}
          setActiveStatusFilter={listState.setActiveStatusFilter}
          activeStatusCounts={entries.activeStatusCounts}
        />
        {createButton}
      </div>

      <FilterBar
        {...filterBarProps}
        searchQuery={listState.activeSearch}
        onSearchChange={listState.setActiveSearch}
        filters={listState.activeFilters}
        onFiltersChange={listState.setActiveFilters}
      />

      <div className="mt-2">
        <UnifiedAuftraegeTable
          {...tableProps}
          entries={entries.filteredActive}
          sortColumn={resolveAuftraegeSortColumn(listState.activeSortCol, tableProps.visibleColumns)}
          sortDirection={listState.activeSortDir}
          onSort={sortHandlers.handleActiveSort}
        />
      </div>
    </section>
  );
}

/** The Parkplatz and Archiv sections, each shown only when it has entries. */
function EmbeddedAuftraegeCollapsibleSections({
  listState,
  entries,
  sortHandlers,
  filterBarProps,
  tableProps,
}: EmbeddedAuftraegeSectionsProps) {
  const { visibleColumns } = tableProps;
  return (
    <>
      {/* Parkplatz section */}
      {entries.rawParked.length > 0 && (
        <EmbeddedAuftraegeCollapsibleSection
          title="Parkplatz"
          count={entries.rawParked.length}
          expanded={listState.parkplatzExpanded}
          onToggle={() => listState.setParkplatzExpanded((v) => !v)}
        >
          <FilterBar
            {...filterBarProps}
            searchQuery={listState.parkplatzSearch}
            onSearchChange={listState.setParkplatzSearch}
            filters={listState.parkplatzFilters}
            onFiltersChange={listState.setParkplatzFilters}
          />
          <UnifiedAuftraegeTable
            {...tableProps}
            entries={entries.filteredParked}
            sortColumn={resolveAuftraegeSortColumn(listState.parkplatzSortCol, visibleColumns)}
            sortDirection={listState.parkplatzSortDir}
            onSort={sortHandlers.handleParkplatzSort}
          />
        </EmbeddedAuftraegeCollapsibleSection>
      )}

      {/* Archive section */}
      {entries.rawArchived.length > 0 && (
        <EmbeddedAuftraegeCollapsibleSection
          title="Archiv"
          count={entries.rawArchived.length}
          expanded={listState.archiveExpanded}
          onToggle={() => listState.setArchiveExpanded((v) => !v)}
        >
          <FilterBar
            {...filterBarProps}
            searchQuery={listState.archiveSearch}
            onSearchChange={listState.setArchiveSearch}
            filters={listState.archiveFilters}
            onFiltersChange={listState.setArchiveFilters}
          />
          <UnifiedAuftraegeTable
            {...tableProps}
            entries={entries.filteredArchived}
            sortColumn={resolveAuftraegeSortColumn(listState.archiveSortCol, visibleColumns)}
            sortDirection={listState.archiveSortDir}
            onSort={sortHandlers.handleArchiveSort}
            isArchive
          />
        </EmbeddedAuftraegeCollapsibleSection>
      )}
    </>
  );
}

interface EmbeddedAuftraegeListsProps {
  listState: EmbeddedAuftraegeListState;
  entries: ReturnType<typeof useEmbeddedAuftraegeEntries>;
  sortHandlers: ReturnType<typeof useEmbeddedAuftraegeSortHandlers>;
  mutations: ReturnType<typeof useEmbeddedAuftraegeMutations>;
  createButton: ReactNode;
  createDialogs: ReactNode;
  clientMap: Record<string, string>;
  members: OrgMemberOption[];
  isAdminOrManager: boolean;
  lockedEmployeeLabel: string | undefined;
  lockedClientLabel: string | undefined;
  hideClientColumn: boolean | undefined;
  visibleColumns: AuftraegeColumnId[];
}

/** The active list with status chips, then the collapsible Parkplatz and Archiv sections. */
export function EmbeddedAuftraegeLists({
  listState,
  entries,
  sortHandlers,
  mutations,
  createButton,
  createDialogs,
  clientMap,
  members,
  isAdminOrManager,
  lockedEmployeeLabel,
  lockedClientLabel,
  hideClientColumn,
  visibleColumns,
}: EmbeddedAuftraegeListsProps) {
  const filterBarProps: SharedFilterBarProps = { members, lockedEmployeeLabel, lockedClientLabel };
  const tableProps: SharedTableProps = {
    clientMap,
    isAdminOrManager,
    jobAssignmentMap: entries.jobAssignmentMap,
    members,
    hideClientColumn,
    visibleColumns,
    onJobUpdated: mutations.handleJobEdited,
    onJobDeleted: mutations.handleJobDelete,
    onProjectUpdated: mutations.handleProjectEdited,
    onProjectDeleted: mutations.handleProjectDelete,
  };
  const sections = { listState, entries, sortHandlers, filterBarProps, tableProps };
  return (
    <div className="space-y-4">
      <EmbeddedAuftraegeActiveSection {...sections} createButton={createButton} />
      <EmbeddedAuftraegeCollapsibleSections {...sections} />
      {createDialogs}
    </div>
  );
}
