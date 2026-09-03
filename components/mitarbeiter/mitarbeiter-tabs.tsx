'use client';

import { useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useBanner } from '@/components/ui/banner';
import { ErrorText } from '@/components/ui/error-text';
import { RefreshButton } from '@/components/ui/refresh-button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MembersTable, type OrgMember } from './members-table';
import { InvitationsTable, type Invite } from './invitations-table';
import { inviteCreations } from './invite-dialog';
import { getRoleLabel } from '@/lib/roles';
import { QuickStats } from './quick-stats';
import { PersonnelRecordsSection } from './personnel-records-section';
import { useBusyIds } from '@/hooks/use-busy-id';
import { useMemberStatus } from '@/hooks/use-member-status';
import { useOptimisticChannel } from '@/hooks/use-optimistic-channel';
import { useOptimisticList } from '@/hooks/use-optimistic-list';
import { useRealtimeRouterRefresh } from '@/hooks/use-realtime-router-refresh';
import { useSettleOnChange } from '@/hooks/use-settle-on-change';
import { updateMemberRole, type OrgRole } from '@/lib/members/actions';
import { getMemberActionErrorMessage } from '@/lib/members/errors';
import type { PersonnelListEntry } from '@/lib/personnel/actions';
import type { DailyTarget } from '@/lib/personnel/targets';
import type { OrgBreakMode } from '@/lib/time-tracking/settings';
import type { QualificationWorkspace } from '@/lib/qualifications/types';
import { TeamManagementSection } from './team-management-section';
import { QualificationManagementSection } from './qualification-management-section';

interface MitarbeiterTabsProps {
  members: OrgMember[];
  invites: Invite[];
  personnelEntries: PersonnelListEntry[];
  personnelProfileNames: Record<string, string>;
  targetsByUserId?: Record<string, DailyTarget>;
  removalBlockedByUserId: Record<string, string>;
  currentUserId: string;
  currentUserRole: OrgRole;
  organizationId: string;
  breakMode: OrgBreakMode;
  autoBreakThresholdMinutes: number;
  autoBreakDurationMinutes: number;
  qualificationWorkspace: QualificationWorkspace | null;
}

const getMemberId = (member: OrgMember) => member.user_id;
const getInviteId = (invite: Invite) => invite.id;
// The server lists invites newest first; a just-sent one lands on top.
const compareInvitesNewestFirst = (a: Invite, b: Invite) =>
  b.created_at.localeCompare(a.created_at);

export function MitarbeiterTabs({
  members: initialMembers,
  invites: initialInvites,
  personnelEntries,
  personnelProfileNames,
  targetsByUserId,
  removalBlockedByUserId,
  currentUserId,
  currentUserRole,
  organizationId,
  breakMode,
  autoBreakThresholdMinutes,
  autoBreakDurationMinutes,
  qualificationWorkspace,
}: MitarbeiterTabsProps) {
  const router = useRouter();
  const { showBanner } = useBanner();

  // Server props are the authority; the overlays hold a role change until the
  // refreshed list carries it and an invite just sent until the list has it.
  const memberList = useOptimisticList({ items: initialMembers, getId: getMemberId });
  const inviteList = useOptimisticList({
    items: initialInvites,
    getId: getInviteId,
    compare: compareInvitesNewestFirst,
  });
  useOptimisticChannel(inviteCreations, inviteList);
  const members = useMemo(
    () => memberList.items.map((row) => row.item),
    [memberList.items]
  );
  const invites = useMemo(
    () => inviteList.items.map((row) => row.item),
    [inviteList.items]
  );
  const { run: runBusy, busyIds } = useBusyIds();
  const waitForMembers = useSettleOnChange(initialMembers);

  // Get member IDs for status polling
  const memberIds = useMemo(() => members.map((m) => m.user_id), [members]);

  // Personnel records that are not active members (future starters, non-login
  // personnel, exited people) get their own visibly distinct section.
  const personnelWithoutMembership = useMemo(() => {
    const memberIdSet = new Set(memberIds);
    return personnelEntries.filter(
      (entry) => !entry.record.userId || !memberIdSet.has(entry.record.userId)
    );
  }, [personnelEntries, memberIds]);
  const personnelByUserId = useMemo<Record<string, PersonnelListEntry>>(
    () =>
      Object.fromEntries(
        personnelEntries.flatMap((entry): [string, PersonnelListEntry][] =>
          entry.record.userId ? [[entry.record.userId, entry]] : []
        )
      ),
    [personnelEntries]
  );

  // Poll for member status (working status and hours)
  const {
    statusMap,
    isLoading: isStatusLoading,
    refetch: refetchStatus
  } = useMemberStatus({
    organizationId,
    memberIds,
    breakMode,
    autoBreakThresholdMinutes,
    autoBreakDurationMinutes,
    enabled: memberIds.length > 0
  });

  // Calculate active working count from statusMap
  const activeWorkingCount = useMemo(() => {
    return Object.values(statusMap).filter((status) => status.status === 'working')
      .length;
  }, [statusMap]);

  // Reload server-rendered records and break-policy props. Member status
  // refetches time entries itself, then recomputes when these props change.
  useRealtimeRouterRefresh({
    tables: [
      'organization_invites',
      'organization_settings',
      'employee_records',
      'employment_conditions',
      'work_schedules',
      'organization_closure_days',
      'organization_responsibility_configurations',
      'organization_responsibility_assignments',
      'organization_responsibility_delegations',
      'teams',
      'team_memberships',
      'organization_capabilities',
      'employee_capabilities',
      'organization_qualification_settings',
    ],
  });

  // Role change: the row flips at once and stays marked until the refreshed
  // list lands; the banner fires only after the server confirmed, and a
  // failure rolls the role back and reports at list level.
  const { update: updateMember, rollback: rollbackMember } = memberList;
  const handleRoleChange = useCallback(
    (
      memberId: string,
      newRole: OrgRole,
      firstName: string,
      lastName: string
    ): Promise<void> => {
      const member = members.find((candidate) => candidate.user_id === memberId);
      if (!member) return Promise.resolve();
      const displayName = `${firstName} ${lastName}`.trim() || 'Mitglied';
      updateMember(memberId, { ...member, role: newRole });
      return runBusy(memberId, async () => {
        const result = await updateMemberRole(memberId, newRole).catch(() => null);
        if (!result || !result.success) {
          rollbackMember(memberId);
          showBanner({
            variant: 'error',
            message: `Die Rolle von ${displayName} konnte nicht geändert werden: ${getMemberActionErrorMessage(result?.error)}`,
          });
          return;
        }
        showBanner({
          variant: 'success',
          message: `Die Rolle von ${displayName} wurde erfolgreich zu ${getRoleLabel(newRole)} geändert.`,
        });
        router.refresh();
        await waitForMembers();
      });
    },
    [members, updateMember, rollbackMember, runBusy, router, showBanner, waitForMembers]
  );

  // Count pending invites for the badge
  const pendingCount = invites.filter(
    (i) => i.status === 'pending' && new Date(i.expires_at) > new Date()
  ).length;

  return (
    <>
      <QuickStats
        organizationId={organizationId}
        totalMembers={members.length}
        activeWorkingCount={activeWorkingCount}
        isAdmin={currentUserRole === 'admin'}
      />
      <Tabs defaultValue="members" className="w-full">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <TabsList className="min-w-0 gap-1">
            <TabsTrigger value="members" className="group">
              Mitglieder
              <span className="ml-1 flex h-5 w-5 items-center justify-center rounded-full bg-muted-foreground/20 text-[10px] font-semibold text-muted-foreground group-data-[state=active]:text-foreground">
                {members.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="invitations" className="group">
              Einladungen
              {pendingCount > 0 && (
                <span className="ml-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary group-data-[state=active]:bg-primary group-data-[state=active]:text-primary-foreground">
                  {pendingCount}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="teams">Teams</TabsTrigger>
            <TabsTrigger value="qualifications">Qualifikationen</TabsTrigger>
          </TabsList>

          {/* Route refresh plus the member status refetch; rows stay on screen. */}
          <RefreshButton
            label="Tabellen aktualisieren"
            onRefresh={async () => {
              await refetchStatus();
            }}
            withRouteRefresh
          />
        </div>

        <TabsContent value="members" className="mt-4">
          <MembersTable
            members={members}
            currentUserId={currentUserId}
            currentUserRole={currentUserRole}
            onRoleChange={handleRoleChange}
            statusMap={statusMap}
            isStatusLoading={isStatusLoading}
            busyMemberIds={busyIds}
            targetsByUserId={targetsByUserId}
            personnelByUserId={personnelByUserId}
            removalBlockedByUserId={removalBlockedByUserId}
          />
          <PersonnelRecordsSection
            entries={personnelWithoutMembership}
            profileNames={personnelProfileNames}
          />
        </TabsContent>
        <TabsContent value="invitations" className="mt-4">
          <InvitationsTable rows={inviteList.items} />
        </TabsContent>
        <TabsContent value="teams" className="mt-4">
          {qualificationWorkspace ? (
            <TeamManagementSection
              teams={qualificationWorkspace.teams}
              teamMemberships={qualificationWorkspace.teamMemberships}
              employees={qualificationWorkspace.employees}
            />
          ) : (
            <ErrorText>Die Teams konnten nicht geladen werden.</ErrorText>
          )}
        </TabsContent>
        <TabsContent value="qualifications" className="mt-4">
          {qualificationWorkspace ? (
            <QualificationManagementSection
              capabilities={qualificationWorkspace.capabilities}
              employeeCapabilities={
                qualificationWorkspace.employeeCapabilities
              }
              employees={qualificationWorkspace.employees}
              apprenticeWarningEnabled={
                qualificationWorkspace.apprenticeWarningEnabled
              }
              isAdmin={qualificationWorkspace.isAdmin}
            />
          ) : (
            <ErrorText>Die Qualifikationen konnten nicht geladen werden.</ErrorText>
          )}
        </TabsContent>
      </Tabs>
    </>
  );
}
