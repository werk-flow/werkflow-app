'use client';

import { useId, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

import { PlainButton } from '@/components/ui/plain-button';
import { FilterBar } from '@/components/auftraege/list/filter-bar';
import { UnifiedAuftraegeTable } from '@/components/auftraege/list/unified-auftraege-table';
import { UNIFIED_STATUS_LABELS, type Client } from '@/lib/jobs/types';
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
        <span className="text-xs tabular-nums text-muted-foreground/70">({count})</span>
      </PlainButton>

      {expanded && (
        <div id={contentId} className="space-y-2">
          {children}
        </div>
      )}
    </section>
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
  clients: Client[];
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
  clients,
  members,
  isAdminOrManager,
  lockedEmployeeLabel,
  lockedClientLabel,
  hideClientColumn,
  visibleColumns,
}: EmbeddedAuftraegeListsProps) {
  const { activeStatusFilter, setActiveStatusFilter } = listState;
  const { activeStatusCounts, jobAssignmentMap, rawParked, rawArchived } = entries;
  const { handleJobEdited, handleJobDelete, handleProjectEdited, handleProjectDelete } = mutations;
  return (
    <div className="space-y-4">
      {/* Active section */}
      <section>
        <div className="mb-2 flex items-center justify-between gap-2">
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
                    activeStatusFilter === opt.value ? 'text-primary-text' : 'text-muted-foreground/70',
                  )}
                >
                  {activeStatusCounts[opt.value] || 0}
                </span>
              </PlainButton>
            ))}
          </div>
          {createButton}
        </div>

        <FilterBar
          searchQuery={listState.activeSearch}
          onSearchChange={listState.setActiveSearch}
          filters={listState.activeFilters}
          onFiltersChange={listState.setActiveFilters}
          clients={clients}
          members={members}
          lockedEmployeeLabel={lockedEmployeeLabel}
          lockedClientLabel={lockedClientLabel}
        />

        <div className="mt-2">
          <UnifiedAuftraegeTable
            entries={entries.filteredActive}
            clientMap={clientMap}
            isAdminOrManager={isAdminOrManager}
            sortColumn={resolveAuftraegeSortColumn(listState.activeSortCol, visibleColumns)}
            sortDirection={listState.activeSortDir}
            onSort={sortHandlers.handleActiveSort}
            jobAssignmentMap={jobAssignmentMap}
            members={members}
            hideClientColumn={hideClientColumn}
            clients={clients}
            visibleColumns={visibleColumns}
            onJobUpdated={handleJobEdited}
            onJobDeleted={handleJobDelete}
            onProjectUpdated={handleProjectEdited}
            onProjectDeleted={handleProjectDelete}
          />
        </div>
      </section>

      {/* Parkplatz section */}
      {rawParked.length > 0 && (
        <EmbeddedAuftraegeCollapsibleSection
          title="Parkplatz"
          count={rawParked.length}
          expanded={listState.parkplatzExpanded}
          onToggle={() => listState.setParkplatzExpanded((v) => !v)}
        >
          <FilterBar
            searchQuery={listState.parkplatzSearch}
            onSearchChange={listState.setParkplatzSearch}
            filters={listState.parkplatzFilters}
            onFiltersChange={listState.setParkplatzFilters}
            clients={clients}
            members={members}
            lockedEmployeeLabel={lockedEmployeeLabel}
            lockedClientLabel={lockedClientLabel}
          />
          <UnifiedAuftraegeTable
            entries={entries.filteredParked}
            clientMap={clientMap}
            isAdminOrManager={isAdminOrManager}
            sortColumn={resolveAuftraegeSortColumn(listState.parkplatzSortCol, visibleColumns)}
            sortDirection={listState.parkplatzSortDir}
            onSort={sortHandlers.handleParkplatzSort}
            jobAssignmentMap={jobAssignmentMap}
            members={members}
            hideClientColumn={hideClientColumn}
            clients={clients}
            visibleColumns={visibleColumns}
            onJobUpdated={handleJobEdited}
            onJobDeleted={handleJobDelete}
            onProjectUpdated={handleProjectEdited}
            onProjectDeleted={handleProjectDelete}
          />
        </EmbeddedAuftraegeCollapsibleSection>
      )}

      {/* Archive section */}
      {rawArchived.length > 0 && (
        <EmbeddedAuftraegeCollapsibleSection
          title="Archiv"
          count={rawArchived.length}
          expanded={listState.archiveExpanded}
          onToggle={() => listState.setArchiveExpanded((v) => !v)}
        >
          <FilterBar
            searchQuery={listState.archiveSearch}
            onSearchChange={listState.setArchiveSearch}
            filters={listState.archiveFilters}
            onFiltersChange={listState.setArchiveFilters}
            clients={clients}
            members={members}
            lockedEmployeeLabel={lockedEmployeeLabel}
            lockedClientLabel={lockedClientLabel}
          />
          <UnifiedAuftraegeTable
            entries={entries.filteredArchived}
            clientMap={clientMap}
            isAdminOrManager={isAdminOrManager}
            sortColumn={resolveAuftraegeSortColumn(listState.archiveSortCol, visibleColumns)}
            sortDirection={listState.archiveSortDir}
            onSort={sortHandlers.handleArchiveSort}
            isArchive
            jobAssignmentMap={jobAssignmentMap}
            members={members}
            hideClientColumn={hideClientColumn}
            clients={clients}
            visibleColumns={visibleColumns}
            onJobUpdated={handleJobEdited}
            onJobDeleted={handleJobDelete}
            onProjectUpdated={handleProjectEdited}
            onProjectDeleted={handleProjectDelete}
          />
        </EmbeddedAuftraegeCollapsibleSection>
      )}
      {createDialogs}
    </div>
  );
}
