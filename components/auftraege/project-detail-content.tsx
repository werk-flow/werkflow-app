'use client';

import { usePendingTask } from '@/hooks/use-server-action';
import {
  useState,
    useEffect,
  useMemo,
  useRef,
} from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Plus,
  Building2,
  Clock,
  ChevronDown,
  Trash2,
  MoreVertical,
  Loader2,
  Pencil,
} from 'lucide-react';
import { useActiveJobs } from '@/hooks/use-active-jobs';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useBanner } from '@/components/ui/banner';
import { ListRow } from '@/components/ui/list-row';
import { Progress } from '@/components/ui/progress';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

import { DetailPageHeader } from '@/components/shared/detail-page-header';
import { PageBody, PageShell } from '@/components/shared/page-shell';
import { MetadataSection, type MetadataField } from '@/components/shared/metadata-section';
import { EntityLinkCard } from '@/components/shared/entity-link-card';
import { ContextualDocumentsSection } from '@/components/dokumente/contextual-documents-section';
import { JobMaterialsSection } from '@/components/inventar/job-materials-section';
import { ApplyWorkTemplateCard } from '@/components/arbeitsvorlagen/apply-work-template-card';
import { JobInstructionItemsCard } from './job-instruction-items-card';
import { ProjectQualificationSection } from './project-qualification-section';
import { Skeleton } from '@/components/ui/skeleton';
import { SectionError } from '@/components/ui/section-error';
import { CreateJobDialog } from './create-job-dialog';
import { ClientAssignmentDialog } from './client-assignment-dialog';
import { EditProjectDialog } from './edit-project-dialog';
import { ProjectJobsAssignmentDialog } from './project-jobs-assignment-dialog';
import { WorkLifecycleCard, WorkLifecycleLoadError } from './work-lifecycle-card';
import { WorkArtifactsSection } from './work-artifacts-section';
import type { WorkLifecycleSnapshot } from '@/lib/work-lifecycle/types';
import type { WorkArtifactSummary } from '@/lib/work-artifacts/types';

import { updateProject, deleteProject } from '@/lib/projects/actions';
import {
  getAuftraegeDialogOptions,
  updateJob,
} from '@/lib/jobs/actions';
import { getTimeEntriesForProjectJobs } from '@/lib/time-tracking/actions';
import { calculateWorkSessions } from '@/lib/time-tracking/validation';
import type { TimeEntry } from '@/lib/time-tracking/types';
import { useRealtimeEvent } from '@/components/realtime/realtime-provider';
import { useRealtimeRouterRefresh } from '@/hooks/use-realtime-router-refresh';
import { useLiveView } from '@/hooks/use-live-view';
import {
  getJobDisplayTitle,
  calculateProjectProgress,
  calculateTrafficLight,
  getEffectiveProjectStatus,
  type Project,
  type Client,
  type Job,
  type JobInstructionItemWithDetails,
  type DerivedProjectStatus,
  type ProjectStatus,
  type JobStatus,
  PROJECT_STATUS_LABELS,
  JOB_STATUS_LABELS,
  JOB_PRIORITY_LABELS,
  CLIENT_TYPE_LABELS,
} from '@/lib/jobs/types';
import type { OrgMemberOption } from './employee-multi-select';
import type { OrganizationDocument, ProjectJobDocumentGroup } from '@/lib/documents/types';
import type {
  InventoryLocation,
  InventoryPickerOption,
  ProjectMaterialSummary,
} from '@/lib/inventory/types';
import { cn } from '@/lib/utils';
import type { WorkHandoverWorkspace } from '@/lib/work-handover/types';
import { WorkHandoverSummary } from './work-handover-section';

const PROJECT_STATUS_CLASSES: Record<ProjectStatus, string> = {
  nicht_begonnen: 'bg-secondary text-secondary-foreground',
  in_bearbeitung:
    'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  abgeschlossen:
    'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  geparkt:
    'bg-brand-purple/15 text-brand-purple-dark dark:text-brand-purple-light',
};

const JOB_STATUS_CLASSES: Record<JobStatus, string> = {
  nicht_bearbeitet: 'bg-secondary text-secondary-foreground',
  in_bearbeitung:
    'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  fertig:
    'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  geparkt:
    'bg-brand-purple/15 text-brand-purple-dark dark:text-brand-purple-light',
};

const PRIORITY_CLASSES: Record<string, string> = {
  niedrig: 'bg-secondary text-secondary-foreground',
  mittel: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  hoch: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
};

function TrafficLight({ status }: { status: 'green' | 'yellow' | 'red' }) {
  const base = 'size-2.5 rounded-full shrink-0 transition-colors';
  const inactive = 'bg-muted-foreground/20';
  return (
    <div
      className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/50 px-1.5 py-0.5"
      title={
        status === 'green'
          ? 'Im Zeitplan'
          : status === 'yellow'
            ? 'Leicht verzögert'
            : 'Stark verzögert'
      }
    >
      <span className={cn(base, status === 'red' ? 'bg-red-500' : inactive)} />
      <span
        className={cn(base, status === 'yellow' ? 'bg-yellow-500' : inactive)}
      />
      <span
        className={cn(base, status === 'green' ? 'bg-green-500' : inactive)}
      />
    </div>
  );
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface ProjectDetailContentProps {
  project: Project;
  client: Client | null;
  jobs: Job[];
  derivedStatus: DerivedProjectStatus;
  clients: Client[];
  members: OrgMemberOption[];
  isAdminOrManager: boolean;
  canApproveWorkArtifacts: boolean;
  currentUserId: string;
  instructionItems: JobInstructionItemWithDetails[];
  initialArtifacts: WorkArtifactSummary[];
  projectDocuments: OrganizationDocument[];
  jobDocumentGroups: ProjectJobDocumentGroup[];
  materialSummary: ProjectMaterialSummary;
  inventoryItems: InventoryPickerOption[];
  inventoryLocations: InventoryLocation[];
  lifecycleSnapshot: WorkLifecycleSnapshot | null;
  handoverWorkspace: WorkHandoverWorkspace | null;
  // Set when this project was created by converting an Anfrage (P1-02).
  originRequest?: { label: string; href: string } | null;
}

export function ProjectDetailContent({
  project,
  jobs,
  clients,
  members,
  isAdminOrManager,
  canApproveWorkArtifacts,
  currentUserId,
  instructionItems,
  initialArtifacts,
  projectDocuments,
  jobDocumentGroups,
  materialSummary,
  inventoryItems,
  inventoryLocations,
  lifecycleSnapshot,
  handoverWorkspace,
  originRequest,
}: ProjectDetailContentProps) {
  const router = useRouter();
  const { showBanner } = useBanner();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const { run: runDeleteTask, isPending: isDeleting } = usePendingTask();
  const [showCreateJob, setShowCreateJob] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showClientDialog, setShowClientDialog] = useState(false);
  const [showAssignJobsDialog, setShowAssignJobsDialog] = useState(false);
  const { run: runClientUpdateTask, isPending: isUpdatingClient } = usePendingTask();
  const { run: runAssignJobsTask, isPending: isAssigningJobs } = usePendingTask();
  const [dialogClients, setDialogClients] = useState(clients);
  const [dialogMembers, setDialogMembers] = useState(members);
  const [dialogAvailableJobs, setDialogAvailableJobs] = useState<Job[]>([]);
  const [isLoadingDialogOptions, setIsLoadingDialogOptions] = useState(false);
  const [dialogOptionsError, setDialogOptionsError] = useState<string | null>(null);
  const [assignJobsError, setAssignJobsError] = useState<string | null>(null);
  const [dialogOptionsRefreshKey, setDialogOptionsRefreshKey] = useState(0);
  const dialogOptionsRequestInFlightRef = useRef(false);
  const [liveProject, setLiveProject] = useState(project);
  const [liveJobs, setLiveJobs] = useState(jobs);
  const [instructionRefreshSignal, setInstructionRefreshSignal] = useState(0);

  const [showTimeDetails, setShowTimeDetails] = useState(false);

  useEffect(() => {
    setLiveProject(project);
  }, [project]);

  useEffect(() => {
    setLiveJobs(jobs);
  }, [jobs]);

  useEffect(() => {
    setDialogClients(clients);
  }, [clients]);

  useEffect(() => {
    setDialogMembers(members);
  }, [members]);

  useEffect(() => {
    if (
      !isAdminOrManager ||
      dialogOptionsRequestInFlightRef.current ||
      (
        !showCreateJob &&
        !showEditDialog &&
        !showClientDialog &&
        !showAssignJobsDialog
      ) ||
      (
        !(showClientDialog && dialogClients.length === 0) &&
        !(
          showCreateJob &&
          (dialogClients.length === 0 || dialogMembers.length === 0)
        ) &&
        !(
          showEditDialog &&
          (dialogClients.length === 0 ||
            dialogMembers.length === 0 ||
            dialogAvailableJobs.length === 0)
        ) &&
        !(showAssignJobsDialog && dialogAvailableJobs.length === 0)
      )
    ) {
      return;
    }

    let cancelled = false;
    dialogOptionsRequestInFlightRef.current = true;
    setIsLoadingDialogOptions(true);
    setDialogOptionsError(null);
    getAuftraegeDialogOptions()
      .then((result) => {
        if (cancelled) return;
        if (!result.success) {
          setDialogOptionsError('Die verfügbaren Aufträge konnten nicht geladen werden.');
          return;
        }
        setDialogClients(result.clients);
        setDialogMembers(result.members);
        setDialogAvailableJobs(result.jobs);
      })
      .catch(() => {
        if (!cancelled) {
          setDialogOptionsError('Die verfügbaren Aufträge konnten nicht geladen werden.');
        }
      })
      .finally(() => {
        dialogOptionsRequestInFlightRef.current = false;
        if (!cancelled) setIsLoadingDialogOptions(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    dialogAvailableJobs.length,
    dialogClients.length,
    dialogMembers.length,
    dialogOptionsRefreshKey,
    isAdminOrManager,
    showAssignJobsDialog,
    showClientDialog,
    showCreateJob,
    showEditDialog,
  ]);

  const liveClient = useMemo(
    () => clients.find((entry) => entry.id === liveProject.clientId) ?? null,
    [clients, liveProject.clientId]
  );

  const timeView = useLiveView<
    { jobId: string; jobTitle: string; entries: TimeEntry[] }[]
  >({
    tables: ['time_entries', 'time_sessions', 'time_segments'],
    read: async () => {
      const result = await getTimeEntriesForProjectJobs(liveProject.id);
      if (!result.success) return { ok: false, error: result.error };
      const entriesByJobId = new Map(
        result.jobs.map((job) => [job.jobId, job.entries])
      );
      return {
        ok: true,
        data: liveJobs.map((job) => ({
          jobId: job.id,
          jobTitle: getJobDisplayTitle(job),
          entries: entriesByJobId.get(job.id) ?? [],
        })),
      };
    },
    resetKey: liveJobs
      .map((job) => job.id)
      .sort()
      .join(','),
  });
  const projectTimeEntries = useMemo(
    () => timeView.data ?? [],
    [timeView.data]
  );
  const isLoadingTime = timeView.isLoading;
  const timeLoadError = !isLoadingTime && (
    timeView.error !== null || timeView.data === undefined
  );

  // Server props are the authority for project and job facts: Realtime
  // changes trigger a debounced route refresh, and the sync effects above
  // adopt the fresh props.
  useRealtimeRouterRefresh({
    tables: ['projects', 'jobs', 'job_assignments'],
  });

  useRealtimeRouterRefresh({
    tables: [
      'job_material_lines',
      'inventory_stock_levels',
      'inventory_movements',
      'inventory_items',
      'inventory_locations',
    ],
    enabled: isAdminOrManager,
  });

  // Deliberate narrow event consumer: leaving the page of a project another
  // session just deleted needs the event itself (DELETE payloads carry the
  // id), not a refetch.
  useRealtimeEvent('projects', (event) => {
    const oldId = (event.old as { id?: string } | null)?.id;
    if (event.eventType === 'DELETE' && oldId === liveProject.id) {
      router.push('/auftraege');
    }
  });

  const projectTimeSummary = useMemo(() => {
    let totalMinutes = 0;
    const perJob: Array<{
      jobId: string;
      title: string;
      minutes: number;
      plannedWorkingMinutes: number | null;
    }> = [];
    const jobLookup = new Map(liveJobs.map((job) => [job.id, job]));

    for (const { jobId, jobTitle, entries } of projectTimeEntries) {
      const entriesByUser: Record<string, TimeEntry[]> = {};
      for (const e of entries) {
        if (!entriesByUser[e.userId]) entriesByUser[e.userId] = [];
        entriesByUser[e.userId].push(e);
      }
      const sessions = Object.values(entriesByUser)
        .flatMap((ue) => calculateWorkSessions(ue))
        .filter((s) => s.clockIn && s.clockOut);

      const jobMin = sessions.reduce(
        (sum, s) => sum + (s.durationMinutes ?? 0),
        0
      );
      totalMinutes += jobMin;
      if (jobMin > 0) {
        perJob.push({
          jobId,
          title: jobTitle,
          minutes: jobMin,
          plannedWorkingMinutes: jobLookup.get(jobId)?.plannedWorkingMinutes ?? null,
        });
      }
    }

    return { totalMinutes, perJob: perJob.sort((a, b) => b.minutes - a.minutes) };
  }, [liveJobs, projectTimeEntries]);
  const artifactEvidenceRequirements = useMemo(
    () => instructionItems.flatMap((item) => item.evidenceRequirements), [instructionItems]
  );
  const artifactInstructionOptions = useMemo(
    () => instructionItems.map((item) => ({ id: item.id, label: item.content })), [instructionItems]
  );
  const artifactTimeEntryOptions = useMemo(
    () => projectTimeEntries.flatMap((group) => group.entries
      .filter((entry) => entry.entryType === 'clock_in')
      .map((entry) => ({ id: entry.canonicalSegmentId ?? entry.id,
        sourceType: entry.canonicalSegmentId
          ? ('time_segment' as const)
          : ('time_entry' as const),
        label: `${group.jobTitle} · ${formatDateTime(entry.timestamp)}` }))),
    [projectTimeEntries]
  );

  function formatDurationMins(mins: number): string {
    const h = Math.floor(mins / 60);
    const m = Math.round(mins % 60);
    if (h === 0) return `${m} Min.`;
    if (m === 0) return `${h} Std.`;
    return `${h} Std. ${m} Min.`;
  }

  const completedCount = liveJobs.filter((j) => j.status === 'fertig').length;
  const inProgressCount = liveJobs.filter(
    (j) => j.status === 'in_bearbeitung'
  ).length;
  const parkedCount = liveJobs.filter((j) => j.status === 'geparkt').length;

  const liveDerivedStatus = useMemo<DerivedProjectStatus>(() => {
    const status = getEffectiveProjectStatus(liveProject, liveJobs);
    return {
      status,
      progress: calculateProjectProgress(liveJobs),
      trafficLight: calculateTrafficLight(liveProject, liveJobs),
    };
  }, [liveJobs, liveProject]);

  const handleDelete = () => {
    void runDeleteTask(async () => {
      const result = await deleteProject(project.id);
      if (result.success) {
        // Hard navigation — see the deletion-stall note in kunden-detail-content.
        window.location.assign(
          `/auftraege?deleted_project=${encodeURIComponent(project.name)}`
        );
        return;
      }
      showBanner({
        variant: 'error',
        message: 'Das Projekt konnte nicht gelöscht werden.',
      });
    });
  };

  const handleClientSave = async (clientId: string) => {
    void runClientUpdateTask(async () => {
      const result = await updateProject(project.id, {
        clientId,
      });
      if (!result.success) {
        // The dialog stays open on failure (no silent close-and-drop).
        showBanner({
          variant: 'error',
          message: 'Der Kunde konnte nicht gespeichert werden.',
        });
        return;
      }
      setShowClientDialog(false);
      setLiveProject(result.project);
    });
  };

  const assignableJobs = useMemo(
    () =>
      dialogAvailableJobs.filter((job) => !job.projectId && job.status !== 'fertig'),
    [dialogAvailableJobs]
  );

  const handleAssignJobsSave = async (jobIds: string[]) => {
    void runAssignJobsTask(async () => {
      setAssignJobsError(null);
      const results = await Promise.allSettled(
        jobIds.map((jobId) => updateJob(jobId, { projectId: project.id }))
      );
      const assignedJobIds = jobIds.filter((_, index) => {
        const result = results[index];
        return result.status === 'fulfilled' && result.value.success;
      });
      setLiveJobs((prev) => {
        const knownIds = new Set(prev.map((job) => job.id));
        const promotedJobs = dialogAvailableJobs
          .filter(
            (job) => assignedJobIds.includes(job.id) && !knownIds.has(job.id)
          )
          .map((job) => ({
            ...job,
            projectId: project.id,
            clientId: project.clientId ?? job.clientId,
          }));

        return [...prev, ...promotedJobs];
      });
      if (assignedJobIds.length !== jobIds.length) {
        setDialogAvailableJobs((previous) =>
          previous.filter((job) => !assignedJobIds.includes(job.id))
        );
        setAssignJobsError(
          'Einige Aufträge konnten nicht hinzugefügt werden. Bitte versuche es erneut.'
        );
        return;
      }

      setShowAssignJobsDialog(false);
      setDialogAvailableJobs([]);
    });
  };

  const metadataFields: MetadataField[] = [
    {
      label: 'Projektnummer',
      value: (
        <span className="font-mono text-xs">{liveProject.projectNumber}</span>
      ),
    },
    {
      label: 'Titel',
      value: liveProject.name,
      editableConfig: isAdminOrManager
        ? {
            type: 'text',
            currentValue: liveProject.name,
            onSave: async (v) => {
              const result = await updateProject(project.id, { name: v });
              if (result.success) setLiveProject(result.project);
            },
          }
        : undefined,
    },
    {
      label: 'Beschreibung',
      value: liveProject.description || (
        <span className="text-muted-foreground">Keine Beschreibung</span>
      ),
      editableConfig: isAdminOrManager
        ? {
            type: 'textarea',
            currentValue: liveProject.description ?? '',
            onSave: async (v) => {
              const result = await updateProject(project.id, { description: v });
              if (result.success) setLiveProject(result.project);
            },
            placeholder: 'Beschreibung hinzufügen...',
            nullable: true,
          }
        : undefined,
    },
    {
      label: 'Status',
      value: (
        <Badge
          variant="secondary"
          className={PROJECT_STATUS_CLASSES[liveDerivedStatus.status]}
        >
          {PROJECT_STATUS_LABELS[liveDerivedStatus.status]}
        </Badge>
      ),
    },
    {
      label: 'Geplanter Beginn',
      value: formatDate(liveProject.plannedStartDate),
      editableConfig: isAdminOrManager
        ? {
            type: 'date',
            currentValue: liveProject.plannedStartDate ?? '',
            onSave: async (v) => {
              const result = await updateProject(project.id, {
                plannedStartDate: v,
              });
              if (result.success) setLiveProject(result.project);
            },
            nullable: true,
          }
        : undefined,
    },
    {
      label: 'Geplantes Ende',
      value: formatDate(liveProject.plannedEndDate),
      editableConfig: isAdminOrManager
        ? {
            type: 'date',
            currentValue: liveProject.plannedEndDate ?? '',
            onSave: async (v) => {
              const result = await updateProject(project.id, {
                plannedEndDate: v,
              });
              if (result.success) setLiveProject(result.project);
            },
            nullable: true,
          }
        : undefined,
    },
    {
      label: 'Erstellt am',
      value: formatDateTime(liveProject.createdAt),
    },
  ];

  return (
    <PageShell>
      <DetailPageHeader
        breadcrumbs={[
          { label: 'Aufträge', href: '/auftraege' },
          { label: liveProject.projectNumber ?? 'Projekt' },
        ]}
        title={liveProject.name}
        badges={
          <>
            <Badge
              variant="secondary"
              className={PROJECT_STATUS_CLASSES[liveDerivedStatus.status]}
            >
              {PROJECT_STATUS_LABELS[liveDerivedStatus.status]}
            </Badge>
            <TrafficLight status={liveDerivedStatus.trafficLight} />
          </>
        }
        actions={
          isAdminOrManager ? (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                className="gap-1.5"
                onClick={() => setShowCreateJob(true)}
              >
                <Plus className="size-3.5" />
                <span className="hidden sm:inline">Auftrag hinzufügen</span>
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    className="size-8"
                    aria-label="Aktionen öffnen"
                  >
                    <MoreVertical className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setShowEditDialog(true)}>
                    <Pencil className="mr-2 size-4" />
                    Bearbeiten
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => setShowDeleteDialog(true)}
                  >
                    <Trash2 className="mr-2 size-4" />
                    Projekt löschen
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : undefined
        }
      />

      <PageBody>
        {isAdminOrManager && originRequest && (
          <p className="mb-4 text-sm text-muted-foreground">
            Entstanden aus{' '}
            <Link
              href={originRequest.href}
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              {originRequest.label}
            </Link>
          </p>
        )}
        <div className="mb-6">
          {lifecycleSnapshot ? (
            <WorkLifecycleCard
              initialSnapshot={lifecycleSnapshot}
              targetLabel={liveProject.name}
              isManager={isAdminOrManager}
            />
          ) : (
            <WorkLifecycleLoadError />
          )}
          {handoverWorkspace && (
            <div className="mt-4">
              <WorkHandoverSummary
                workspace={handoverWorkspace}
                href={liveProject.projectNumber
                  ? `/auftraege/projekt/${encodeURIComponent(liveProject.projectNumber)}/uebergabe`
                  : `/auftraege/uebergaben/projekt/${handoverWorkspace.targetId}`}
              />
            </div>
          )}
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.5fr]">
          {/* Left Column: Metadata + Client */}
          <div className="space-y-6">
            <MetadataSection
              title="Details"
              fields={metadataFields}
              isEditable={isAdminOrManager}
            />

            {liveClient ? (
              <EntityLinkCard
                title={liveClient.name}
                href={`/kunden/${liveClient.id}`}
                icon={<Building2 className="size-5" />}
                badge={
                  <Badge variant="outline" className="text-xs">
                    {CLIENT_TYPE_LABELS[liveClient.clientType]}
                  </Badge>
                }
                metadata={[
                  ...(liveClient.email
                    ? [{ label: 'E-Mail', value: liveClient.email }]
                    : []),
                  ...(liveClient.phone
                    ? [{ label: 'Telefon', value: liveClient.phone }]
                    : []),
                ]}
              />
            ) : (
              <EntityLinkCard
                title=""
                href=""
                icon={<Building2 className="size-5" />}
                emptyState={{ text: 'Kein Kunde zugewiesen' }}
                onEmptyClick={
                  isAdminOrManager ? () => setShowClientDialog(true) : undefined
                }
              />
            )}
          </div>

          {/* Right Column: Progress + Jobs + Placeholders */}
          <div className="space-y-6">
            {/* Progress Hero */}
            <div className="rounded-lg border bg-muted/30 p-5 sm:p-6">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Fortschritt
                </h3>
                <div className="flex items-center gap-2">
                  <span className="text-2xl font-bold tabular-nums">
                    {liveDerivedStatus.progress}%
                  </span>
                  <TrafficLight status={liveDerivedStatus.trafficLight} />
                </div>
              </div>
              <Progress
                value={liveDerivedStatus.progress}
                className="mt-4 h-2.5"
              />
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                <span>
                  {completedCount} von {liveJobs.length} Aufträge abgeschlossen
                </span>
                {inProgressCount > 0 && (
                  <span>{inProgressCount} in Bearbeitung</span>
                )}
              </div>
            </div>

            {/* Child Jobs Table */}
            <div className="rounded-lg border bg-card">
              <div className="flex items-center justify-between border-b px-4 py-3">
                <h3 className="text-sm font-semibold">
                  Aufträge in diesem Projekt{' '}
                  <span className="text-muted-foreground">({liveJobs.length})</span>
                </h3>
                {isAdminOrManager && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1 text-xs"
                    onClick={() => setShowAssignJobsDialog(true)}
                  >
                    <Plus className="size-3" />
                    Zuweisen
                  </Button>
                )}
              </div>

              {liveJobs.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                  Noch keine Aufträge in diesem Projekt.
                </div>
              ) : (
                <div className="space-y-2 p-3">
                  {liveJobs.map((job) => (
                    <ChildJobRow
                      key={job.id}
                      job={job}
                      projectNumber={liveProject.projectNumber!}
                    />
                  ))}
                </div>
              )}
            </div>

            {isAdminOrManager ? (
              <>
                <JobInstructionItemsCard
                  projectId={liveProject.id}
                  initialItems={instructionItems}
                  isAdminOrManager
                  currentUserActor={null}
                  refreshSignal={instructionRefreshSignal}
                />
                <ApplyWorkTemplateCard
                  targetType="project"
                  targetId={liveProject.id}
                  onApplied={() => setInstructionRefreshSignal((value) => value + 1)}
                />
                <ProjectQualificationSection projectId={liveProject.id} />
                <JobMaterialsSection
                  projectId={liveProject.id}
                  initialLines={materialSummary.directLines}
                  inheritedJobGroups={materialSummary.jobGroups}
                  totals={materialSummary.totals}
                  inventoryItems={inventoryItems}
                  locations={inventoryLocations}
                  isAdminOrManager
                />
              </>
            ) : null}

            <WorkArtifactsSection
              targetType="project"
              targetId={liveProject.id}
              initialArtifacts={initialArtifacts}
              isManager={isAdminOrManager}
              canApprove={canApproveWorkArtifacts}
              currentUserId={currentUserId}
              documents={projectDocuments}
              evidenceRequirements={artifactEvidenceRequirements}
              instructionOptions={artifactInstructionOptions}
              timeEntryOptions={artifactTimeEntryOptions}
            />

            <ContextualDocumentsSection
              title="Dokumente"
              description="Projektdateien und verknüpfte Auftragsdokumente an einem Ort."
              documents={projectDocuments}
              jobDocumentGroups={jobDocumentGroups}
              documentTarget={{ kind: "project", projectId: liveProject.id }}
              contextLabel={liveProject.name}
              canUpload={isAdminOrManager}
              canManage={isAdminOrManager}
            />

            {/* Project Time Summary */}
            <div className="rounded-lg border bg-card p-4 sm:p-5">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-4">
                <Clock className="size-4" />
                Gesamte Zeiterfassung
              </h3>

              {isLoadingTime ? (
                <div className="space-y-3">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-8 w-3/4" />
                </div>
              ) : timeLoadError ? (
                <SectionError
                  onRetry={() => void timeView.refresh()}
                  retryPending={timeView.isRefreshing}
                >
                  Die Arbeitszeiten für dieses Projekt konnten nicht geladen werden.
                </SectionError>
              ) : projectTimeSummary.totalMinutes === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  Noch keine Arbeitszeiten für dieses Projekt erfasst.
                </p>
              ) : (
                <div className="space-y-4">
                  <div className="rounded-md bg-muted/50 p-3">
                    <p className="text-xs text-muted-foreground">
                      Gesamtstunden (alle Aufträge)
                    </p>
                    <p className="text-lg font-bold tabular-nums">
                      {formatDurationMins(
                        Math.round(projectTimeSummary.totalMinutes)
                      )}
                    </p>
                  </div>

                  {projectTimeSummary.perJob.length > 0 && (
                    <div>
                      <button
                        onClick={() => setShowTimeDetails(!showTimeDetails)}
                        className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent transition-colors"
                      >
                        <span>
                          Pro Auftrag ({projectTimeSummary.perJob.length})
                        </span>
                        <ChevronDown
                          className={cn(
                            'size-3.5 transition-transform',
                            showTimeDetails && 'rotate-180'
                          )}
                        />
                      </button>

                      {showTimeDetails && (
                        <div className="mt-2 divide-y rounded-md border">
                          {projectTimeSummary.perJob.map((pj) => {
                            const targetMinutes =
                              pj.plannedWorkingMinutes && pj.plannedWorkingMinutes > 0
                                ? pj.plannedWorkingMinutes
                                : null;
                            const hasTarget = targetMinutes !== null;
                            const progressPercentage = hasTarget
                              ? Math.min(
                                  100,
                                  (pj.minutes / targetMinutes) * 100
                                )
                              : 0;
                            const overrunMinutes =
                              hasTarget && pj.minutes > targetMinutes
                                ? pj.minutes - targetMinutes
                                : 0;
                            return (
                              <div key={pj.jobId} className="space-y-2 px-3 py-2.5">
                                <div className="flex items-center justify-between gap-3 text-sm">
                                  <span className="truncate font-medium">
                                    {pj.title}
                                  </span>
                                  <span className="shrink-0 tabular-nums text-muted-foreground">
                                    {formatDurationMins(Math.round(pj.minutes))}
                                  </span>
                                </div>
                                {hasTarget ? (
                                  <>
                                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                                      <span>
                                        {formatDurationMins(Math.round(pj.minutes))} /{' '}
                                        {formatDurationMins(targetMinutes)}
                                      </span>
                                      <span className="tabular-nums">
                                        {Math.round((pj.minutes / targetMinutes) * 100)}
                                        %
                                      </span>
                                    </div>
                                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                                      <div
                                        className="h-full rounded-full bg-primary transition-all"
                                        style={{ width: `${progressPercentage}%` }}
                                      />
                                    </div>
                                    {overrunMinutes > 0 && (
                                      <p className="text-xs text-amber-700 dark:text-amber-300">
                                        {formatDurationMins(overrunMinutes)} über dem
                                        geplanten Arbeitsaufwand
                                      </p>
                                    )}
                                  </>
                                ) : (
                                  <p className="text-xs text-muted-foreground">
                                    Kein geplanter Arbeitsaufwand hinterlegt.
                                  </p>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </PageBody>

      {/* Dialogs */}
      <CreateJobDialog
        clients={dialogClients}
        members={dialogMembers}
        projects={[{
          ...liveProject,
          client: liveClient,
          jobCount: liveJobs.length,
          completedJobCount: completedCount,
          inProgressJobCount: inProgressCount,
          parkedJobCount: parkedCount,
        }]}
        defaultProjectId={liveProject.id}
        defaultClientId={liveProject.clientId ?? undefined}
        readOnlyProject
        readOnlyClient
        open={showCreateJob}
        onOpenChange={setShowCreateJob}
        onJobCreated={({ job }) => {
          setShowCreateJob(false);
          setLiveJobs((prev) => {
            const next = prev.filter((entry) => entry.id !== job.id);
            next.push(job);
            return next;
          });
        }}
      />

      <EditProjectDialog
        project={{
          ...liveProject,
          client: liveClient,
          jobCount: liveJobs.length,
          completedJobCount: completedCount,
          inProgressJobCount: inProgressCount,
          parkedJobCount: parkedCount,
        }}
        open={showEditDialog}
        onOpenChange={setShowEditDialog}
        clients={dialogClients}
        jobs={liveJobs}
        onSuccess={({ project: nextProject, selectedJobIds }) => {
          setShowEditDialog(false);
          setLiveProject(nextProject);
          if (!selectedJobIds) return;
          setLiveJobs((prev) => {
            const selectedIds = new Set(selectedJobIds);
            return prev
              .filter((job) => selectedIds.has(job.id))
              .map((job) => ({
                ...job,
                projectId: nextProject.id,
                clientId: nextProject.clientId ?? job.clientId,
              }));
          });
        }}
      />

      <ClientAssignmentDialog
        open={showClientDialog}
        onOpenChange={setShowClientDialog}
        clients={dialogClients}
        currentClientId={liveProject.clientId}
        title="Kunde zum Projekt hinzufügen"
        isSaving={isUpdatingClient}
        onSave={handleClientSave}
      />

      <ProjectJobsAssignmentDialog
        open={showAssignJobsDialog}
        onOpenChange={(open) => {
          setShowAssignJobsDialog(open);
          if (!open) setAssignJobsError(null);
        }}
        jobs={assignableJobs}
        title="Aufträge zum Projekt hinzufügen"
        isSaving={isAssigningJobs}
        isLoading={isLoadingDialogOptions}
        loadError={dialogOptionsError}
        saveError={assignJobsError}
        onRetry={() => setDialogOptionsRefreshKey((value) => value + 1)}
        onSave={handleAssignJobsSave}
      />

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Projekt löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Möchtest du das Projekt &ldquo;{project.name}&rdquo; wirklich
              löschen? Alle zugehörigen Aufträge werden nicht gelöscht, aber ihre
              Projektzuordnung wird entfernt.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>
              Abbrechen
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting && <Loader2 className="mr-2 size-4 animate-spin" />}
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
}

function ActiveWorkIndicator() {
  return (
    <span
      className="relative ml-2 inline-flex h-2.5 w-2.5 shrink-0"
      title="Jemand arbeitet gerade an diesem Auftrag"
    >
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-500" />
    </span>
  );
}

function ChildJobRow({
  job,
  projectNumber,
}: {
  job: Job;
  projectNumber: string;
}) {
  const { activeJobIds } = useActiveJobs();
  const href = `/auftraege/projekt/${encodeURIComponent(projectNumber)}/${encodeURIComponent(job.jobNumber!)}`;

  return (
    <ListRow asChild interactive>
      <Link href={href}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">
            {job.jobNumber}
          </span>
          <span className="text-sm font-medium inline-flex items-center min-w-0">
            <span className="line-clamp-2 break-words" title={getJobDisplayTitle(job)}>
              {getJobDisplayTitle(job)}
            </span>
            {activeJobIds.has(job.id) && <ActiveWorkIndicator />}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-2">
          <Badge
            variant="secondary"
            className={cn('text-[10px]', JOB_STATUS_CLASSES[job.status])}
          >
            {JOB_STATUS_LABELS[job.status]}
          </Badge>
          <Badge
            variant="secondary"
            className={cn('text-[10px]', PRIORITY_CLASSES[job.priority])}
          >
            {JOB_PRIORITY_LABELS[job.priority]}
          </Badge>
          {job.plannedDate && (
            <span className="text-xs text-muted-foreground">
              {formatDate(job.plannedDate)}
            </span>
          )}
        </div>
      </div>
      </Link>
    </ListRow>
  );
}
