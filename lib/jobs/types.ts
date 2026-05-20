import type { Database } from '@/lib/supabase/database.types';

// ============================================
// Database Row / Insert / Update Aliases
// ============================================

export type ClientRow = Database['public']['Tables']['clients']['Row'];
export type ClientInsert = Database['public']['Tables']['clients']['Insert'];
export type ClientUpdate = Database['public']['Tables']['clients']['Update'];

export type ProjectRow = Database['public']['Tables']['projects']['Row'];
export type ProjectInsert = Database['public']['Tables']['projects']['Insert'];
export type ProjectUpdate = Database['public']['Tables']['projects']['Update'];

export type JobRow = Database['public']['Tables']['jobs']['Row'];
export type JobInsert = Database['public']['Tables']['jobs']['Insert'];
export type JobUpdate = Database['public']['Tables']['jobs']['Update'];

export type JobAssignmentRow =
  Database['public']['Tables']['job_assignments']['Row'];
export type JobAssignmentInsert =
  Database['public']['Tables']['job_assignments']['Insert'];
export type JobAssignmentUpdate =
  Database['public']['Tables']['job_assignments']['Update'];

export type JobInstructionItemRow =
  Database['public']['Tables']['job_instruction_items']['Row'];
export type JobInstructionItemInsert =
  Database['public']['Tables']['job_instruction_items']['Insert'];
export type JobInstructionItemUpdate =
  Database['public']['Tables']['job_instruction_items']['Update'];

// ============================================
// Enum Types
// ============================================

export type ClientType = Database['public']['Enums']['client_type'];
export type JobStatus = Database['public']['Enums']['job_status'];
export type JobPriority = Database['public']['Enums']['job_priority'];
export type ProjectStatus = Database['public']['Enums']['project_status'];
export type OrgRole = Database['public']['Enums']['org_role'];

// ============================================
// Application-Level Types (camelCase)
// ============================================

export type Client = {
  id: string;
  organizationId: string;
  name: string;
  clientType: ClientType;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Project = {
  id: string;
  organizationId: string;
  clientId: string | null;
  name: string;
  description: string | null;
  projectNumber: string | null;
  statusOverride: ProjectStatus | null;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type Job = {
  id: string;
  organizationId: string;
  projectId: string | null;
  clientId: string | null;
  jobNumber: string | null;
  title: string;
  description: string | null;
  status: JobStatus;
  priority: JobPriority;
  plannedDate: string | null;
  plannedTime: string | null;
  estimatedDurationMinutes: number | null;
  plannedWorkingMinutes: number | null;
  actualCompletionDate: string | null;
  location: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type JobAssignment = {
  id: string;
  jobId: string;
  userId: string;
  assignedBy: string;
  assignedAt: string;
};

export type JobInstructionActor = {
  userId: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  avatarPath: string | null;
};

export type JobInstructionItem = {
  id: string;
  organizationId: string;
  jobId: string;
  content: string;
  sortOrder: number;
  isCompleted: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  lastStatusChangedBy: string | null;
  lastStatusChangedAt: string | null;
};

// ============================================
// Extended Types (with joined data)
// ============================================

export type JobWithDetails = Job & {
  assignments: JobAssignmentWithProfile[];
  client: Client | null;
  project: Pick<Project, 'id' | 'name' | 'projectNumber'> | null;
};

export type JobAssignmentWithProfile = JobAssignment & {
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  avatarPath: string | null;
};

export type ProjectWithDetails = Project & {
  client: Client | null;
  jobCount: number;
  completedJobCount: number;
  inProgressJobCount: number;
  parkedJobCount: number;
};

export type JobInstructionItemWithDetails = JobInstructionItem & {
  creator: JobInstructionActor | null;
  lastStatusChangedByProfile: JobInstructionActor | null;
};

/**
 * Derived project status based on child jobs.
 * Used when `statusOverride` is NULL.
 */
export type DerivedProjectStatus = {
  status: ProjectStatus;
  progress: number;
  trafficLight: 'green' | 'yellow' | 'red';
};

// ============================================
// Calendar Integration Types
// ============================================

export type CalendarJob = {
  id: string;
  jobNumber: string | null;
  title: string;
  status: JobStatus;
  priority: JobPriority;
  plannedDate: string | null;
  plannedTime: string | null;
  estimatedDurationMinutes: number | null;
  plannedWorkingMinutes: number | null;
  location: string | null;
  clientName: string | null;
  clientAddress: string | null;
  projectName: string | null;
  projectNumber: string | null;
  assignedUserIds: string[];
};

// ============================================
// Result Types
// ============================================

export type CreateClientResult =
  | { success: true; client: Client }
  | { success: false; error: string };

export type UpdateClientResult =
  | { success: true; client: Client }
  | { success: false; error: string };

export type DeleteClientResult =
  | { success: true }
  | { success: false; error: string };

export type CreateJobResult =
  | { success: true; job: Job }
  | { success: false; error: string };

export type UpdateJobResult =
  | { success: true; job: Job }
  | { success: false; error: string };

export type DeleteJobResult =
  | { success: true }
  | { success: false; error: string };

export type CreateProjectResult =
  | { success: true; project: Project }
  | { success: false; error: string };

export type UpdateProjectResult =
  | { success: true; project: Project }
  | { success: false; error: string };

export type DeleteProjectResult =
  | { success: true }
  | { success: false; error: string };

export type AssignEmployeeResult =
  | { success: true; assignment: JobAssignment }
  | { success: false; error: string };

export type UnassignEmployeeResult =
  | { success: true }
  | { success: false; error: string };

export type GetJobInstructionItemsResult =
  | { success: true; items: JobInstructionItemWithDetails[] }
  | { success: false; error: string };

export type CreateJobInstructionItemResult =
  | { success: true; item: JobInstructionItemWithDetails }
  | { success: false; error: string };

export type UpdateJobInstructionItemResult =
  | { success: true; item: JobInstructionItemWithDetails }
  | { success: false; error: string };

export type DeleteJobInstructionItemResult =
  | { success: true }
  | { success: false; error: string };

export type ToggleJobInstructionItemCompletionResult =
  | { success: true; item: JobInstructionItemWithDetails }
  | { success: false; error: string };

export type ReorderJobInstructionItemsResult =
  | { success: true }
  | { success: false; error: string };

// ============================================
// Converter Functions
// ============================================

export function toClient(row: ClientRow): Client {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    clientType: row.client_type,
    email: row.email,
    phone: row.phone,
    address: row.address,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    organizationId: row.organization_id,
    clientId: row.client_id,
    name: row.name,
    description: row.description,
    projectNumber: row.project_number,
    statusOverride: row.status_override,
    plannedStartDate: row.planned_start_date,
    plannedEndDate: row.planned_end_date,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function normalizeJobPlannedTime(
  plannedTime: string | null | undefined
): string | null {
  if (!plannedTime) return null;

  const trimmed = plannedTime.trim();
  if (!trimmed) return null;

  const [hours = '', minutes = ''] = trimmed.split(':');
  if (!hours || !minutes) {
    return trimmed;
  }

  return `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}`;
}

export function toJob(row: JobRow): Job {
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    clientId: row.client_id,
    jobNumber: row.job_number,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    plannedDate: row.planned_date,
    plannedTime: normalizeJobPlannedTime(row.planned_time),
    estimatedDurationMinutes: row.estimated_duration_minutes,
    plannedWorkingMinutes: row.planned_working_minutes,
    actualCompletionDate: row.actual_completion_date,
    location: row.location,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getJobDisplayTitle(
  job: Pick<Job, 'title' | 'description'>
): string {
  const title = job.title.trim();
  if (title) return title;

  const description = job.description?.trim();
  return description || '—';
}

export function getProjectDisplayTitle(
  project: Pick<Project, 'name' | 'description'>
): string {
  const title = project.name.trim();
  if (title) return title;

  const description = project.description?.trim();
  return description || '—';
}

export function toJobAssignment(row: JobAssignmentRow): JobAssignment {
  return {
    id: row.id,
    jobId: row.job_id,
    userId: row.user_id,
    assignedBy: row.assigned_by,
    assignedAt: row.assigned_at,
  };
}

export function toJobInstructionItem(
  row: JobInstructionItemRow
): JobInstructionItem {
  return {
    id: row.id,
    organizationId: row.organization_id,
    jobId: row.job_id,
    content: row.content,
    sortOrder: row.sort_order,
    isCompleted: row.is_completed,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastStatusChangedBy: row.last_status_changed_by,
    lastStatusChangedAt: row.last_status_changed_at,
  };
}

// ============================================
// Display Labels (German UI)
// ============================================

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  nicht_bearbeitet: 'Nicht bearbeitet',
  in_bearbeitung: 'In Bearbeitung',
  fertig: 'Fertig',
  geparkt: 'Geparkt',
};

export const JOB_PRIORITY_LABELS: Record<JobPriority, string> = {
  niedrig: 'Niedrig',
  mittel: 'Mittel',
  hoch: 'Hoch',
};

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  nicht_begonnen: 'Nicht begonnen',
  in_bearbeitung: 'In Bearbeitung',
  abgeschlossen: 'Abgeschlossen',
  geparkt: 'Geparkt',
};

export const CLIENT_TYPE_LABELS: Record<ClientType, string> = {
  privat: 'Privat',
  gewerblich: 'Gewerblich',
};

// ============================================
// Unified List Types (Combined View)
// ============================================

export type UnifiedListEntry =
  | { type: 'standalone-job'; job: Job }
  | { type: 'project'; project: ProjectWithDetails; childJobs: Job[] };

export type UnifiedStatus = 'offen' | 'in_bearbeitung' | 'abgeschlossen' | 'geparkt';

export const UNIFIED_STATUS_LABELS: Record<UnifiedStatus, string> = {
  offen: 'Offen',
  in_bearbeitung: 'In Bearbeitung',
  abgeschlossen: 'Abgeschlossen',
  geparkt: 'Geparkt',
};

// ============================================
// Constants
// ============================================

export const MANAGER_ROLES: OrgRole[] = ['admin', 'buero'];

export const JOB_STATUS_ORDER: JobStatus[] = [
  'nicht_bearbeitet',
  'in_bearbeitung',
  'fertig',
  'geparkt',
];

export const JOB_PRIORITY_ORDER: JobPriority[] = [
  'niedrig',
  'mittel',
  'hoch',
];

export const PROJECT_STATUS_ORDER: ProjectStatus[] = [
  'nicht_begonnen',
  'in_bearbeitung',
  'abgeschlossen',
  'geparkt',
];

// ============================================
// Utility Functions
// ============================================

/**
 * Derive a project's status from its child jobs.
 * Returns `nicht_begonnen` if no jobs, `abgeschlossen` if all done,
 * `in_bearbeitung` if any are in progress or completed.
 */
export function deriveProjectStatus(jobs: Pick<Job, 'status'>[]): ProjectStatus {
  if (jobs.length === 0) return 'nicht_begonnen';

  const allParked = jobs.every((j) => j.status === 'geparkt');
  if (allParked) return 'geparkt';

  const allDone = jobs.every((j) => j.status === 'fertig');
  if (allDone) return 'abgeschlossen';

  const anyStarted = jobs.some(
    (j) => j.status === 'in_bearbeitung' || j.status === 'fertig'
  );
  if (anyStarted) return 'in_bearbeitung';

  return 'nicht_begonnen';
}

/**
 * Compute the effective status of a project, respecting the manual override.
 */
export function getEffectiveProjectStatus(
  project: Pick<Project, 'statusOverride'>,
  jobs: Pick<Job, 'status'>[]
): ProjectStatus {
  return project.statusOverride ?? deriveProjectStatus(jobs);
}

/**
 * Calculate project progress as a percentage (0-100).
 */
export function calculateProjectProgress(
  jobs: Pick<Job, 'status'>[]
): number {
  if (jobs.length === 0) return 0;
  const completed = jobs.filter((j) => j.status === 'fertig').length;
  return Math.round((completed / jobs.length) * 100);
}

/**
 * Determine the traffic light color for a project based on job completions vs. planned end date.
 * Green: all jobs done, OR no planned end date, OR still before planned end date
 * Yellow: not all done AND on/past planned end date (within 1 week)
 * Red: not all done AND more than 1 week past planned end date
 */
export function calculateTrafficLight(
  project: Pick<Project, 'plannedStartDate' | 'plannedEndDate'>,
  jobs: Pick<Job, 'status'>[]
): 'green' | 'yellow' | 'red' {
  if (jobs.length === 0) return 'green';

  const allDone = jobs.every((j) => j.status === 'fertig');
  if (allDone) return 'green';
  if (!project.plannedEndDate) return 'green';

  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const end = new Date(project.plannedEndDate);
  end.setHours(0, 0, 0, 0);

  if (now.getTime() < end.getTime()) return 'green';

  const msPerDay = 1000 * 60 * 60 * 24;
  const daysOverdue = (now.getTime() - end.getTime()) / msPerDay;

  if (daysOverdue > 7) return 'red';
  return 'yellow';
}

/**
 * Traffic light variant that works with aggregate counts from ProjectWithDetails,
 * avoiding the need to load the full jobs array for list views.
 * Green: all done, OR no planned end date, OR still before planned end date
 * Yellow: not all done AND on/past planned end date (within 1 week)
 * Red: not all done AND more than 1 week past planned end date
 */
export function calculateTrafficLightFromCounts(
  project: Pick<Project, 'plannedStartDate' | 'plannedEndDate'>,
  jobCount: number,
  completedJobCount: number
): 'green' | 'yellow' | 'red' {
  if (jobCount === 0) return 'green';

  const allDone = completedJobCount >= jobCount;
  if (allDone) return 'green';
  if (!project.plannedEndDate) return 'green';

  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const end = new Date(project.plannedEndDate);
  end.setHours(0, 0, 0, 0);

  if (now.getTime() < end.getTime()) return 'green';

  const msPerDay = 1000 * 60 * 60 * 24;
  const daysOverdue = (now.getTime() - end.getTime()) / msPerDay;

  if (daysOverdue > 7) return 'red';
  return 'yellow';
}

/**
 * Map a Job's status to the abstract unified status used for filtering.
 */
export function getJobUnifiedStatus(job: Pick<Job, 'status'>): UnifiedStatus {
  switch (job.status) {
    case 'nicht_bearbeitet': return 'offen';
    case 'in_bearbeitung': return 'in_bearbeitung';
    case 'fertig': return 'abgeschlossen';
    case 'geparkt': return 'geparkt';
  }
}

/**
 * Map a ProjectWithDetails' effective status to the abstract unified status.
 */
export function getProjectUnifiedStatus(project: ProjectWithDetails): UnifiedStatus {
  const effective = project.statusOverride ?? getEffectiveProjectStatusFromCounts(project);
  switch (effective) {
    case 'nicht_begonnen': return 'offen';
    case 'in_bearbeitung': return 'in_bearbeitung';
    case 'abgeschlossen': return 'abgeschlossen';
    case 'geparkt': return 'geparkt';
  }
}

/**
 * Derive effective project status from aggregate counts (avoids needing the jobs array).
 */
export function getEffectiveProjectStatusFromCounts(
  project: Pick<ProjectWithDetails, 'jobCount' | 'completedJobCount' | 'inProgressJobCount' | 'parkedJobCount'>
): ProjectStatus {
  if (project.jobCount === 0) return 'nicht_begonnen';
  if (project.parkedJobCount === project.jobCount) return 'geparkt';
  if (project.completedJobCount === project.jobCount) return 'abgeschlossen';
  if (project.completedJobCount > 0 || project.inProgressJobCount > 0) return 'in_bearbeitung';
  return 'nicht_begonnen';
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
export function buildUnifiedList(
  jobs: Job[],
  projects: ProjectWithDetails[]
): UnifiedListEntry[] {
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
  if (entry.type === 'standalone-job') {
    return entry.job.status === 'fertig';
  }
  const effective =
    entry.project.statusOverride ??
    getEffectiveProjectStatusFromCounts(entry.project);
  return effective === 'abgeschlossen';
}

function isParkedEntry(entry: UnifiedListEntry): boolean {
  if (entry.type === 'standalone-job') {
    return entry.job.status === 'geparkt';
  }
  const effective =
    entry.project.statusOverride ??
    getEffectiveProjectStatusFromCounts(entry.project);
  return effective === 'geparkt';
}

export function splitActiveAndArchived(
  entries: UnifiedListEntry[]
): { active: UnifiedListEntry[]; archived: UnifiedListEntry[] } {
  const active: UnifiedListEntry[] = [];
  const archived: UnifiedListEntry[] = [];
  for (const entry of entries) {
    if (isArchivedEntry(entry)) archived.push(entry);
    else active.push(entry);
  }
  return { active, archived };
}

export function splitEntries(
  entries: UnifiedListEntry[]
): { active: UnifiedListEntry[]; parked: UnifiedListEntry[]; archived: UnifiedListEntry[] } {
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
  clientMap: Record<string, string>
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
      (j.location?.toLowerCase().includes(q) ?? false)
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
  clientMap: Record<string, string>
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
  nicht_bearbeitet: 0, nicht_begonnen: 0,
  in_bearbeitung: 1,
  fertig: 2, abgeschlossen: 2,
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
  clientMap: Record<string, string>
): string | number | null {
  if (entry.type === 'standalone-job') {
    const j = entry.job;
    switch (column) {
      case 'nr': return j.jobNumber ?? '';
      case 'bezeichnung': return getJobDisplayTitle(j);
      case 'kunde': return j.clientId ? (clientMap[j.clientId] ?? '') : '';
      case 'status': return STATUS_SORT_ORDER[j.status] ?? 0;
      case 'prioritaet': return PRIORITY_SORT_ORDER[j.priority] ?? 0;
      case 'datum': return j.plannedDate ?? null;
    }
  }
  const p = entry.project;
  switch (column) {
    case 'nr': return p.projectNumber ?? '';
    case 'bezeichnung': return getProjectDisplayTitle(p);
    case 'kunde': return p.clientId ? (clientMap[p.clientId] ?? '') : '';
    case 'status': {
      const eff = p.statusOverride ?? getEffectiveProjectStatusFromCounts(p);
      return STATUS_SORT_ORDER[eff] ?? 0;
    }
    case 'prioritaet': return -1;
    case 'datum': return p.plannedStartDate ?? null;
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

export function isFilterActive(state: FilterState): boolean {
  return (
    state.clientIds.length > 0 ||
    state.employeeIds.length > 0 ||
    state.dateFrom !== '' ||
    state.dateTo !== '' ||
    state.entryType !== 'alle'
  );
}

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
    .sort((a, b) => a.plannedDate!.localeCompare(b.plannedDate!))[0];
  return earliest?.plannedDate ? new Date(earliest.plannedDate) : null;
}
