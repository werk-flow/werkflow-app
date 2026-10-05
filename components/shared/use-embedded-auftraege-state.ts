'use client';

import { useState, useMemo, useCallback } from 'react';

import {
  buildUnifiedList,
  splitEntries,
  matchesSearch,
  sortUnifiedEntries,
  getEntryUnifiedStatus,
  EMPTY_FILTER_STATE,
  type Job,
  type Client,
  type ProjectWithDetails,
  type FilterState,
  type SortColumn,
} from '@/lib/jobs/types';
import { resolveAuftraegeSortColumn, type AuftraegeColumnId } from '@/lib/jobs/auftraege-table-columns';
import { applyDropdownFilters } from '@/lib/jobs/dropdown-filters';
import { useLiveAuftraegeData } from '@/hooks/use-live-auftraege-data';

export type ActiveStatusFilter = 'alle' | 'not_started' | 'in_progress' | 'interrupted';

interface EmbeddedAuftraegeEntriesInput {
  initialJobs: Job[];
  initialProjects: ProjectWithDetails[];
  supportProjects: ProjectWithDetails[] | undefined;
  clientMap: Record<string, string>;
  initialJobAssignmentMap: Record<string, string[]>;
  clients: Client[];
  allProjectsForJobCreation: ProjectWithDetails[] | undefined;
  hideEmptyProjects: boolean;
  visibleColumns: AuftraegeColumnId[];
}

/** Status chip, search, filter, sort and expansion state of the active, Parkplatz and Archiv sections. */
export function useEmbeddedAuftraegeListState() {
  const [activeStatusFilter, setActiveStatusFilter] = useState<ActiveStatusFilter>('alle');
  const [activeSearch, setActiveSearch] = useState('');
  const [activeFilters, setActiveFilters] = useState<FilterState>(EMPTY_FILTER_STATE);
  const [activeSortCol, setActiveSortCol] = useState<SortColumn>('datum');
  const [activeSortDir, setActiveSortDir] = useState<'asc' | 'desc'>('desc');

  const [parkplatzExpanded, setParkplatzExpanded] = useState(true);
  const [parkplatzSearch, setParkplatzSearch] = useState('');
  const [parkplatzFilters, setParkplatzFilters] = useState<FilterState>(EMPTY_FILTER_STATE);
  const [parkplatzSortCol, setParkplatzSortCol] = useState<SortColumn>('datum');
  const [parkplatzSortDir, setParkplatzSortDir] = useState<'asc' | 'desc'>('desc');

  const [archiveExpanded, setArchiveExpanded] = useState(false);
  const [archiveSearch, setArchiveSearch] = useState('');
  const [archiveFilters, setArchiveFilters] = useState<FilterState>(EMPTY_FILTER_STATE);
  const [archiveSortCol, setArchiveSortCol] = useState<SortColumn>('datum');
  const [archiveSortDir, setArchiveSortDir] = useState<'asc' | 'desc'>('desc');

  return {
    activeStatusFilter,
    setActiveStatusFilter,
    activeSearch,
    setActiveSearch,
    activeFilters,
    setActiveFilters,
    activeSortCol,
    setActiveSortCol,
    activeSortDir,
    setActiveSortDir,
    parkplatzExpanded,
    setParkplatzExpanded,
    parkplatzSearch,
    setParkplatzSearch,
    parkplatzFilters,
    setParkplatzFilters,
    parkplatzSortCol,
    setParkplatzSortCol,
    parkplatzSortDir,
    setParkplatzSortDir,
    archiveExpanded,
    setArchiveExpanded,
    archiveSearch,
    setArchiveSearch,
    archiveFilters,
    setArchiveFilters,
    archiveSortCol,
    setArchiveSortCol,
    archiveSortDir,
    setArchiveSortDir,
  };
}

export type EmbeddedAuftraegeListState = ReturnType<typeof useEmbeddedAuftraegeListState>;

/** Live entries filtered and sorted per section, plus the project options of the create dialogs. */
export function useEmbeddedAuftraegeEntries(
  listState: EmbeddedAuftraegeListState,
  {
    initialJobs,
    initialProjects,
    supportProjects,
    clientMap,
    initialJobAssignmentMap,
    clients,
    allProjectsForJobCreation,
    hideEmptyProjects,
    visibleColumns,
  }: EmbeddedAuftraegeEntriesInput,
) {
  const {
    activeStatusFilter,
    activeSearch,
    activeFilters,
    activeSortCol,
    activeSortDir,
    parkplatzSearch,
    parkplatzFilters,
    parkplatzSortCol,
    parkplatzSortDir,
    archiveSearch,
    archiveFilters,
    archiveSortCol,
    archiveSortDir,
  } = listState;
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const { jobs, setJobs, setRawProjects, projects, jobAssignmentMap, setJobAssignmentMap } =
    useLiveAuftraegeData({
      initialJobs,
      initialProjects,
      supportProjects,
      initialJobAssignmentMap,
      clients,
    });

  const dialogProjectOptions = allProjectsForJobCreation ?? projects;

  const unifiedEntries = useMemo(() => {
    const entries = buildUnifiedList(jobs, projects);
    if (!hideEmptyProjects) return entries;

    return entries.filter((entry) => entry.type !== 'project' || entry.childJobs.length > 0);
  }, [hideEmptyProjects, jobs, projects]);

  const {
    active: rawActive,
    parked: rawParked,
    archived: rawArchived,
  } = useMemo(() => splitEntries(unifiedEntries), [unifiedEntries]);

  const activeStatusCounts = useMemo(() => {
    const counts: Record<string, number> = { alle: rawActive.length };
    for (const entry of rawActive) {
      const status = getEntryUnifiedStatus(entry);
      counts[status] = (counts[status] || 0) + 1;
    }
    return counts;
  }, [rawActive]);

  const filteredActive = useMemo(() => {
    const effectiveSortColumn = resolveAuftraegeSortColumn(activeSortCol, visibleColumns);
    let result = rawActive;
    if (activeStatusFilter !== 'alle') {
      result = result.filter((e) => getEntryUnifiedStatus(e) === activeStatusFilter);
    }
    if (activeSearch) {
      result = result.filter((e) => matchesSearch(e, activeSearch, clientMap));
    }
    result = applyDropdownFilters(result, activeFilters, jobAssignmentMap);
    return sortUnifiedEntries(result, effectiveSortColumn, activeSortDir, clientMap);
  }, [
    rawActive,
    activeStatusFilter,
    activeSearch,
    activeFilters,
    activeSortCol,
    activeSortDir,
    clientMap,
    jobAssignmentMap,
    visibleColumns,
  ]);

  const filteredParked = useMemo(() => {
    const effectiveSortColumn = resolveAuftraegeSortColumn(parkplatzSortCol, visibleColumns);
    let result = rawParked;
    if (parkplatzSearch) {
      result = result.filter((e) => matchesSearch(e, parkplatzSearch, clientMap));
    }
    result = applyDropdownFilters(result, parkplatzFilters, jobAssignmentMap);
    return sortUnifiedEntries(result, effectiveSortColumn, parkplatzSortDir, clientMap);
  }, [
    rawParked,
    parkplatzSearch,
    parkplatzFilters,
    parkplatzSortCol,
    parkplatzSortDir,
    clientMap,
    jobAssignmentMap,
    visibleColumns,
  ]);

  const filteredArchived = useMemo(() => {
    const effectiveSortColumn = resolveAuftraegeSortColumn(archiveSortCol, visibleColumns);
    let result = rawArchived;
    if (archiveSearch) {
      result = result.filter((e) => matchesSearch(e, archiveSearch, clientMap));
    }
    result = applyDropdownFilters(result, archiveFilters, jobAssignmentMap);
    return sortUnifiedEntries(result, effectiveSortColumn, archiveSortDir, clientMap);
  }, [
    rawArchived,
    archiveSearch,
    archiveFilters,
    archiveSortCol,
    archiveSortDir,
    clientMap,
    jobAssignmentMap,
    visibleColumns,
  ]);

  return {
    createDialogOpen,
    setCreateDialogOpen,
    dialogProjectOptions,
    jobs,
    setJobs,
    setRawProjects,
    jobAssignmentMap,
    setJobAssignmentMap,
    unifiedEntries,
    rawParked,
    rawArchived,
    activeStatusCounts,
    filteredActive,
    filteredParked,
    filteredArchived,
  };
}

/** Column sort toggles; the three sections keep their historically different direction defaults. */
export function useEmbeddedAuftraegeSortHandlers(state: EmbeddedAuftraegeListState) {
  const { activeSortCol, setActiveSortCol, setActiveSortDir } = state;
  const { parkplatzSortCol, setParkplatzSortCol, setParkplatzSortDir } = state;
  const { archiveSortCol, setArchiveSortCol, setArchiveSortDir } = state;

  const handleActiveSort = useCallback(
    (col: SortColumn) => {
      if (col === activeSortCol) {
        setActiveSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      } else {
        setActiveSortCol(col);
        setActiveSortDir('asc');
      }
    },
    [activeSortCol, setActiveSortCol, setActiveSortDir],
  );

  const handleParkplatzSort = useCallback(
    (col: SortColumn) => {
      if (col === parkplatzSortCol) {
        setParkplatzSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      } else {
        setParkplatzSortCol(col);
        setParkplatzSortDir('desc');
      }
    },
    [parkplatzSortCol, setParkplatzSortCol, setParkplatzSortDir],
  );

  const handleArchiveSort = useCallback(
    (col: SortColumn) => {
      if (col === archiveSortCol) {
        setArchiveSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      } else {
        setArchiveSortCol(col);
        setArchiveSortDir('desc');
      }
    },
    [archiveSortCol, setArchiveSortCol, setArchiveSortDir],
  );

  return { handleActiveSort, handleParkplatzSort, handleArchiveSort };
}
