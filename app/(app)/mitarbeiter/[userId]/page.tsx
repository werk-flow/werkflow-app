import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';

import { resolveActiveOrgId } from '@/lib/org/cookies';
import { getEmployeeDocuments } from '@/lib/documents/actions';
import {
  getCachedMemberships,
  getCachedOrganizationSettings,
  getCachedUser,
  getOrganizationUserPreferencesForView,
} from '@/lib/data/cached';
import { getMemberDetail, getProfilesByIds, type OrgRole } from '@/lib/members/actions';
import { getOrgMembersForUser } from '@/lib/members/queries';
import { getPersonnelDetail, type PersonnelDetail } from '@/lib/personnel/actions';
import { getJobsForMember } from '@/lib/jobs/actions';
import type { OrgMemberOption } from '@/components/auftraege/shared/employee-multi-select';
import { MitarbeiterDetailContent } from '@/components/mitarbeiter/mitarbeiter-detail-content';
import { PersonnelRecordDetailContent } from '@/components/mitarbeiter/personnel-record-detail-content';
import { RegionLoadError } from '@/components/shared/region-load-error';
import { RouteRedirect } from '@/components/shared/route-redirect';
import { getResponsibilitySettingsData } from '@/lib/responsibilities/server';
import { getPersonnelQualificationSummary } from '@/lib/qualifications/actions';
import { getPersonnelLifecycle } from '@/lib/personnel/lifecycle-actions';
import { logError } from '@/lib/logging';
import MitarbeiterDetailLoading from './loading';

/** Names of the people in the personnel history; null when the read failed. */
async function resolveActorNames(detail: PersonnelDetail | null): Promise<Record<string, string> | null> {
  if (!detail) return {};
  const actorIds = Array.from(
    new Set(detail.events.map((event) => event.createdBy).filter((id): id is string => Boolean(id))),
  );
  const profiles = await getProfilesByIds(actorIds);
  if (!profiles.success) return null;
  const names: Record<string, string> = {};
  for (const [id, profile] of Object.entries(profiles.profiles)) {
    const name = [profile.firstName, profile.lastName].filter(Boolean).join(' ');
    if (name) names[id] = name;
  }
  return names;
}

interface MitarbeiterDetailPageProps {
  params: Promise<{ userId: string }>;
}

async function MitarbeiterDetailData({ targetUserId }: { targetUserId: string }) {
  const [
    {
      data: { user },
    },
    cookieStore,
  ] = await Promise.all([getCachedUser(), cookies()]);

  if (!user) redirect('/login');

  const [activeOrgId, memberships] = await Promise.all([
    resolveActiveOrgId(cookieStore, user.id),
    getCachedMemberships(user.id),
  ]);
  if (!activeOrgId) redirect('/mitarbeiter');

  const currentMembership = memberships.find((m) => m.orgId === activeOrgId);
  const currentUserRole = currentMembership?.role as OrgRole | undefined;
  const isAdminOrManager = currentUserRole === 'admin' || currentUserRole === 'buero';

  if (!isAdminOrManager) {
    redirect('/dashboard');
  }

  const [
    memberResult,
    personnelResult,
    jobsResult,
    membersResult,
    documentsResult,
    organizationSettings,
    organizationUserPreferences,
    responsibilitySettingsResult,
    qualificationSummaryResult,
  ] = await Promise.all([
    getMemberDetail(targetUserId),
    getPersonnelDetail(targetUserId),
    getJobsForMember(targetUserId),
    getOrgMembersForUser(activeOrgId, user.id),
    getEmployeeDocuments(targetUserId),
    getCachedOrganizationSettings(activeOrgId),
    getOrganizationUserPreferencesForView(activeOrgId, user.id),
    getResponsibilitySettingsData(),
    getPersonnelQualificationSummary(targetUserId),
  ]);
  const qualificationSummary = qualificationSummaryResult.success ? qualificationSummaryResult.data : null;
  if (!qualificationSummaryResult.success) {
    logError('Mitarbeiter detail: qualification summary read failed', qualificationSummaryResult.error);
  }
  const personnelDetail = personnelResult.success ? personnelResult.detail : null;
  // A missing record keeps the member-only view; a failed read must not look like one.
  // getPersonnelDetail logs both failures with their cause.
  const personnelLoadFailed =
    !personnelResult.success &&
    (personnelResult.error === 'load_failed' || personnelResult.error === 'unexpected_error');
  // Both follow-up reads need only the personnel detail, so they run together.
  const [lifecycleResult, actorNames] = await Promise.all([
    personnelDetail ? getPersonnelLifecycle(personnelDetail.record.id) : null,
    resolveActorNames(personnelDetail),
  ]);
  if (lifecycleResult && !lifecycleResult.success) {
    logError('Mitarbeiter detail: lifecycle read failed', lifecycleResult.error);
  }

  if (
    !memberResult.success &&
    (memberResult.error === 'load_failed' || memberResult.error === 'unexpected_error')
  ) {
    return (
      <RegionLoadError title="Der Mitarbeiter konnte nicht geladen werden">
        Die Mitgliedschaft ist gerade nicht erreichbar. Versuche es in einem Moment erneut.
      </RegionLoadError>
    );
  }

  if (!memberResult.success) {
    // No active membership: personnel records without a login and exited
    // people get the personnel-only detail surface.
    if (personnelLoadFailed) {
      return (
        <RegionLoadError title="Der Mitarbeiter konnte nicht geladen werden">
          Die Personalakte ist gerade nicht erreichbar. Versuche es in einem Moment erneut.
        </RegionLoadError>
      );
    }
    if (personnelDetail) {
      return (
        <PersonnelRecordDetailContent
          detail={personnelDetail}
          actorNames={actorNames}
          canEdit={isAdminOrManager}
          qualificationSummary={qualificationSummary}
          lifecycle={lifecycleResult?.success ? lifecycleResult.data : null}
          canAdministerAccess={currentUserRole === 'admin'}
        />
      );
    }
    return (
      <RouteRedirect href="/mitarbeiter">
        <MitarbeiterDetailLoading />
      </RouteRedirect>
    );
  }

  if (!membersResult.success) {
    return (
      <RegionLoadError title="Der Mitarbeiter konnte nicht geladen werden">
        Die Mitarbeiterliste ist gerade nicht erreichbar. Versuche es in einem Moment erneut.
      </RegionLoadError>
    );
  }

  const { member } = memberResult;

  const jobsData = jobsResult.success
    ? {
        jobs: jobsResult.jobs,
        projects: jobsResult.projects,
        clientMap: jobsResult.clientMap,
        jobAssignmentMap: jobsResult.jobAssignmentMap,
      }
    : null;

  const members: OrgMemberOption[] = membersResult.members.map((m) => ({
    userId: m.user_id,
    firstName: m.first_name,
    lastName: m.last_name,
    role: m.role,
  }));

  const { visibleColumns } = organizationUserPreferences;
  if (!documentsResult.success) {
    logError('Mitarbeiter detail: document read failed', documentsResult.error);
  }

  return (
    <MitarbeiterDetailContent
      member={member}
      personnel={personnelDetail}
      personnelLoadFailed={personnelLoadFailed}
      actorNames={actorNames}
      jobs={jobsData?.jobs ?? null}
      projects={jobsData?.projects ?? []}
      clientMap={jobsData?.clientMap ?? {}}
      jobAssignmentMap={jobsData?.jobAssignmentMap ?? {}}
      members={members}
      organizationId={activeOrgId}
      currentUserId={user.id}
      currentUserRole={currentUserRole}
      isAdminOrManager={isAdminOrManager}
      visibleColumns={visibleColumns}
      documents={documentsResult.success ? documentsResult.documents : null}
      breakMode={organizationSettings.breakMode}
      autoBreakThresholdMinutes={organizationSettings.autoBreakThresholdMinutes}
      autoBreakDurationMinutes={organizationSettings.autoBreakDurationMinutes}
      responsibilitySettings={responsibilitySettingsResult.success ? responsibilitySettingsResult.data : null}
      qualificationSummary={qualificationSummary}
      lifecycle={lifecycleResult?.success ? lifecycleResult.data : null}
      canAdministerAccess={currentUserRole === 'admin'}
    />
  );
}

export default async function MitarbeiterDetailPage({ params }: MitarbeiterDetailPageProps) {
  const { userId: targetUserId } = await params;

  return <MitarbeiterDetailData targetUserId={targetUserId} />;
}
