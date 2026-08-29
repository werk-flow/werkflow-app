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
import { ContextualDocumentsSection } from '@/components/dokumente/contextual-documents-section';
import { StatusBadge } from './status-badge';
import { PersonalienSection } from './personalien-section';
import { EmploymentConditionsSection } from './employment-conditions-section';
import { WorkScheduleSection } from './work-schedule-section';
import { SicknessReportsSection } from './sickness-reports-section';
import { PersonnelHistorySection } from './personnel-history-section';
import {
  PersonnelQualificationSummary,
  type PersonnelQualificationSummaryData,
} from './personnel-qualification-summary';
import { ResponsibilitySummarySection } from './responsibility-summary-section';
import { EmploymentStateBadge } from './personnel-state-badges';
import { WeeklyHoursChart } from '@/components/zeiterfassung/weekly-hours-chart';
import { useRealtimeRouterRefresh } from '@/hooks/use-realtime-router-refresh';
import { getEmploymentState } from '@/lib/personnel/types';
import type { PersonnelDetail } from '@/lib/personnel/actions';

import {
  updateMemberRole,
  removeMember,
  type OrgRole,
  type MemberDetail,
} from '@/lib/members/actions';
import { ROLE_LABELS } from '@/lib/roles';
import {
  useMemberStatus,
  type MemberStatus,
} from '@/hooks/use-member-status';
import { useWeeklyTimeData } from '@/hooks/use-weekly-time-data';
import {
  formatDuration,
  getNonNegativeElapsedMs,
  WORK_GOAL_MINUTES,
} from '@/lib/time-tracking/helpers';
import {
  computeBreakdownForSettings,
  type OrgBreakMode,
} from '@/lib/time-tracking/settings';
import { getTargetSourceHint, type DailyTarget } from '@/lib/personnel/targets';
import type {
  Job,
  ProjectWithDetails,
  Client,
} from '@/lib/jobs/types';
import type { OrganizationDocument } from '@/lib/documents/types';
import type { AuftraegeColumnId } from '@/lib/jobs/auftraege-table-columns';
import type { OrgMemberOption } from '@/components/auftraege/employee-multi-select';
import { cn } from '@/lib/utils';
import type { ResponsibilitySettingsData } from '@/lib/responsibilities/server';
import { getResponsibilitiesStrandedByEmployeeRemoval } from '@/lib/responsibilities/resolution';
import {
  getMemberActionErrorMessage,
  getResponsibilityRemovalBlockMessage,
} from '@/lib/members/errors';

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

function computeLiveBreakMinutesForMember(
  status: MemberStatus | undefined,
  liveTotalMinutes: number,
  defaultBreakMode: OrgBreakMode,
  defaultAutoBreakThresholdMinutes: number,
  defaultAutoBreakDurationMinutes: number,
  targetMinutes?: number
) {
  const effectiveBreakMode = status?.breakMode ?? defaultBreakMode;
  const trackedLiveBreakMinutes =
    effectiveBreakMode === 'manual'
      ? (status?.breakMinutes ?? 0) +
        (status?.status === 'on_break' && status.statusStartedAt
          ? getNonNegativeElapsedMs(status.statusStartedAt) / 60000
          : 0)
      : status?.breakMinutes ?? 0;

  return computeBreakdownForSettings(
    liveTotalMinutes,
    trackedLiveBreakMinutes,
    {
      breakMode: effectiveBreakMode,
      autoBreakThresholdMinutes:
        status?.autoBreakThresholdMinutes ?? defaultAutoBreakThresholdMinutes,
      autoBreakDurationMinutes:
        status?.autoBreakDurationMinutes ?? defaultAutoBreakDurationMinutes,
    },
    targetMinutes
  );
}

interface MitarbeiterDetailContentProps {
  member: MemberDetail;
  personnel: PersonnelDetail | null;
  actorNames: Record<string, string>;
  jobs: Job[];
  projects: ProjectWithDetails[];
  projectGraphProjects: ProjectWithDetails[];
  clientMap: Record<string, string>;
  jobAssignmentMap: Record<string, string[]>;
  clients: Client[];
  members: OrgMemberOption[];
  allProjects: ProjectWithDetails[];
  organizationId: string;
  currentUserId: string;
  currentUserRole: OrgRole;
  isAdminOrManager: boolean;
  visibleColumns: AuftraegeColumnId[];
  documents: OrganizationDocument[];
  breakMode: OrgBreakMode;
  autoBreakThresholdMinutes: number;
  autoBreakDurationMinutes: number;
  responsibilitySettings: ResponsibilitySettingsData | null;
  qualificationSummary: PersonnelQualificationSummaryData | null;
}

export function MitarbeiterDetailContent({
  member,
  personnel,
  actorNames,
  jobs,
  projects,
  projectGraphProjects,
  clientMap,
  jobAssignmentMap,
  clients,
  members,
  allProjects,
  organizationId,
  currentUserId,
  currentUserRole,
  isAdminOrManager,
  visibleColumns,
  documents,
  breakMode,
  autoBreakThresholdMinutes,
  autoBreakDurationMinutes,
  responsibilitySettings,
  qualificationSummary,
}: MitarbeiterDetailContentProps) {
  const router = useRouter();
  const [showRemoveDialog, setShowRemoveDialog] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [isUpdatingRole, setIsUpdatingRole] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useRealtimeRouterRefresh({
    tables: [
      'organization_settings',
      'employee_records',
      'employment_conditions',
      'work_schedules',
      'teams',
      'team_memberships',
      'organization_capabilities',
      'employee_capabilities',
    ],
  });

  const memberIds = useMemo(() => [member.userId], [member.userId]);

  const { statusMap } = useMemberStatus({
    organizationId,
    memberIds,
    breakMode,
    autoBreakThresholdMinutes,
    autoBreakDurationMinutes,
  });
  const status = statusMap[member.userId];

  const { weekData, weekTargets, todayIndex, weekLabel } = useWeeklyTimeData({
    organizationId,
    userId: member.userId,
    breakMode,
    autoBreakThresholdMinutes,
    autoBreakDurationMinutes,
  });

  const isOwnRow = member.userId === currentUserId;
  const canManage =
    !isOwnRow &&
    member.role !== 'admin' &&
    (currentUserRole === 'admin' ||
      (currentUserRole === 'buero' &&
        ROLE_HIERARCHY[member.role] > ROLE_HIERARCHY['buero']));

  const removalBlockedMessage = useMemo(() => {
    if (!personnel || !responsibilitySettings) return null;
    return getResponsibilityRemovalBlockMessage(
      getResponsibilitiesStrandedByEmployeeRemoval(
        responsibilitySettings.effective,
        personnel.record.id
      )
    );
  }, [personnel, responsibilitySettings]);

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
    setActionError(null);
    const result = await updateMemberRole(member.userId, newRole);
    if (result.success) {
      router.refresh();
    } else {
      setActionError(getMemberActionErrorMessage(result.error));
    }
    setIsUpdatingRole(false);
  };

  const handleRemove = async () => {
    if (isRemoving) return;
    setIsRemoving(true);
    setActionError(null);
    const result = await removeMember(member.userId);
    if (result.success) {
      // Hard navigation: the refresh of this now-removed member's detail
      // redirects to plain /mitarbeiter and can land after a soft push,
      // dropping the banner param (documented post-delete race).
      window.location.assign(
        `/mitarbeiter?removed_member=${encodeURIComponent(fullName)}`
      );
    } else {
      setActionError(getMemberActionErrorMessage(result.error));
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
      if (status?.isClockedIn && status.statusStartedAt) {
        base += getNonNegativeElapsedMs(status.statusStartedAt) / 60000;
      }
      setLiveTotalMinutes(base);
    };
    compute();
    // eslint-disable-next-line no-restricted-syntax -- wall-clock render tick, no data polling
    const interval = setInterval(compute, 60000);
    return () => clearInterval(interval);
  }, [status?.isClockedIn, status?.statusStartedAt, status?.todayMinutes]);

  // This member's resolved target for today (P1-04); the legacy 8h value only
  // appears as the visibly labeled `default` source.
  const todayTarget: DailyTarget | undefined = weekTargets?.[todayIndex];
  const todayTargetMinutes = todayTarget?.targetMinutes ?? DAILY_GOAL_MINUTES;
  const todayTargetHint = todayTarget ? getTargetSourceHint(todayTarget) : null;

  const memberBreakdown = computeLiveBreakMinutesForMember(
    status,
    liveTotalMinutes,
    breakMode,
    autoBreakThresholdMinutes,
    autoBreakDurationMinutes,
    todayTarget?.targetMinutes
  );
  const liveBreakMinutes = memberBreakdown.breakMinutes;
  const dailyPercentage =
    todayTargetMinutes > 0
      ? Math.min(
          100,
          Math.round((memberBreakdown.workMinutes / todayTargetMinutes) * 100)
        )
      : 0;

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
              await handleRoleChange(v as OrgRole);
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
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary" className="text-xs">
              {ROLE_LABELS[member.role] || member.role}
            </Badge>
            {personnel &&
              getEmploymentState(personnel.record) !== 'aktiv' && (
                <EmploymentStateBadge
                  state={getEmploymentState(personnel.record)}
                />
              )}
          </span>
        }
        actions={
          canManage ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="size-8"
                  aria-label="Aktionen"
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
      {actionError && !showRemoveDialog ? (
        <div
          role="alert"
          className="mx-4 mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive sm:mx-6"
        >
          {actionError}
        </div>
      ) : null}

      <div className="flex-1 overflow-auto p-4 sm:p-6">
        <div className="grid grid-cols-1 gap-6 2xl:grid-cols-[1fr_1.5fr]">
          {/* Left Column: Profile + Status */}
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3 2xl:grid-cols-1">
            <MetadataSection
              title="Profil"
              fields={metadataFields}
              isEditable={canManage}
            />

            {personnel && (
              <PersonalienSection
                record={personnel.record}
                canEdit={isAdminOrManager}
              />
            )}

            {personnel && (
              <EmploymentConditionsSection
                recordId={personnel.record.id}
                conditions={personnel.conditions}
                canEdit={isAdminOrManager}
              />
            )}

            {personnel && (
              <WorkScheduleSection
                recordId={personnel.record.id}
                schedules={personnel.schedules}
                conditions={personnel.conditions}
                canEdit={isAdminOrManager}
              />
            )}

            {personnel && isAdminOrManager && (
              <>
                <SicknessReportsSection recordId={personnel.record.id} />
                <PersonnelQualificationSummary data={qualificationSummary} />
              </>
            )}

            {personnel && responsibilitySettings ? (
              <ResponsibilitySummarySection
                employeeRecordId={personnel.record.id}
                data={responsibilitySettings}
              />
            ) : null}

            {personnel && (
              <PersonnelHistorySection
                events={personnel.events}
                actorNames={actorNames}
              />
            )}

            <div className="min-w-0 md:col-span-2 2xl:col-span-1">
              <ContextualDocumentsSection
                title="Dokumente & Bilder"
                description="Dokumente, Nachweise und Dateien zu diesem Mitarbeiter."
                documents={documents}
                employeeId={member.userId}
                contextLabel={fullName}
                canUpload={isAdminOrManager}
                canManage={isAdminOrManager}
              />
            </div>

            {/* Live Status Card (compact) */}
            <div className="rounded-lg border bg-card p-3 sm:p-4">
              <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                <Clock className="size-4" />
                Aktueller Status
              </h3>
              <div className="space-y-2.5">
                <StatusBadge
                  status={status?.status}
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
                        todayTargetMinutes > 0 && dailyPercentage >= 100
                          ? 'text-green-600 dark:text-green-400'
                          : 'text-foreground'
                      )}
                    >
                      {todayTargetMinutes > 0
                        ? `${formatMinutesAsHours(memberBreakdown.workMinutes)} / ${formatMinutesAsHours(todayTargetMinutes)} (${dailyPercentage}%)`
                        : formatMinutesAsHours(memberBreakdown.workMinutes)}
                    </span>
                  </div>
                  <Progress
                    value={dailyPercentage}
                    className="h-2"
                    indicatorClassName={cn(
                      'bg-green-500',
                      status?.status === 'working' && 'opacity-80'
                    )}
                  />
                  {todayTarget && todayTarget.targetMinutes === 0 && (
                    <p className="text-[11px] text-muted-foreground">
                      {todayTarget.isHoliday
                        ? `Feiertag: ${todayTarget.holidayName} – keine Sollarbeitszeit.`
                        : todayTarget.isClosureDay
                          ? `Betriebsruhe${todayTarget.closureLabel ? ` (${todayTarget.closureLabel})` : ''} – keine Sollarbeitszeit.`
                          : 'Laut Arbeitszeitmodell heute kein Arbeitstag.'}
                    </p>
                  )}
                  {todayTargetHint && (
                    <p className="text-[11px] text-muted-foreground">
                      {todayTargetHint}
                    </p>
                  )}
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
                      {memberBreakdown.breakMinutes > 0
                        ? formatDuration(memberBreakdown.breakMinutes)
                        : '0 Min.'}
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
                  liveTodayBreakMinutes={liveBreakMinutes}
                  liveTodayBreakMode={status?.breakMode ?? breakMode}
                  liveAutoBreakThresholdMinutes={
                    status?.autoBreakThresholdMinutes ?? autoBreakThresholdMinutes
                  }
                  liveAutoBreakDurationMinutes={
                    status?.autoBreakDurationMinutes ?? autoBreakDurationMinutes
                  }
                  weekLabel={weekLabel}
                  weekTargets={weekTargets}
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
              supportProjects={projectGraphProjects}
              clientMap={clientMap}
              jobAssignmentMap={jobAssignmentMap}
              clients={clients}
              members={members}
              lockedEmployeeLabel={`${member.firstName} ${member.lastName}`.trim()}
              defaultEmployeeIds={[member.userId]}
              isAdminOrManager={isAdminOrManager}
              hideProjectCreation
              hideEmptyProjects
              allProjectsForJobCreation={allProjects}
              visibleColumns={visibleColumns}
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
            <AlertDialogTitle>
              {removalBlockedMessage
                ? 'Mitglied kann noch nicht entfernt werden'
                : 'Mitglied entfernen?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {removalBlockedMessage ? (
                removalBlockedMessage
              ) : (
                <>
                  Bist du sicher, dass du{' '}
                  <span className="font-medium">{fullName}</span> aus der
                  Organisation entfernen möchtest? Diese Aktion kann nicht
                  rückgängig gemacht werden.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {actionError ? (
            <p role="alert" className="text-sm text-destructive">
              {actionError}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRemoving}>
              Abbrechen
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRemove}
              disabled={isRemoving || Boolean(removalBlockedMessage)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isRemoving ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Wird entfernt...
                </>
              ) : (
                removalBlockedMessage ? 'Zuerst neu zuweisen' : 'Entfernen'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
