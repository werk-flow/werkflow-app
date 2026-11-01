'use client';

import { useMemo } from 'react';
import { SectionError } from '@/components/ui/section-error';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { MembersTable, type OrgMember } from './members-table';
import { InvitationsTable, type Invite } from './invitations-table';
import { inviteCreations } from './invite-dialog';
import { QuickStats } from './quick-stats';
import { PersonnelRecordsSection } from './personnel-records-section';
import { useMemberStatus } from '@/hooks/use-member-status';
import { useOptimisticChannel } from '@/hooks/use-optimistic-channel';
import { useOptimisticList } from '@/hooks/use-optimistic-list';
import { useRealtimeRouterRefresh } from '@/hooks/use-realtime-router-refresh';
import { useServerAction } from '@/hooks/use-server-action';
import type { RealtimeTable } from '@/lib/realtime/tables';
import type { OrgRole } from '@/lib/roles';
import type { PersonnelListEntry } from '@/lib/personnel/record-read-actions';
import type { DailyTarget } from '@/lib/personnel/targets';
import type { OrgBreakMode } from '@/lib/time-tracking/settings';
import type { QualificationWorkspace } from '@/lib/qualifications/types';
import type { PendingJoinRequest } from '@/lib/org/types';
import { JoinRequestsSection } from './join-requests-section';
import { MitarbeiterTabsBar } from './mitarbeiter-tabs-bar';
import { MitarbeiterTabsQualificationPanels } from './mitarbeiter-tabs-qualification-panels';
import { useMitarbeiterTabsRoleChange } from './use-mitarbeiter-tabs-role-change';

interface MitarbeiterTabsProps {
  members: OrgMember[];
  invites: Invite[];
  joinRequests: PendingJoinRequest[];
  personnelEntries: PersonnelListEntry[];
  personnelProfileNames: Record<string, string>;
  targetsByUserId?: Record<string, DailyTarget> | undefined;
  removalBlockedByUserId: Record<string, string>;
  currentUserId: string;
  currentUserRole: OrgRole;
  organizationId: string;
  breakMode: OrgBreakMode;
  autoBreakThresholdMinutes: number;
  autoBreakDurationMinutes: number;
  qualificationWorkspace: QualificationWorkspace | null;
}

// Reload server-rendered records and break-policy props. Member status
// refetches time entries itself, then recomputes when these props change.
// The subscription keys on the joined names (hooks/use-realtime-tables.ts),
// so a module constant subscribes exactly as the inline list did.
const MITARBEITER_TABS_REFRESH_TABLES = [
  'organization_invites',
  'organization_join_requests',
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
] as const satisfies readonly RealtimeTable[];

const getMemberId = (member: OrgMember) => member.user_id;
const getInviteId = (invite: Invite) => invite.id;
// The server lists invites newest first; a just-sent one lands on top.
const compareInvitesNewestFirst = (a: Invite, b: Invite) => b.created_at.localeCompare(a.created_at);

function useMitarbeiterTabsLists(initialMembers: OrgMember[], initialInvites: Invite[]) {
  // Server props are the authority; the overlays hold a role change until the
  // refreshed list carries it and an invite just sent until the list has it.
  const memberList = useOptimisticList({ items: initialMembers, getId: getMemberId });
  const inviteList = useOptimisticList({
    items: initialInvites,
    getId: getInviteId,
    compare: compareInvitesNewestFirst,
  });
  useOptimisticChannel(inviteCreations, inviteList);
  const members = useMemo(() => memberList.items.map((row) => row.item), [memberList.items]);
  const invites = useMemo(() => inviteList.items.map((row) => row.item), [inviteList.items]);
  return { memberList, inviteList, members, invites };
}

function useMitarbeiterPersonnelLookups(members: OrgMember[], personnelEntries: PersonnelListEntry[]) {
  // Get member IDs for status polling
  const memberIds = useMemo(() => members.map((m) => m.user_id), [members]);

  // Personnel records that are not active members (future starters, non-login
  // personnel, exited people) get their own visibly distinct section.
  const personnelWithoutMembership = useMemo(() => {
    const memberIdSet = new Set(memberIds);
    return personnelEntries.filter((entry) => !entry.record.userId || !memberIdSet.has(entry.record.userId));
  }, [personnelEntries, memberIds]);
  const personnelByUserId = useMemo<Record<string, PersonnelListEntry>>(
    () =>
      Object.fromEntries(
        personnelEntries.flatMap((entry): [string, PersonnelListEntry][] =>
          entry.record.userId ? [[entry.record.userId, entry]] : [],
        ),
      ),
    [personnelEntries],
  );
  return { memberIds, personnelWithoutMembership, personnelByUserId };
}

type MitarbeiterMemberStatusOptions = Pick<
  MitarbeiterTabsProps,
  'organizationId' | 'breakMode' | 'autoBreakThresholdMinutes' | 'autoBreakDurationMinutes'
> & { memberIds: string[] };

function useMitarbeiterMemberStatus({
  organizationId,
  memberIds,
  breakMode,
  autoBreakThresholdMinutes,
  autoBreakDurationMinutes,
}: MitarbeiterMemberStatusOptions) {
  // Poll for member status (working status and hours)
  const {
    statusMap,
    isLoading: isStatusLoading,
    isStale: isStatusStale,
    error: statusError,
    refetch: refetchStatus,
  } = useMemberStatus({
    organizationId,
    memberIds,
    breakMode,
    autoBreakThresholdMinutes,
    autoBreakDurationMinutes,
    enabled: memberIds.length > 0,
  });

  const { run: retryStatus, isPending: isStatusRetryPending } = useServerAction(refetchStatus);

  // A failed status read must not read as "nobody works": the count is
  // withheld and the members tab names the failure with a retry.
  // `statusError` stays null when the read threw, so a stale map counts as failed too.
  const statusFailed = statusError !== null || isStatusStale;
  const activeWorkingCount = useMemo(() => {
    if (statusFailed) return null;
    return Object.values(statusMap).filter((status) => status.status === 'working').length;
  }, [statusMap, statusFailed]);

  return {
    statusMap,
    isStatusLoading,
    refetchStatus,
    retryStatus,
    isStatusRetryPending,
    statusFailed,
    activeWorkingCount,
  };
}

type MitarbeiterMembersTabProps = Pick<
  MitarbeiterTabsProps,
  'currentUserId' | 'currentUserRole' | 'targetsByUserId' | 'removalBlockedByUserId' | 'personnelProfileNames'
> & {
  status: ReturnType<typeof useMitarbeiterMemberStatus>;
  members: OrgMember[];
  onRoleChange: ReturnType<typeof useMitarbeiterTabsRoleChange>['handleRoleChange'];
  busyIds: ReturnType<typeof useMitarbeiterTabsRoleChange>['busyIds'];
  personnelByUserId: Record<string, PersonnelListEntry>;
  personnelWithoutMembership: PersonnelListEntry[];
};

function MitarbeiterMembersTab({
  status,
  members,
  currentUserId,
  currentUserRole,
  onRoleChange,
  busyIds,
  targetsByUserId,
  personnelByUserId,
  removalBlockedByUserId,
  personnelWithoutMembership,
  personnelProfileNames,
}: MitarbeiterMembersTabProps) {
  const { statusMap, isStatusLoading, retryStatus, isStatusRetryPending, statusFailed } = status;

  return (
    <TabsContent value="members" className="mt-4">
      {statusFailed ? (
        <SectionError className="mb-4" onRetry={() => void retryStatus()} retryPending={isStatusRetryPending}>
          Der Arbeitsstatus konnte nicht geladen werden. Wer gerade arbeitet, ist deshalb vielleicht nicht
          aktuell.
        </SectionError>
      ) : null}
      <MembersTable
        members={members}
        currentUserId={currentUserId}
        currentUserRole={currentUserRole}
        onRoleChange={onRoleChange}
        statusMap={statusMap}
        isStatusLoading={isStatusLoading}
        isStatusUnavailable={statusFailed}
        busyMemberIds={busyIds}
        targetsByUserId={targetsByUserId}
        personnelByUserId={personnelByUserId}
        removalBlockedByUserId={removalBlockedByUserId}
      />
      <PersonnelRecordsSection entries={personnelWithoutMembership} profileNames={personnelProfileNames} />
    </TabsContent>
  );
}

export function MitarbeiterTabs({
  members: initialMembers,
  invites: initialInvites,
  joinRequests,
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
  const { memberList, inviteList, members, invites } = useMitarbeiterTabsLists(
    initialMembers,
    initialInvites,
  );
  const { handleRoleChange, busyIds } = useMitarbeiterTabsRoleChange({
    members,
    initialMembers,
    updateMember: memberList.update,
    rollbackMember: memberList.rollback,
  });

  const { memberIds, personnelWithoutMembership, personnelByUserId } = useMitarbeiterPersonnelLookups(
    members,
    personnelEntries,
  );
  const status = useMitarbeiterMemberStatus({
    organizationId,
    memberIds,
    breakMode,
    autoBreakThresholdMinutes,
    autoBreakDurationMinutes,
  });

  useRealtimeRouterRefresh({ tables: MITARBEITER_TABS_REFRESH_TABLES });

  // Count pending invites for the badge
  const pendingCount = invites.filter(
    (i) => i.status === 'pending' && new Date(i.expires_at) > new Date(),
  ).length;

  return (
    <>
      <QuickStats
        organizationId={organizationId}
        totalMembers={members.length}
        activeWorkingCount={status.activeWorkingCount}
        isAdmin={currentUserRole === 'admin'}
      />
      <JoinRequestsSection requests={joinRequests} />
      <Tabs defaultValue="members" className="w-full">
        <MitarbeiterTabsBar
          memberCount={members.length}
          pendingCount={pendingCount}
          onRefreshStatus={status.refetchStatus}
        />

        <MitarbeiterMembersTab
          status={status}
          members={members}
          currentUserId={currentUserId}
          currentUserRole={currentUserRole}
          onRoleChange={handleRoleChange}
          busyIds={busyIds}
          targetsByUserId={targetsByUserId}
          personnelByUserId={personnelByUserId}
          removalBlockedByUserId={removalBlockedByUserId}
          personnelWithoutMembership={personnelWithoutMembership}
          personnelProfileNames={personnelProfileNames}
        />
        <TabsContent value="invitations" className="mt-4">
          <InvitationsTable rows={inviteList.items} />
        </TabsContent>
        <MitarbeiterTabsQualificationPanels qualificationWorkspace={qualificationWorkspace} />
      </Tabs>
    </>
  );
}
