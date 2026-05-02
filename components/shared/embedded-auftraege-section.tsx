'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { Briefcase, ChevronRight, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { FilterBar } from '@/components/auftraege/filter-bar';
import { UnifiedAuftraegeTable } from '@/components/auftraege/unified-auftraege-table';
import { CreateJobDialog } from '@/components/auftraege/create-job-dialog';
import { CreateAuftragProjectDialog } from '@/components/auftraege/create-auftrag-project-dialog';
import {
  buildUnifiedList,
  splitEntries,
  matchesSearch,
  sortUnifiedEntries,
  getEntryUnifiedStatus,
  UNIFIED_STATUS_LABELS,
  EMPTY_FILTER_STATE,
  type Job,
  type Client,
  type Project,
  type ProjectWithDetails,
  type UnifiedListEntry,
  type FilterState,
  type SortColumn,
} from '@/lib/jobs/types';
import type { OrgMemberOption } from '@/components/auftraege/employee-multi-select';
import { cn } from '@/lib/utils';
import { useLiveAuftraegeData } from '@/hooks/use-live-auftraege-data';
import { getAuftraegeDialogOptions } from '@/lib/jobs/actions';

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
  supportProjects?: ProjectWithDetails[];
  clientMap: Record<string, string>;
  jobAssignmentMap?: Record<string, string[]>;
  clients?: Client[];
  members?: OrgMemberOption[];
  isAdminOrManager: boolean;
  /** When set, the employee filter shows a locked, read-only field with this label. */
  lockedEmployeeLabel?: string;
  /** When set, the client filter shows a locked, read-only field with this label. */
  lockedClientLabel?: string;
  hideClientColumn?: boolean;
  defaultClientId?: string;
  defaultEmployeeIds?: string[];
  /** Makes the client field in create dialogs read-only. */
  readOnlyClient?: boolean;
  /** When true, project creation is hidden from the create dropdown. */
  hideProjectCreation?: boolean;
  /** Override projects list for create-job dialog (e.g. all active projects). */
  allProjectsForJobCreation?: ProjectWithDetails[];
  /** Hide empty project rows while still keeping support project metadata in the live graph. */
  hideEmptyProjects?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
}

export function EmbeddedAuftraegeSection({
  jobs: initialJobs,
  projects: initialProjects,
  supportProjects,
  clientMap,
  jobAssignmentMap: initialJobAssignmentMap = {},
  clients = [],
  members = [],
  isAdminOrManager,
  lockedEmployeeLabel,
  lockedClientLabel,
  hideClientColumn,
  defaultClientId,
  defaultEmployeeIds,
  readOnlyClient,
  hideProjectCreation,
  allProjectsForJobCreation,
  hideEmptyProjects = false,
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

  const [parkplatzExpanded, setParkplatzExpanded] = useState(true);
  const [parkplatzSearch, setParkplatzSearch] = useState('');
  const [parkplatzFilters, setParkplatzFilters] =
    useState<FilterState>(EMPTY_FILTER_STATE);
  const [parkplatzSortCol, setParkplatzSortCol] = useState<SortColumn>('datum');
  const [parkplatzSortDir, setParkplatzSortDir] = useState<'asc' | 'desc'>('desc');

  const [archiveExpanded, setArchiveExpanded] = useState(false);
  const [archiveSearch, setArchiveSearch] = useState('');
  const [archiveFilters, setArchiveFilters] =
    useState<FilterState>(EMPTY_FILTER_STATE);
  const [archiveSortCol, setArchiveSortCol] = useState<SortColumn>('datum');
  const [archiveSortDir, setArchiveSortDir] = useState<'asc' | 'desc'>('desc');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [dialogClients, setDialogClients] = useState(clients);
  const [dialogMembers, setDialogMembers] = useState(members);
  const [dialogProjects, setDialogProjects] = useState<ProjectWithDetails[]>(
    allProjectsForJobCreation ?? []
  );
  const [isLoadingDialogOptions, setIsLoadingDialogOptions] = useState(false);
  const {
    jobs,
    setJobs,
    setRawProjects,
    projects,
    jobAssignmentMap,
    setJobAssignmentMap,
  } = useLiveAuftraegeData({
    initialJobs,
    initialProjects,
    supportProjects,
    initialJobAssignmentMap,
    clients,
  });

  const hasDialogOptions =
    dialogClients.length > 0 ||
    dialogMembers.length > 0 ||
    dialogProjects.length > 0;

  useEffect(() => {
    if (
      !isAdminOrManager ||
      !createDialogOpen ||
      hasDialogOptions ||
      isLoadingDialogOptions
    ) {
      return;
    }

    let cancelled = false;
    setIsLoadingDialogOptions(true);
    getAuftraegeDialogOptions()
      .then((result) => {
        if (cancelled || !result.success) return;
        setDialogClients(result.clients);
        setDialogMembers(result.members);
        setDialogProjects(result.projects);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingDialogOptions(false);
      });

    return () => {
      cancelled = true;
    };
  }, [createDialogOpen, hasDialogOptions, isAdminOrManager, isLoadingDialogOptions]);

  const dialogProjectOptions =
    dialogProjects.length > 0 ? dialogProjects : allProjectsForJobCreation ?? projects;

  const unifiedEntries = useMemo(() => {
    const entries = buildUnifiedList(jobs, projects);
    if (!hideEmptyProjects) return entries;

    return entries.filter(
      (entry) => entry.type !== 'project' || entry.childJobs.length > 0
    );
  }, [hideEmptyProjects, jobs, projects]
  );

  const { active: rawActive, parked: rawParked, archived: rawArchived } = useMemo(
    () => splitEntries(unifiedEntries),
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

  const filteredParked = useMemo(() => {
    let result = rawParked;
    if (parkplatzSearch) {
      result = result.filter((e) => matchesSearch(e, parkplatzSearch, clientMap));
    }
    result = applyDropdownFilters(result, parkplatzFilters, jobAssignmentMap);
    return sortUnifiedEntries(result, parkplatzSortCol, parkplatzSortDir, clientMap);
  }, [rawParked, parkplatzSearch, parkplatzFilters, parkplatzSortCol, parkplatzSortDir, clientMap, jobAssignmentMap]);

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

  const handleJobUpsert = useCallback((job: Job) => {
    setJobs((prev) => {
      const next = prev.filter((entry) => entry.id !== job.id);
      next.push(job);
      return next;
    });
  }, [setJobs]);

  const handleJobDelete = useCallback((jobId: string) => {
    setJobs((prev) => prev.filter((entry) => entry.id !== jobId));
    setJobAssignmentMap((prev) => {
      if (!prev[jobId]) return prev;
      const next = { ...prev };
      delete next[jobId];
      return next;
    });
  }, [setJobAssignmentMap, setJobs]);

  const handleProjectUpsert = useCallback((project: Project) => {
    setRawProjects((prev) => {
      const next = prev.filter((entry) => entry.id !== project.id);
      next.push(project);
      return next;
    });
  }, [setRawProjects]);

  const handleProjectDelete = useCallback((projectId: string) => {
    setRawProjects((prev) => prev.filter((entry) => entry.id !== projectId));
    setJobs((prev) =>
      prev.map((job) =>
        job.projectId === projectId ? { ...job, projectId: null } : job
      )
    );
  }, [setJobs, setRawProjects]);

  const handleJobAssignmentsReplace = useCallback((jobId: string, userIds: string[]) => {
    setJobAssignmentMap((prev) => ({
      ...prev,
      [jobId]: userIds,
    }));
  }, [setJobAssignmentMap]);

  const handleJobCreated = useCallback(
    ({ job, assignedUserIds }: { job: Job; assignedUserIds: string[] }) => {
      handleJobUpsert(job);
      handleJobAssignmentsReplace(job.id, assignedUserIds);
    },
    [handleJobAssignmentsReplace, handleJobUpsert]
  );

  const handleProjectCreated = useCallback(
    ({ project, linkedJobIds }: { project: Project; linkedJobIds: string[] }) => {
      handleProjectUpsert(project);
      if (linkedJobIds.length === 0) return;

      setJobs((prev) =>
        prev.map((job) =>
          linkedJobIds.includes(job.id)
            ? {
                ...job,
                projectId: project.id,
                clientId: project.clientId ?? job.clientId,
              }
            : job
        )
      );
    },
    [handleProjectUpsert, setJobs]
  );

  const handleJobEdited = useCallback(
    ({
      job,
      selectedEmployeeIds,
    }: {
      job: Job;
      selectedEmployeeIds?: string[];
    }) => {
      handleJobUpsert(job);
      if (selectedEmployeeIds) {
        handleJobAssignmentsReplace(job.id, selectedEmployeeIds);
      }
    },
    [handleJobAssignmentsReplace, handleJobUpsert]
  );

  const handleProjectEdited = useCallback(
    ({
      project,
      selectedJobIds,
    }: {
      project: Project;
      selectedJobIds?: string[];
    }) => {
      handleProjectUpsert(project);
      if (!selectedJobIds) return;

      setJobs((prev) =>
        prev.map((job) => {
          if (selectedJobIds.includes(job.id)) {
            return {
              ...job,
              projectId: project.id,
              clientId: project.clientId ?? job.clientId,
            };
          }

          if (job.projectId === project.id) {
            return {
              ...job,
              projectId: null,
            };
          }

          return job;
        })
      );
    },
    [handleProjectUpsert, setJobs]
  );

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

  const handleParkplatzSort = useCallback((col: SortColumn) => {
    if (col === parkplatzSortCol) {
      setParkplatzSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setParkplatzSortCol(col);
      setParkplatzSortDir('desc');
    }
  }, [parkplatzSortCol]);

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

  const createButton = isAdminOrManager ? (
    hideProjectCreation ? (
      <Button size="sm" className="gap-1.5" onClick={() => setCreateDialogOpen(true)}>
        <Plus className="size-3.5" />
        <span className="hidden sm:inline">Auftrag erstellen</span>
      </Button>
    ) : (
      <Button
        size="sm"
        className="gap-1.5"
        onClick={() => setCreateDialogOpen(true)}
      >
        <Plus className="size-3.5" />
        <span className="hidden sm:inline">Erstellen</span>
      </Button>
    )
  ) : null;

  const createDialogs = isAdminOrManager ? (
    <>
      {hideProjectCreation ? (
        <CreateJobDialog
          clients={dialogClients}
          members={dialogMembers}
          projects={dialogProjectOptions}
          defaultClientId={defaultClientId}
          defaultEmployeeIds={defaultEmployeeIds}
          readOnlyClient={readOnlyClient}
          open={createDialogOpen}
          onOpenChange={setCreateDialogOpen}
          onJobCreated={handleJobCreated}
        />
      ) : (
        <CreateAuftragProjectDialog
          clients={dialogClients}
          members={dialogMembers}
          projects={dialogProjectOptions}
          jobs={jobs}
          defaultClientId={defaultClientId}
          defaultEmployeeIds={defaultEmployeeIds}
          readOnlyClient={readOnlyClient}
          open={createDialogOpen}
          onOpenChange={setCreateDialogOpen}
          onJobCreated={handleJobCreated}
          onProjectCreated={handleProjectCreated}
        />
      )}
    </>
  ) : null;

  if (unifiedEntries.length === 0) {
    return (
      <>
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
            {isAdminOrManager && (
              <div className="mt-2">{createButton}</div>
            )}
          </div>
        </div>
        {createDialogs}
      </>
    );
  }

  return (
    <div className="space-y-4">
      {/* Active section */}
      <section>
        <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
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
        {createButton}
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
            jobAssignmentMap={jobAssignmentMap}
            members={members}
            hideClientColumn={hideClientColumn}
            clients={clients}
            onJobUpdated={handleJobEdited}
            onJobDeleted={handleJobDelete}
            onProjectUpdated={handleProjectEdited}
            onProjectDeleted={handleProjectDelete}
          />
        </div>
      </section>

      {/* Parkplatz section */}
      {rawParked.length > 0 && (
        <section>
          <button
            onClick={() => setParkplatzExpanded((v) => !v)}
            className="group mb-2 flex items-center gap-2"
          >
            <ChevronRight
              className={cn(
                'size-4 text-muted-foreground transition-transform duration-200',
                parkplatzExpanded && 'rotate-90'
              )}
            />
            <span className="text-sm font-semibold text-muted-foreground transition-colors group-hover:text-foreground">
              Parkplatz
            </span>
            <span className="text-xs tabular-nums text-muted-foreground/70">
              ({rawParked.length})
            </span>
          </button>

          {parkplatzExpanded && (
            <div className="space-y-2">
              <FilterBar
                searchQuery={parkplatzSearch}
                onSearchChange={setParkplatzSearch}
                filters={parkplatzFilters}
                onFiltersChange={setParkplatzFilters}
                clients={clients}
                members={members}
                lockedEmployeeLabel={lockedEmployeeLabel}
                lockedClientLabel={lockedClientLabel}
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
                hideClientColumn={hideClientColumn}
                clients={clients}
                onJobUpdated={handleJobEdited}
                onJobDeleted={handleJobDelete}
                onProjectUpdated={handleProjectEdited}
                onProjectDeleted={handleProjectDelete}
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
                jobAssignmentMap={jobAssignmentMap}
                members={members}
                hideClientColumn={hideClientColumn}
                clients={clients}
                onJobUpdated={handleJobEdited}
                onJobDeleted={handleJobDelete}
                onProjectUpdated={handleProjectEdited}
                onProjectDeleted={handleProjectDelete}
              />
            </div>
          )}
        </section>
      )}
      {createDialogs}
    </div>
  );
}
