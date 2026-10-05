import { RegionLoadError } from '@/components/shared/region-load-error';
import { Suspense } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { LIST_ROW_CAP, readCompleteRows } from '@/lib/supabase/query-batches';
import { resolveActiveOrgId } from '@/lib/org/cookies';
import { getCachedUser, getCachedMemberships, getCachedOrganizationSettings } from '@/lib/data/cached';
import { InviteDialog } from '@/components/mitarbeiter/invite-dialog';
import { CreatePersonnelDialog } from '@/components/mitarbeiter/create-personnel-dialog';
import { MitarbeiterTabs } from '@/components/mitarbeiter/mitarbeiter-tabs';
import { MitarbeiterContentSkeleton } from '@/components/loading-states/mitarbeiter-content-skeleton';
import { PageHeader } from '@/components/shared/page-header';
import { PageBody, PageShell } from '@/components/shared/page-shell';
import { UrlFlashBanner } from '@/components/ui/banner';
import type { OrgMember } from '@/components/mitarbeiter/members-table';
import type { Invite } from '@/components/mitarbeiter/invitations-table';
import { getProfilesByIds, type OrgRole } from '@/lib/members/actions';
import { getOrgMembersForUser } from '@/lib/members/queries';
import { logError } from '@/lib/logging';
import { readPendingJoinRequests } from '@/lib/org/join-requests';
import { getPersonnelRecords } from '@/lib/personnel/actions';
import { getTodayTargetsForMembers } from '@/lib/personnel/target-actions';
import { getQualificationWorkspace } from '@/lib/qualifications/actions';
import { getResponsibilitySettingsData } from '@/lib/responsibilities/server';
import { getResponsibilitiesStrandedByEmployeeRemoval } from '@/lib/responsibilities/resolution';
import { getResponsibilityRemovalBlockMessage } from '@/lib/members/errors';

async function MitarbeiterData({
  activeOrgId,
  userId,
  currentUserRole,
}: {
  activeOrgId: string;
  userId: string;
  currentUserRole: OrgRole;
}) {
  const [
    membersResult,
    invitesResult,
    personnelResult,
    targetsResult,
    responsibilitySettingsResult,
    qualificationWorkspaceResult,
    organizationSettings,
    joinRequestsResult,
  ] = await Promise.all([
    getOrgMembersForUser(activeOrgId, userId),
    // Complete on purpose: a plain select stops at the response cap without
    // an error and would hide older invitations.
    readCompleteRows(
      (from, to) =>
        createSupabaseAdminClient()
          .from('organization_invites')
          .select('id, email, status, created_at, expires_at, accepted_at, invited_role')
          .eq('organization_id', activeOrgId)
          .order('created_at', { ascending: false })
          .order('id')
          .range(from, to),
      LIST_ROW_CAP,
    ),
    getPersonnelRecords(),
    getTodayTargetsForMembers(),
    getResponsibilitySettingsData(),
    getQualificationWorkspace(),
    getCachedOrganizationSettings(activeOrgId),
    readPendingJoinRequests(activeOrgId),
  ]);

  if (!qualificationWorkspaceResult.success) {
    logError('Mitarbeiter: qualification workspace read failed', qualificationWorkspaceResult.error);
  }

  const memberList = membersResult.success ? (membersResult.members as OrgMember[]) : [];
  const inviteList = invitesResult.data as Invite[];

  if (invitesResult.error) {
    logError('Mitarbeiter: invite read failed', invitesResult.error);
  }

  if (!personnelResult.success) {
    logError('Mitarbeiter: personnel record read failed', personnelResult.error);
  }
  const personnelEntries = personnelResult.success ? personnelResult.entries : [];
  const removalBlockedByUserId: Record<string, string> = {};
  if (responsibilitySettingsResult.success) {
    for (const entry of personnelEntries) {
      if (!entry.record.userId) continue;
      const message = getResponsibilityRemovalBlockMessage(
        getResponsibilitiesStrandedByEmployeeRemoval(
          responsibilitySettingsResult.data.effective,
          entry.record.id,
        ),
      );
      if (message) removalBlockedByUserId[entry.record.userId] = message;
    }
  }

  // Exited people keep their linked login; resolve those names from profiles.
  const linkedUserIds = personnelEntries
    .map((entry) => entry.record.userId)
    .filter((id): id is string => Boolean(id));
  const profileNamesResult = await getProfilesByIds(linkedUserIds);
  const profileNamesByUserId = profileNamesResult.success ? profileNamesResult.profiles : {};
  const personnelProfileNames: Record<string, string> = {};
  for (const entry of personnelEntries) {
    if (!entry.record.userId) continue;
    const profile = profileNamesByUserId[entry.record.userId];
    if (!profile) continue;
    const name = [profile.firstName, profile.lastName].filter(Boolean).join(' ');
    if (name) personnelProfileNames[entry.record.id] = name;
  }

  // A failed read must not look like an empty list (feedback canon: no
  // silent failures). The tabs still render what did load.
  const failedRegions = [
    membersResult.success ? null : 'Mitarbeiter',
    joinRequestsResult.success ? null : 'Beitrittsanfragen',
    invitesResult.error ? 'Einladungen' : null,
    personnelResult.success ? null : 'Personalakten',
    qualificationWorkspaceResult.success ? null : 'Qualifikationen',
    targetsResult.success ? null : 'Tagesziele',
    responsibilitySettingsResult.success ? null : 'Verantwortlichkeiten',
    profileNamesResult.success ? null : 'Namen ausgeschiedener Mitarbeiter',
  ].filter((region): region is string => region !== null);

  return (
    <>
      {failedRegions.length > 0 && (
        <RegionLoadError className="mb-4" title={`Nicht geladen: ${failedRegions.join(', ')}`}>
          Die Listen unten können deshalb unvollständig sein. Lade die Seite erneut, bevor du Änderungen
          vornimmst.
        </RegionLoadError>
      )}
      <MitarbeiterTabs
        members={memberList}
        invites={inviteList}
        joinRequests={joinRequestsResult.success ? joinRequestsResult.requests : []}
        personnelEntries={personnelEntries}
        personnelProfileNames={personnelProfileNames}
        targetsByUserId={targetsResult.success ? targetsResult.targetsByUserId : undefined}
        removalBlockedByUserId={removalBlockedByUserId}
        currentUserId={userId}
        currentUserRole={currentUserRole}
        organizationId={activeOrgId}
        breakMode={organizationSettings.breakMode}
        autoBreakThresholdMinutes={organizationSettings.autoBreakThresholdMinutes}
        autoBreakDurationMinutes={organizationSettings.autoBreakDurationMinutes}
        qualificationWorkspace={
          qualificationWorkspaceResult.success ? qualificationWorkspaceResult.data : null
        }
      />
    </>
  );
}

export default async function MitarbeiterPage() {
  const [
    {
      data: { user },
    },
    cookieStore,
  ] = await Promise.all([getCachedUser(), cookies()]);

  if (!user) {
    redirect('/login');
  }

  const [activeOrgId, memberships] = await Promise.all([
    resolveActiveOrgId(cookieStore, user.id),
    getCachedMemberships(user.id),
  ]);

  if (!activeOrgId) {
    return (
      <PageShell>
        <PageHeader title="Mitarbeiter" />
        <PageBody>
          <p className="text-muted-foreground">Bitte wähle zuerst eine Organisation aus.</p>
        </PageBody>
      </PageShell>
    );
  }

  const currentMembership = memberships.find((m) => m.orgId === activeOrgId);

  const currentUserRole = currentMembership?.role as OrgRole | undefined;
  const isAdminOrManager = currentUserRole === 'admin' || currentUserRole === 'buero';

  if (!isAdminOrManager) {
    redirect('/dashboard');
  }

  return (
    <PageShell>
      <Suspense fallback={null}>
        <UrlFlashBanner
          paramKey="removed_member"
          messageTemplate="„{name}“ wurde aus der Organisation entfernt."
        />
      </Suspense>
      <PageHeader
        title="Mitarbeiter"
        actions={
          <>
            <CreatePersonnelDialog />
            <InviteDialog />
          </>
        }
      />

      <PageBody>
        <Suspense fallback={<MitarbeiterContentSkeleton />}>
          <MitarbeiterData activeOrgId={activeOrgId} userId={user.id} currentUserRole={currentUserRole} />
        </Suspense>
      </PageBody>
    </PageShell>
  );
}
