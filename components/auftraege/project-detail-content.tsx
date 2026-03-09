'use client';

import { useState, useTransition, useEffect, useCallback, useMemo } from 'react';
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

import { updateProject, deleteProject } from '@/lib/projects/actions';
import { updateJobStatus } from '@/lib/jobs/actions';
import { getTimeEntriesForJob } from '@/lib/time-tracking/actions';
import { calculateWorkSessions } from '@/lib/time-tracking/validation';
import type { TimeEntry } from '@/lib/time-tracking/types';
import { useRealtimeEvent } from '@/components/realtime/realtime-provider';
import {
  type Project,
  type Client,
  type Job,
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
};

const JOB_STATUS_CLASSES: Record<JobStatus, string> = {
  nicht_bearbeitet: 'bg-secondary text-secondary-foreground',
  in_bearbeitung:
    'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  fertig:
    'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
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
}

export function ProjectDetailContent({
  project,
  client,
  jobs,
  derivedStatus,
  clients,
  members,
  isAdminOrManager,
}: ProjectDetailContentProps) {
  const router = useRouter();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isDeleting, startDeleteTransition] = useTransition();
  const [showCreateJob, setShowCreateJob] = useState(false);
  const [statusUpdatingJobId, setStatusUpdatingJobId] = useState<string | null>(null);

  const [projectTimeEntries, setProjectTimeEntries] = useState<
    { jobId: string; jobTitle: string; entries: TimeEntry[] }[]
  >([]);
  const [isLoadingTime, setIsLoadingTime] = useState(true);
  const [showTimeDetails, setShowTimeDetails] = useState(false);

  const fetchProjectTime = useCallback(async () => {
    try {
      const results = await Promise.all(
        jobs.map(async (job) => {
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
  }, [jobs]);

  useEffect(() => {
    fetchProjectTime();
  }, [fetchProjectTime]);

  useRealtimeEvent('time_entries', () => fetchProjectTime());

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

  const completedCount = jobs.filter((j) => j.status === 'fertig').length;
  const inProgressCount = jobs.filter(
    (j) => j.status === 'in_bearbeitung'
  ).length;

  const handleDelete = () => {
    startDeleteTransition(async () => {
      const result = await deleteProject(project.id);
      if (result.success) {
        router.push('/auftraege');
        router.refresh();
      }
    });
  };

  const handleOverrideStatus = async (status: ProjectStatus | 'auto') => {
    await updateProject(project.id, {
      statusOverride: status === 'auto' ? null : status,
    });
    router.refresh();
  };

  const handleJobStatusChange = async (jobId: string, newStatus: JobStatus) => {
    setStatusUpdatingJobId(jobId);
    await updateJobStatus(jobId, newStatus);
    setStatusUpdatingJobId(null);
    router.refresh();
  };

  const metadataFields: MetadataField[] = [
    {
      label: 'Projektnummer',
      value: (
        <span className="font-mono text-xs">{project.projectNumber}</span>
      ),
    },
    {
      label: 'Name',
      value: project.name,
      editableConfig: isAdminOrManager
        ? {
            type: 'text',
            currentValue: project.name,
            onSave: async (v) => {
              await updateProject(project.id, { name: v });
            },
          }
        : undefined,
    },
    {
      label: 'Beschreibung',
      value: project.description || (
        <span className="text-muted-foreground">Keine Beschreibung</span>
      ),
      editableConfig: isAdminOrManager
        ? {
            type: 'textarea',
            currentValue: project.description ?? '',
            onSave: async (v) => {
              await updateProject(project.id, { description: v });
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
          className={PROJECT_STATUS_CLASSES[derivedStatus.status]}
        >
          {PROJECT_STATUS_LABELS[derivedStatus.status]}
        </Badge>
      ),
    },
    {
      label: 'Geplanter Beginn',
      value: formatDate(project.plannedStartDate),
      editableConfig: isAdminOrManager
        ? {
            type: 'date',
            currentValue: project.plannedStartDate ?? '',
            onSave: async (v) => {
              await updateProject(project.id, {
                plannedStartDate: v || undefined,
              });
            },
          }
        : undefined,
    },
    {
      label: 'Geplantes Ende',
      value: formatDate(project.plannedEndDate),
      editableConfig: isAdminOrManager
        ? {
            type: 'date',
            currentValue: project.plannedEndDate ?? '',
            onSave: async (v) => {
              await updateProject(project.id, {
                plannedEndDate: v || undefined,
              });
            },
          }
        : undefined,
    },
    {
      label: 'Erstellt am',
      value: formatDateTime(project.createdAt),
    },
  ];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <DetailPageHeader
        breadcrumbs={[
          { label: 'Aufträge', href: '/auftraege' },
          { label: project.projectNumber ?? 'Projekt' },
        ]}
        title={project.name}
        badges={
          <>
            <Badge
              variant="secondary"
              className={PROJECT_STATUS_CLASSES[derivedStatus.status]}
            >
              {PROJECT_STATUS_LABELS[derivedStatus.status]}
            </Badge>
            <TrafficLight status={derivedStatus.trafficLight} />
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

      <div className="flex-1 overflow-auto p-4 sm:p-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.5fr]">
          {/* Left Column: Metadata + Client */}
          <div className="space-y-6">
            <MetadataSection
              title="Details"
              fields={metadataFields}
              isEditable={isAdminOrManager}
            />

            {client ? (
              <EntityLinkCard
                title={client.name}
                href={`/kunden/${client.id}`}
                icon={<Building2 className="size-5" />}
                badge={
                  <Badge variant="outline" className="text-xs">
                    {CLIENT_TYPE_LABELS[client.clientType]}
                  </Badge>
                }
                metadata={[
                  ...(client.email
                    ? [{ label: 'E-Mail', value: client.email }]
                    : []),
                  ...(client.phone
                    ? [{ label: 'Telefon', value: client.phone }]
                    : []),
                ]}
              />
            ) : (
              <EntityLinkCard
                title=""
                href=""
                icon={<Building2 className="size-5" />}
                emptyState={{ text: 'Kein Kunde zugewiesen' }}
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
                    {derivedStatus.progress}%
                  </span>
                  <TrafficLight status={derivedStatus.trafficLight} />
                </div>
              </div>
              <Progress
                value={derivedStatus.progress}
                className="mt-4 h-2.5"
              />
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                <span>
                  {completedCount} von {jobs.length} Aufträge abgeschlossen
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
                  <span className="text-muted-foreground">({jobs.length})</span>
                </h3>
              </div>

              {jobs.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                  Noch keine Aufträge in diesem Projekt.
                </div>
              ) : (
                <div className="divide-y">
                  {jobs.map((job) => (
                    <ChildJobRow
                      key={job.id}
                      job={job}
                      projectNumber={project.projectNumber!}
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
        clients={clients}
        members={members}
        projects={[]}
        defaultProjectId={project.id}
        open={showCreateJob}
        onOpenChange={setShowCreateJob}
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
      className="relative ml-1.5 inline-flex h-2 w-2 shrink-0"
      title="Jemand arbeitet gerade an diesem Auftrag"
    >
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
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
          <span className="truncate text-sm font-medium inline-flex items-center">
            {job.title}
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
