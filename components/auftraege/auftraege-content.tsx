'use client';

import { useState, useCallback, useEffect, useTransition, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw, Plus, Briefcase, FolderKanban, ChevronRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { UnifiedAuftraegeTable } from './unified-auftraege-table';
import { FilterBar } from './filter-bar';
import { CreateJobDialog } from './create-job-dialog';
import { CreateProjectDialog } from './create-project-dialog';
import {
  UNIFIED_STATUS_LABELS,
  EMPTY_FILTER_STATE,
  buildUnifiedList,
  splitEntries,
  matchesSearch,
  sortUnifiedEntries,
  getEntryUnifiedStatus,
  type Client,
  type Job,
  type UnifiedStatus,
  type ProjectWithDetails,
  type UnifiedListEntry,
  type FilterState,
  type SortColumn,
} from '@/lib/jobs/types';
import type { OrgMemberOption } from './employee-multi-select';
import { cn } from '@/lib/utils';

type ActiveStatusFilter = 'alle' | 'offen' | 'in_bearbeitung';

const ACTIVE_FILTER_OPTIONS: { value: ActiveStatusFilter; label: string }[] = [
  { value: 'alle', label: 'Alle' },
  { value: 'offen', label: UNIFIED_STATUS_LABELS.offen },
  { value: 'in_bearbeitung', label: UNIFIED_STATUS_LABELS.in_bearbeitung },
];

interface AuftraegeContentProps {
  jobs: Job[];
  projects: ProjectWithDetails[];
  clientMap: Record<string, string>;
  clients: Client[];
  members: OrgMemberOption[];
  jobAssignmentMap: Record<string, string[]>;
  isAdminOrManager: boolean;
}

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
      if (e.type === 'standalone-job') return e.job.clientId ? clientSet.has(e.job.clientId) : false;
      return (e.project.clientId && clientSet.has(e.project.clientId)) ||
        e.childJobs.some((j) => j.clientId && clientSet.has(j.clientId));
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
      const dateStr = e.type === 'standalone-job'
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

export function AuftraegeContent({
  jobs: initialJobs,
  projects: initialProjects,
  clientMap,
  clients,
  members,
  jobAssignmentMap,
  isAdminOrManager,
}: AuftraegeContentProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [jobs, setJobs] = useState<Job[]>(initialJobs);
  const [projects, setProjects] = useState<ProjectWithDetails[]>(initialProjects);
  const [prevEntryCount, setPrevEntryCount] = useState(0);

  // Active section state
  const [activeStatusFilter, setActiveStatusFilter] = useState<ActiveStatusFilter>('alle');
  const [activeSearch, setActiveSearch] = useState('');
  const [activeFilters, setActiveFilters] = useState<FilterState>(EMPTY_FILTER_STATE);
  const [activeSortCol, setActiveSortCol] = useState<SortColumn>('datum');
  const [activeSortDir, setActiveSortDir] = useState<'asc' | 'desc'>('desc');

  // Parkplatz section state
  const [parkplatzExpanded, setParkplatzExpanded] = useState(true);
  const [parkplatzSearch, setParkplatzSearch] = useState('');
  const [parkplatzFilters, setParkplatzFilters] = useState<FilterState>(EMPTY_FILTER_STATE);
  const [parkplatzSortCol, setParkplatzSortCol] = useState<SortColumn>('datum');
  const [parkplatzSortDir, setParkplatzSortDir] = useState<'asc' | 'desc'>('desc');

  // Archive section state
  const [archiveExpanded, setArchiveExpanded] = useState(false);
  const [archiveSearch, setArchiveSearch] = useState('');
  const [archiveFilters, setArchiveFilters] = useState<FilterState>(EMPTY_FILTER_STATE);
  const [archiveSortCol, setArchiveSortCol] = useState<SortColumn>('datum');
  const [archiveSortDir, setArchiveSortDir] = useState<'asc' | 'desc'>('desc');

  const [createJobOpen, setCreateJobOpen] = useState(false);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);

  useEffect(() => { setJobs(initialJobs); }, [initialJobs]);
  useEffect(() => { setProjects(initialProjects); }, [initialProjects]);

  const unifiedEntries = useMemo(
    () => buildUnifiedList(jobs, projects),
    [jobs, projects]
  );

  useEffect(() => {
    setPrevEntryCount(unifiedEntries.length);
  }, [unifiedEntries.length]);

  const { active: rawActive, parked: rawParked, archived: rawArchived } = useMemo(
    () => splitEntries(unifiedEntries),
    [unifiedEntries]
  );

  // Active section pipeline: status pills -> search -> dropdown filters -> sort
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
    result = sortUnifiedEntries(result, activeSortCol, activeSortDir, clientMap);
    return result;
  }, [rawActive, activeStatusFilter, activeSearch, activeFilters, activeSortCol, activeSortDir, clientMap, jobAssignmentMap]);

  // Parkplatz section pipeline: search -> dropdown filters -> sort
  const filteredParked = useMemo(() => {
    let result = rawParked;
    if (parkplatzSearch) {
      result = result.filter((e) => matchesSearch(e, parkplatzSearch, clientMap));
    }
    result = applyDropdownFilters(result, parkplatzFilters, jobAssignmentMap);
    result = sortUnifiedEntries(result, parkplatzSortCol, parkplatzSortDir, clientMap);
    return result;
  }, [rawParked, parkplatzSearch, parkplatzFilters, parkplatzSortCol, parkplatzSortDir, clientMap, jobAssignmentMap]);

  // Archive section pipeline: search -> dropdown filters -> sort
  const filteredArchived = useMemo(() => {
    let result = rawArchived;
    if (archiveSearch) {
      result = result.filter((e) => matchesSearch(e, archiveSearch, clientMap));
    }
    result = applyDropdownFilters(result, archiveFilters, jobAssignmentMap);
    result = sortUnifiedEntries(result, archiveSortCol, archiveSortDir, clientMap);
    return result;
  }, [rawArchived, archiveSearch, archiveFilters, archiveSortCol, archiveSortDir, clientMap, jobAssignmentMap]);

  const handleParkplatzSort = useCallback((col: SortColumn) => {
    if (col === parkplatzSortCol) {
      setParkplatzSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setParkplatzSortCol(col);
      setParkplatzSortDir('desc');
    }
  }, [parkplatzSortCol]);

  const handleRefresh = useCallback(() => {
    setPrevEntryCount(unifiedEntries.length);
    startTransition(() => { router.refresh(); });
  }, [router, unifiedEntries.length]);

  const handleActiveSort = useCallback((col: SortColumn) => {
    if (col === activeSortCol) {
      setActiveSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setActiveSortCol(col);
      setActiveSortDir('asc');
    }
  }, [activeSortCol]);

  const handleArchiveSort = useCallback((col: SortColumn) => {
    if (col === archiveSortCol) {
      setArchiveSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setArchiveSortCol(col);
      setArchiveSortDir('desc');
    }
  }, [archiveSortCol]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex items-center justify-between border-b bg-background px-4 py-3 sm:px-6 sm:py-4 sticky top-0 z-10 shrink-0">
        <h1 className="text-xl font-bold sm:text-2xl">Aufträge</h1>
        {isAdminOrManager && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="default" className="gap-2">
                <Plus className="size-4" />
                <span className="hidden sm:inline">Erstellen</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setCreateJobOpen(true)}>
                <Briefcase className="mr-2 size-4" />
                Auftrag erstellen
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setCreateProjectOpen(true)}>
                <FolderKanban className="mr-2 size-4" />
                Projekt erstellen
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </header>

      <div className="flex-1 overflow-auto p-4 sm:p-6">
      <div className="space-y-6 pb-20">
      {/* Active section */}
      <section>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold sm:text-lg">
            Aktuelle Aufträge und Projekte
          </h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleRefresh}
            disabled={isPending}
            className="h-8 w-8 shrink-0"
            title="Tabelle aktualisieren"
          >
            <RefreshCw className={`size-4 ${isPending ? 'animate-spin' : ''}`} />
            <span className="sr-only">Aktualisieren</span>
          </Button>
        </div>

        <div className="mb-3 flex flex-wrap gap-1.5">
          {ACTIVE_FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setActiveStatusFilter(opt.value)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                activeStatusFilter === opt.value
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              )}
            >
              {opt.label}
              <span className={cn(
                'tabular-nums',
                activeStatusFilter === opt.value ? 'text-primary' : 'text-muted-foreground/70'
              )}>
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
        />

        <div className="mt-3">
          <UnifiedAuftraegeTable
            entries={filteredActive}
            clientMap={clientMap}
            isAdminOrManager={isAdminOrManager}
            isLoading={isPending}
            skeletonCount={prevEntryCount}
            sortColumn={activeSortCol}
            sortDirection={activeSortDir}
            onSort={handleActiveSort}
            jobAssignmentMap={jobAssignmentMap}
            members={members}
          />
        </div>
      </section>

      {/* Parkplatz section */}
      {rawParked.length > 0 && (
        <section>
          <button
            onClick={() => setParkplatzExpanded((v) => !v)}
            className="flex items-center gap-2 mb-3 group"
          >
            <ChevronRight
              className={cn(
                'size-5 text-muted-foreground transition-transform duration-200',
                parkplatzExpanded && 'rotate-90'
              )}
            />
            <h2 className="text-base font-semibold sm:text-lg text-muted-foreground group-hover:text-foreground transition-colors">
              Parkplatz
            </h2>
            <span className="text-xs tabular-nums text-muted-foreground/70">
              ({rawParked.length})
            </span>
          </button>

          {parkplatzExpanded && (
            <div className="space-y-3">
              <FilterBar
                searchQuery={parkplatzSearch}
                onSearchChange={setParkplatzSearch}
                filters={parkplatzFilters}
                onFiltersChange={setParkplatzFilters}
                clients={clients}
                members={members}
              />
              <UnifiedAuftraegeTable
                entries={filteredParked}
                clientMap={clientMap}
                isAdminOrManager={isAdminOrManager}
                sortColumn={parkplatzSortCol}
                sortDirection={parkplatzSortDir}
                onSort={handleParkplatzSort}
                jobAssignmentMap={jobAssignmentMap}
                members={members}
              />
            </div>
          )}
        </section>
      )}

      {/* Archive section */}
      {rawArchived.length > 0 && (
        <section>
          <button
            onClick={() => setArchiveExpanded((v) => !v)}
            className="flex items-center gap-2 mb-3 group"
          >
            <ChevronRight
              className={cn(
                'size-5 text-muted-foreground transition-transform duration-200',
                archiveExpanded && 'rotate-90'
              )}
            />
            <h2 className="text-base font-semibold sm:text-lg text-muted-foreground group-hover:text-foreground transition-colors">
              Archiv
            </h2>
            <span className="text-xs tabular-nums text-muted-foreground/70">
              ({rawArchived.length})
            </span>
          </button>

          {archiveExpanded && (
            <div className="space-y-3">
              <FilterBar
                searchQuery={archiveSearch}
                onSearchChange={setArchiveSearch}
                filters={archiveFilters}
                onFiltersChange={setArchiveFilters}
                clients={clients}
                members={members}
              />
              <UnifiedAuftraegeTable
                entries={filteredArchived}
                clientMap={clientMap}
                isAdminOrManager={isAdminOrManager}
                sortColumn={archiveSortCol}
                sortDirection={archiveSortDir}
                onSort={handleArchiveSort}
                isArchive
                jobAssignmentMap={jobAssignmentMap}
                members={members}
              />
            </div>
          )}
        </section>
      )}

      {isAdminOrManager && (
        <>
          <CreateJobDialog
            clients={clients}
            members={members}
            projects={projects}
            open={createJobOpen}
            onOpenChange={setCreateJobOpen}
          />
          <CreateProjectDialog
            clients={clients}
            jobs={jobs}
            open={createProjectOpen}
            onOpenChange={setCreateProjectOpen}
          />
        </>
      )}
    </div>
    </div>
    </div>
  );
}
