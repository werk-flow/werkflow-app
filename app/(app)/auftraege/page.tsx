import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { resolveActiveOrgId } from '@/lib/org/cookies';
import { getCachedUser, getCachedMemberships } from '@/lib/data/cached';
import {
  toJob,
  toClient,
  toProject,
  type Client,
  type Job,
  type ProjectWithDetails,
} from '@/lib/jobs/types';
import { AuftraegeContent } from '@/components/auftraege/auftraege-content';
import type { OrgRole } from '@/lib/members/actions';
import type { OrgMemberOption } from '@/components/auftraege/employee-multi-select';

export default async function AuftraegePage() {
  const [{ data: { user } }, cookieStore] = await Promise.all([
    getCachedUser(),
    cookies()
  ]);

  if (!user) {
    redirect('/login');
  }

  const activeOrgId = await resolveActiveOrgId(cookieStore, user.id);

  if (!activeOrgId) {
    return (
      <div className="flex h-full flex-col p-6">
        <h1 className="text-2xl font-bold">Aufträge</h1>
        <p className="mt-4 text-muted-foreground">
          Bitte wähle zuerst eine Organisation aus.
        </p>
      </div>
    );
  }

  const memberships = await getCachedMemberships(user.id);
  const currentMembership = memberships.find((m) => m.orgId === activeOrgId);
  const currentUserRole = currentMembership?.role as OrgRole | undefined;
  const isAdminOrManager =
    currentUserRole === 'admin' || currentUserRole === 'manager';

  const admin = createSupabaseAdminClient();
  const supabase = await createSupabaseServerClient();

  let jobList: Job[] = [];
  let clientList: Client[] = [];
  let memberList: OrgMemberOption[] = [];
  let projectList: ProjectWithDetails[] = [];
  let jobAssignmentMap: Record<string, string[]> = {};

  if (isAdminOrManager) {
    const [jobsResult, projectsResult, clientsResult, membersResult] = await Promise.all([
      admin
        .from('jobs')
        .select('*')
        .eq('organization_id', activeOrgId)
        .order('planned_date', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false }),
      admin
        .from('projects')
        .select('*')
        .eq('organization_id', activeOrgId)
        .order('created_at', { ascending: false }),
      admin
        .from('clients')
        .select('*')
        .eq('organization_id', activeOrgId)
        .order('name', { ascending: true }),
      supabase.rpc('get_org_members', { p_org_id: activeOrgId }),
    ]);

    if (jobsResult.error) {
      console.error('Error fetching jobs:', jobsResult.error);
      return (
        <div className="flex h-full flex-col p-6">
          <h1 className="text-2xl font-bold">Aufträge</h1>
          <p className="mt-4 text-destructive">
            Fehler beim Laden der Aufträge:{' '}
            {jobsResult.error.message || 'Unbekannter Fehler'}
          </p>
        </div>
      );
    }

    if (membersResult.error) {
      console.error('Error fetching members:', membersResult.error);
    }

    jobList = (jobsResult.data ?? []).map(toJob);
    clientList = (clientsResult.data ?? []).map(toClient);
    memberList = (membersResult.data ?? []).map((m: { user_id: string; first_name: string; last_name: string }) => ({
      userId: m.user_id,
      firstName: m.first_name,
      lastName: m.last_name,
    }));

    const jobIds = jobList.map((j) => j.id);
    if (jobIds.length > 0) {
      const { data: assignData } = await admin
        .from('job_assignments')
        .select('job_id, user_id')
        .in('job_id', jobIds);
      for (const a of assignData ?? []) {
        if (!jobAssignmentMap[a.job_id]) jobAssignmentMap[a.job_id] = [];
        jobAssignmentMap[a.job_id].push(a.user_id);
      }
    }

    const clientLookup = new Map(clientList.map((c) => [c.id, c]));

    const projectJobCounts = new Map<string, { total: number; completed: number }>();
    for (const job of jobList) {
      if (!job.projectId) continue;
      const counts = projectJobCounts.get(job.projectId) ?? { total: 0, completed: 0 };
      counts.total++;
      if (job.status === 'fertig') counts.completed++;
      projectJobCounts.set(job.projectId, counts);
    }

    projectList = (projectsResult.data ?? []).map((row) => {
      const project = toProject(row);
      const counts = projectJobCounts.get(project.id) ?? { total: 0, completed: 0 };
      return {
        ...project,
        client: project.clientId ? clientLookup.get(project.clientId) ?? null : null,
        jobCount: counts.total,
        completedJobCount: counts.completed,
      };
    });
  } else {
    const { data: assignments, error: assignError } = await admin
      .from('job_assignments')
      .select('job_id, user_id')
      .eq('user_id', user.id);

    if (assignError) {
      console.error('Error fetching assignments:', assignError);
    }

    const assignedJobIds = (assignments ?? []).map((a) => a.job_id);

    for (const a of assignments ?? []) {
      if (!jobAssignmentMap[a.job_id]) jobAssignmentMap[a.job_id] = [];
      jobAssignmentMap[a.job_id].push(a.user_id);
    }

    if (assignedJobIds.length > 0) {
      const [jobsResult2, allAssignResult] = await Promise.all([
        admin
          .from('jobs')
          .select('*')
          .eq('organization_id', activeOrgId)
          .in('id', assignedJobIds)
          .order('planned_date', { ascending: true, nullsFirst: false })
          .order('created_at', { ascending: false }),
        admin
          .from('job_assignments')
          .select('job_id, user_id')
          .in('job_id', assignedJobIds),
      ]);

      if (jobsResult2.error) {
        console.error('Error fetching jobs:', jobsResult2.error);
      } else {
        jobList = (jobsResult2.data ?? []).map(toJob);
      }

      jobAssignmentMap = {};
      for (const a of allAssignResult.data ?? []) {
        if (!jobAssignmentMap[a.job_id]) jobAssignmentMap[a.job_id] = [];
        jobAssignmentMap[a.job_id].push(a.user_id);
      }
    }

    const assignedProjectIds = [
      ...new Set(
        jobList
          .filter((j) => j.projectId)
          .map((j) => j.projectId!)
      ),
    ];

    if (assignedProjectIds.length > 0) {
      const [projectsResult, projectJobsResult] = await Promise.all([
        admin
          .from('projects')
          .select('*')
          .in('id', assignedProjectIds)
          .order('created_at', { ascending: false }),
        admin
          .from('jobs')
          .select('id, project_id, status')
          .in('project_id', assignedProjectIds)
          .eq('organization_id', activeOrgId),
      ]);

      const projectJobCounts = new Map<string, { total: number; completed: number }>();
      for (const job of projectJobsResult.data ?? []) {
        if (!job.project_id) continue;
        const counts = projectJobCounts.get(job.project_id) ?? { total: 0, completed: 0 };
        counts.total++;
        if (job.status === 'fertig') counts.completed++;
        projectJobCounts.set(job.project_id, counts);
      }

      const projectClientIds = [
        ...new Set(
          (projectsResult.data ?? [])
            .map((p) => p.client_id)
            .filter((id): id is string => id !== null)
        ),
      ];

      const allNeededClientIds = [
        ...new Set([
          ...jobList.filter((j) => j.clientId).map((j) => j.clientId!),
          ...projectClientIds,
        ]),
      ];

      if (allNeededClientIds.length > 0) {
        const { data: clientsData } = await admin
          .from('clients')
          .select('*')
          .in('id', allNeededClientIds);
        clientList = (clientsData ?? []).map(toClient);
      }

      const clientLookup = new Map(clientList.map((c) => [c.id, c]));

      projectList = (projectsResult.data ?? []).map((row) => {
        const project = toProject(row);
        const counts = projectJobCounts.get(project.id) ?? { total: 0, completed: 0 };
        return {
          ...project,
          client: project.clientId ? clientLookup.get(project.clientId) ?? null : null,
          jobCount: counts.total,
          completedJobCount: counts.completed,
        };
      });
    } else {
      const uniqueClientIds = [...new Set(jobList.filter((j) => j.clientId).map((j) => j.clientId!))];
      if (uniqueClientIds.length > 0) {
        const { data: clientsData } = await admin
          .from('clients')
          .select('*')
          .in('id', uniqueClientIds);
        clientList = (clientsData ?? []).map(toClient);
      }
    }
  }

  const clientMap: Record<string, string> = {};
  for (const c of clientList) {
    clientMap[c.id] = c.name;
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex items-center justify-between border-b bg-background px-4 py-3 sm:px-6 sm:py-4 sticky top-0 z-10 shrink-0">
        <h1 className="text-xl font-bold sm:text-2xl">Aufträge</h1>
      </header>

      <div className="flex-1 overflow-auto p-4 sm:p-6">
        <AuftraegeContent
          jobs={jobList}
          projects={projectList}
          clientMap={clientMap}
          clients={clientList}
          members={memberList}
          jobAssignmentMap={jobAssignmentMap}
          isAdminOrManager={isAdminOrManager}
        />
      </div>
    </div>
  );
}
