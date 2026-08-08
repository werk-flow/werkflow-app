import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { resolveActiveOrgId } from '@/lib/org/cookies';
import {
  getEmployeeDocuments,
} from '@/lib/documents/actions';
import type { OrganizationDocument } from '@/lib/documents/types';
import {
  getCachedMemberships,
  getCachedOrganizationSettings,
  getCachedOrganizationUserPreferences,
  getCachedUser,
} from '@/lib/data/cached';
import {
  getMemberDetail,
  getOrgMembersForUser,
  getProfilesByIds,
  type OrgRole,
} from '@/lib/members/actions';
import { getPersonnelDetail, type PersonnelDetail } from '@/lib/personnel/actions';
import { getJobsForMember } from '@/lib/jobs/actions';
import { toClient, toProject, type Client, type ProjectWithDetails } from '@/lib/jobs/types';
import type { OrgMemberOption } from '@/components/auftraege/employee-multi-select';
import { MitarbeiterDetailContent } from '@/components/mitarbeiter/mitarbeiter-detail-content';
import { PersonnelRecordDetailContent } from '@/components/mitarbeiter/personnel-record-detail-content';
import { RouteRedirect } from '@/components/shared/route-redirect';
import { getResponsibilitySettingsData } from '@/lib/responsibilities/server';
import { getQualificationWorkspace } from '@/lib/qualifications/actions';
import type { QualificationWorkspace } from '@/lib/qualifications/types';
import type { PersonnelQualificationSummaryData } from '@/components/mitarbeiter/personnel-qualification-summary';
import MitarbeiterDetailLoading from './loading';

async function resolveActorNames(
  detail: PersonnelDetail | null
): Promise<Record<string, string>> {
  if (!detail) return {};
  const actorIds = Array.from(
    new Set(
      detail.events
        .map((event) => event.createdBy)
        .filter((id): id is string => Boolean(id))
    )
  );
  const profiles = await getProfilesByIds(actorIds);
  const names: Record<string, string> = {};
  for (const [id, profile] of Object.entries(profiles)) {
    const name = [profile.firstName, profile.lastName].filter(Boolean).join(' ');
    if (name) names[id] = name;
  }
  return names;
}

interface MitarbeiterDetailPageProps {
  params: Promise<{ userId: string }>;
}

function buildQualificationSummary(
  workspace: QualificationWorkspace | null,
  employeeRecordId: string | null
): PersonnelQualificationSummaryData {
  if (!workspace || !employeeRecordId) {
    return { teamNames: [], entries: [] };
  }
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const teamIds = new Set(
    workspace.teamMemberships
      .filter(
        (membership) =>
          membership.employeeRecordId === employeeRecordId &&
          membership.validFrom <= today &&
          (!membership.validUntil || membership.validUntil >= today)
      )
      .map((membership) => membership.teamId)
  );
  const definitionById = new Map(
    workspace.capabilities.map((definition) => [definition.id, definition])
  );
  return {
    teamNames: workspace.teams
      .filter((team) => !team.dissolvedAt && teamIds.has(team.id))
      .map((team) => team.name)
      .sort(),
    entries: workspace.employeeCapabilities.flatMap((record) => {
      if (
        record.employeeRecordId !== employeeRecordId ||
        record.supersededAt
      ) {
        return [];
      }
      const definition = definitionById.get(record.capabilityId);
      return definition ? [{ definition, record }] : [];
    }),
  };
}

async function MitarbeiterDetailData({
  targetUserId,
}: {
  targetUserId: string;
}) {
  const [{ data: { user } }, cookieStore] = await Promise.all([
    getCachedUser(),
    cookies(),
  ]);

  if (!user) redirect('/login');

  const activeOrgId = await resolveActiveOrgId(cookieStore, user.id);
  if (!activeOrgId) redirect('/mitarbeiter');

  const memberships = await getCachedMemberships(user.id);
  const currentMembership = memberships.find((m) => m.orgId === activeOrgId);
  const currentUserRole = currentMembership?.role as OrgRole | undefined;
  const isAdminOrManager =
    currentUserRole === 'admin' || currentUserRole === 'buero';

  if (!isAdminOrManager) {
    redirect('/dashboard');
  }

  const admin = createSupabaseAdminClient();

  const [
    memberResult,
    personnelResult,
    jobsResult,
    clientsResult,
    membersResult,
    allProjectsResult,
    allJobsResult,
    documentsResult,
    organizationSettings,
    organizationUserPreferences,
    responsibilitySettingsResult,
    qualificationWorkspaceResult,
  ] = await Promise.all([
    getMemberDetail(targetUserId),
    getPersonnelDetail(targetUserId),
    getJobsForMember(targetUserId),
    admin
      .from('clients')
      .select('*')
      .eq('organization_id', activeOrgId)
      .order('name', { ascending: true }),
    getOrgMembersForUser(activeOrgId, user.id),
    admin
      .from('projects')
      .select('*')
      .eq('organization_id', activeOrgId)
      .order('created_at', { ascending: false }),
    admin
      .from('jobs')
      .select('id, project_id, status')
      .eq('organization_id', activeOrgId),
    getEmployeeDocuments(targetUserId),
    getCachedOrganizationSettings(activeOrgId),
    getCachedOrganizationUserPreferences(activeOrgId, user.id),
    getResponsibilitySettingsData(),
    getQualificationWorkspace(),
  ]);
  const qualificationWorkspace = qualificationWorkspaceResult.success
    ? qualificationWorkspaceResult.data
    : null;

  if (!memberResult.success) {
    // No active membership: personnel records without a login and exited
    // people get the personnel-only detail surface.
    if (personnelResult.success) {
      const actorNames = await resolveActorNames(personnelResult.detail);
      return (
        <PersonnelRecordDetailContent
          detail={personnelResult.detail}
          actorNames={actorNames}
          canEdit={isAdminOrManager}
          qualificationSummary={buildQualificationSummary(
            qualificationWorkspace,
            personnelResult.detail.record.id
          )}
        />
      );
    }
    return (
      <RouteRedirect href="/mitarbeiter">
        <MitarbeiterDetailLoading />
      </RouteRedirect>
    );
  }

  const { member } = memberResult;
  const personnelDetail = personnelResult.success
    ? personnelResult.detail
    : null;
  const actorNames = await resolveActorNames(personnelDetail);
  if (!personnelResult.success) {
    console.error('Failed to load personnel detail:', personnelResult.error);
  }

  const jobsData = jobsResult.success
    ? {
        jobs: jobsResult.jobs,
        projects: jobsResult.projects,
        clientMap: jobsResult.clientMap,
        jobAssignmentMap: jobsResult.jobAssignmentMap,
      }
    : { jobs: [], projects: [], clientMap: {}, jobAssignmentMap: {} };

  const clients: Client[] = (clientsResult.data ?? []).map(toClient);
  const members: OrgMemberOption[] = membersResult.map(
    (m) => ({
      userId: m.user_id,
      firstName: m.first_name,
      lastName: m.last_name,
      role: m.role,
    })
  );

  const clientLookup = new Map(clients.map((c) => [c.id, c]));
  const projectJobCounts = new Map<string, { total: number; completed: number; inProgress: number; parked: number }>();
  for (const j of allJobsResult.data ?? []) {
    if (!j.project_id) continue;
    const counts = projectJobCounts.get(j.project_id) ?? { total: 0, completed: 0, inProgress: 0, parked: 0 };
    counts.total++;
    if (j.status === 'fertig') counts.completed++;
    if (j.status === 'in_bearbeitung') counts.inProgress++;
    if (j.status === 'geparkt') counts.parked++;
    projectJobCounts.set(j.project_id, counts);
  }

  const allProjects: ProjectWithDetails[] = (allProjectsResult.data ?? []).map((row) => {
    const project = toProject(row);
    const counts = projectJobCounts.get(project.id) ?? { total: 0, completed: 0, inProgress: 0, parked: 0 };
    return {
      ...project,
      client: project.clientId ? clientLookup.get(project.clientId) ?? null : null,
      jobCount: counts.total,
      completedJobCount: counts.completed,
      inProgressJobCount: counts.inProgress,
      parkedJobCount: counts.parked,
    };
  });

  const employeeProjectGraph = Array.from(
    new Map(
      [...allProjects, ...jobsData.projects].map((project) => [project.id, project])
    ).values()
  );
  const { visibleColumns } = organizationUserPreferences;
  if (!documentsResult.success) {
    console.error('Failed to load employee documents:', documentsResult.error);
  }

  const documents: OrganizationDocument[] = documentsResult.success
    ? documentsResult.documents
    : [];

  return (
    <MitarbeiterDetailContent
      member={member}
      personnel={personnelDetail}
      actorNames={actorNames}
      jobs={jobsData.jobs}
      projects={jobsData.projects}
      projectGraphProjects={employeeProjectGraph}
      clientMap={jobsData.clientMap}
      jobAssignmentMap={jobsData.jobAssignmentMap}
      clients={clients}
      members={members}
      allProjects={allProjects}
      organizationId={activeOrgId}
      currentUserId={user.id}
      currentUserRole={currentUserRole!}
      isAdminOrManager={isAdminOrManager}
      visibleColumns={visibleColumns}
      documents={documents}
      breakMode={organizationSettings.breakMode}
      autoBreakThresholdMinutes={organizationSettings.autoBreakThresholdMinutes}
      autoBreakDurationMinutes={organizationSettings.autoBreakDurationMinutes}
      responsibilitySettings={
        responsibilitySettingsResult.success
          ? responsibilitySettingsResult.data
          : null
      }
      qualificationSummary={buildQualificationSummary(
        qualificationWorkspace,
        personnelDetail?.record.id ?? null
      )}
    />
  );
}

export default async function MitarbeiterDetailPage({
  params,
}: MitarbeiterDetailPageProps) {
  const { userId: targetUserId } = await params;

  return <MitarbeiterDetailData targetUserId={targetUserId} />;
}
