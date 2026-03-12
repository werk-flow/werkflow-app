import { notFound, redirect } from 'next/navigation';
import { cookies } from 'next/headers';

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { resolveActiveOrgId } from '@/lib/org/cookies';
import { getCachedUser, getCachedMemberships } from '@/lib/data/cached';
import { getMemberDetail, type OrgRole } from '@/lib/members/actions';
import { getJobsForMember } from '@/lib/jobs/actions';
import { toClient, toProject, type Client, type ProjectWithDetails } from '@/lib/jobs/types';
import type { OrgMemberOption } from '@/components/auftraege/employee-multi-select';
import { MitarbeiterDetailContent } from '@/components/mitarbeiter/mitarbeiter-detail-content';

interface MitarbeiterDetailPageProps {
  params: Promise<{ userId: string }>;
}

export default async function MitarbeiterDetailPage({
  params,
}: MitarbeiterDetailPageProps) {
  const { userId } = await params;
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
    currentUserRole === 'admin' || currentUserRole === 'manager';

  if (!isAdminOrManager) {
    redirect('/dashboard');
  }

  const admin = createSupabaseAdminClient();
  const supabase = await createSupabaseServerClient();

  // Run ALL data fetches in parallel — entity data + supplementary lists
  const [memberResult, jobsResult, clientsResult, membersResult, allProjectsResult, allJobsResult] = await Promise.all([
    getMemberDetail(userId),
    getJobsForMember(userId),
    admin
      .from('clients')
      .select('*')
      .eq('organization_id', activeOrgId)
      .order('name', { ascending: true }),
    supabase.rpc('get_org_members', { p_org_id: activeOrgId }),
    admin
      .from('projects')
      .select('*')
      .eq('organization_id', activeOrgId)
      .order('created_at', { ascending: false }),
    admin
      .from('jobs')
      .select('id, project_id, status')
      .eq('organization_id', activeOrgId),
  ]);

  if (!memberResult.success) notFound();

  const { member } = memberResult;

  const jobsData = jobsResult.success
    ? {
        jobs: jobsResult.jobs,
        projects: jobsResult.projects,
        clientMap: jobsResult.clientMap,
        jobAssignmentMap: jobsResult.jobAssignmentMap,
      }
    : { jobs: [], projects: [], clientMap: {}, jobAssignmentMap: {} };

  const clients: Client[] = (clientsResult.data ?? []).map(toClient);
  const members: OrgMemberOption[] = (membersResult.data ?? []).map(
    (m: { user_id: string; first_name: string; last_name: string; role: string }) => ({
      userId: m.user_id,
      firstName: m.first_name,
      lastName: m.last_name,
      role: m.role,
    })
  );

  const clientLookup = new Map(clients.map((c) => [c.id, c]));
  const projectJobCounts = new Map<string, { total: number; completed: number; inProgress: number }>();
  for (const j of allJobsResult.data ?? []) {
    if (!j.project_id) continue;
    const counts = projectJobCounts.get(j.project_id) ?? { total: 0, completed: 0, inProgress: 0 };
    counts.total++;
    if (j.status === 'fertig') counts.completed++;
    if (j.status === 'in_bearbeitung') counts.inProgress++;
    projectJobCounts.set(j.project_id, counts);
  }

  const allProjects: ProjectWithDetails[] = (allProjectsResult.data ?? []).map((row) => {
    const project = toProject(row);
    const counts = projectJobCounts.get(project.id) ?? { total: 0, completed: 0, inProgress: 0 };
    return {
      ...project,
      client: project.clientId ? clientLookup.get(project.clientId) ?? null : null,
      jobCount: counts.total,
      completedJobCount: counts.completed,
      inProgressJobCount: counts.inProgress,
    };
  });

  return (
    <MitarbeiterDetailContent
      member={member}
      jobs={jobsData.jobs}
      projects={jobsData.projects}
      clientMap={jobsData.clientMap}
      jobAssignmentMap={jobsData.jobAssignmentMap}
      clients={clients}
      members={members}
      allProjects={allProjects}
      organizationId={activeOrgId}
      currentUserId={user.id}
      currentUserRole={currentUserRole!}
      isAdminOrManager={isAdminOrManager}
    />
  );
}
