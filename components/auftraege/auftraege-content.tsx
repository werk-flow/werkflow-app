'use client';
import { ListPagination } from '@/components/shared/list-pagination';
import { useListNavigation } from '@/hooks/use-list-navigation';
import { retainPageEntries, type JobListPagination, type JobListSection } from '@/lib/jobs/list-page';


import { useState, useCallback, useMemo } from 'react';
import { ChevronRight } from 'lucide-react';
import { RefreshButton } from '@/components/ui/refresh-button';
import { useBanner } from '@/components/ui/banner';

import { usePageAction } from '@/components/shared/page-action';
import {
  UnifiedAuftraegeTable,
  type AuftraegeRowFeedback,
} from './unified-auftraege-table';
import { FilterBar } from './filter-bar';
import { CreateAuftragProjectDialog } from './create-auftrag-project-dialog';
import {
  CREATE_JOB_ERROR_MESSAGES,
  type CreateJobSubmission,
} from './create-job-form-content';
import {
  CREATE_PROJECT_ERROR_MESSAGES,
  linkJobsToProject,
  projectCreatedBanner,
  type CreateProjectSubmission,
} from './create-project-form-content';
import { describeJobDeleteError } from './job-actions-menu';
import { PROJECT_DELETE_FAILED_MESSAGE } from './project-actions-menu';
import { QualificationWarningDialog } from './qualification-warning-dialog';
import { useBusyIds } from '@/hooks/use-busy-id';
import { useOptimisticList } from '@/hooks/use-optimistic-list';
import { useServerAction } from '@/hooks/use-server-action';
import { useSettleOnChange } from '@/hooks/use-settle-on-change';
import { UsableContent } from '@/components/shared/usable-content';
import { createJob, deleteJob, type CreateJobInput } from '@/lib/jobs/actions';
import { JOB_DELETE_FAILED_MESSAGE } from '@/lib/jobs/messages';
import {
  createProject,
  deleteProject,
  type CreateProjectInput,
} from '@/lib/projects/actions';
import type {
  AssignmentApproval,
  AssignmentEvaluation,
} from '@/lib/qualifications/types';
import {
  UNIFIED_STATUS_LABELS,
  EMPTY_FILTER_STATE,
  buildUnifiedList,
  splitEntries,
  matchesSearch,
  sortUnifiedEntries,
  getEntryUnifiedStatus,
  type Project,
  type Client,
  type Job,
  type ProjectWithDetails,
  type UnifiedListEntry,
  type FilterState,
  type SortColumn,
} from '@/lib/jobs/types';
import {
  resolveAuftraegeSortColumn,
  type AuftraegeColumnId,
} from '@/lib/jobs/auftraege-table-columns';
import type { OrgMemberOption } from './employee-multi-select';
import { cn } from '@/lib/utils';
import { useLiveAuftraegeData } from '@/hooks/use-live-auftraege-data';

type ActiveStatusFilter = 'alle' | 'not_started' | 'in_progress' | 'interrupted';

const ACTIVE_FILTER_OPTIONS: { value: ActiveStatusFilter; label: string }[] = [
  { value: 'alle', label: 'Alle' },
  { value: 'not_started', label: UNIFIED_STATUS_LABELS.not_started },
  { value: 'in_progress', label: UNIFIED_STATUS_LABELS.in_progress },
  { value: 'interrupted', label: UNIFIED_STATUS_LABELS.interrupted },
];

interface AuftraegeContentProps {
  jobs: Job[];
  projects: ProjectWithDetails[];
  clientMap: Record<string, string>;
  clients: Client[];
  members: OrgMemberOption[];
  jobAssignmentMap: Record<string, string[]>;
  isAdminOrManager: boolean;
  visibleColumns: AuftraegeColumnId[];
  pagination?: JobListPagination;
}

/** A deferred job create the server answered with a qualification confirm step. */
type JobCreateAwaitingApproval = CreateJobSubmission & {
  tempId: string;
  evaluation: AssignmentEvaluation;
};

const getEntityId = (entity: { id: string }): string => entity.id;

// Drafts fill the pending row until the server confirms (feedback canon);
// organisation and creator are unknown client-side and never read by the list.
function buildJobDraft(tempId: string, input: CreateJobInput): Job {
  const now = new Date().toISOString();
  return {
    id: tempId,
    organizationId: '',
    projectId: input.projectId ?? null,
    clientId: input.clientId ?? null,
    jobNumber: input.jobNumber ?? null,
    title: input.title,
    description: input.description ?? null,
    status: 'nicht_bearbeitet',
    executionState: 'not_started',
    executionVersion: 0,
    priority: input.priority ?? 'mittel',
    plannedDate: input.plannedDate ?? null,
    plannedTime: input.plannedTime ?? null,
    estimatedDurationMinutes: input.estimatedDurationMinutes ?? null,
    plannedWorkingMinutes: input.plannedWorkingMinutes ?? null,
    actualCompletionDate: null,
    location: input.location ?? null,
    siteId: input.siteId || null,
    contactId: input.contactId || null,
    createdBy: '',
    createdAt: now,
    updatedAt: now,
  };
}

function buildProjectDraft(
  tempId: string,
  input: CreateProjectInput,
  clients: Client[]
): ProjectWithDetails {
  const now = new Date().toISOString();
  return {
    id: tempId,
    organizationId: '',
    clientId: input.clientId ?? null,
    name: input.name,
    description: input.description ?? null,
    projectNumber: input.projectNumber ?? null,
    statusOverride: null,
    executionStateOverride: null,
    executionVersion: 0,
    executionOverrideReason: null,
    plannedStartDate: input.plannedStartDate ?? null,
    plannedEndDate: input.plannedEndDate ?? null,
    siteId: input.siteId ?? null,
    contactId: input.contactId ?? null,
    createdBy: '',
    createdAt: now,
    updatedAt: now,
    client: clients.find((client) => client.id === input.clientId) ?? null,
    jobCount: 0,
    completedJobCount: 0,
    inProgressJobCount: 0,
    parkedJobCount: 0,
  };
}

/** Banner copy for a rolled-back create: the known reason, then the outcome. */
function createFailureMessage(
  messages: Record<string, string>,
  error: string,
  notCreated: string
): string {
  const detail = messages[error];
  return detail ? `${detail} ${notCreated}` : notCreated;
}

const JOB_NOT_CREATED = 'Der Auftrag wurde nicht angelegt.';
const PROJECT_NOT_CREATED = 'Das Projekt wurde nicht angelegt.';

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
  jobAssignmentMap: initialJobAssignmentMap,
  isAdminOrManager,
  visibleColumns,
  pagination,
}: AuftraegeContentProps) {
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
    initialJobAssignmentMap,
    clients,
    preserveProjectCounts: Boolean(pagination),
  });

  const navigation = useListNavigation();
  function navigateSection(section: JobListSection, changes: Record<string, string | number | null>, delay = 0): void {
    navigation.navigate(Object.fromEntries(Object.entries({ page: 1, ...changes }).map(([key, value]) => [`${section}_${key}`, value])), delay);
  }
  // Active section state
  const [activeStatusFilterState, setActiveStatusFilter] = useState<ActiveStatusFilter>(pagination?.queries.active.status ?? 'alle');
  const [activeSearchState, setActiveSearch] = useState(pagination?.queries.active.search ?? '');
  const [activeFiltersState, setActiveFilters] = useState<FilterState>(pagination ? { clientIds: pagination.queries.active.clientIds, employeeIds: pagination.queries.active.employeeIds, dateFrom: pagination.queries.active.dateFrom, dateTo: pagination.queries.active.dateTo, entryType: pagination.queries.active.entryType } : EMPTY_FILTER_STATE);
  const [activeSortColState, setActiveSortCol] = useState<SortColumn>(pagination?.queries.active.sort ?? 'datum');
  const [activeSortDirState, setActiveSortDir] = useState<'asc' | 'desc'>(pagination?.queries.active.direction ?? 'desc');

  // Parkplatz section state
  const [parkplatzExpanded, setParkplatzExpanded] = useState(true);
  const [parkplatzSearchState, setParkplatzSearch] = useState(pagination?.queries.parked.search ?? '');
  const [parkplatzFiltersState, setParkplatzFilters] = useState<FilterState>(pagination ? { clientIds: pagination.queries.parked.clientIds, employeeIds: pagination.queries.parked.employeeIds, dateFrom: pagination.queries.parked.dateFrom, dateTo: pagination.queries.parked.dateTo, entryType: pagination.queries.parked.entryType } : EMPTY_FILTER_STATE);
  const [parkplatzSortColState, setParkplatzSortCol] = useState<SortColumn>(pagination?.queries.parked.sort ?? 'datum');
  const [parkplatzSortDirState, setParkplatzSortDir] = useState<'asc' | 'desc'>(pagination?.queries.parked.direction ?? 'desc');

  // Archive section state
  const [archiveExpandedState, setArchiveExpanded] = useState(pagination?.queries.archived.enabled ?? false);
  const [archiveSearchState, setArchiveSearch] = useState(pagination?.queries.archived.search ?? '');
  const [archiveFiltersState, setArchiveFilters] = useState<FilterState>(pagination ? { clientIds: pagination.queries.archived.clientIds, employeeIds: pagination.queries.archived.employeeIds, dateFrom: pagination.queries.archived.dateFrom, dateTo: pagination.queries.archived.dateTo, entryType: pagination.queries.archived.entryType } : EMPTY_FILTER_STATE);
  const [archiveSortColState, setArchiveSortCol] = useState<SortColumn>(pagination?.queries.archived.sort ?? 'datum');
  const [archiveSortDirState, setArchiveSortDir] = useState<'asc' | 'desc'>(pagination?.queries.archived.direction ?? 'desc');

  const activeSearch = pagination && !navigation.busy ? pagination.queries.active.search : activeSearchState;
  const activeSortCol = pagination && !navigation.busy ? pagination.queries.active.sort : activeSortColState;
  const activeSortDir = pagination && !navigation.busy ? pagination.queries.active.direction : activeSortDirState;
  const activeFilters = pagination && !navigation.busy ? { clientIds: pagination.queries.active.clientIds, employeeIds: pagination.queries.active.employeeIds, dateFrom: pagination.queries.active.dateFrom, dateTo: pagination.queries.active.dateTo, entryType: pagination.queries.active.entryType } : activeFiltersState;
  const parkplatzSearch = pagination && !navigation.busy ? pagination.queries.parked.search : parkplatzSearchState;
  const parkplatzSortCol = pagination && !navigation.busy ? pagination.queries.parked.sort : parkplatzSortColState;
  const parkplatzSortDir = pagination && !navigation.busy ? pagination.queries.parked.direction : parkplatzSortDirState;
  const parkplatzFilters = pagination && !navigation.busy ? { clientIds: pagination.queries.parked.clientIds, employeeIds: pagination.queries.parked.employeeIds, dateFrom: pagination.queries.parked.dateFrom, dateTo: pagination.queries.parked.dateTo, entryType: pagination.queries.parked.entryType } : parkplatzFiltersState;
  const archiveSearch = pagination && !navigation.busy ? pagination.queries.archived.search : archiveSearchState;
  const archiveSortCol = pagination && !navigation.busy ? pagination.queries.archived.sort : archiveSortColState;
  const archiveSortDir = pagination && !navigation.busy ? pagination.queries.archived.direction : archiveSortDirState;
  const archiveFilters = pagination && !navigation.busy ? { clientIds: pagination.queries.archived.clientIds, employeeIds: pagination.queries.archived.employeeIds, dateFrom: pagination.queries.archived.dateFrom, dateTo: pagination.queries.archived.dateTo, entryType: pagination.queries.archived.entryType } : archiveFiltersState;
  const activeStatusFilter = pagination && !navigation.busy ? pagination.queries.active.status : activeStatusFilterState;
  const archiveExpanded = pagination && !navigation.busy ? pagination.queries.archived.enabled : archiveExpandedState;
  // The create button lives in the page header outside the data boundary.
  const { open: createDialogOpen, setOpen: setCreateDialogOpen } = usePageAction();

  // Own-action feedback (feedback canon): a create shows a pending row until
  // the server confirms, a delete removes the row before the server answers,
  // and an edited row stays marked until the refreshed props land.
  const { showBanner } = useBanner();
  const {
    items: jobOverlay,
    insert: insertJob,
    remove: removeJob,
    rollback: rollbackJob,
  } = useOptimisticList({ items: jobs, getId: getEntityId });
  const {
    items: projectOverlay,
    insert: insertProject,
    remove: removeProject,
    rollback: rollbackProject,
  } = useOptimisticList({ items: projects, getId: getEntityId });
  const { busyIds: settlingIds, run: markSettling } = useBusyIds();
  const waitForJobsRefresh = useSettleOnChange(initialJobs);
  const waitForProjectsRefresh = useSettleOnChange(initialProjects);
  const { run: runCreateJob, isPending: isCreatingJob } = useServerAction(createJob);
  const [jobCreateAwaitingApproval, setJobCreateAwaitingApproval] =
    useState<JobCreateAwaitingApproval | null>(null);

  const visibleJobs = useMemo(
    () => jobOverlay.map((entry) => entry.item),
    [jobOverlay]
  );
  const visibleProjects = useMemo(
    () => projectOverlay.map((entry) => entry.item),
    [projectOverlay]
  );
  // Creation pickers must follow the same client-owned collection as the
  // table, otherwise a confirmed create remains unselectable until the next
  // route refresh. Pending inserts stay out because their temporary ids are
  // not valid server references.
  const dialogJobs = useMemo(
    () => jobOverlay.filter((entry) => entry.tempId === null).map((entry) => entry.item),
    [jobOverlay]
  );
  const dialogProjects = useMemo(
    () => projectOverlay.filter((entry) => entry.tempId === null).map((entry) => entry.item),
    [projectOverlay]
  );
  const rowFeedback = useMemo<AuftraegeRowFeedback>(
    () => ({
      pendingIds: new Set(
        [...jobOverlay, ...projectOverlay]
          .filter((entry) => entry.isOptimistic)
          .map((entry) => entry.item.id)
      ),
      settlingIds,
    }),
    [jobOverlay, projectOverlay, settlingIds]
  );

  const unifiedEntries = useMemo(
    () => buildUnifiedList(visibleJobs, visibleProjects),
    [visibleJobs, visibleProjects]
  );

  const { active: rawActive, parked: rawParked, archived: rawArchived } = useMemo(
    () => splitEntries(unifiedEntries),
    [unifiedEntries]
  );

  const initialIds = useMemo(() => new Set([...initialJobs, ...initialProjects].map((entry) => entry.id)), [initialJobs, initialProjects]);
  const localPendingIds = useMemo(() => new Set([...rowFeedback.pendingIds, ...settlingIds]), [rowFeedback.pendingIds, settlingIds]);

  // Active section pipeline: status pills -> search -> dropdown filters -> sort
  const activeStatusCounts = useMemo(() => {
    if (pagination) return pagination.pages.active.statusCounts;
    const counts: Record<string, number> = { alle: rawActive.length };
    for (const entry of rawActive) {
      const status = getEntryUnifiedStatus(entry);
      counts[status] = (counts[status] || 0) + 1;
    }
    return counts;
  }, [rawActive, pagination]);

  const filteredActive = useMemo(() => {
    if (pagination) return retainPageEntries(rawActive, pagination.pages.active.entries.map((entry) => entry.id), initialIds, localPendingIds);
    const effectiveSortColumn = resolveAuftraegeSortColumn(activeSortCol, visibleColumns);
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
    result = sortUnifiedEntries(result, effectiveSortColumn, activeSortDir, clientMap);
    return result;
  }, [rawActive, activeStatusFilter, activeSearch, activeFilters, activeSortCol, activeSortDir, clientMap, jobAssignmentMap, visibleColumns, pagination, initialIds, localPendingIds]);

  // Parkplatz section pipeline: search -> dropdown filters -> sort
  const filteredParked = useMemo(() => {
    if (pagination) return retainPageEntries(rawParked, pagination.pages.parked.entries.map((entry) => entry.id), initialIds, localPendingIds);
    const effectiveSortColumn = resolveAuftraegeSortColumn(parkplatzSortCol, visibleColumns);
    let result = rawParked;
    if (parkplatzSearch) {
      result = result.filter((e) => matchesSearch(e, parkplatzSearch, clientMap));
    }
    result = applyDropdownFilters(result, parkplatzFilters, jobAssignmentMap);
    result = sortUnifiedEntries(result, effectiveSortColumn, parkplatzSortDir, clientMap);
    return result;
  }, [rawParked, parkplatzSearch, parkplatzFilters, parkplatzSortCol, parkplatzSortDir, clientMap, jobAssignmentMap, visibleColumns, pagination, initialIds, localPendingIds]);

  // Archive section pipeline: search -> dropdown filters -> sort
  const filteredArchived = useMemo(() => {
    if (pagination) return retainPageEntries(rawArchived, pagination.pages.archived.entries.map((entry) => entry.id), initialIds, localPendingIds);
    const effectiveSortColumn = resolveAuftraegeSortColumn(archiveSortCol, visibleColumns);
    let result = rawArchived;
    if (archiveSearch) {
      result = result.filter((e) => matchesSearch(e, archiveSearch, clientMap));
    }
    result = applyDropdownFilters(result, archiveFilters, jobAssignmentMap);
    result = sortUnifiedEntries(result, effectiveSortColumn, archiveSortDir, clientMap);
    return result;
  }, [rawArchived, archiveSearch, archiveFilters, archiveSortCol, archiveSortDir, clientMap, jobAssignmentMap, visibleColumns, pagination, initialIds, localPendingIds]);

  const handleParkplatzSort = useCallback((col: SortColumn) => {
    if (col === parkplatzSortCol) {
      setParkplatzSortDir(parkplatzSortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setParkplatzSortCol(col);
      setParkplatzSortDir('desc');
    }
  }, [parkplatzSortCol, parkplatzSortDir]);

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

  const runJobCreate = useCallback(
    async (
      pending: CreateJobSubmission & { tempId: string },
      approval: AssignmentApproval | null
    ) => {
      try {
        const result = await runCreateJob({
          ...pending.input,
          assignmentApproval: approval,
        });
        if (result.success) {
          setJobCreateAwaitingApproval(null);
          rollbackJob(pending.tempId);
          handleJobCreated({
            job: result.job,
            assignedUserIds: pending.assignedUserIds,
          });
          showBanner({ variant: 'success', message: 'Auftrag erfolgreich erstellt!' });
          return;
        }
        if (
          (result.error === 'qualification_warning' ||
            result.error === 'stale_evaluation') &&
          'evaluation' in result
        ) {
          // The confirm step runs at list level; the pending row stays until
          // the user decides.
          setJobCreateAwaitingApproval({ ...pending, evaluation: result.evaluation });
          return;
        }
        setJobCreateAwaitingApproval(null);
        rollbackJob(pending.tempId);
        showBanner({
          variant: 'error',
          message: createFailureMessage(CREATE_JOB_ERROR_MESSAGES, result.error, JOB_NOT_CREATED),
        });
      } catch {
        setJobCreateAwaitingApproval(null);
        rollbackJob(pending.tempId);
        showBanner({
          variant: 'error',
          message: createFailureMessage(CREATE_JOB_ERROR_MESSAGES, 'unexpected_error', JOB_NOT_CREATED),
        });
      }
    },
    [handleJobCreated, rollbackJob, runCreateJob, showBanner]
  );

  const handleJobSubmit = useCallback(
    (submission: CreateJobSubmission) => {
      const tempId = `pending-job-${crypto.randomUUID()}`;
      insertJob(tempId, buildJobDraft(tempId, submission.input));
      void runJobCreate({ ...submission, tempId }, null);
    },
    [insertJob, runJobCreate]
  );

  const handleJobCreateCancel = useCallback(() => {
    if (!jobCreateAwaitingApproval) return;
    rollbackJob(jobCreateAwaitingApproval.tempId);
    setJobCreateAwaitingApproval(null);
    showBanner({ variant: 'info', message: JOB_NOT_CREATED });
  }, [jobCreateAwaitingApproval, rollbackJob, showBanner]);

  const handleProjectSubmit = useCallback(
    async (submission: CreateProjectSubmission) => {
      const tempId = `pending-project-${crypto.randomUUID()}`;
      insertProject(tempId, buildProjectDraft(tempId, submission.input, clients));
      try {
        const result = await createProject(submission.input);
        if (!result.success) {
          rollbackProject(tempId);
          showBanner({
            variant: 'error',
            message: createFailureMessage(CREATE_PROJECT_ERROR_MESSAGES, result.error, PROJECT_NOT_CREATED),
          });
          return;
        }
        const failedLinkCount = await linkJobsToProject(
          result.project.id,
          submission.linkedJobIds
        );
        rollbackProject(tempId);
        handleProjectCreated({
          project: result.project,
          linkedJobIds: submission.linkedJobIds,
        });
        showBanner(projectCreatedBanner(failedLinkCount));
      } catch {
        rollbackProject(tempId);
        showBanner({
          variant: 'error',
          message: createFailureMessage(CREATE_PROJECT_ERROR_MESSAGES, 'unexpected_error', PROJECT_NOT_CREATED),
        });
      }
    },
    [clients, handleProjectCreated, insertProject, rollbackProject, showBanner]
  );

  const handleJobDeleteRequested = useCallback(
    async (jobId: string) => {
      removeJob(jobId);
      try {
        const result = await deleteJob(jobId);
        if (!result.success) {
          rollbackJob(jobId);
          showBanner({ variant: 'error', message: describeJobDeleteError(result.error) });
          return;
        }
        handleJobDelete(jobId);
        showBanner({ variant: 'success', message: 'Auftrag gelöscht.' });
      } catch {
        rollbackJob(jobId);
        showBanner({ variant: 'error', message: JOB_DELETE_FAILED_MESSAGE });
      }
    },
    [handleJobDelete, removeJob, rollbackJob, showBanner]
  );

  const handleProjectDeleteRequested = useCallback(
    async (projectId: string) => {
      removeProject(projectId);
      try {
        const result = await deleteProject(projectId);
        if (!result.success) {
          rollbackProject(projectId);
          showBanner({ variant: 'error', message: PROJECT_DELETE_FAILED_MESSAGE });
          return;
        }
        handleProjectDelete(projectId);
        showBanner({ variant: 'success', message: 'Projekt gelöscht.' });
      } catch {
        rollbackProject(projectId);
        showBanner({ variant: 'error', message: PROJECT_DELETE_FAILED_MESSAGE });
      }
    },
    [handleProjectDelete, removeProject, rollbackProject, showBanner]
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
      void markSettling(job.id, waitForJobsRefresh);
    },
    [handleJobAssignmentsReplace, handleJobUpsert, markSettling, waitForJobsRefresh]
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
      void markSettling(project.id, waitForProjectsRefresh);
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
    [handleProjectUpsert, markSettling, setJobs, waitForProjectsRefresh]
  );

  const handleActiveSort = useCallback((col: SortColumn) => {
    if (col === activeSortCol) {
      setActiveSortDir(activeSortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setActiveSortCol(col);
      setActiveSortDir('asc');
    }
  }, [activeSortCol, activeSortDir]);

  const handleArchiveSort = useCallback((col: SortColumn) => {
    if (col === archiveSortCol) {
      setArchiveSortDir(archiveSortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setArchiveSortCol(col);
      setArchiveSortDir('desc');
    }
  }, [archiveSortCol, archiveSortDir]);

  return (
    <UsableContent name="auftraege" count={jobs.length}>
    <div className="space-y-6">
      {/* Active section */}
      <section>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold sm:text-lg">
            Aktuelle Aufträge und Projekte
          </h2>
          <RefreshButton label="Tabelle aktualisieren" />
        </div>

        <div className="mb-3 flex flex-wrap gap-1.5">
          {ACTIVE_FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => { setActiveStatusFilter(opt.value); if (pagination) navigateSection('active', { status: opt.value }); }}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                activeStatusFilter === opt.value
                  ? 'border-primary bg-primary/10 text-primary-text'
                  : 'border-border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              )}
            >
              {opt.label}
              <span className={cn(
                'tabular-nums',
                activeStatusFilter === opt.value ? 'text-primary-text' : 'text-muted-foreground/70'
              )}>
                {activeStatusCounts[opt.value] || 0}
              </span>
            </button>
          ))}
        </div>

        <FilterBar
          searchQuery={activeSearch}
          onSearchChange={(value) => { setActiveSearch(value); if (pagination) navigateSection('active', { q: value }, 250); }}
          filters={activeFilters}
          onFiltersChange={(value) => { setActiveFilters(value); if (pagination) navigateSection('active', { clients: value.clientIds.join(','), employees: value.employeeIds.join(','), from: value.dateFrom, to: value.dateTo, type: value.entryType }); }}
          clients={clients}
          members={members}
        />

        <div className="mt-3">
          <UnifiedAuftraegeTable pagedChildren={Boolean(pagination)} projectAssignmentMap={Object.fromEntries(pagination ? Object.values(pagination.pages).flatMap((page) => page.entries.filter((entry) => entry.type === 'project').map((entry) => [entry.id, entry.assignedUserIds])) : [])}
            entries={filteredActive}
            clientMap={clientMap}
            isAdminOrManager={isAdminOrManager}
            sortColumn={resolveAuftraegeSortColumn(activeSortCol, visibleColumns)}
            sortDirection={activeSortDir}
            onSort={(column) => { handleActiveSort(column); if (pagination) navigateSection('active', { sort: column, direction: column === activeSortCol ? (activeSortDir === 'asc' ? 'desc' : 'asc') : 'asc' }); }}
            jobAssignmentMap={jobAssignmentMap}
            clients={clients}
            members={members}
            visibleColumns={visibleColumns}
            rowFeedback={rowFeedback}
            onJobUpdated={handleJobEdited}
            onJobDeleteRequested={handleJobDeleteRequested}
            onProjectUpdated={handleProjectEdited}
            onProjectDeleteRequested={handleProjectDeleteRequested}
          />
          {pagination && <ListPagination label="Aktuelle Aufträge" page={pagination.queries.active.page} total={pagination.pages.active.total} busy={navigation.busy} onPageChange={(page) => navigateSection('active', { page })} />}
        </div>
      </section>

      {/* Parkplatz section */}
      {(pagination ? pagination.pages.parked.sectionTotal > 0 : rawParked.length > 0) && (
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
              ({pagination?.pages.parked.sectionTotal ?? rawParked.length})
            </span>
          </button>

          {parkplatzExpanded && (
            <div className="space-y-3">
              <FilterBar
                searchQuery={parkplatzSearch}
                onSearchChange={(value) => { setParkplatzSearch(value); if (pagination) navigateSection('parked', { q: value }, 250); }}
                filters={parkplatzFilters}
                onFiltersChange={(value) => { setParkplatzFilters(value); if (pagination) navigateSection('parked', { clients: value.clientIds.join(','), employees: value.employeeIds.join(','), from: value.dateFrom, to: value.dateTo, type: value.entryType }); }}
                clients={clients}
                members={members}
              />
              <UnifiedAuftraegeTable pagedChildren={Boolean(pagination)} projectAssignmentMap={Object.fromEntries(pagination ? Object.values(pagination.pages).flatMap((page) => page.entries.filter((entry) => entry.type === 'project').map((entry) => [entry.id, entry.assignedUserIds])) : [])}
                entries={filteredParked}
                clientMap={clientMap}
                isAdminOrManager={isAdminOrManager}
                sortColumn={resolveAuftraegeSortColumn(parkplatzSortCol, visibleColumns)}
                sortDirection={parkplatzSortDir}
                onSort={(column) => { handleParkplatzSort(column); if (pagination) navigateSection('parked', { sort: column, direction: column === parkplatzSortCol ? (parkplatzSortDir === 'asc' ? 'desc' : 'asc') : 'desc' }); }}
                jobAssignmentMap={jobAssignmentMap}
                clients={clients}
                members={members}
                visibleColumns={visibleColumns}
                rowFeedback={rowFeedback}
                onJobUpdated={handleJobEdited}
                onJobDeleteRequested={handleJobDeleteRequested}
                onProjectUpdated={handleProjectEdited}
                onProjectDeleteRequested={handleProjectDeleteRequested}
              />
              {pagination && <ListPagination label="Parkplatz" page={pagination.queries.parked.page} total={pagination.pages.parked.total} busy={navigation.busy} onPageChange={(page) => navigateSection('parked', { page })} />}
            </div>
          )}
        </section>
      )}

      {/* Archive section */}
      {(pagination ? pagination.pages.archived.sectionTotal > 0 : rawArchived.length > 0) && (
        <section>
          <button
            onClick={() => { setArchiveExpanded((value) => !value); if (pagination) navigateSection('archived', { open: archiveExpanded ? null : '1' }); }}
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
              ({pagination?.pages.archived.sectionTotal ?? rawArchived.length})
            </span>
          </button>

          {archiveExpanded && (
            <div className="space-y-3">
              <FilterBar
                searchQuery={archiveSearch}
                onSearchChange={(value) => { setArchiveSearch(value); if (pagination) navigateSection('archived', { q: value }, 250); }}
                filters={archiveFilters}
                onFiltersChange={(value) => { setArchiveFilters(value); if (pagination) navigateSection('archived', { clients: value.clientIds.join(','), employees: value.employeeIds.join(','), from: value.dateFrom, to: value.dateTo, type: value.entryType }); }}
                clients={clients}
                members={members}
              />
              <UnifiedAuftraegeTable pagedChildren={Boolean(pagination)} projectAssignmentMap={Object.fromEntries(pagination ? Object.values(pagination.pages).flatMap((page) => page.entries.filter((entry) => entry.type === 'project').map((entry) => [entry.id, entry.assignedUserIds])) : [])}
                entries={filteredArchived}
                clientMap={clientMap}
                isAdminOrManager={isAdminOrManager}
                sortColumn={resolveAuftraegeSortColumn(archiveSortCol, visibleColumns)}
                sortDirection={archiveSortDir}
                onSort={(column) => { handleArchiveSort(column); if (pagination) navigateSection('archived', { sort: column, direction: column === archiveSortCol ? (archiveSortDir === 'asc' ? 'desc' : 'asc') : 'desc' }); }}
                isArchive
                jobAssignmentMap={jobAssignmentMap}
                clients={clients}
                members={members}
                visibleColumns={visibleColumns}
                rowFeedback={rowFeedback}
                onJobUpdated={handleJobEdited}
                onJobDeleteRequested={handleJobDeleteRequested}
                onProjectUpdated={handleProjectEdited}
                onProjectDeleteRequested={handleProjectDeleteRequested}
              />
              {pagination && <ListPagination label="Archiv" page={pagination.queries.archived.page} total={pagination.pages.archived.total} busy={navigation.busy} onPageChange={(page) => navigateSection('archived', { page })} />}
            </div>
          )}
        </section>
      )}

      {isAdminOrManager && (
        <>
          <CreateAuftragProjectDialog
            clients={clients}
            members={members}
            projects={dialogProjects}
            jobs={dialogJobs}
            open={createDialogOpen}
            onOpenChange={setCreateDialogOpen}
            onJobSubmit={handleJobSubmit}
            onProjectSubmit={handleProjectSubmit}
          />
          <QualificationWarningDialog
            evaluation={jobCreateAwaitingApproval?.evaluation ?? null}
            isSubmitting={isCreatingJob}
            onCancel={handleJobCreateCancel}
            onConfirm={(approval) =>
              jobCreateAwaitingApproval
                ? runJobCreate(jobCreateAwaitingApproval, approval)
                : undefined
            }
          />
        </>
      )}
    </div>
    </UsableContent>
  );
}
