import { RegionLoadError } from '@/components/shared/region-load-error';
import { Suspense } from 'react';
import { redirect } from 'next/navigation';

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { LIST_ROW_CAP, readCompleteRows } from '@/lib/supabase/query-batches';
import { resolvePageMembership } from '@/lib/org/page-context';
import { getCachedOrganizationSettings } from '@/lib/data/cached';
import { InviteDialog } from '@/components/mitarbeiter/invite-dialog';
import { CreatePersonnelDialog } from '@/components/mitarbeiter/create-personnel-dialog';
import { MitarbeiterTabs } from '@/components/mitarbeiter/mitarbeiter-tabs';
import { MitarbeiterContentSkeleton } from '@/components/loading-states/mitarbeiter-content-skeleton';
import { PageHeader } from '@/components/shared/page-header';
import { PageBody, PageShell } from '@/components/shared/page-shell';
import { UrlFlashBanner } from '@/components/ui/banner';
import { getProfilesByIds } from '@/lib/members/actions';
import { isManagerRole, type OrgRole } from '@/lib/roles';
import { getOrgMembersForUser, type ProfileNamesRead } from '@/lib/members/queries';
import { logError } from '@/lib/logging';
import { readPendingJoinRequests } from '@/lib/org/join-requests';
import { getPersonnelRecords, type PersonnelListEntry } from '@/lib/personnel/record-read-actions';
import { getTodayTargetsForMembers } from '@/lib/personnel/target-actions';
import { getQualificationWorkspace } from '@/lib/qualifications/workspace-actions';
import { getResponsibilitySettingsData } from '@/lib/responsibilities/server';
import { getResponsibilitiesStrandedByEmployeeRemoval } from '@/lib/responsibilities/resolution';
import { getResponsibilityRemovalBlockMessage } from '@/lib/members/errors';

// Complete on purpose: a plain select stops at the response cap without
// an error and would hide older invitations.
function readOrganizationInviteRows(activeOrgId: string) {
  return readCompleteRows(
    (from, to) =>
      createSupabaseAdminClient()
        .from('organization_invites')
        .select('id, email, status, created_at, expires_at, accepted_at, invited_role')
        .eq('organization_id', activeOrgId)
        .order('created_at', { ascending: false })
        .order('id')
        .range(from, to),
    LIST_ROW_CAP,
  );
}

/** Why each linked member cannot be removed yet: the responsibilities only they hold. */
function removalBlockMessagesByUserId(
  personnelEntries: PersonnelListEntry[],
  effective: Parameters<typeof getResponsibilitiesStrandedByEmployeeRemoval>[0],
): Record<string, string> {
  const removalBlockedByUserId: Record<string, string> = {};
  for (const entry of personnelEntries) {
    if (!entry.record.userId) continue;
    const message = getResponsibilityRemovalBlockMessage(
      getResponsibilitiesStrandedByEmployeeRemoval(effective, entry.record.id),
    );
    if (message) removalBlockedByUserId[entry.record.userId] = message;
  }
  return removalBlockedByUserId;
}

/** The profile name of each linked personnel record, keyed by record id. */
function personnelProfileNamesByRecordId(
  personnelEntries: PersonnelListEntry[],
  profileNamesByUserId: Extract<ProfileNamesRead, { success: true }>['profiles'],
): Record<string, string> {
  const personnelProfileNames: Record<string, string> = {};
  for (const entry of personnelEntries) {
    if (!entry.record.userId) continue;
    const profile = profileNamesByUserId[entry.record.userId];
    if (!profile) continue;
    const name = [profile.firstName, profile.lastName].filter(Boolean).join(' ');
    if (name) personnelProfileNames[entry.record.id] = name;
  }
  return personnelProfileNames;
}

function MitarbeiterLoadWarning({ failedRegions }: { failedRegions: string[] }) {
  return (
    <RegionLoadError className="mb-4" title={`Nicht geladen: ${failedRegions.join(', ')}`}>
      Die Listen unten können deshalb unvollständig sein. Lade die Seite erneut, bevor du Änderungen
      vornimmst.
    </RegionLoadError>
  );
}

type MitarbeiterDataProps = {
  activeOrgId: string;
  userId: string;
  currentUserRole: OrgRole;
};

async function MitarbeiterData({ activeOrgId, userId, currentUserRole }: MitarbeiterDataProps) {
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
    readOrganizationInviteRows(activeOrgId),
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

  const memberList = membersResult.success ? membersResult.members : [];
  const inviteList = invitesResult.data;

  if (invitesResult.error) {
    logError('Mitarbeiter: invite read failed', invitesResult.error);
  }

  if (!personnelResult.success) {
    logError('Mitarbeiter: personnel record read failed', personnelResult.error);
  }
  const personnelEntries = personnelResult.success ? personnelResult.entries : [];
  const removalBlockedByUserId = responsibilitySettingsResult.success
    ? removalBlockMessagesByUserId(personnelEntries, responsibilitySettingsResult.data.effective)
    : {};

  // Exited people keep their linked login; resolve those names from profiles.
  const linkedUserIds = personnelEntries
    .map((entry) => entry.record.userId)
    .filter((id): id is string => Boolean(id));
  const profileNamesResult = await getProfilesByIds(linkedUserIds);
  const profileNamesByUserId = profileNamesResult.success ? profileNamesResult.profiles : {};
  const personnelProfileNames = personnelProfileNamesByRecordId(personnelEntries, profileNamesByUserId);

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
      {failedRegions.length > 0 && <MitarbeiterLoadWarning failedRegions={failedRegions} />}
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
  const { user, membership } = await resolvePageMembership();

  if (!membership) {
    return (
      <PageShell>
        <PageHeader title="Mitarbeiter" />
        <PageBody>
          <p className="text-muted-foreground">Bitte wähle zuerst eine Organisation aus.</p>
        </PageBody>
      </PageShell>
    );
  }

  const activeOrgId = membership.orgId;
  const currentUserRole = membership.role;
  if (!isManagerRole(currentUserRole)) {
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
