import { WORK_EXECUTION_LABELS, type WorkExecutionState } from '@/lib/work-lifecycle/types';
import {
  getEffectiveProjectStatusFromCounts,
  getJobDisplayTitle,
  getProjectDisplayTitle,
  type Job,
  type ProjectWithDetails,
} from './types';

// The Aufträge list model: standalone jobs and projects as one list, split
// into active, parked and archived, searched, sorted and filtered.

// ============================================
// Unified List Types (Combined View)
// ============================================

export type UnifiedListEntry =
  | { type: 'standalone-job'; job: Job }
  | { type: 'project'; project: ProjectWithDetails; childJobs: Job[] };

export type UnifiedStatus = WorkExecutionState | 'parked';

export const UNIFIED_STATUS_LABELS: Record<UnifiedStatus, string> = {
  ...WORK_EXECUTION_LABELS,
  parked: 'Geparkt',
};

/**
 * Map a Job's status to the abstract unified status used for filtering.
 */
function getJobUnifiedStatus(job: Pick<Job, 'status' | 'executionState'>): UnifiedStatus {
  if (job.status === 'geparkt') return 'parked';
  if (job.executionState) return job.executionState;
  switch (job.status) {
    case 'nicht_bearbeitet':
      return 'not_started';
    case 'in_bearbeitung':
      return 'in_progress';
    case 'fertig':
      return 'execution_complete';
    default:
      throw new Error(`Unexpected job status: ${String(job.status)}`);
  }
}

/**
 * Map a ProjectWithDetails' effective status to the abstract unified status.
 */
function getProjectUnifiedStatus(project: ProjectWithDetails): UnifiedStatus {
  if (project.statusOverride === 'geparkt') return 'parked';
  if (project.executionStateOverride) return project.executionStateOverride;
  const effective = project.statusOverride ?? getEffectiveProjectStatusFromCounts(project);
  switch (effective) {
    case 'nicht_begonnen':
      return 'not_started';
    case 'in_bearbeitung':
      return 'in_progress';
    case 'abgeschlossen':
      return 'execution_complete';
    case 'geparkt':
      return 'parked';
    default:
      throw new Error(`Unexpected project status: ${String(effective)}`);
  }
}

/**
 * Get the unified status for any list entry (standalone job or project).
 */
export function getEntryUnifiedStatus(entry: UnifiedListEntry): UnifiedStatus {
  return entry.type === 'standalone-job'
    ? getJobUnifiedStatus(entry.job)
    : getProjectUnifiedStatus(entry.project);
}

/**
 * Build the sorted unified list from raw jobs and projects arrays.
 * Standalone jobs (no projectId) and projects become top-level entries.
 * Jobs with a projectId are nested under their project.
 */
export function buildUnifiedList(jobs: Job[], projects: ProjectWithDetails[]): UnifiedListEntry[] {
  const jobsByProject = new Map<string, Job[]>();
  const standaloneJobs: Job[] = [];

  for (const job of jobs) {
    if (job.projectId) {
      const list = jobsByProject.get(job.projectId);
      if (list) list.push(job);
      else jobsByProject.set(job.projectId, [job]);
    } else {
      standaloneJobs.push(job);
    }
  }

  const entries: UnifiedListEntry[] = [];

  for (const job of standaloneJobs) {
    entries.push({ type: 'standalone-job', job });
  }

  const matchedProjectIds = new Set<string>();
  for (const project of projects) {
    const childJobs = jobsByProject.get(project.id) ?? [];
    matchedProjectIds.add(project.id);
    entries.push({ type: 'project', project, childJobs });
  }

  // If the local project graph is temporarily incomplete, still show the job
  // instead of dropping it from the UI entirely.
  for (const [projectId, childJobs] of jobsByProject.entries()) {
    if (matchedProjectIds.has(projectId)) continue;
    for (const job of childJobs) {
      entries.push({ type: 'standalone-job', job });
    }
  }

  entries.sort((a, b) => {
    const dateA = getEntryDate(a);
    const dateB = getEntryDate(b);
    if (!dateA && !dateB) return 0;
    if (!dateA) return 1;
    if (!dateB) return -1;
    return dateA.getTime() - dateB.getTime();
  });

  return entries;
}

// ============================================
// Archive / Parkplatz Split
// ============================================

function isArchivedEntry(entry: UnifiedListEntry): boolean {
  return ['execution_complete', 'handed_over', 'cancelled'].includes(getEntryUnifiedStatus(entry));
}

function isParkedEntry(entry: UnifiedListEntry): boolean {
  return getEntryUnifiedStatus(entry) === 'parked';
}

export function splitEntries(entries: UnifiedListEntry[]): {
  active: UnifiedListEntry[];
  parked: UnifiedListEntry[];
  archived: UnifiedListEntry[];
} {
  const active: UnifiedListEntry[] = [];
  const parked: UnifiedListEntry[] = [];
  const archived: UnifiedListEntry[] = [];
  for (const entry of entries) {
    if (isArchivedEntry(entry)) {
      archived.push(entry);
    } else if (isParkedEntry(entry)) {
      parked.push(entry);
    } else {
      active.push(entry);
    }
  }
  return { active, parked, archived };
}

// ============================================
// Search Matching
// ============================================

export function matchesSearch(
  entry: UnifiedListEntry,
  query: string,
  clientMap: Record<string, string>,
): boolean {
  if (!query) return true;
  const q = query.toLowerCase();

  if (entry.type === 'standalone-job') {
    const j = entry.job;
    return (
      j.title.toLowerCase().includes(q) ||
      (j.jobNumber?.toLowerCase().includes(q) ?? false) ||
      (j.description?.toLowerCase().includes(q) ?? false) ||
      (j.location?.toLowerCase().includes(q) ?? false) ||
      (j.clientId ? (clientMap[j.clientId] ?? '').toLowerCase().includes(q) : false)
    );
  }

  const p = entry.project;
  const projectMatches =
    p.name.toLowerCase().includes(q) ||
    (p.projectNumber?.toLowerCase().includes(q) ?? false) ||
    (p.description?.toLowerCase().includes(q) ?? false) ||
    (p.clientId ? (clientMap[p.clientId] ?? '').toLowerCase().includes(q) : false);

  if (projectMatches) return true;

  return entry.childJobs.some(
    (j) =>
      j.title.toLowerCase().includes(q) ||
      (j.jobNumber?.toLowerCase().includes(q) ?? false) ||
      (j.description?.toLowerCase().includes(q) ?? false) ||
      (j.location?.toLowerCase().includes(q) ?? false),
  );
}

// ============================================
// Sorting
// ============================================

export type SortColumn = 'nr' | 'bezeichnung' | 'kunde' | 'status' | 'prioritaet' | 'datum';

export function sortUnifiedEntries(
  entries: UnifiedListEntry[],
  column: SortColumn,
  direction: 'asc' | 'desc',
  clientMap: Record<string, string>,
): UnifiedListEntry[] {
  const sorted = [...entries];
  const dir = direction === 'asc' ? 1 : -1;

  sorted.sort((a, b) => {
    const valA = getSortValue(a, column, clientMap);
    const valB = getSortValue(b, column, clientMap);

    if (valA === valB) return 0;
    if (valA === null || valA === undefined) return 1;
    if (valB === null || valB === undefined) return -1;

    if (typeof valA === 'string' && typeof valB === 'string') {
      return valA.localeCompare(valB, 'de') * dir;
    }
    if (typeof valA === 'number' && typeof valB === 'number') {
      return (valA - valB) * dir;
    }
    return 0;
  });

  return sorted;
}

const STATUS_SORT_ORDER: Record<string, number> = {
  nicht_bearbeitet: 0,
  nicht_begonnen: 0,
  in_bearbeitung: 1,
  fertig: 2,
  abgeschlossen: 2,
  geparkt: 3,
};

const PRIORITY_SORT_ORDER: Record<string, number> = {
  niedrig: 0,
  mittel: 1,
  hoch: 2,
};

function getSortValue(
  entry: UnifiedListEntry,
  column: SortColumn,
  clientMap: Record<string, string>,
): string | number | null {
  if (entry.type === 'standalone-job') {
    const j = entry.job;
    switch (column) {
      case 'nr':
        return j.jobNumber ?? '';
      case 'bezeichnung':
        return getJobDisplayTitle(j);
      case 'kunde':
        return j.clientId ? (clientMap[j.clientId] ?? '') : '';
      case 'status':
        return STATUS_SORT_ORDER[j.status] ?? 0;
      case 'prioritaet':
        return PRIORITY_SORT_ORDER[j.priority] ?? 0;
      case 'datum':
        return j.plannedDate ?? null;
    }
  }
  const p = entry.project;
  switch (column) {
    case 'nr':
      return p.projectNumber ?? '';
    case 'bezeichnung':
      return getProjectDisplayTitle(p);
    case 'kunde':
      return p.clientId ? (clientMap[p.clientId] ?? '') : '';
    case 'status': {
      const eff = p.statusOverride ?? getEffectiveProjectStatusFromCounts(p);
      return STATUS_SORT_ORDER[eff] ?? 0;
    }
    case 'prioritaet':
      return -1;
    case 'datum':
      return p.plannedStartDate ?? null;
  }
}

// ============================================
// Filter Types
// ============================================

export type EntryTypeFilter = 'alle' | 'jobs' | 'projekte';

export interface FilterState {
  clientIds: string[];
  employeeIds: string[];
  dateFrom: string;
  dateTo: string;
  entryType: EntryTypeFilter;
}

export const EMPTY_FILTER_STATE: FilterState = {
  clientIds: [],
  employeeIds: [],
  dateFrom: '',
  dateTo: '',
  entryType: 'alle',
};

export function countActiveFilters(state: FilterState): number {
  let count = 0;
  if (state.clientIds.length > 0) count++;
  if (state.employeeIds.length > 0) count++;
  if (state.dateFrom || state.dateTo) count++;
  if (state.entryType !== 'alle') count++;
  return count;
}

function getEntryDate(entry: UnifiedListEntry): Date | null {
  if (entry.type === 'standalone-job') {
    return entry.job.plannedDate ? new Date(entry.job.plannedDate) : null;
  }
  if (entry.project.plannedStartDate) {
    return new Date(entry.project.plannedStartDate);
  }
  const earliest = entry.childJobs
    .filter((j) => j.plannedDate)
    .sort((a, b) => (a.plannedDate ?? '').localeCompare(b.plannedDate ?? ''))[0];
  return earliest?.plannedDate ? new Date(earliest.plannedDate) : null;
}
