import { redirect } from 'next/navigation';
import { readOrganizationClients } from '@/lib/clients/server';
import { cookies } from 'next/headers';

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
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
import { toProject, type ProjectWithDetails } from '@/lib/jobs/types';
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

  const admin = createSupabaseAdminClient();

  const [
    memberResult,
    personnelResult,
    jobsResult,
    clients,
    membersResult,
    allProjectsResult,
    allJobsResult,
    documentsResult,
    organizationSettings,
    organizationUserPreferences,
    responsibilitySettingsResult,
    qualificationSummaryResult,
  ] = await Promise.all([
    getMemberDetail(targetUserId),
    getPersonnelDetail(targetUserId),
    getJobsForMember(targetUserId),
    readOrganizationClients(admin, activeOrgId),
    getOrgMembersForUser(activeOrgId, user.id),
    admin
      .from('projects')
      .select('*')
      .eq('organization_id', activeOrgId)
      .order('created_at', { ascending: false }),
    admin.from('jobs').select('id, project_id, status').eq('organization_id', activeOrgId),
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

  // The project choices and counts feed the jobs region, so any of the three
  // reads failing shows that region as failed instead of an empty one.
  if (allProjectsResult.error) {
    logError('Mitarbeiter detail: project read failed', allProjectsResult.error);
  }
  if (allJobsResult.error) {
    logError('Mitarbeiter detail: job count read failed', allJobsResult.error);
  }
  const projectGraphFailed = Boolean(allProjectsResult.error || allJobsResult.error);
  const jobsData =
    jobsResult.success && !projectGraphFailed
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

  const clientLookup = new Map(clients.map((c) => [c.id, c]));
  const projectJobCounts = new Map<
    string,
    { total: number; completed: number; inProgress: number; parked: number }
  >();
  for (const j of projectGraphFailed ? [] : (allJobsResult.data ?? [])) {
    if (!j.project_id) continue;
    const counts = projectJobCounts.get(j.project_id) ?? { total: 0, completed: 0, inProgress: 0, parked: 0 };
    counts.total++;
    if (j.status === 'fertig') counts.completed++;
    if (j.status === 'in_bearbeitung') counts.inProgress++;
    if (j.status === 'geparkt') counts.parked++;
    projectJobCounts.set(j.project_id, counts);
  }

  // Without both reads the jobs region shows its failure, so the graph stays empty.
  const allProjects: ProjectWithDetails[] = (projectGraphFailed ? [] : (allProjectsResult.data ?? [])).map(
    (row) => {
      const project = toProject(row);
      const counts = projectJobCounts.get(project.id) ?? { total: 0, completed: 0, inProgress: 0, parked: 0 };
      return {
        ...project,
        client: project.clientId ? (clientLookup.get(project.clientId) ?? null) : null,
        jobCount: counts.total,
        completedJobCount: counts.completed,
        inProgressJobCount: counts.inProgress,
        parkedJobCount: counts.parked,
      };
    },
  );

  const employeeProjectGraph = Array.from(
    new Map([...allProjects, ...(jobsData?.projects ?? [])].map((project) => [project.id, project])).values(),
  );
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
      projectGraphProjects={employeeProjectGraph}
      clientMap={jobsData?.clientMap ?? {}}
      jobAssignmentMap={jobsData?.jobAssignmentMap ?? {}}
      clients={clients}
      members={members}
      allProjects={allProjects}
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
