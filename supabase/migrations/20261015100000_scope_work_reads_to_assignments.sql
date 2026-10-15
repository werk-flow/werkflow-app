-- Employees see work through their assignments (docs/features/jobs-and-projects.md,
-- "Assignment and qualifications"): the server readers already refuse an
-- employee an unassigned job, and these policies give the Data API and
-- Realtime delivery the same boundary. Admin and Büro read every job, project
-- and assignment of their organization; an employee reads the jobs they are
-- assigned to, the assignments of those jobs (the team of their own work) and
-- the projects that contain one of them.
--
-- The helpers run as definer so that the jobs and job_assignments policies
-- do not evaluate each other recursively. Both stay inside the organizations
-- in which the user currently has effective access (get_user_org_ids).

create or replace function app_private.get_user_assigned_job_ids(p_user_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select assignment.job_id
  from public.job_assignments assignment
  where assignment.user_id = p_user_id
    and assignment.organization_id in (select app_private.get_user_org_ids(p_user_id));
$$;

create or replace function app_private.get_user_assigned_project_ids(p_user_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct job.project_id
  from public.job_assignments assignment
  join public.jobs job
    on job.id = assignment.job_id
   and job.organization_id = assignment.organization_id
  where assignment.user_id = p_user_id
    and job.project_id is not null
    and assignment.organization_id in (select app_private.get_user_org_ids(p_user_id));
$$;

revoke all on function app_private.get_user_assigned_job_ids(uuid) from public, anon, authenticated, service_role;
revoke all on function app_private.get_user_assigned_project_ids(uuid) from public, anon, authenticated, service_role;
grant execute on function app_private.get_user_assigned_job_ids(uuid) to authenticated, service_role;
grant execute on function app_private.get_user_assigned_project_ids(uuid) to authenticated, service_role;

alter policy "Users can view jobs in their orgs"
  on public.jobs
  using (
    organization_id in (select app_private.get_user_admin_or_manager_org_ids((select auth.uid())))
    or id in (select app_private.get_user_assigned_job_ids((select auth.uid())))
  );

alter policy "Users can view job assignments in their orgs"
  on public.job_assignments
  using (
    organization_id in (select app_private.get_user_admin_or_manager_org_ids((select auth.uid())))
    or job_id in (select app_private.get_user_assigned_job_ids((select auth.uid())))
  );

alter policy "Users can view projects in their orgs"
  on public.projects
  using (
    organization_id in (select app_private.get_user_admin_or_manager_org_ids((select auth.uid())))
    or id in (select app_private.get_user_assigned_project_ids((select auth.uid())))
  );

-- The names say who reads; no code refers to a policy name.
alter policy "Users can view jobs in their orgs" on public.jobs
  rename to "Managers and assignees can view jobs";
alter policy "Users can view job assignments in their orgs" on public.job_assignments
  rename to "Managers and assignees can view job assignments";
alter policy "Users can view projects in their orgs" on public.projects
  rename to "Managers and assignees can view projects";
