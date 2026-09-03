'use client';

import {
  useState,
  useCallback,
  useEffect,
  useTransition,
  useMemo
} from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { useBanner } from '@/components/ui/banner';
import { ErrorText } from '@/components/ui/error-text';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { MembersTable, type OrgMember } from './members-table';
import { InvitationsTable, type Invite } from './invitations-table';
import { getRoleLabel } from '@/lib/roles';
import { QuickStats } from './quick-stats';
import { PersonnelRecordsSection } from './personnel-records-section';
import { useMemberStatus } from '@/hooks/use-member-status';
import { useRealtimeRouterRefresh } from '@/hooks/use-realtime-router-refresh';
import type { OrgRole } from '@/lib/members/actions';
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
  const [isPending, startTransition] = useTransition();

  // Sync members and invites state with props (for when server data refreshes)
  const [members, setMembers] = useState<OrgMember[]>(initialMembers);
  const [invites, setInvites] = useState<Invite[]>(initialInvites);

  // Track previous counts for skeleton display during refresh
  const [prevMemberCount, setPrevMemberCount] = useState(initialMembers.length);
  const [prevInviteCount, setPrevInviteCount] = useState(initialInvites.length);

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

  // Update state when props change (after router.refresh())
  useEffect(() => {
    setMembers(initialMembers);
    setPrevMemberCount(initialMembers.length);
  }, [initialMembers]);

  useEffect(() => {
    setInvites(initialInvites);
    setPrevInviteCount(initialInvites.length);
  }, [initialInvites]);

  const { showBanner } = useBanner();

  // Handle manual refresh
  const handleRefresh = useCallback(() => {
    setPrevMemberCount(members.length);
    setPrevInviteCount(invites.length);
    refetchStatus();
    startTransition(() => {
      router.refresh();
    });
  }, [router, members.length, invites.length, refetchStatus]);

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

  // Handle role change with optimistic update
  const handleRoleChange = useCallback(
    (
      memberId: string,
      newRole: OrgRole,
      firstName: string,
      lastName: string
    ) => {
      // Optimistically update the members list
      setMembers((prevMembers) =>
        prevMembers.map((member) =>
          member.user_id === memberId ? { ...member, role: newRole } : member
        )
      );

      const displayName =
        `${firstName} ${lastName}`.trim() || 'Mitglied';
      showBanner({
        variant: 'success',
        message: `Die Rolle von ${displayName} wurde erfolgreich zu ${getRoleLabel(newRole)} geändert.`,
      });
    },
    [showBanner]
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

          <Button
            variant="ghost"
            size="icon"
            onClick={handleRefresh}
            disabled={isPending}
            className="h-8 w-8 shrink-0"
            title="Tabellen aktualisieren"
          >
            <RefreshCw
              className={`size-4 ${isPending ? 'animate-spin' : ''}`}
            />
            <span className="sr-only">Aktualisieren</span>
          </Button>
        </div>

        <TabsContent value="members" className="mt-4">
          <MembersTable
            members={members}
            currentUserId={currentUserId}
            currentUserRole={currentUserRole}
            onRoleChange={handleRoleChange}
            isLoading={isPending || isStatusLoading}
            skeletonCount={prevMemberCount}
            statusMap={statusMap}
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
          <InvitationsTable
            invites={invites}
            isLoading={isPending}
            skeletonCount={prevInviteCount}
          />
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
