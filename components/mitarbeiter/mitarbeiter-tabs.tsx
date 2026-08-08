'use client';

import {
  useState,
  useCallback,
  useEffect,
  useTransition,
  useMemo,
  useRef
} from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { MembersTable, type OrgMember } from './members-table';
import { InvitationsTable, type Invite } from './invitations-table';
import { RoleChangeBanner, type RoleChangeInfo } from './role-change-banner';
import { QuickStats } from './quick-stats';
import { PersonnelRecordsSection } from './personnel-records-section';
import { useMemberStatusPolling } from '@/hooks/use-member-status-polling';
import { useRealtimeEvent } from '@/components/realtime/realtime-provider';
import type { OrgRole } from '@/lib/members/actions';
import type { PersonnelListEntry } from '@/lib/personnel/actions';
import type { DailyTarget } from '@/lib/personnel/targets';
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

  // Poll for member status (working status and hours)
  const {
    statusMap,
    isLoading: isStatusLoading,
    refetch: refetchStatus
  } = useMemberStatusPolling({
    organizationId,
    memberIds,
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

  // Track role change info for banner
  const [roleChangeInfo, setRoleChangeInfo] = useState<RoleChangeInfo | null>(
    null
  );

  // Handle manual refresh
  const handleRefresh = useCallback(() => {
    setPrevMemberCount(members.length);
    setPrevInviteCount(invites.length);
    refetchStatus();
    startTransition(() => {
      router.refresh();
    });
  }, [router, members.length, invites.length, refetchStatus]);
  const realtimeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleRealtimeRefresh = useCallback(() => {
    if (realtimeTimerRef.current) clearTimeout(realtimeTimerRef.current);
    realtimeTimerRef.current = setTimeout(() => {
      realtimeTimerRef.current = null;
      handleRefresh();
    }, 150);
  }, [handleRefresh]);
  useEffect(
    () => () => {
      if (realtimeTimerRef.current) clearTimeout(realtimeTimerRef.current);
    },
    []
  );

  // Realtime: refetch server data when invitations or personnel records change
  useRealtimeEvent('organization_invites', scheduleRealtimeRefresh);
  useRealtimeEvent('employee_records', scheduleRealtimeRefresh);
  useRealtimeEvent('employment_conditions', scheduleRealtimeRefresh);
  useRealtimeEvent('work_schedules', scheduleRealtimeRefresh);
  useRealtimeEvent('organization_closure_days', scheduleRealtimeRefresh);
  useRealtimeEvent('organization_responsibility_configurations', scheduleRealtimeRefresh);
  useRealtimeEvent('organization_responsibility_assignments', scheduleRealtimeRefresh);
  useRealtimeEvent('organization_responsibility_delegations', scheduleRealtimeRefresh);
  useRealtimeEvent('teams', scheduleRealtimeRefresh);
  useRealtimeEvent('team_memberships', scheduleRealtimeRefresh);
  useRealtimeEvent('organization_capabilities', scheduleRealtimeRefresh);
  useRealtimeEvent('employee_capabilities', scheduleRealtimeRefresh);
  useRealtimeEvent('organization_qualification_settings', scheduleRealtimeRefresh);

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

      // Show the success banner
      setRoleChangeInfo({ firstName, lastName, newRole });
    },
    []
  );

  // Dismiss banner callback
  const handleBannerDismiss = useCallback(() => {
    setRoleChangeInfo(null);
  }, []);

  // Count pending invites for the badge
  const pendingCount = invites.filter(
    (i) => i.status === 'pending' && new Date(i.expires_at) > new Date()
  ).length;

  return (
    <>
      <RoleChangeBanner
        roleChangeInfo={roleChangeInfo}
        onDismiss={handleBannerDismiss}
      />
      <QuickStats
        organizationId={organizationId}
        totalMembers={members.length}
        activeWorkingCount={activeWorkingCount}
        isAdmin={currentUserRole === 'admin'}
      />
      <Tabs defaultValue="members" className="w-full">
        <div className="flex items-center justify-between gap-2">
          <TabsList className="gap-1">
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
            className="h-8 w-8"
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
            <p role="alert" className="text-sm text-destructive">
              Die Teams konnten nicht geladen werden.
            </p>
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
            <p role="alert" className="text-sm text-destructive">
              Die Qualifikationen konnten nicht geladen werden.
            </p>
          )}
        </TabsContent>
      </Tabs>
    </>
  );
}
