'use client';

import { useState, useTransition, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Building2,
  FolderOpen,
  Users,
  Clock,
  Trash2,
  MoreVertical,
  Loader2,
  X,
  UserPlus,
  ChevronDown,
  Pencil,
} from 'lucide-react';
import { useActiveJobs } from '@/hooks/use-active-jobs';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
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
import { ContextualDocumentsSection } from '@/components/dokumente/contextual-documents-section';
import { EmployeeMultiSelect } from './employee-multi-select';
import { ParkConfirmationDialog } from './park-confirmation-dialog';
import { ClientAssignmentDialog } from './client-assignment-dialog';
import { EditJobDialog } from './edit-job-dialog';
import { JobInstructionItemsCard } from './job-instruction-items-card';
import { ProjectAssignmentDialog } from './project-assignment-dialog';
import { Skeleton } from '@/components/ui/skeleton';

import {
  updateJob,
  updateJobStatus,
  deleteJob,
  assignEmployee,
  unassignEmployee,
  getAuftraegeDialogOptions,
} from '@/lib/jobs/actions';
import { updateProject } from '@/lib/projects/actions';
import { getTimeEntriesForJob } from '@/lib/time-tracking/actions';
import { calculateWorkSessions } from '@/lib/time-tracking/validation';
import type { TimeEntry } from '@/lib/time-tracking/types';
import { getProfileAvatarUrl } from '@/lib/profile-avatar';
import {
  calculatePlannedWorkingMinutes,
  formatMinutesAsHoursInput,
  parseHoursInputToMinutes,
} from '@/lib/jobs/planned-working';
import { useRealtimeEvent } from '@/components/realtime/realtime-provider';
import { useRealtimeRouterRefresh } from '@/hooks/use-realtime-router-refresh';
import {
  getJobDisplayTitle,
  type JobWithDetails,
  type JobStatus,
  type JobPriority,
  type JobInstructionItemWithDetails,
  type Project,
  type ProjectWithDetails,
  type Client,
  JOB_STATUS_LABELS,
  JOB_PRIORITY_LABELS,
  CLIENT_TYPE_LABELS,
  normalizeJobPlannedTime,
} from '@/lib/jobs/types';
import type { OrgMemberOption } from './employee-multi-select';
import type { OrganizationDocument } from '@/lib/documents/types';
import { cn } from '@/lib/utils';

const JOB_STATUS_CLASSES: Record<JobStatus, string> = {
  nicht_bearbeitet: 'bg-secondary text-secondary-foreground',
  in_bearbeitung:
    'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  fertig:
    'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  geparkt:
    'bg-brand-purple/15 text-brand-purple-dark dark:text-brand-purple-light',
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
  if (minutes === null || minutes === undefined) return '—';
  if (minutes === 0) return '0 Min.';
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

type SessionPerson = {
  firstName: string | null;
  lastName: string | null;
  email?: string | null;
  avatarPath?: string | null;
};

function getSessionPersonName(person?: SessionPerson | null): string {
  if (!person) return 'Mitarbeiter';
  return (
    [person.firstName, person.lastName].filter(Boolean).join(' ') ||
    person.email ||
    'Mitarbeiter'
  );
}

function PersonAvatar({
  person,
  className,
  fallbackClassName,
}: {
  person?: SessionPerson | null;
  className?: string;
  fallbackClassName?: string;
}) {
  return (
    <Avatar className={className}>
      <AvatarImage src={getProfileAvatarUrl(person?.avatarPath) ?? undefined} />
      <AvatarFallback className={fallbackClassName}>
        {getInitials(person?.firstName ?? null, person?.lastName ?? null)}
      </AvatarFallback>
    </Avatar>
  );
}

interface JobDetailContentProps {
  job: JobWithDetails;
  parentProject?: Pick<Project, 'id' | 'name' | 'projectNumber'>;
  clients: Client[];
  members: OrgMemberOption[];
  projects?: ProjectWithDetails[];
  isAdminOrManager: boolean;
  instructionItems: JobInstructionItemWithDetails[];
  documents: OrganizationDocument[];
  currentUserId: string;
}

export function JobDetailContent({
  job,
  parentProject,
  clients,
  members,
  projects = [],
  isAdminOrManager,
  instructionItems,
  documents,
  currentUserId,
}: JobDetailContentProps) {
  const router = useRouter();
  const [liveJob, setLiveJob] = useState(job);
  const { activeJobIds } = useActiveJobs();
  const displayTitle = getJobDisplayTitle(liveJob);
  const isJobActive = activeJobIds.has(liveJob.id);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [isDeleting, startDeleteTransition] = useTransition();
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [showClientDialog, setShowClientDialog] = useState(false);
  const [showProjectDialog, setShowProjectDialog] = useState(false);
  const [showParkDialog, setShowParkDialog] = useState(false);
  const [unassigningUserId, setUnassigningUserId] = useState<string | null>(
    null
  );
  const [assignSelectedIds, setAssignSelectedIds] = useState<string[]>([]);
  const [isAssigning, startAssignTransition] = useTransition();
  const [isUpdatingClient, startClientUpdateTransition] = useTransition();
  const [isUpdatingProject, startProjectUpdateTransition] = useTransition();
  const [dialogClients, setDialogClients] = useState(clients);
  const [dialogMembers, setDialogMembers] = useState(members);
  const [dialogProjects, setDialogProjects] = useState(projects);
  const [isLoadingDialogOptions, setIsLoadingDialogOptions] = useState(false);
  const [suspendRealtimeRefresh, setSuspendRealtimeRefresh] = useState(false);

  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([]);
  const [timeParticipants, setTimeParticipants] = useState<
    Array<{
      userId: string;
      firstName: string | null;
      lastName: string | null;
      email: string | null;
      avatarPath: string | null;
    }>
  >([]);
  const [isLoadingTime, setIsLoadingTime] = useState(true);
  const [nowTick, setNowTick] = useState(() => Date.now());

  useEffect(() => {
    setLiveJob(job);
  }, [job]);

  useEffect(() => {
    setDialogClients(clients);
  }, [clients]);

  useEffect(() => {
    setDialogMembers(members);
  }, [members]);

  useEffect(() => {
    setDialogProjects(projects);
  }, [projects]);

  const applyLiveJobPatch = useCallback((updatedJob: Partial<JobWithDetails>) => {
    setLiveJob((current) => ({
      ...current,
      ...updatedJob,
    }));
  }, []);

  useEffect(() => {
    if (
      !isAdminOrManager ||
      isLoadingDialogOptions ||
      (
        !showAssignDialog &&
        !showClientDialog &&
        !showProjectDialog &&
        !showEditDialog
      ) ||
      (
        !(showClientDialog && dialogClients.length === 0) &&
        !(showAssignDialog && dialogMembers.length === 0) &&
        !(showProjectDialog && dialogProjects.length === 0) &&
        !(
          showEditDialog &&
          (dialogClients.length === 0 ||
            dialogMembers.length === 0 ||
            dialogProjects.length === 0)
        )
      )
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
  }, [
    dialogClients.length,
    dialogMembers.length,
    dialogProjects.length,
    isAdminOrManager,
    isLoadingDialogOptions,
    showAssignDialog,
    showClientDialog,
    showEditDialog,
    showProjectDialog,
  ]);
  const [showAllSessions, setShowAllSessions] = useState(false);

  const fetchTimeEntries = useCallback(async () => {
    try {
      const result = await getTimeEntriesForJob(liveJob.id);
      if (result.success) {
        setTimeEntries(result.entries);
        setTimeParticipants(result.participants ?? []);
      }
    } catch (err) {
      console.error('Error fetching time entries for job:', err);
    } finally {
      setIsLoadingTime(false);
    }
  }, [liveJob.id]);

  useEffect(() => {
    fetchTimeEntries();
  }, [fetchTimeEntries]);

  useRealtimeRouterRefresh({
    tables: ['jobs', 'projects', 'job_assignments', 'job_instruction_items'],
    enabled: !suspendRealtimeRefresh,
  });
  useRealtimeEvent('time_entries', () => fetchTimeEntries());

  const sessionPeople = useMemo(() => {
    const people = new Map<string, SessionPerson>();

    for (const member of members) {
      people.set(member.userId, {
        firstName: member.firstName || null,
        lastName: member.lastName || null,
      });
    }

    for (const assignment of liveJob.assignments) {
      if (!people.has(assignment.userId)) {
        people.set(assignment.userId, {
          firstName: assignment.firstName,
          lastName: assignment.lastName,
          email: assignment.email,
          avatarPath: assignment.avatarPath,
        });
      }
    }

    for (const participant of timeParticipants) {
      if (!people.has(participant.userId)) {
        people.set(participant.userId, {
          firstName: participant.firstName,
          lastName: participant.lastName,
          email: participant.email,
          avatarPath: participant.avatarPath,
        });
      }
    }

    return people;
  }, [liveJob.assignments, members, timeParticipants]);

  const allSessions = useMemo(() => {
    const entriesByUser: Record<string, TimeEntry[]> = {};
    for (const e of timeEntries) {
      if (!entriesByUser[e.userId]) entriesByUser[e.userId] = [];
      entriesByUser[e.userId].push(e);
    }
    return Object.values(entriesByUser)
      .flatMap((ue) => calculateWorkSessions(ue))
      .filter((session) => session.clockIn && session.jobId === liveJob.id)
      .sort((a, b) =>
        new Date(b.clockIn!.timestamp).getTime() -
        new Date(a.clockIn!.timestamp).getTime()
      );
  }, [liveJob.id, timeEntries]);

  const activeWorkSessions = useMemo(
    () =>
      allSessions.filter(
        (session) =>
          session.clockIn &&
          !session.clockOut &&
          !session.isOrphan &&
          session.jobId === liveJob.id
      ),
    [allSessions, liveJob.id]
  );

  useEffect(() => {
    if (activeWorkSessions.length === 0) return;

    const interval = window.setInterval(() => {
      setNowTick(Date.now());
    }, 1000);

    return () => window.clearInterval(interval);
  }, [activeWorkSessions.length]);

  const getSessionDurationMinutes = useCallback(
    (session: {
      clockIn: TimeEntry | null;
      clockOut: TimeEntry | null;
      durationMinutes: number | null;
    }) => {
      if (session.durationMinutes !== null) return session.durationMinutes;
      if (!session.clockIn || session.clockOut) return 0;

      const startMs = new Date(session.clockIn.timestamp).getTime();
      return Math.max(0, Math.floor((nowTick - startMs) / 60000));
    },
    [nowTick]
  );

  const totalMinutes = useMemo(
    () =>
      allSessions.reduce(
        (sum, session) => sum + getSessionDurationMinutes(session),
        0
      ),
    [allSessions, getSessionDurationMinutes]
  );

  const perEmployeeMinutes = useMemo(() => {
    const map: Record<
      string,
      {
        userId: string;
        name: string;
        minutes: number;
        isLive: boolean;
        person: SessionPerson | null;
      }
    > = {};
    for (const s of allSessions) {
      if (!s.clockIn) continue;
      const uid = s.clockIn.userId;
      if (!map[uid]) {
        const person = sessionPeople.get(uid);
        map[uid] = {
          userId: uid,
          name: getSessionPersonName(person),
          minutes: 0,
          isLive: false,
          person: person ?? null,
        };
      }
      map[uid].minutes += getSessionDurationMinutes(s);
      if (!s.clockOut && !s.isOrphan) {
        map[uid].isLive = true;
      }
    }
    return Object.values(map).sort((a, b) => b.minutes - a.minutes);
  }, [allSessions, getSessionDurationMinutes, sessionPeople]);

  const activeWorkers = useMemo(
    () =>
      activeWorkSessions.map((session) => {
        const userId = session.clockIn!.userId;
        const person = sessionPeople.get(userId);
        return {
          userId,
          clockIn: session.clockIn!,
          name: getSessionPersonName(person),
          person: person ?? null,
          isPending: session.pendingState === 'full' || session.pendingState === 'partial',
          liveMinutes: getSessionDurationMinutes(session),
        };
      }),
    [activeWorkSessions, getSessionDurationMinutes, sessionPeople]
  );
  const progressTargetMinutes = liveJob.plannedWorkingMinutes;
  const hasProgressTarget =
    progressTargetMinutes !== null && progressTargetMinutes > 0;
  const progressPercentage = hasProgressTarget
    ? Math.min(100, (totalMinutes / progressTargetMinutes) * 100)
    : 0;
  const overrunMinutes =
    hasProgressTarget && totalMinutes > progressTargetMinutes
      ? totalMinutes - progressTargetMinutes
      : 0;
  const hasAnySessions = allSessions.length > 0;
  const hasAnyTimeData = hasAnySessions || hasProgressTarget;

  const projectInfo = parentProject ?? liveJob.project;
  const currentUserActor = useMemo(() => {
    const currentMember = members.find((member) => member.userId === currentUserId);

    if (currentMember) {
      return {
        userId: currentMember.userId,
        firstName: currentMember.firstName || null,
        lastName: currentMember.lastName || null,
        email: null,
        avatarPath: null,
      };
    }

    const currentAssignment = liveJob.assignments.find(
      (assignment) => assignment.userId === currentUserId
    );

    if (!currentAssignment) return null;

    return {
      userId: currentAssignment.userId,
      firstName: currentAssignment.firstName,
      lastName: currentAssignment.lastName,
      email: currentAssignment.email,
      avatarPath: currentAssignment.avatarPath,
    };
  }, [currentUserId, liveJob.assignments, members]);

  const handleDelete = () => {
    startDeleteTransition(async () => {
      const result = await deleteJob(liveJob.id);
      if (result.success) {
        const deletedParam = `?deleted_job=${encodeURIComponent(displayTitle)}`;
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
    const result = await updateJobStatus(liveJob.id, newStatus);
    if (result.success) {
      applyLiveJobPatch(result.job);
    }
  };

  const handleParkConfirm = async () => {
    const result = await updateJobStatus(liveJob.id, 'geparkt');
    if (result.success) {
      applyLiveJobPatch(result.job);
    }
  };

  const handleAssignEmployees = () => {
    startAssignTransition(async () => {
      const newIds = assignSelectedIds.filter(
        (id) => !liveJob.assignments.some((a) => a.userId === id)
      );
      const results = await Promise.allSettled(
        newIds.map((id) => assignEmployee(liveJob.id, id))
      );
      const successfulIds = newIds.filter((_, index) => {
        const result = results[index];
        return result.status === 'fulfilled' && result.value.success;
      });

      if (successfulIds.length > 0) {
        const memberLookup = new Map(dialogMembers.map((member) => [member.userId, member]));
        setLiveJob((current) => {
          const existingIds = new Set(current.assignments.map((assignment) => assignment.userId));
          const nextAssignments = [
            ...current.assignments,
            ...successfulIds
              .filter((userId) => !existingIds.has(userId))
              .map((userId) => {
                const member = memberLookup.get(userId);
                return {
                  id: `temp-${current.id}-${userId}`,
                  jobId: current.id,
                  userId,
                  assignedBy: current.createdBy,
                  assignedAt: new Date().toISOString(),
                  firstName: member?.firstName ?? null,
                  lastName: member?.lastName ?? null,
                  email: null,
                  avatarPath: null,
                };
              }),
          ];

          return {
            ...current,
            assignments: nextAssignments,
            plannedWorkingMinutes: calculatePlannedWorkingMinutes(
              current.estimatedDurationMinutes,
              nextAssignments.length
            ),
          };
        });
      }

      setShowAssignDialog(false);
      setAssignSelectedIds([]);
    });
  };

  const handleUnassign = async (userId: string) => {
    setUnassigningUserId(userId);
    const result = await unassignEmployee(liveJob.id, userId);
    setUnassigningUserId(null);
    if (result.success) {
      setLiveJob((current) => {
        const nextAssignments = current.assignments.filter(
          (assignment) => assignment.userId !== userId
        );

        return {
          ...current,
          assignments: nextAssignments,
          plannedWorkingMinutes: calculatePlannedWorkingMinutes(
            current.estimatedDurationMinutes,
            nextAssignments.length
          ),
        };
      });
    }
  };

  const handleClientSave = async (clientId: string) => {
    startClientUpdateTransition(async () => {
      if (parentProject?.id) {
        await updateProject(parentProject.id, { clientId });
      } else {
        const result = await updateJob(liveJob.id, {
          clientId,
        });
        if (result.success) {
          applyLiveJobPatch({
            ...result.job,
            clientId: result.job.clientId,
            client: result.job.clientId
              ? clients.find((client) => client.id === result.job.clientId) ?? null
              : null,
          });
        }
      }
      setShowClientDialog(false);
      if (parentProject?.id) {
        router.refresh();
      }
    });
  };

  const handleProjectSave = async (projectId: string) => {
    startProjectUpdateTransition(async () => {
      setSuspendRealtimeRefresh(true);
      const result = await updateJob(liveJob.id, { projectId });
      setShowProjectDialog(false);
      if (!result.success && result.error !== 'no_changes') {
        setSuspendRealtimeRefresh(false);
        return;
      }

      if (result.success) {
        applyLiveJobPatch({
          ...result.job,
          project:
            result.job.projectId && result.job.projectId !== liveJob.projectId
              ? (() => {
                  const nextProject = dialogProjects.find(
                    (project) => project.id === result.job.projectId
                  );
                  return nextProject
                    ? {
                        id: nextProject.id,
                        name: nextProject.name,
                        projectNumber: nextProject.projectNumber ?? null,
                      }
                    : null;
                })()
              : result.job.projectId
                ? liveJob.project
                : null,
        });
      }

      const nextJobNumber = result.success ? result.job.jobNumber : liveJob.jobNumber;
      if (!nextJobNumber) {
        setSuspendRealtimeRefresh(false);
        return;
      }

      const nextProjectId = projectId || '';
      if (!nextProjectId) {
        router.replace(`/auftraege/${encodeURIComponent(nextJobNumber)}`);
        return;
      }

      const nextProject = projects.find((entry) => entry.id === nextProjectId);
      if (!nextProject?.projectNumber) {
        setSuspendRealtimeRefresh(false);
        router.refresh();
        return;
      }

      router.replace(
        `/auftraege/projekt/${encodeURIComponent(nextProject.projectNumber)}/${encodeURIComponent(nextJobNumber)}`
      );
    });
  };

  const breadcrumbs = projectInfo?.projectNumber
    ? [
        { label: 'Aufträge', href: '/auftraege' },
        {
          label: projectInfo.projectNumber,
          href: `/auftraege/projekt/${encodeURIComponent(projectInfo.projectNumber)}`,
        },
        { label: liveJob.jobNumber ?? 'Auftrag' },
      ]
    : [
        { label: 'Aufträge', href: '/auftraege' },
        { label: liveJob.jobNumber ?? 'Auftrag' },
      ];

  const metadataFields: MetadataField[] = [
    {
      label: 'Auftragsnummer',
      value: <span className="font-mono text-xs">{liveJob.jobNumber}</span>,
    },
    {
      label: 'Titel',
      value: liveJob.title,
      editableConfig: isAdminOrManager
        ? {
            type: 'text',
            currentValue: liveJob.title,
            onSave: async (v) => {
              const result = await updateJob(liveJob.id, { title: v });
              if (!result.success) {
                throw new Error('Failed to update title');
              }
              applyLiveJobPatch(result.job);
            },
          }
        : undefined,
    },
    {
      label: 'Beschreibung',
      value: liveJob.description || (
        <span className="text-muted-foreground">Keine Beschreibung</span>
      ),
      editableConfig: isAdminOrManager
        ? {
            type: 'textarea',
            currentValue: liveJob.description ?? '',
            onSave: async (v) => {
              const result = await updateJob(liveJob.id, { description: v });
              if (!result.success) {
                throw new Error('Failed to update description');
              }
              applyLiveJobPatch(result.job);
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
            className={JOB_STATUS_CLASSES[liveJob.status]}
        >
          {JOB_STATUS_LABELS[liveJob.status]}
        </Badge>
      ),
      editableConfig: isAdminOrManager
        ? {
            type: 'select',
            currentValue: liveJob.status,
            onSave: async (v) => {
              if (v === 'geparkt') {
                setShowParkDialog(true);
                return;
              }
              const result = await updateJobStatus(liveJob.id, v as JobStatus);
              if (!result.success) {
                throw new Error('Failed to update status');
              }
              applyLiveJobPatch(result.job);
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
        <Badge variant="secondary" className={PRIORITY_CLASSES[liveJob.priority]}>
          {JOB_PRIORITY_LABELS[liveJob.priority]}
        </Badge>
      ),
      editableConfig: isAdminOrManager
        ? {
            type: 'select',
            currentValue: liveJob.priority,
            onSave: async (v) => {
              const result = await updateJob(liveJob.id, {
                priority: v as JobPriority,
              });
              if (!result.success) {
                throw new Error('Failed to update priority');
              }
              applyLiveJobPatch(result.job);
            },
            options: Object.entries(JOB_PRIORITY_LABELS).map(
              ([value, label]) => ({ value, label })
            ),
          }
        : undefined,
    },
    {
      label: 'Geplantes Datum',
      value: formatDate(liveJob.plannedDate),
      editableConfig: isAdminOrManager
        ? {
            type: 'date',
            currentValue: liveJob.plannedDate ?? '',
            confirmBeforeSave: {
              shouldConfirm: (newValue, currentValue) =>
                currentValue.trim().length > 0 && newValue.trim().length === 0,
              title: 'Datum entfernen?',
              description: (
                <div className="space-y-2">
                  <p>
                    Wenn du das geplante Datum von{' '}
                    <span className="font-medium text-foreground">
                      {liveJob.jobNumber ? `${liveJob.jobNumber} – ` : ''}
                      {displayTitle}
                    </span>{' '}
                    entfernst, wird der Auftrag automatisch geparkt.
                  </p>
                  <p className="font-medium text-destructive/80">
                    Andere Metadaten wie Uhrzeit, Dauer und zugewiesene Mitarbeiter
                    bleiben erhalten.
                  </p>
                </div>
              ),
              confirmLabel: 'Datum entfernen',
              loadingLabel: 'Wird gespeichert...',
            },
            onSave: async (v) => {
              const result = await updateJob(liveJob.id, {
                plannedDate: v || null,
              });
              if (!result.success) {
                throw new Error('Failed to update planned date');
              }
              applyLiveJobPatch(result.job);
            },
            nullable: true,
          }
        : undefined,
    },
    {
      label: 'Geplante Uhrzeit',
      value: formatPlannedTime(liveJob.plannedTime),
      editableConfig: isAdminOrManager
        ? {
            type: 'time',
            currentValue: normalizeJobPlannedTime(liveJob.plannedTime) ?? '',
            onSave: async (v) => {
              const result = await updateJob(liveJob.id, {
                plannedTime: v || null,
              });
              if (!result.success) {
                throw new Error('Failed to update planned time');
              }
              applyLiveJobPatch(result.job);
            },
            placeholder: 'z.B. 08:00',
            nullable: true,
          }
        : undefined,
    },
    {
      label: 'Geschätzte Dauer',
      value: formatDuration(liveJob.estimatedDurationMinutes),
      editableConfig: isAdminOrManager
        ? {
            type: 'duration',
            currentValue: formatMinutesAsHoursInput(liveJob.estimatedDurationMinutes),
            onSave: async (v) => {
              const estimatedDurationMinutes = v.trim()
                ? parseHoursInputToMinutes(v)
                : null;
              const plannedWorkingMinutes = calculatePlannedWorkingMinutes(
                estimatedDurationMinutes,
                liveJob.assignments.length
              );
              const result = await updateJob(liveJob.id, {
                estimatedDurationMinutes,
                plannedWorkingMinutes,
              });
              if (!result.success) {
                throw new Error('Failed to update estimated duration');
              }
              applyLiveJobPatch(result.job);
            },
            placeholder: 'z.B. 2.5',
            nullable: true,
          }
        : undefined,
    },
    {
      label: 'Geplanter Arbeitsaufwand',
      value: formatDuration(liveJob.plannedWorkingMinutes),
      editableConfig: isAdminOrManager
        ? {
            type: 'duration',
            currentValue: formatMinutesAsHoursInput(liveJob.plannedWorkingMinutes),
            onSave: async (v) => {
              const result = await updateJob(liveJob.id, {
                plannedWorkingMinutes: v.trim()
                  ? parseHoursInputToMinutes(v)
                  : null,
              });
              if (!result.success) {
                throw new Error('Failed to update planned effort');
              }
              applyLiveJobPatch(result.job);
            },
            placeholder: 'z.B. 5',
            nullable: true,
          }
        : undefined,
    },
    {
      label: 'Ort',
      value: liveJob.location || '—',
      editableConfig: isAdminOrManager
        ? {
            type: 'text',
            currentValue: liveJob.location ?? '',
            onSave: async (v) => {
              const result = await updateJob(liveJob.id, { location: v });
              if (!result.success) {
                throw new Error('Failed to update location');
              }
              applyLiveJobPatch(result.job);
            },
            placeholder: 'Adresse oder Ort',
            nullable: true,
          }
        : undefined,
    },
    ...(liveJob.actualCompletionDate
      ? [
          {
            label: 'Abschlussdatum',
            value: formatDate(liveJob.actualCompletionDate),
          },
        ]
      : []),
    {
      label: 'Erstellt am',
      value: formatDateTime(liveJob.createdAt),
    },
  ];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <DetailPageHeader
        breadcrumbs={breadcrumbs}
        title={
          <span className="inline-flex items-start gap-1 overflow-visible">
            <span className="line-clamp-2 break-words">{displayTitle}</span>
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
              className={JOB_STATUS_CLASSES[liveJob.status]}
            >
              {JOB_STATUS_LABELS[liveJob.status]}
            </Badge>
            <Badge
              variant="secondary"
              className={PRIORITY_CLASSES[liveJob.priority]}
            >
              {JOB_PRIORITY_LABELS[liveJob.priority]}
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
                <DropdownMenuItem onClick={() => setShowEditDialog(true)}>
                  <Pencil className="mr-2 size-4" />
                  Bearbeiten
                </DropdownMenuItem>
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
                        disabled={liveJob.status === value}
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

      <div className="flex-1 overflow-auto px-4 pb-24 pt-4 sm:px-6 sm:pb-28 sm:pt-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1fr]">
          {/* Left Column: Metadata + Client + Employees */}
          <div className="space-y-6">
            <MetadataSection
              title="Details"
              fields={metadataFields}
              isEditable={isAdminOrManager}
            />

            <JobInstructionItemsCard
              jobId={liveJob.id}
              initialItems={instructionItems}
              isAdminOrManager={isAdminOrManager}
              currentUserActor={currentUserActor}
            />

            {liveJob.client ? (
              <EntityLinkCard
                title={liveJob.client.name}
                href={`/kunden/${liveJob.client.id}`}
                icon={<Building2 className="size-5" />}
                badge={
                  <Badge variant="outline" className="text-xs">
                    {CLIENT_TYPE_LABELS[liveJob.client.clientType]}
                  </Badge>
                }
                metadata={[
                  ...(liveJob.client.email
                    ? [{ label: 'E-Mail', value: liveJob.client.email }]
                    : []),
                  ...(liveJob.client.phone
                    ? [{ label: 'Telefon', value: liveJob.client.phone }]
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
                        liveJob.assignments.map((a) => a.userId)
                      );
                      setShowAssignDialog(true);
                    }}
                  >
                    <UserPlus className="size-3" />
                    Zuweisen
                  </Button>
                )}
              </div>
              {liveJob.assignments.length === 0 ? (
                <p className="py-2 text-center text-sm text-muted-foreground">
                  Keine Mitarbeiter zugewiesen.
                </p>
              ) : (
                <div className="divide-y">
                  {liveJob.assignments.map((a) => (
                    <div
                      key={a.userId}
                      className="flex items-center gap-3 py-2"
                    >
                      <PersonAvatar
                        person={a}
                        className="size-8"
                        fallbackClassName="bg-primary/10 text-xs font-medium text-primary"
                      />
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/mitarbeiter/${a.userId}`}
                          className="text-sm font-medium hover:underline"
                        >
                          {getSessionPersonName(a)}
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
                onEmptyClick={
                  isAdminOrManager ? () => setShowProjectDialog(true) : undefined
                }
              />
            )}

            <ContextualDocumentsSection
              title="Dokumente & Bilder"
              description="Lade Dateien zu diesem Auftrag hoch oder verknüpfe vorhandene Dokumente."
              documents={documents}
              jobId={liveJob.id}
              contextLabel={liveJob.title}
              canUpload
              canManage={isAdminOrManager}
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
              ) : !hasAnyTimeData ? (
                <div className="rounded-md border border-dashed bg-muted/20 px-4 py-6 text-center">
                  <p className="text-sm font-medium">
                    Noch keine Arbeitszeiten für diesen Auftrag erfasst.
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Sobald ein Mitarbeiter auf diesen Auftrag arbeitet, erscheinen
                    die Summen und Einträge hier automatisch.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {activeWorkers.length > 0 && (
                    <div className="rounded-md border border-green-200 bg-green-50/80 p-3 dark:border-green-900/40 dark:bg-green-950/20">
                      <div className="mb-2 flex items-center gap-2">
                        <span className="relative inline-flex h-2.5 w-2.5 shrink-0">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-500" />
                        </span>
                        <p className="text-xs font-semibold uppercase tracking-wide text-green-700 dark:text-green-300">
                          Aktiv in Arbeit
                        </p>
                      </div>
                      <div className="space-y-2">
                        {activeWorkers.map((worker) => (
                          <div
                            key={worker.userId}
                            className="flex items-center gap-3 rounded-md bg-background/80 px-3 py-2"
                          >
                            <PersonAvatar
                              person={worker.person}
                              className="size-8"
                              fallbackClassName="bg-green-500/10 text-[10px] font-medium text-green-700 dark:text-green-300"
                            />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium">
                                {worker.name}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                Eingestempelt seit{' '}
                                {new Date(worker.clockIn.timestamp).toLocaleTimeString(
                                  'de-DE',
                                  {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  }
                                )}
                                {' · '}
                                {formatDuration(Math.round(worker.liveMinutes))}
                                {worker.isPending ? ' · ausstehend' : ''}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {hasProgressTarget ? (
                    <div className="rounded-md border bg-muted/30 p-3">
                      <div className="mb-3 flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-medium text-muted-foreground">
                            Fortschritt nach Arbeitsaufwand
                          </p>
                          <p className="text-sm font-semibold tabular-nums">
                            {formatDuration(Math.round(totalMinutes))} /{' '}
                            {formatDuration(progressTargetMinutes)}
                          </p>
                        </div>
                        <p className="text-xs font-medium text-muted-foreground tabular-nums">
                          {Math.round((totalMinutes / progressTargetMinutes) * 100)}%
                        </p>
                      </div>
                      <Progress value={progressPercentage} />
                      {overrunMinutes > 0 && (
                        <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                          {formatDuration(overrunMinutes)} über dem geplanten
                          Arbeitsaufwand
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="rounded-md border border-dashed bg-muted/20 p-3">
                      <p className="text-xs font-medium text-muted-foreground">
                        Kein geplanter Arbeitsaufwand hinterlegt.
                      </p>
                    </div>
                  )}

                  {/* Per-employee breakdown */}
                  {perEmployeeMinutes.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">
                        Pro Mitarbeiter
                      </p>
                      <div className="divide-y rounded-md border">
                        {perEmployeeMinutes.map((emp) => (
                          <div
                            key={emp.userId}
                            className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm"
                          >
                            <div className="flex min-w-0 items-center gap-2">
                              <PersonAvatar
                                person={emp.person}
                                className="size-7"
                                fallbackClassName="bg-primary/10 text-[10px] font-medium text-primary"
                              />
                              <span className="truncate font-medium">
                                {emp.name}
                              </span>
                              {emp.isLive && (
                                <span className="relative inline-flex h-2 w-2 shrink-0">
                                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                                  <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
                                </span>
                              )}
                            </div>
                            <span className="shrink-0 tabular-nums text-muted-foreground">
                              {formatDuration(Math.round(emp.minutes))}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Session timeline */}
                  {hasAnySessions && (
                    <div>
                      <button
                        onClick={() => setShowAllSessions(!showAllSessions)}
                        className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent"
                      >
                        <span>Einzelne Einträge ({allSessions.length})</span>
                        <ChevronDown
                          className={cn(
                            'size-3.5 transition-transform',
                            showAllSessions && 'rotate-180'
                          )}
                        />
                      </button>

                      {showAllSessions && (
                        <div className="mt-2 max-h-64 divide-y overflow-auto rounded-md border">
                          {allSessions.map((session) => {
                            if (!session.clockIn) return null;

                            const member = sessionPeople.get(session.clockIn.userId);
                            return (
                              <div
                                key={session.clockIn.id}
                                className="flex items-center gap-3 px-3 py-2.5 text-sm"
                              >
                                <PersonAvatar
                                  person={member}
                                  className="size-7"
                                  fallbackClassName="bg-primary/10 text-[10px] font-medium text-primary"
                                />
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-sm font-medium">
                                    {getSessionPersonName(member)}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {new Date(
                                      session.clockIn.timestamp
                                    ).toLocaleDateString('de-DE', {
                                      day: '2-digit',
                                      month: '2-digit',
                                      year: 'numeric',
                                    })}
                                    {' · '}
                                    {new Date(
                                      session.clockIn.timestamp
                                    ).toLocaleTimeString('de-DE', {
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    })}
                                    {' – '}
                                    {session.clockOut
                                      ? new Date(
                                          session.clockOut.timestamp
                                        ).toLocaleTimeString('de-DE', {
                                          hour: '2-digit',
                                          minute: '2-digit',
                                        })
                                      : 'offen'}
                                  </p>
                                </div>
                                <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                                  {formatDuration(
                                    Math.round(getSessionDurationMinutes(session))
                                  )}
                                </span>
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

      {/* Delete Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Auftrag löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Möchtest du den Auftrag &ldquo;{displayTitle}&rdquo; wirklich
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
              members={dialogMembers}
              selectedIds={assignSelectedIds}
              onSelectionChange={setAssignSelectedIds}
            />
            {isLoadingDialogOptions && (
              <div className="mt-3 space-y-2">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-2/3" />
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setShowAssignDialog(false)}
              disabled={isAssigning}
            >
              Abbrechen
            </Button>
            <Button
              onClick={handleAssignEmployees}
              disabled={isAssigning || isLoadingDialogOptions}
            >
              {isAssigning && (
                <Loader2 className="mr-2 size-4 animate-spin" />
              )}
              Speichern
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <ClientAssignmentDialog
        open={showClientDialog}
        onOpenChange={setShowClientDialog}
        clients={dialogClients}
        currentClientId={liveJob.clientId}
        title={
          parentProject?.id
            ? 'Kunde zum Projekt hinzufügen'
            : 'Kunde zum Auftrag hinzufügen'
        }
        isSaving={isUpdatingClient}
        onSave={handleClientSave}
      />

      <ProjectAssignmentDialog
        open={showProjectDialog}
        onOpenChange={setShowProjectDialog}
        projects={dialogProjects}
        currentProjectId={liveJob.projectId}
        currentClientId={liveJob.clientId}
        title="Projekt zum Auftrag hinzufügen"
        isSaving={isUpdatingProject}
        onSave={handleProjectSave}
      />

      <EditJobDialog
        job={liveJob}
        open={showEditDialog}
        onOpenChange={setShowEditDialog}
        clients={dialogClients}
        members={dialogMembers}
        projects={dialogProjects}
      />

      <ParkConfirmationDialog
        open={showParkDialog}
        onOpenChange={setShowParkDialog}
        variant="job"
        title={displayTitle}
        identifier={liveJob.jobNumber ?? undefined}
        onConfirm={handleParkConfirm}
      />
    </div>
  );
}
