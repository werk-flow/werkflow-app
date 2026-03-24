'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  MoreVertical,
  UserCog,
  UserMinus,
  Loader2,
  Clock,
  BarChart3,
  Briefcase,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
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
import {
  MetadataSection,
  type MetadataField,
} from '@/components/shared/metadata-section';
import { EmbeddedAuftraegeSection } from '@/components/shared/embedded-auftraege-section';
import { StatusBadge } from './status-badge';
import { WeeklyHoursChart } from '@/components/zeiterfassung/weekly-hours-chart';

import {
  updateMemberRole,
  removeMember,
  type OrgRole,
  type MemberDetail,
} from '@/lib/members/actions';
import { ROLE_LABELS } from '@/lib/roles';
import { useMemberStatusPolling } from '@/hooks/use-member-status-polling';
import { useWeeklyTimeData } from '@/hooks/use-weekly-time-data';
import {
  computeTimeBreakdown,
  formatDuration,
  WORK_GOAL_MINUTES,
} from '@/lib/time-tracking/helpers';
import type {
  Job,
  ProjectWithDetails,
  Client,
} from '@/lib/jobs/types';
import type { OrgMemberOption } from '@/components/auftraege/employee-multi-select';
import { cn } from '@/lib/utils';

const ROLE_HIERARCHY: Record<OrgRole, number> = {
  admin: 1,
  buero: 2,
  employee: 3,
};

const ADMIN_ASSIGNABLE_ROLES: OrgRole[] = [
  'buero',
  'employee',
];

const BUERO_ASSIGNABLE_ROLES: OrgRole[] = [
  'employee',
];

const DAILY_GOAL_MINUTES = WORK_GOAL_MINUTES;

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatMinutesAsHours(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m} Min.`;
  if (m === 0) return `${h} Std.`;
  return `${h} Std. ${m} Min.`;
}

interface MitarbeiterDetailContentProps {
  member: MemberDetail;
  jobs: Job[];
  projects: ProjectWithDetails[];
  clientMap: Record<string, string>;
  jobAssignmentMap: Record<string, string[]>;
  clients: Client[];
  members: OrgMemberOption[];
  allProjects: ProjectWithDetails[];
  organizationId: string;
  currentUserId: string;
  currentUserRole: OrgRole;
  isAdminOrManager: boolean;
}

export function MitarbeiterDetailContent({
  member,
  jobs,
  projects,
  clientMap,
  jobAssignmentMap,
  clients,
  members,
  allProjects,
  organizationId,
  currentUserId,
  currentUserRole,
  isAdminOrManager,
}: MitarbeiterDetailContentProps) {
  const router = useRouter();
  const [showRemoveDialog, setShowRemoveDialog] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [isUpdatingRole, setIsUpdatingRole] = useState(false);

  const memberIds = useMemo(() => [member.userId], [member.userId]);

  const { statusMap } = useMemberStatusPolling({
    organizationId,
    memberIds,
  });
  const status = statusMap[member.userId];

  const { weekData, todayIndex, weekLabel } = useWeeklyTimeData({
    organizationId,
    userId: member.userId,
  });

  const isOwnRow = member.userId === currentUserId;
  const canManage =
    !isOwnRow &&
    member.role !== 'admin' &&
    (currentUserRole === 'admin' ||
      (currentUserRole === 'buero' &&
        ROLE_HIERARCHY[member.role] > ROLE_HIERARCHY['buero']));

  const availableRoles = useMemo(() => {
    const assignable =
      currentUserRole === 'admin'
        ? ADMIN_ASSIGNABLE_ROLES
        : BUERO_ASSIGNABLE_ROLES;
    return assignable.filter((r) => r !== member.role);
  }, [currentUserRole, member.role]);

  const roleOptions = useMemo(() => {
    if (!canManage) return undefined;
    const assignable =
      currentUserRole === 'admin'
        ? ADMIN_ASSIGNABLE_ROLES
        : BUERO_ASSIGNABLE_ROLES;
    return assignable.map((r) => ({ value: r, label: ROLE_LABELS[r] }));
  }, [canManage, currentUserRole]);

  const handleRoleChange = async (newRole: OrgRole) => {
    if (isUpdatingRole) return;
    setIsUpdatingRole(true);
    const result = await updateMemberRole(member.userId, newRole);
    if (result.success) {
      router.refresh();
    }
    setIsUpdatingRole(false);
  };

  const handleRemove = async () => {
    if (isRemoving) return;
    setIsRemoving(true);
    const result = await removeMember(member.userId);
    if (result.success) {
      router.push(`/mitarbeiter?removed_member=${encodeURIComponent(fullName)}`);
    } else {
      setIsRemoving(false);
    }
  };

  const fullName =
    [member.firstName, member.lastName].filter(Boolean).join(' ') ||
    'Unbekannt';

  const [liveTotalMinutes, setLiveTotalMinutes] = useState(0);
  useEffect(() => {
    const compute = () => {
      let base = status?.todayMinutes ?? 0;
      if (status?.isClockedIn && status.clockInTime) {
        const elapsed =
          (Date.now() - new Date(status.clockInTime).getTime()) / 60000;
        base += elapsed;
      }
      setLiveTotalMinutes(base);
    };
    compute();
    const interval = setInterval(compute, 60000);
    return () => clearInterval(interval);
  }, [status?.isClockedIn, status?.clockInTime, status?.todayMinutes]);

  const memberBreakdown = computeTimeBreakdown(liveTotalMinutes);
  const dailyPercentage = Math.min(
    100,
    Math.round((memberBreakdown.workMinutes / DAILY_GOAL_MINUTES) * 100)
  );

  const metadataFields: MetadataField[] = [
    { label: 'Vorname', value: member.firstName || '—' },
    { label: 'Nachname', value: member.lastName || '—' },
    { label: 'E-Mail', value: member.email || '—' },
    {
      label: 'Rolle',
      value: (
        <Badge variant="secondary" className="text-xs">
          {ROLE_LABELS[member.role] || member.role}
        </Badge>
      ),
      editableConfig: roleOptions
        ? {
            type: 'select' as const,
            currentValue: member.role,
            onSave: async (v: string) => {
              await updateMemberRole(member.userId, v as OrgRole);
            },
            options: roleOptions,
          }
        : undefined,
    },
    {
      label: 'Beigetreten',
      value: formatDate(member.joinedAt),
    },
  ];

  const breadcrumbs = [
    { label: 'Mitarbeiter', href: '/mitarbeiter' },
    { label: fullName },
  ];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <DetailPageHeader
        breadcrumbs={breadcrumbs}
        title={fullName}
        subtitle={member.email}
        badges={
          <Badge variant="secondary" className="text-xs">
            {ROLE_LABELS[member.role] || member.role}
          </Badge>
        }
        actions={
          canManage ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="size-8"
                  disabled={isUpdatingRole}
                >
                  {isUpdatingRole ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <MoreVertical className="size-4" />
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {availableRoles.length > 0 && (
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <UserCog className="size-4" />
                      Rolle ändern
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      {availableRoles.map((role) => (
                        <DropdownMenuItem
                          key={role}
                          onClick={() => handleRoleChange(role)}
                        >
                          {ROLE_LABELS[role]}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => setShowRemoveDialog(true)}
                >
                  <UserMinus className="size-4" />
                  Entfernen
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : undefined
        }
      />

      <div className="flex-1 overflow-auto p-4 sm:p-6">
        <div className="grid grid-cols-1 gap-6 2xl:grid-cols-[1fr_1.5fr]">
          {/* Left Column: Profile + Status */}
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3 2xl:grid-cols-1">
            <MetadataSection
              title="Profil"
              fields={metadataFields}
              isEditable={canManage}
            />

            {/* Live Status Card (compact) */}
            <div className="rounded-lg border bg-card p-3 sm:p-4">
              <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                <Clock className="size-4" />
                Aktueller Status
              </h3>
              <div className="space-y-2.5">
                <StatusBadge
                  isClockedIn={status?.isClockedIn ?? false}
                  isPending={status?.isPending ?? false}
                  canViewStatus
                />

                {status?.isClockedIn && status.clockInTime && (
                  <p className="text-xs text-muted-foreground">
                    Eingestempelt seit{' '}
                    <span className="font-medium text-foreground">
                      {formatTime(status.clockInTime)} Uhr
                    </span>
                  </p>
                )}

                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">
                      Tagesfortschritt
                    </span>
                    <span
                      className={cn(
                        'font-medium tabular-nums',
                        dailyPercentage >= 100
                          ? 'text-green-600 dark:text-green-400'
                          : 'text-foreground'
                      )}
                    >
                      {formatMinutesAsHours(memberBreakdown.workMinutes)} / 8 Std. ({dailyPercentage}%)
                    </span>
                  </div>
                  <Progress
                    value={dailyPercentage}
                    className="h-2"
                    indicatorClassName={cn(
                      'bg-green-500',
                      status?.isClockedIn && 'opacity-80'
                    )}
                  />
                </div>

                {/* Time breakdown indicators */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1.5 text-[11px]">
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500" />
                    <span className="text-muted-foreground">Arbeit</span>
                    <span className="font-medium tabular-nums">
                      {formatDuration(memberBreakdown.workMinutes)}
                    </span>
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-yellow-500" />
                    <span className="text-muted-foreground">Pause</span>
                    <span className="font-medium tabular-nums">
                      {memberBreakdown.breakMinutes > 0 ? '30 Min.' : '0 Min.'}
                    </span>
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-blue-500" />
                    <span className="text-muted-foreground">Überstunden heute</span>
                    <span className="font-medium tabular-nums">
                      {memberBreakdown.overtimeMinutes > 0
                        ? formatDuration(memberBreakdown.overtimeMinutes)
                        : '0 Min.'}
                    </span>
                  </span>
                </div>
              </div>
            </div>

            {/* Anwesenheit & Stunden */}
            <div className="rounded-lg border bg-card p-3 sm:p-4">
              <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                <BarChart3 className="size-4" />
                Anwesenheit & Stunden
              </h3>
              {weekData.length > 0 ? (
                <WeeklyHoursChart
                  weekData={weekData}
                  todayIndex={todayIndex}
                  liveTodayMinutes={liveTotalMinutes}
                  weekLabel={weekLabel}
                />
              ) : (
                <p className="py-4 text-center text-xs text-muted-foreground">
                  Keine Daten für diese Woche
                </p>
              )}
            </div>
          </div>

          {/* Right Column: Jobs Table */}
          <div className="space-y-4 md:col-span-3 2xl:col-span-1">
            <div className="flex items-center gap-2">
              <Briefcase className="size-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Zugewiesene Aufträge
              </h3>
            </div>
            <EmbeddedAuftraegeSection
              jobs={jobs}
              projects={projects}
              clientMap={clientMap}
              jobAssignmentMap={jobAssignmentMap}
              clients={clients}
              members={members}
              lockedEmployeeLabel={`${member.firstName} ${member.lastName}`.trim()}
              defaultEmployeeIds={[member.userId]}
              isAdminOrManager={isAdminOrManager}
              hideProjectCreation
              allProjectsForJobCreation={allProjects}
              emptyTitle="Keine Aufträge zugewiesen"
              emptyDescription="Diesem Mitarbeiter sind derzeit keine Aufträge zugewiesen."
            />
          </div>
        </div>
      </div>

      {/* Remove Dialog */}
      <AlertDialog open={showRemoveDialog} onOpenChange={setShowRemoveDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mitglied entfernen?</AlertDialogTitle>
            <AlertDialogDescription>
              Bist du sicher, dass du{' '}
              <span className="font-medium">{fullName}</span> aus der
              Organisation entfernen möchtest? Diese Aktion kann nicht
              rückgängig gemacht werden.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRemoving}>
              Abbrechen
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRemove}
              disabled={isRemoving}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isRemoving ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Wird entfernt...
                </>
              ) : (
                'Entfernen'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
