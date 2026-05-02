'use client';

import {
  useState,
  useTransition,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Plus,
  Building2,
  FileText,
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
import { Progress } from '@/components/ui/progress';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
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
import { MetadataSection, type MetadataField } from '@/components/shared/metadata-section';
import { EntityLinkCard } from '@/components/shared/entity-link-card';
import { PlaceholderSection } from '@/components/shared/placeholder-section';
import { Skeleton } from '@/components/ui/skeleton';
import { CreateJobDialog } from './create-job-dialog';
import { ClientAssignmentDialog } from './client-assignment-dialog';
import { EditProjectDialog } from './edit-project-dialog';
import { ProjectJobsAssignmentDialog } from './project-jobs-assignment-dialog';

import { updateProject, deleteProject } from '@/lib/projects/actions';
import {
  getAuftraegeDialogOptions,
  updateJob,
  updateJobStatus,
} from '@/lib/jobs/actions';
import { getTimeEntriesForJob } from '@/lib/time-tracking/actions';
import { calculateWorkSessions } from '@/lib/time-tracking/validation';
import type { TimeEntry } from '@/lib/time-tracking/types';
import { useRealtimeEvent } from '@/components/realtime/realtime-provider';
import {
  toJob,
  toProject,
  calculateProjectProgress,
  calculateTrafficLight,
  getEffectiveProjectStatus,
  type Project,
  type ProjectRow,
  type Client,
  type Job,
  type JobRow,
  type DerivedProjectStatus,
  type ProjectStatus,
  type JobStatus,
  PROJECT_STATUS_LABELS,
  JOB_STATUS_LABELS,
  JOB_PRIORITY_LABELS,
  CLIENT_TYPE_LABELS,
} from '@/lib/jobs/types';
import type { OrgMemberOption } from './employee-multi-select';
import { cn } from '@/lib/utils';

const PROJECT_STATUS_CLASSES: Record<ProjectStatus, string> = {
  nicht_begonnen: 'bg-secondary text-secondary-foreground',
  in_bearbeitung:
    'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  abgeschlossen:
    'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  geparkt:
    'bg-purple-500/15 text-purple-700 dark:text-purple-300',
};

const JOB_STATUS_CLASSES: Record<JobStatus, string> = {
  nicht_bearbeitet: 'bg-secondary text-secondary-foreground',
  in_bearbeitung:
    'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  fertig:
    'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  geparkt:
    'bg-purple-500/15 text-purple-700 dark:text-purple-300',
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
  availableJobs?: Job[];
  derivedStatus: DerivedProjectStatus;
  clients: Client[];
  members: OrgMemberOption[];
  isAdminOrManager: boolean;
}

export function ProjectDetailContent({
  project,
  client,
  jobs,
  availableJobs = [],
  derivedStatus,
  clients,
  members,
  isAdminOrManager,
}: ProjectDetailContentProps) {
  const router = useRouter();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isDeleting, startDeleteTransition] = useTransition();
  const [showCreateJob, setShowCreateJob] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showClientDialog, setShowClientDialog] = useState(false);
  const [showAssignJobsDialog, setShowAssignJobsDialog] = useState(false);
  const [statusUpdatingJobId, setStatusUpdatingJobId] = useState<string | null>(null);
  const [isUpdatingClient, startClientUpdateTransition] = useTransition();
  const [isAssigningJobs, startAssignJobsTransition] = useTransition();
  const [dialogClients, setDialogClients] = useState(clients);
  const [dialogMembers, setDialogMembers] = useState(members);
  const [dialogAvailableJobs, setDialogAvailableJobs] = useState(availableJobs);
  const [isLoadingDialogOptions, setIsLoadingDialogOptions] = useState(false);
  const [hasLoadedDialogOptions, setHasLoadedDialogOptions] = useState(
    clients.length > 1 || members.length > 0 || availableJobs.length > 0
  );
  const [liveProject, setLiveProject] = useState(project);
  const [liveJobs, setLiveJobs] = useState(jobs);
  const repairTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [projectTimeEntries, setProjectTimeEntries] = useState<
    { jobId: string; jobTitle: string; entries: TimeEntry[] }[]
  >([]);
  const [isLoadingTime, setIsLoadingTime] = useState(true);
  const [showTimeDetails, setShowTimeDetails] = useState(false);

  useEffect(() => {
    setLiveProject(project);
  }, [project]);

  useEffect(() => {
    setLiveJobs(jobs);
  }, [jobs]);

  useEffect(() => {
    return () => {
      if (repairTimerRef.current) {
        clearTimeout(repairTimerRef.current);
      }
    };
  }, []);

  const scheduleRepair = useCallback(() => {
    if (repairTimerRef.current) {
      clearTimeout(repairTimerRef.current);
    }

    repairTimerRef.current = setTimeout(() => {
      repairTimerRef.current = null;
      router.refresh();
    }, 150);
  }, [router]);

  useEffect(() => {
    if (
      !isAdminOrManager ||
      hasLoadedDialogOptions ||
      isLoadingDialogOptions ||
      (!showCreateJob && !showEditDialog && !showClientDialog && !showAssignJobsDialog)
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
        setDialogAvailableJobs(result.jobs);
        setHasLoadedDialogOptions(true);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingDialogOptions(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    hasLoadedDialogOptions,
    isAdminOrManager,
    isLoadingDialogOptions,
    showAssignJobsDialog,
    showClientDialog,
    showCreateJob,
    showEditDialog,
  ]);

  const liveClient = useMemo(
    () => clients.find((entry) => entry.id === liveProject.clientId) ?? null,
    [clients, liveProject.clientId]
  );

  const fetchProjectTime = useCallback(async () => {
    try {
      const results = await Promise.all(
        liveJobs.map(async (job) => {
          const result = await getTimeEntriesForJob(job.id);
          return {
            jobId: job.id,
            jobTitle: job.title,
            entries: result.success ? result.entries : [],
          };
        })
      );
      setProjectTimeEntries(results);
    } catch (err) {
      console.error('Error fetching project time entries:', err);
    } finally {
      setIsLoadingTime(false);
    }
  }, [liveJobs]);

  useEffect(() => {
    fetchProjectTime();
  }, [fetchProjectTime]);

  useRealtimeEvent('time_entries', () => fetchProjectTime());
  useRealtimeEvent('projects', (event) => {
    if (!event.new && !event.old) {
      scheduleRepair();
      return;
    }

    const newId = (event.new as { id?: string } | null)?.id;
    const oldId = (event.old as { id?: string } | null)?.id;

    if (event.eventType === 'DELETE' && oldId === liveProject.id) {
      router.push('/auftraege');
      return;
    }

    if (newId !== liveProject.id) return;
    setLiveProject(toProject(event.new as ProjectRow));
  });
  useRealtimeEvent('jobs', (event) => {
    if (!event.new && !event.old) {
      scheduleRepair();
      return;
    }

    if (event.eventType === 'DELETE') {
      const oldRow = event.old as { id?: string; project_id?: string | null } | null;
      if (!oldRow?.id || oldRow.project_id !== liveProject.id) return;
      setLiveJobs((prev) => prev.filter((job) => job.id !== oldRow.id));
      return;
    }

    if (!event.new) return;
    const nextJob = toJob(event.new as JobRow);

    setLiveJobs((prev) => {
      const withoutJob = prev.filter((job) => job.id !== nextJob.id);
      if (nextJob.projectId !== liveProject.id) {
        return withoutJob;
      }

      return [...withoutJob, nextJob];
    });
  });

  const projectTimeSummary = useMemo(() => {
    let totalMinutes = 0;
    const perJob: { title: string; minutes: number }[] = [];

    for (const { jobTitle, entries } of projectTimeEntries) {
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
        perJob.push({ title: jobTitle, minutes: jobMin });
      }
    }

    return { totalMinutes, perJob: perJob.sort((a, b) => b.minutes - a.minutes) };
  }, [projectTimeEntries]);

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
    startDeleteTransition(async () => {
      const result = await deleteProject(project.id);
      if (result.success) {
        router.push(`/auftraege?deleted_project=${encodeURIComponent(project.name)}`);
      }
    });
  };

  const handleOverrideStatus = async (status: ProjectStatus | 'auto') => {
    const result = await updateProject(project.id, {
      statusOverride: status === 'auto' ? null : status,
    });
    if (result.success) setLiveProject(result.project);
  };

  const handleJobStatusChange = async (jobId: string, newStatus: JobStatus) => {
    setStatusUpdatingJobId(jobId);
    const result = await updateJobStatus(jobId, newStatus);
    setStatusUpdatingJobId(null);
    if (result.success) {
      setLiveJobs((prev) =>
        prev.map((job) => (job.id === jobId ? result.job : job))
      );
    }
  };

  const handleClientSave = async (clientId: string) => {
    startClientUpdateTransition(async () => {
      const result = await updateProject(project.id, {
        clientId,
      });
      setShowClientDialog(false);
      if (result.success) setLiveProject(result.project);
    });
  };

  const assignableJobs = useMemo(
    () =>
      dialogAvailableJobs.filter((job) => !job.projectId && job.status !== 'fertig'),
    [dialogAvailableJobs]
  );

  const handleAssignJobsSave = async (jobIds: string[]) => {
    startAssignJobsTransition(async () => {
      await Promise.allSettled(
        jobIds.map((jobId) => updateJob(jobId, { projectId: project.id }))
      );
      setShowAssignJobsDialog(false);
      setLiveJobs((prev) => {
        const knownIds = new Set(prev.map((job) => job.id));
        const promotedJobs = dialogAvailableJobs
          .filter((job) => jobIds.includes(job.id) && !knownIds.has(job.id))
          .map((job) => ({
            ...job,
            projectId: project.id,
            clientId: project.clientId ?? job.clientId,
          }));

        return [...prev, ...promotedJobs];
      });
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
      label: 'Name',
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
      editableConfig: isAdminOrManager
        ? {
            type: 'select' as const,
            currentValue: liveProject.statusOverride ?? 'auto',
            onSave: async (v: string) => {
              await handleOverrideStatus(v as ProjectStatus | 'auto');
            },
            options: [
              { value: 'auto', label: 'Automatisch (aus Aufträgen)' },
              ...Object.entries(PROJECT_STATUS_LABELS).map(([value, label]) => ({
                value,
                label,
              })),
            ],
          }
        : undefined,
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
                plannedStartDate: v || undefined,
              });
              if (result.success) setLiveProject(result.project);
            },
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
                plannedEndDate: v || undefined,
              });
              if (result.success) setLiveProject(result.project);
            },
          }
        : undefined,
    },
    {
      label: 'Erstellt am',
      value: formatDateTime(liveProject.createdAt),
    },
  ];

  return (
    <div className="flex h-full flex-col overflow-hidden">
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
                  <Button variant="outline" size="icon" className="size-8">
                    <MoreVertical className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setShowEditDialog(true)}>
                    <Pencil className="mr-2 size-4" />
                    Bearbeiten
                  </DropdownMenuItem>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      Status überschreiben
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      <DropdownMenuItem
                        onClick={() => handleOverrideStatus('auto')}
                      >
                        Automatisch (aus Aufträgen)
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      {(
                        Object.entries(PROJECT_STATUS_LABELS) as [
                          ProjectStatus,
                          string,
                        ][]
                      ).map(([value, label]) => (
                        <DropdownMenuItem
                          key={value}
                          onClick={() => handleOverrideStatus(value)}
                        >
                          {label}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
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

      <div className="flex-1 overflow-auto px-4 pb-24 pt-4 sm:px-6 sm:pb-28 sm:pt-6">
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
                <div className="divide-y">
                  {liveJobs.map((job) => (
                    <ChildJobRow
                      key={job.id}
                      job={job}
                      projectNumber={liveProject.projectNumber!}
                      isAdminOrManager={isAdminOrManager}
                      isUpdating={statusUpdatingJobId === job.id}
                      onStatusChange={handleJobStatusChange}
                    />
                  ))}
                </div>
              )}
            </div>

            <PlaceholderSection
              title="Dokumente"
              description="Dokumente und Dateien werden hier in einer zukünftigen Version verfügbar sein."
              icon={<FileText className="size-8" />}
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
                        <div className="mt-2 space-y-2">
                          {projectTimeSummary.perJob.map((pj) => {
                            const pct =
                              projectTimeSummary.totalMinutes > 0
                                ? (pj.minutes /
                                    projectTimeSummary.totalMinutes) *
                                  100
                                : 0;
                            return (
                              <div key={pj.title} className="space-y-1">
                                <div className="flex items-center justify-between text-xs">
                                  <span className="font-medium truncate">
                                    {pj.title}
                                  </span>
                                  <span className="text-muted-foreground tabular-nums">
                                    {formatDurationMins(Math.round(pj.minutes))}
                                  </span>
                                </div>
                                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                                  <div
                                    className="h-full rounded-full bg-primary transition-all"
                                    style={{ width: `${pct}%` }}
                                  />
                                </div>
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
      </div>

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
        onOpenChange={setShowAssignJobsDialog}
        jobs={assignableJobs}
        title="Aufträge zum Projekt hinzufügen"
        isSaving={isAssigningJobs || isLoadingDialogOptions}
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
    </div>
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
  isAdminOrManager,
  isUpdating,
  onStatusChange,
}: {
  job: Job;
  projectNumber: string;
  isAdminOrManager: boolean;
  isUpdating: boolean;
  onStatusChange: (jobId: string, status: JobStatus) => void;
}) {
  const { activeJobIds } = useActiveJobs();
  const href = `/auftraege/projekt/${encodeURIComponent(projectNumber)}/${encodeURIComponent(job.jobNumber!)}`;

  return (
    <Link
      href={href}
      className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/50"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">
            {job.jobNumber}
          </span>
          <span className="text-sm font-medium inline-flex items-center min-w-0">
            <span className="truncate">{job.title}</span>
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

      {isAdminOrManager && (
        <div onClick={(e) => e.preventDefault()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 shrink-0"
                onClick={(e) => e.stopPropagation()}
              >
                {isUpdating ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <MoreVertical className="size-3.5" />
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>Status ändern</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {(
                    Object.entries(JOB_STATUS_LABELS) as [JobStatus, string][]
                  ).map(([value, label]) => (
                    <DropdownMenuItem
                      key={value}
                      onClick={(e) => {
                        e.stopPropagation();
                        onStatusChange(job.id, value);
                      }}
                      disabled={job.status === value}
                    >
                      {label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </Link>
  );
}
