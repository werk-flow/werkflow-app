'use client';

import { useMemo, type ComponentProps, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

import { ListPagination } from '@/components/shared/list-pagination';
import { PlainButton } from '@/components/ui/plain-button';
import { retainPageEntries, type JobListPagination, type JobListSection } from '@/lib/jobs/list-page';
import { resolveAuftraegeSortColumn } from '@/lib/jobs/auftraege-table-columns';
import {
  UNIFIED_STATUS_LABELS,
  countActiveFilters,
  getEntryUnifiedStatus,
  matchesSearch,
  sortUnifiedEntries,
  type UnifiedListEntry,
} from '@/lib/jobs/types';
import { cn } from '@/lib/utils';
import { applyDropdownFilters } from '@/lib/jobs/dropdown-filters';
import type { AuftraegeActiveStatusFilter } from './auftraege-list-filters';
import { FilterBar } from './filter-bar';
import { UnifiedAuftraegeTable } from './unified-auftraege-table';
import type { AuftraegeSectionQuery } from './use-auftraege-section-query';

const ACTIVE_FILTER_OPTIONS: { value: AuftraegeActiveStatusFilter; label: string }[] = [
  { value: 'alle', label: 'Alle' },
  { value: 'not_started', label: UNIFIED_STATUS_LABELS.not_started },
  { value: 'in_progress', label: UNIFIED_STATUS_LABELS.in_progress },
  { value: 'interrupted', label: UNIFIED_STATUS_LABELS.interrupted },
];

type AuftraegeStatusFilterPillsProps = {
  activeStatusFilter: AuftraegeActiveStatusFilter;
  onChange: (status: AuftraegeActiveStatusFilter) => void;
  rawActive: UnifiedListEntry[];
  pagination: JobListPagination | undefined;
};

/** Status pills of the active section, each with its entry count. */
export function AuftraegeStatusFilterPills({
  activeStatusFilter,
  onChange,
  rawActive,
  pagination,
}: AuftraegeStatusFilterPillsProps) {
  const activeStatusCounts = useMemo(() => {
    if (pagination) return pagination.pages.active.statusCounts;
    const counts: Record<string, number> = { alle: rawActive.length };
    for (const entry of rawActive) {
      const status = getEntryUnifiedStatus(entry);
      counts[status] = (counts[status] || 0) + 1;
    }
    return counts;
  }, [rawActive, pagination]);

  return (
    <div className="mb-3 flex flex-wrap gap-1.5">
      {ACTIVE_FILTER_OPTIONS.map((opt) => (
        <PlainButton
          key={opt.value}
          onClick={() => onChange(opt.value)}
          aria-pressed={activeStatusFilter === opt.value}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
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
  );
}

type AuftraegeCollapsibleSectionProps = {
  title: string;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
};

/** A secondary list section (Parkplatz, Archiv) behind a disclosure heading. */
export function AuftraegeCollapsibleSection({
  title,
  count,
  expanded,
  onToggle,
  children,
}: AuftraegeCollapsibleSectionProps) {
  return (
    <section>
      {/* The heading wraps the button: a heading inside a button loses its heading role. */}
      <h2 className="mb-3">
        <PlainButton onClick={onToggle} aria-expanded={expanded} className="flex items-center gap-2 group">
          <ChevronRight
            className={cn(
              'size-5 text-muted-foreground transition-transform duration-200',
              expanded && 'rotate-90',
            )}
          />
          <span className="text-base font-semibold sm:text-lg text-muted-foreground group-hover:text-foreground transition-colors">
            {title}
          </span>
          <span className="text-xs tabular-nums text-muted-foreground/70">({count})</span>
        </PlainButton>
      </h2>

      {expanded && <div className="space-y-3">{children}</div>}
    </section>
  );
}

type AuftraegeSectionFilterBarProps = Pick<ComponentProps<typeof FilterBar>, 'members'> & {
  query: AuftraegeSectionQuery;
};

/** The search and filter bar of one section, bound to that section's query. */
export function AuftraegeSectionFilterBar({ query, members }: AuftraegeSectionFilterBarProps) {
  return (
    <FilterBar
      searchQuery={query.search}
      onSearchChange={query.changeSearch}
      filters={query.filters}
      onFiltersChange={query.changeFilters}
      members={members}
    />
  );
}

type AuftraegeSectionTableProps = Pick<
  ComponentProps<typeof UnifiedAuftraegeTable>,
  | 'clientMap'
  | 'isAdminOrManager'
  | 'members'
  | 'visibleColumns'
  | 'rowFeedback'
  | 'onJobUpdated'
  | 'onJobDeleteRequested'
  | 'onProjectUpdated'
  | 'onProjectDeleteRequested'
> & {
  section: JobListSection;
  paginationLabel: string;
  /** The section's entries before search, filters and sort. */
  rawEntries: UnifiedListEntry[];
  query: AuftraegeSectionQuery;
  /** Only the active section filters by status. */
  statusFilter?: AuftraegeActiveStatusFilter | undefined;
  isArchive?: boolean | undefined;
  jobAssignmentMap: Record<string, string[]>;
  pagination: JobListPagination | undefined;
  navigationBusy: boolean;
  initialIds: Set<string>;
  localPendingIds: Set<string>;
};

/** One section's table: status pills -> search -> dropdown filters -> sort, then paging. */
export function AuftraegeSectionTable({
  section,
  paginationLabel,
  rawEntries,
  query,
  statusFilter = 'alle',
  isArchive = false,
  jobAssignmentMap,
  pagination,
  navigationBusy,
  initialIds,
  localPendingIds,
  clientMap,
  isAdminOrManager,
  members,
  visibleColumns,
  rowFeedback,
  onJobUpdated,
  onJobDeleteRequested,
  onProjectUpdated,
  onProjectDeleteRequested,
}: AuftraegeSectionTableProps) {
  const { search, filters, sortColumn, sortDirection } = query;

  const filteredEntries = useMemo(() => {
    if (pagination) {
      return retainPageEntries(
        rawEntries,
        pagination.pages[section].entries.map((entry) => entry.id),
        initialIds,
        localPendingIds,
      );
    }
    const effectiveSortColumn = resolveAuftraegeSortColumn(sortColumn, visibleColumns);
    let result = rawEntries;
    if (statusFilter !== 'alle') {
      result = result.filter((e) => getEntryUnifiedStatus(e) === statusFilter);
    }
    if (search) {
      result = result.filter((e) => matchesSearch(e, search, clientMap));
    }
    result = applyDropdownFilters(result, filters, jobAssignmentMap);
    result = sortUnifiedEntries(result, effectiveSortColumn, sortDirection, clientMap);
    return result;
  }, [
    rawEntries,
    statusFilter,
    search,
    filters,
    sortColumn,
    sortDirection,
    clientMap,
    jobAssignmentMap,
    visibleColumns,
    pagination,
    section,
    initialIds,
    localPendingIds,
  ]);

  return (
    <>
      <UnifiedAuftraegeTable
        pagedChildren={Boolean(pagination)}
        projectAssignmentMap={Object.fromEntries(
          pagination
            ? Object.values(pagination.pages).flatMap((page) =>
                page.entries
                  .filter((entry) => entry.type === 'project')
                  .map((entry) => [entry.id, entry.assignedUserIds]),
              )
            : [],
        )}
        entries={filteredEntries}
        isFiltered={statusFilter !== 'alle' || Boolean(search) || countActiveFilters(filters) > 0}
        clientMap={clientMap}
        isAdminOrManager={isAdminOrManager}
        sortColumn={resolveAuftraegeSortColumn(sortColumn, visibleColumns)}
        sortDirection={sortDirection}
        onSort={query.changeSort}
        isArchive={isArchive}
        jobAssignmentMap={jobAssignmentMap}
        members={members}
        visibleColumns={visibleColumns}
        rowFeedback={rowFeedback}
        onJobUpdated={onJobUpdated}
        onJobDeleteRequested={onJobDeleteRequested}
        onProjectUpdated={onProjectUpdated}
        onProjectDeleteRequested={onProjectDeleteRequested}
      />
      {pagination && (
        <ListPagination
          label={paginationLabel}
          page={pagination.queries[section].page}
          total={pagination.pages[section].total}
          busy={navigationBusy}
          onPageChange={(page) => query.navigate({ page })}
        />
      )}
    </>
  );
}
