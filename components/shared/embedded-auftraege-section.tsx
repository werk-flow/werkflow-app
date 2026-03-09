'use client';

import { useState, useMemo, useCallback } from 'react';
import { Briefcase, ChevronRight } from 'lucide-react';

import { FilterBar } from '@/components/auftraege/filter-bar';
import { UnifiedAuftraegeTable } from '@/components/auftraege/unified-auftraege-table';
import {
  buildUnifiedList,
  splitActiveAndArchived,
  matchesSearch,
  sortUnifiedEntries,
  getEntryUnifiedStatus,
  UNIFIED_STATUS_LABELS,
  EMPTY_FILTER_STATE,
  type Job,
  type Client,
  type ProjectWithDetails,
  type UnifiedListEntry,
  type FilterState,
  type SortColumn,
} from '@/lib/jobs/types';
import type { OrgMemberOption } from '@/components/auftraege/employee-multi-select';
import { cn } from '@/lib/utils';

type ActiveStatusFilter = 'alle' | 'offen' | 'in_bearbeitung';

const ACTIVE_FILTER_OPTIONS: { value: ActiveStatusFilter; label: string }[] = [
  { value: 'alle', label: 'Alle' },
  { value: 'offen', label: UNIFIED_STATUS_LABELS.offen },
  { value: 'in_bearbeitung', label: UNIFIED_STATUS_LABELS.in_bearbeitung },
];

function applyDropdownFilters(
  entries: UnifiedListEntry[],
  filters: FilterState,
  jobAssignmentMap: Record<string, string[]>
): UnifiedListEntry[] {
  let result = entries;

  if (filters.entryType === 'jobs') {
    result = result.filter((e) => e.type === 'standalone-job');
  } else if (filters.entryType === 'projekte') {
    result = result.filter((e) => e.type === 'project');
  }

  if (filters.clientIds.length > 0) {
    const clientSet = new Set(filters.clientIds);
    result = result.filter((e) => {
      if (e.type === 'standalone-job')
        return e.job.clientId ? clientSet.has(e.job.clientId) : false;
      return (
        (e.project.clientId && clientSet.has(e.project.clientId)) ||
        e.childJobs.some((j) => j.clientId && clientSet.has(j.clientId))
      );
    });
  }

  if (filters.employeeIds.length > 0) {
    const employeeSet = new Set(filters.employeeIds);
    result = result.filter((e) => {
      if (e.type === 'standalone-job') {
        const assigned = jobAssignmentMap[e.job.id] ?? [];
        return assigned.some((uid) => employeeSet.has(uid));
      }
      return e.childJobs.some((j) => {
        const assigned = jobAssignmentMap[j.id] ?? [];
        return assigned.some((uid) => employeeSet.has(uid));
      });
    });
  }

  if (filters.dateFrom || filters.dateTo) {
    result = result.filter((e) => {
      const dateStr =
        e.type === 'standalone-job'
          ? e.job.plannedDate
          : e.project.plannedStartDate;
      if (!dateStr) return true;
      if (filters.dateFrom && dateStr < filters.dateFrom) return false;
      if (filters.dateTo && dateStr > filters.dateTo) return false;
      return true;
    });
  }

  return result;
}

interface EmbeddedAuftraegeSectionProps {
  jobs: Job[];
  projects: ProjectWithDetails[];
  clientMap: Record<string, string>;
  jobAssignmentMap?: Record<string, string[]>;
  clients?: Client[];
  members?: OrgMemberOption[];
  isAdminOrManager: boolean;
  /** When set, the employee filter shows a locked, read-only field with this label. */
  lockedEmployeeLabel?: string;
  /** When set, the client filter shows a locked, read-only field with this label. */
  lockedClientLabel?: string;
  emptyTitle?: string;
  emptyDescription?: string;
}

export function EmbeddedAuftraegeSection({
  jobs,
  projects,
  clientMap,
  jobAssignmentMap = {},
  clients = [],
  members = [],
  isAdminOrManager,
  lockedEmployeeLabel,
  lockedClientLabel,
  emptyTitle = 'Keine Aufträge',
  emptyDescription = 'Es sind keine Aufträge vorhanden.',
}: EmbeddedAuftraegeSectionProps) {
  const [activeStatusFilter, setActiveStatusFilter] =
    useState<ActiveStatusFilter>('alle');
  const [activeSearch, setActiveSearch] = useState('');
  const [activeFilters, setActiveFilters] =
    useState<FilterState>(EMPTY_FILTER_STATE);
  const [activeSortCol, setActiveSortCol] = useState<SortColumn>('datum');
  const [activeSortDir, setActiveSortDir] = useState<'asc' | 'desc'>('desc');

  const [archiveExpanded, setArchiveExpanded] = useState(false);
  const [archiveSearch, setArchiveSearch] = useState('');
  const [archiveFilters, setArchiveFilters] =
    useState<FilterState>(EMPTY_FILTER_STATE);
  const [archiveSortCol, setArchiveSortCol] = useState<SortColumn>('datum');
  const [archiveSortDir, setArchiveSortDir] = useState<'asc' | 'desc'>('desc');

  const unifiedEntries = useMemo(
    () => buildUnifiedList(jobs, projects),
    [jobs, projects]
  );

  const { active: rawActive, archived: rawArchived } = useMemo(
    () => splitActiveAndArchived(unifiedEntries),
    [unifiedEntries]
  );

  const activeStatusCounts = useMemo(() => {
    const counts: Record<string, number> = { alle: rawActive.length };
    for (const entry of rawActive) {
      const status = getEntryUnifiedStatus(entry);
      counts[status] = (counts[status] || 0) + 1;
    }
    return counts;
  }, [rawActive]);

  const filteredActive = useMemo(() => {
    let result = rawActive;
    if (activeStatusFilter !== 'alle') {
      result = result.filter(
        (e) => getEntryUnifiedStatus(e) === activeStatusFilter
      );
    }
    if (activeSearch) {
      result = result.filter((e) => matchesSearch(e, activeSearch, clientMap));
    }
    result = applyDropdownFilters(result, activeFilters, jobAssignmentMap);
    return sortUnifiedEntries(result, activeSortCol, activeSortDir, clientMap);
  }, [
    rawActive,
    activeStatusFilter,
    activeSearch,
    activeFilters,
    activeSortCol,
    activeSortDir,
    clientMap,
    jobAssignmentMap,
  ]);

  const filteredArchived = useMemo(() => {
    let result = rawArchived;
    if (archiveSearch) {
      result = result.filter((e) => matchesSearch(e, archiveSearch, clientMap));
    }
    result = applyDropdownFilters(result, archiveFilters, jobAssignmentMap);
    return sortUnifiedEntries(result, archiveSortCol, archiveSortDir, clientMap);
  }, [
    rawArchived,
    archiveSearch,
    archiveFilters,
    archiveSortCol,
    archiveSortDir,
    clientMap,
    jobAssignmentMap,
  ]);

  const handleActiveSort = useCallback((col: SortColumn) => {
    setActiveSortCol((prev) => {
      if (col === prev) {
        setActiveSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        return prev;
      }
      setActiveSortDir('asc');
      return col;
    });
  }, []);

  const handleArchiveSort = useCallback((col: SortColumn) => {
    setArchiveSortCol((prev) => {
      if (col === prev) {
        setArchiveSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        return prev;
      }
      setArchiveSortDir('desc');
      return col;
    });
  }, []);

  if (unifiedEntries.length === 0) {
    return (
      <div className="rounded-lg border border-dashed bg-card p-8">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex size-10 items-center justify-center rounded-full bg-muted">
            <Briefcase className="size-5 text-muted-foreground" />
          </div>
          <h4 className="text-sm font-medium text-muted-foreground">
            {emptyTitle}
          </h4>
          <p className="max-w-xs text-xs text-muted-foreground/80">
            {emptyDescription}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Active section */}
      <section>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {ACTIVE_FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setActiveStatusFilter(opt.value)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors',
                activeStatusFilter === opt.value
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              )}
            >
              {opt.label}
              <span
                className={cn(
                  'tabular-nums',
                  activeStatusFilter === opt.value
                    ? 'text-primary'
                    : 'text-muted-foreground/70'
                )}
              >
                {activeStatusCounts[opt.value] || 0}
              </span>
            </button>
          ))}
        </div>

        <FilterBar
          searchQuery={activeSearch}
          onSearchChange={setActiveSearch}
          filters={activeFilters}
          onFiltersChange={setActiveFilters}
          clients={clients}
          members={members}
          lockedEmployeeLabel={lockedEmployeeLabel}
          lockedClientLabel={lockedClientLabel}
        />

        <div className="mt-2">
          <UnifiedAuftraegeTable
            entries={filteredActive}
            clientMap={clientMap}
            isAdminOrManager={isAdminOrManager}
            sortColumn={activeSortCol}
            sortDirection={activeSortDir}
            onSort={handleActiveSort}
          />
        </div>
      </section>

      {/* Archive section */}
      {rawArchived.length > 0 && (
        <section>
          <button
            onClick={() => setArchiveExpanded((v) => !v)}
            className="group mb-2 flex items-center gap-2"
          >
            <ChevronRight
              className={cn(
                'size-4 text-muted-foreground transition-transform duration-200',
                archiveExpanded && 'rotate-90'
              )}
            />
            <span className="text-sm font-semibold text-muted-foreground transition-colors group-hover:text-foreground">
              Archiv
            </span>
            <span className="text-xs tabular-nums text-muted-foreground/70">
              ({rawArchived.length})
            </span>
          </button>

          {archiveExpanded && (
            <div className="space-y-2">
              <FilterBar
                searchQuery={archiveSearch}
                onSearchChange={setArchiveSearch}
                filters={archiveFilters}
                onFiltersChange={setArchiveFilters}
                clients={clients}
                members={members}
                lockedEmployeeLabel={lockedEmployeeLabel}
                lockedClientLabel={lockedClientLabel}
              />
              <UnifiedAuftraegeTable
                entries={filteredArchived}
                clientMap={clientMap}
                isAdminOrManager={isAdminOrManager}
                sortColumn={archiveSortCol}
                sortDirection={archiveSortDir}
                onSort={handleArchiveSort}
                isArchive
              />
            </div>
          )}
        </section>
      )}
    </div>
  );
}
