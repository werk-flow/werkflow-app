'use client';

import { useState, useTransition, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Building2,
  FolderOpen,
  Users,
  FileText,
  Clock,
  Trash2,
  MoreVertical,
  Loader2,
  X,
  UserPlus,
  ChevronDown,
} from 'lucide-react';
import { useActiveJobs } from '@/hooks/use-active-jobs';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import { DetailPageHeader } from '@/components/shared/detail-page-header';
import {
  MetadataSection,
  type MetadataField,
} from '@/components/shared/metadata-section';
import { EntityLinkCard } from '@/components/shared/entity-link-card';
import { PlaceholderSection } from '@/components/shared/placeholder-section';
import { EmployeeMultiSelect } from './employee-multi-select';
import { ParkConfirmationDialog } from './park-confirmation-dialog';
import { Skeleton } from '@/components/ui/skeleton';

import {
  updateJob,
  updateJobStatus,
  deleteJob,
  assignEmployee,
  unassignEmployee,
} from '@/lib/jobs/actions';
import { getTimeEntriesForJob } from '@/lib/time-tracking/actions';
import { calculateWorkSessions } from '@/lib/time-tracking/validation';
import type { TimeEntry } from '@/lib/time-tracking/types';
import { useRealtimeEvent } from '@/components/realtime/realtime-provider';
import {
  type JobWithDetails,
  type JobStatus,
  type JobPriority,
  type Project,
  JOB_STATUS_LABELS,
  JOB_PRIORITY_LABELS,
  CLIENT_TYPE_LABELS,
  normalizeJobPlannedTime,
} from '@/lib/jobs/types';
import type { OrgMemberOption } from './employee-multi-select';
import { cn } from '@/lib/utils';

const JOB_STATUS_CLASSES: Record<JobStatus, string> = {
  nicht_bearbeitet: 'bg-secondary text-secondary-foreground',
  in_bearbeitung:
    'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  fertig:
    'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  geparkt:
    'bg-purple-500/15 text-purple-700 dark:text-purple-300',
};

const PRIORITY_CLASSES: Record<JobPriority, string> = {
  niedrig: 'bg-secondary text-secondary-foreground',
  mittel: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  hoch: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
};

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

function formatPlannedTime(plannedTime: string | null): string {
  return normalizeJobPlannedTime(plannedTime) ?? '—';
}

function formatDuration(minutes: number | null): string {
  if (!minutes) return '—';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m} Min.`;
  if (m === 0) return `${h} Std.`;
  return `${h} Std. ${m} Min.`;
}

function getInitials(firstName: string | null, lastName: string | null): string {
  const f = firstName?.charAt(0) ?? '';
  const l = lastName?.charAt(0) ?? '';
  return (f + l).toUpperCase() || '?';
}

interface JobDetailContentProps {
  job: JobWithDetails;
  parentProject?: Pick<Project, 'id' | 'name' | 'projectNumber'>;
  members: OrgMemberOption[];
  isAdminOrManager: boolean;
}

export function JobDetailContent({
  job,
  parentProject,
  members,
  isAdminOrManager,
}: JobDetailContentProps) {
  const router = useRouter();
  const { activeJobIds } = useActiveJobs();
  const isJobActive = activeJobIds.has(job.id);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isDeleting, startDeleteTransition] = useTransition();
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [showParkDialog, setShowParkDialog] = useState(false);
  const [unassigningUserId, setUnassigningUserId] = useState<string | null>(
    null
  );
  const [assignSelectedIds, setAssignSelectedIds] = useState<string[]>([]);
  const [isAssigning, startAssignTransition] = useTransition();

  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([]);
  const [isLoadingTime, setIsLoadingTime] = useState(true);
  const [showAllSessions, setShowAllSessions] = useState(false);

  const fetchTimeEntries = useCallback(async () => {
    try {
      const result = await getTimeEntriesForJob(job.id);
      if (result.success) {
        setTimeEntries(result.entries);
      }
    } catch (err) {
      console.error('Error fetching time entries for job:', err);
    } finally {
      setIsLoadingTime(false);
    }
  }, [job.id]);

  useEffect(() => {
    fetchTimeEntries();
  }, [fetchTimeEntries]);

  useRealtimeEvent('time_entries', () => fetchTimeEntries());

  const workSessions = useMemo(() => {
    const entriesByUser: Record<string, TimeEntry[]> = {};
    for (const e of timeEntries) {
      if (!entriesByUser[e.userId]) entriesByUser[e.userId] = [];
      entriesByUser[e.userId].push(e);
    }
    return Object.values(entriesByUser)
      .flatMap((ue) => calculateWorkSessions(ue))
      .filter((s) => s.clockIn && s.clockOut)
      .sort((a, b) =>
        new Date(b.clockIn!.timestamp).getTime() -
        new Date(a.clockIn!.timestamp).getTime()
      );
  }, [timeEntries]);

  const totalMinutes = useMemo(
    () =>
      workSessions.reduce(
        (sum, s) => sum + (s.durationMinutes ?? 0),
        0
      ),
    [workSessions]
  );

  const perEmployeeMinutes = useMemo(() => {
    const map: Record<string, { name: string; minutes: number }> = {};
    for (const s of workSessions) {
      if (!s.clockIn) continue;
      const uid = s.clockIn.userId;
      if (!map[uid]) {
        const a = job.assignments.find((a) => a.userId === uid);
        const name = a
          ? [a.firstName, a.lastName].filter(Boolean).join(' ') ||
            a.email ||
            'Mitarbeiter'
          : 'Mitarbeiter';
        map[uid] = { name, minutes: 0 };
      }
      map[uid].minutes += s.durationMinutes ?? 0;
    }
    return Object.values(map).sort((a, b) => b.minutes - a.minutes);
  }, [workSessions, job.assignments]);

  const projectInfo = parentProject ?? job.project;

  const handleDelete = () => {
    startDeleteTransition(async () => {
      const result = await deleteJob(job.id);
      if (result.success) {
        const deletedParam = `?deleted_job=${encodeURIComponent(job.title)}`;
        if (projectInfo?.projectNumber) {
          router.push(
            `/auftraege/projekt/${encodeURIComponent(projectInfo.projectNumber!)}${deletedParam}`
          );
        } else {
          router.push(`/auftraege${deletedParam}`);
        }
      }
    });
  };

  const handleStatusChange = async (newStatus: JobStatus) => {
    if (newStatus === 'geparkt') {
      setShowParkDialog(true);
      return;
    }
    await updateJobStatus(job.id, newStatus);
    router.refresh();
  };

  const handleParkConfirm = async () => {
    await updateJobStatus(job.id, 'geparkt');
    router.refresh();
  };

  const handleAssignEmployees = () => {
    startAssignTransition(async () => {
      const newIds = assignSelectedIds.filter(
        (id) => !job.assignments.some((a) => a.userId === id)
      );
      await Promise.allSettled(newIds.map((id) => assignEmployee(job.id, id)));
      setShowAssignDialog(false);
      setAssignSelectedIds([]);
      router.refresh();
    });
  };

  const handleUnassign = async (userId: string) => {
    setUnassigningUserId(userId);
    await unassignEmployee(job.id, userId);
    setUnassigningUserId(null);
    router.refresh();
  };

  const breadcrumbs = projectInfo?.projectNumber
    ? [
        { label: 'Aufträge', href: '/auftraege' },
        {
          label: projectInfo.projectNumber,
          href: `/auftraege/projekt/${encodeURIComponent(projectInfo.projectNumber)}`,
        },
        { label: job.jobNumber ?? 'Auftrag' },
      ]
    : [
        { label: 'Aufträge', href: '/auftraege' },
        { label: job.jobNumber ?? 'Auftrag' },
      ];

  const metadataFields: MetadataField[] = [
    {
      label: 'Auftragsnummer',
      value: <span className="font-mono text-xs">{job.jobNumber}</span>,
    },
    {
      label: 'Titel',
      value: job.title,
      editableConfig: isAdminOrManager
        ? {
            type: 'text',
            currentValue: job.title,
            onSave: async (v) => {
              await updateJob(job.id, { title: v });
            },
          }
        : undefined,
    },
    {
      label: 'Beschreibung',
      value: job.description || (
        <span className="text-muted-foreground">Keine Beschreibung</span>
      ),
      editableConfig: isAdminOrManager
        ? {
            type: 'textarea',
            currentValue: job.description ?? '',
            onSave: async (v) => {
              await updateJob(job.id, { description: v });
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
          className={JOB_STATUS_CLASSES[job.status]}
        >
          {JOB_STATUS_LABELS[job.status]}
        </Badge>
      ),
      editableConfig: isAdminOrManager
        ? {
            type: 'select',
            currentValue: job.status,
            onSave: async (v) => {
              if (v === 'geparkt') {
                setShowParkDialog(true);
                return;
              }
              await updateJobStatus(job.id, v as JobStatus);
            },
            options: Object.entries(JOB_STATUS_LABELS).map(([value, label]) => ({
              value,
              label,
            })),
          }
        : undefined,
    },
    {
      label: 'Priorität',
      value: (
        <Badge variant="secondary" className={PRIORITY_CLASSES[job.priority]}>
          {JOB_PRIORITY_LABELS[job.priority]}
        </Badge>
      ),
      editableConfig: isAdminOrManager
        ? {
            type: 'select',
            currentValue: job.priority,
            onSave: async (v) => {
              await updateJob(job.id, { priority: v as JobPriority });
            },
            options: Object.entries(JOB_PRIORITY_LABELS).map(
              ([value, label]) => ({ value, label })
            ),
          }
        : undefined,
    },
    {
      label: 'Geplantes Datum',
      value: formatDate(job.plannedDate),
      editableConfig: isAdminOrManager
        ? {
            type: 'date',
            currentValue: job.plannedDate ?? '',
            onSave: async (v) => {
              await updateJob(job.id, { plannedDate: v || undefined });
            },
          }
        : undefined,
    },
    {
      label: 'Geplante Uhrzeit',
      value: formatPlannedTime(job.plannedTime),
      editableConfig: isAdminOrManager
        ? {
            type: 'text',
            currentValue: normalizeJobPlannedTime(job.plannedTime) ?? '',
            onSave: async (v) => {
              await updateJob(job.id, { plannedTime: v || undefined });
            },
            placeholder: 'z.B. 08:00',
          }
        : undefined,
    },
    {
      label: 'Geschätzte Dauer',
      value: formatDuration(job.estimatedDurationMinutes),
    },
    {
      label: 'Ort',
      value: job.location || '—',
      editableConfig: isAdminOrManager
        ? {
            type: 'text',
            currentValue: job.location ?? '',
            onSave: async (v) => {
              await updateJob(job.id, { location: v || undefined });
            },
            placeholder: 'Adresse oder Ort',
          }
        : undefined,
    },
    ...(job.actualCompletionDate
      ? [
          {
            label: 'Abschlussdatum',
            value: formatDate(job.actualCompletionDate),
          },
        ]
      : []),
    {
      label: 'Erstellt am',
      value: formatDateTime(job.createdAt),
    },
  ];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <DetailPageHeader
        breadcrumbs={breadcrumbs}
        title={
          <span className="inline-flex items-center gap-1 overflow-visible">
            {job.title}
            {isJobActive && (
              <span className="relative ml-1 mr-1 inline-flex h-3 w-3 shrink-0" title="Jemand arbeitet gerade an diesem Auftrag">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex h-3 w-3 rounded-full bg-green-500" />
              </span>
            )}
          </span>
        }
        badges={
          <>
            <Badge
              variant="secondary"
              className={JOB_STATUS_CLASSES[job.status]}
            >
              {JOB_STATUS_LABELS[job.status]}
            </Badge>
            <Badge
              variant="secondary"
              className={PRIORITY_CLASSES[job.priority]}
            >
              {JOB_PRIORITY_LABELS[job.priority]}
            </Badge>
          </>
        }
        actions={
          isAdminOrManager ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="size-8">
                  <MoreVertical className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>Status ändern</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {(
                      Object.entries(JOB_STATUS_LABELS) as [
                        JobStatus,
                        string,
                      ][]
                    ).map(([value, label]) => (
                      <DropdownMenuItem
                        key={value}
                        onClick={() => handleStatusChange(value)}
                        disabled={job.status === value}
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
                  Auftrag löschen
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : undefined
        }
      />

      <div className="flex-1 overflow-auto p-4 sm:p-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1fr]">
          {/* Left Column: Metadata + Client + Employees */}
          <div className="space-y-6">
            <MetadataSection
              title="Details"
              fields={metadataFields}
              isEditable={isAdminOrManager}
            />

            {job.client ? (
              <EntityLinkCard
                title={job.client.name}
                href={`/kunden/${job.client.id}`}
                icon={<Building2 className="size-5" />}
                badge={
                  <Badge variant="outline" className="text-xs">
                    {CLIENT_TYPE_LABELS[job.client.clientType]}
                  </Badge>
                }
                metadata={[
                  ...(job.client.email
                    ? [{ label: 'E-Mail', value: job.client.email }]
                    : []),
                  ...(job.client.phone
                    ? [{ label: 'Telefon', value: job.client.phone }]
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

            {/* Assigned Employees */}
            <div className="rounded-lg border bg-card p-4 sm:p-5">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  <Users className="size-4" />
                  Zugewiesene Mitarbeiter
                </h3>
                {isAdminOrManager && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1 text-xs"
                    onClick={() => {
                      setAssignSelectedIds(
                        job.assignments.map((a) => a.userId)
                      );
                      setShowAssignDialog(true);
                    }}
                  >
                    <UserPlus className="size-3" />
                    Zuweisen
                  </Button>
                )}
              </div>
              {job.assignments.length === 0 ? (
                <p className="py-2 text-center text-sm text-muted-foreground">
                  Keine Mitarbeiter zugewiesen.
                </p>
              ) : (
                <div className="divide-y">
                  {job.assignments.map((a) => (
                    <div
                      key={a.userId}
                      className="flex items-center gap-3 py-2"
                    >
                      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
                        {getInitials(a.firstName, a.lastName)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/mitarbeiter/${a.userId}`}
                          className="text-sm font-medium hover:underline"
                        >
                          {[a.firstName, a.lastName]
                            .filter(Boolean)
                            .join(' ') || a.email}
                        </Link>
                        {a.email && (
                          <p className="truncate text-xs text-muted-foreground">
                            {a.email}
                          </p>
                        )}
                      </div>
                      {isAdminOrManager && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-6 shrink-0"
                          onClick={() => handleUnassign(a.userId)}
                          disabled={unassigningUserId === a.userId}
                        >
                          {unassigningUserId === a.userId ? (
                            <Loader2 className="size-3 animate-spin" />
                          ) : (
                            <X className="size-3" />
                          )}
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Project + Placeholders */}
          <div className="space-y-6">
            {projectInfo?.projectNumber ? (
              <EntityLinkCard
                title={projectInfo.name}
                href={`/auftraege/projekt/${encodeURIComponent(projectInfo.projectNumber)}`}
                icon={<FolderOpen className="size-5" />}
                metadata={[
                  {
                    label: 'Projektnummer',
                    value: projectInfo.projectNumber,
                  },
                ]}
              />
            ) : (
              <EntityLinkCard
                title=""
                href=""
                icon={<FolderOpen className="size-5" />}
                emptyState={{ text: 'Keinem Projekt zugeordnet' }}
              />
            )}

            <PlaceholderSection
              title="Dokumente"
              description="Dokumente und Dateien werden hier in einer zukünftigen Version verfügbar sein."
              icon={<FileText className="size-8" />}
            />

            {/* Zeiterfassung und Aktivität */}
            <div className="rounded-lg border bg-card p-4 sm:p-5">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-4">
                <Clock className="size-4" />
                Zeiterfassung &amp; Aktivität
              </h3>

              {isLoadingTime ? (
                <div className="space-y-3">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-8 w-3/4" />
                  <Skeleton className="h-8 w-1/2" />
                </div>
              ) : workSessions.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  Noch keine Arbeitszeiten für diesen Auftrag erfasst.
                </p>
              ) : (
                <div className="space-y-4">
                  {/* Summary stats */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-md bg-muted/50 p-3">
                      <p className="text-xs text-muted-foreground">Gesamt</p>
                      <p className="text-lg font-bold tabular-nums">
                        {formatDuration(Math.round(totalMinutes))}
                      </p>
                    </div>
                    <div className="rounded-md bg-muted/50 p-3">
                      <p className="text-xs text-muted-foreground">Einträge</p>
                      <p className="text-lg font-bold tabular-nums">
                        {workSessions.length}
                      </p>
                    </div>
                  </div>

                  {/* Per-employee breakdown */}
                  {perEmployeeMinutes.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">
                        Pro Mitarbeiter
                      </p>
                      {perEmployeeMinutes.map((emp) => {
                        const pct =
                          totalMinutes > 0
                            ? (emp.minutes / totalMinutes) * 100
                            : 0;
                        return (
                          <div key={emp.name} className="space-y-1">
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-medium truncate">
                                {emp.name}
                              </span>
                              <span className="text-muted-foreground tabular-nums">
                                {formatDuration(Math.round(emp.minutes))}
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

                  {/* Session timeline */}
                  <div>
                    <button
                      onClick={() => setShowAllSessions(!showAllSessions)}
                      className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent transition-colors"
                    >
                      <span>
                        Einzelne Einträge ({workSessions.length})
                      </span>
                      <ChevronDown
                        className={cn(
                          'size-3.5 transition-transform',
                          showAllSessions && 'rotate-180'
                        )}
                      />
                    </button>

                    {showAllSessions && (
                      <div className="mt-2 divide-y max-h-64 overflow-auto">
                        {workSessions.map((s, idx) => {
                          if (!s.clockIn || !s.clockOut) return null;
                          const emp = job.assignments.find(
                            (a) => a.userId === s.clockIn!.userId
                          );
                          const empName = emp
                            ? [emp.firstName, emp.lastName]
                                .filter(Boolean)
                                .join(' ') || emp.email
                            : 'Mitarbeiter';

                          return (
                            <div key={idx} className="flex items-center gap-3 py-2 text-sm">
                              <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-medium text-primary">
                                {getInitials(
                                  emp?.firstName ?? null,
                                  emp?.lastName ?? null
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="text-xs font-medium truncate">
                                  {empName}
                                </p>
                                <p className="text-[10px] text-muted-foreground">
                                  {new Date(
                                    s.clockIn.timestamp
                                  ).toLocaleDateString('de-DE', {
                                    day: '2-digit',
                                    month: '2-digit',
                                    year: 'numeric',
                                  })}
                                  {' · '}
                                  {new Date(
                                    s.clockIn.timestamp
                                  ).toLocaleTimeString('de-DE', {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })}
                                  {' – '}
                                  {new Date(
                                    s.clockOut.timestamp
                                  ).toLocaleTimeString('de-DE', {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })}
                                </p>
                              </div>
                              <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                                {formatDuration(
                                  Math.round(s.durationMinutes ?? 0)
                                )}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Delete Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Auftrag löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Möchtest du den Auftrag &ldquo;{job.title}&rdquo; wirklich
              löschen? Diese Aktion kann nicht rückgängig gemacht werden.
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

      {/* Assign Employee Dialog */}
      <Dialog open={showAssignDialog} onOpenChange={setShowAssignDialog}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Mitarbeiter zuweisen</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <EmployeeMultiSelect
              members={members}
              selectedIds={assignSelectedIds}
              onSelectionChange={setAssignSelectedIds}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setShowAssignDialog(false)}
              disabled={isAssigning}
            >
              Abbrechen
            </Button>
            <Button onClick={handleAssignEmployees} disabled={isAssigning}>
              {isAssigning && (
                <Loader2 className="mr-2 size-4 animate-spin" />
              )}
              Speichern
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <ParkConfirmationDialog
        open={showParkDialog}
        onOpenChange={setShowParkDialog}
        variant="job"
        title={job.title}
        identifier={job.jobNumber ?? undefined}
        onConfirm={handleParkConfirm}
      />
    </div>
  );
}
