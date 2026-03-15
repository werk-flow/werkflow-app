import { Suspense } from 'react';
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
import { ActionBanner } from '@/components/shared/action-banner';
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

  const [activeOrgId, memberships] = await Promise.all([
    resolveActiveOrgId(cookieStore, user.id),
    getCachedMemberships(user.id)
  ]);

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
    memberList = (membersResult.data ?? []).map((m: { user_id: string; first_name: string; last_name: string; role: string }) => ({
      userId: m.user_id,
      firstName: m.first_name,
      lastName: m.last_name,
      role: m.role,
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

    const projectJobCounts = new Map<string, { total: number; completed: number; inProgress: number }>();
    for (const job of jobList) {
      if (!job.projectId) continue;
      const counts = projectJobCounts.get(job.projectId) ?? { total: 0, completed: 0, inProgress: 0 };
      counts.total++;
      if (job.status === 'fertig') counts.completed++;
      if (job.status === 'in_bearbeitung') counts.inProgress++;
      projectJobCounts.set(job.projectId, counts);
    }

    projectList = (projectsResult.data ?? []).map((row) => {
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
  } else {
    // Employee path: fetch assignments first, then everything else in parallel batches
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
      // Batch 1: jobs + all assignments + org clients (all independent)
      const [jobsResult2, allAssignResult, clientsResult] = await Promise.all([
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
        admin
          .from('clients')
          .select('*')
          .eq('organization_id', activeOrgId)
          .order('name', { ascending: true }),
      ]);

      if (jobsResult2.error) {
        console.error('Error fetching jobs:', jobsResult2.error);
      } else {
        jobList = (jobsResult2.data ?? []).map(toJob);
      }

      clientList = (clientsResult.data ?? []).map(toClient);

      jobAssignmentMap = {};
      for (const a of allAssignResult.data ?? []) {
        if (!jobAssignmentMap[a.job_id]) jobAssignmentMap[a.job_id] = [];
        jobAssignmentMap[a.job_id].push(a.user_id);
      }
    }

    // Batch 2: projects + project jobs (depends on job IDs from batch 1)
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

      const projectJobCounts = new Map<string, { total: number; completed: number; inProgress: number }>();
      for (const job of projectJobsResult.data ?? []) {
        if (!job.project_id) continue;
        const counts = projectJobCounts.get(job.project_id) ?? { total: 0, completed: 0, inProgress: 0 };
        counts.total++;
        if (job.status === 'fertig') counts.completed++;
        if (job.status === 'in_bearbeitung') counts.inProgress++;
        projectJobCounts.set(job.project_id, counts);
      }

      const clientLookup = new Map(clientList.map((c) => [c.id, c]));

      projectList = (projectsResult.data ?? []).map((row) => {
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
    }
  }

  const clientMap: Record<string, string> = {};
  for (const c of clientList) {
    clientMap[c.id] = c.name;
  }

  return (
    <>
      <Suspense fallback={null}>
        <ActionBanner
          paramKey="deleted_job"
          messageTemplate='Auftrag „{name}" wurde erfolgreich gelöscht.'
        />
      </Suspense>
      <Suspense fallback={null}>
        <ActionBanner
          paramKey="deleted_project"
          messageTemplate='Projekt „{name}" wurde erfolgreich gelöscht.'
        />
      </Suspense>
      <AuftraegeContent
        jobs={jobList}
        projects={projectList}
        clientMap={clientMap}
        clients={clientList}
        members={memberList}
        jobAssignmentMap={jobAssignmentMap}
        isAdminOrManager={isAdminOrManager}
      />
    </>
  );
}
