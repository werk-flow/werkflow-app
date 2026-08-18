create index if not exists idx_entry_change_requests_paired_entry_id on public.entry_change_requests (paired_entry_id) where paired_entry_id is not null;
create index if not exists idx_job_assignments_assigned_by on public.job_assignments (assigned_by);
create index if not exists idx_jobs_created_by on public.jobs (created_by);
create index if not exists idx_projects_created_by on public.projects (created_by);
create index if not exists idx_time_entries_reviewed_by on public.time_entries (reviewed_by) where reviewed_by is not null;

alter policy "Users can view own profile" on public.profiles
  using ((select auth.uid()) = id);

alter policy "Users can update own profile" on public.profiles
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

alter policy "Users can view own subscription" on public.subscriptions
  using (user_id = (select auth.uid()));

alter policy "Users can view members of their orgs" on public.organization_members
  using (organization_id in (select public.get_user_org_ids((select auth.uid()))));

alter policy "Members can view their organizations" on public.organizations
  using (id in (select public.get_user_org_ids((select auth.uid()))));

alter policy "Users can view clients in their orgs" on public.clients
  using (organization_id in (select public.get_user_org_ids((select auth.uid()))));

alter policy "Users can view projects in their orgs" on public.projects
  using (organization_id in (select public.get_user_org_ids((select auth.uid()))));

alter policy "Users can view jobs in their orgs" on public.jobs
  using (organization_id in (select public.get_user_org_ids((select auth.uid()))));

alter policy "Users can view job assignments in their orgs" on public.job_assignments
  using (
    job_id in (
      select jobs.id
      from public.jobs
      where jobs.organization_id in (select public.get_user_org_ids((select auth.uid())))
    )
  );

alter policy "Admins and managers can view org invites" on public.organization_invites
  using (organization_id in (select public.get_user_admin_or_manager_org_ids((select auth.uid()))));

alter policy "Admins and managers can view change requests" on public.entry_change_requests
  using (
    exists (
      select 1
      from public.organization_members
      where organization_members.organization_id = entry_change_requests.organization_id
        and organization_members.user_id = (select auth.uid())
        and organization_members.role = any (array['admin'::public.org_role, 'buero'::public.org_role])
    )
  );

alter policy "Users can view permitted time entries" on public.time_entries
  using (
    organization_id in (select public.get_user_org_ids((select auth.uid())))
    and (
      user_id = (select auth.uid())
      or exists (
        select 1
        from public.organization_members om
        where om.organization_id = time_entries.organization_id
          and om.user_id = (select auth.uid())
          and om.role = 'admin'::public.org_role
      )
      or exists (
        select 1
        from public.organization_members om_caller
        where om_caller.organization_id = time_entries.organization_id
          and om_caller.user_id = (select auth.uid())
          and om_caller.role = 'buero'::public.org_role
      )
    )
  );

alter function public.guard_automatic_time_entry_timestamps() set search_path = public;
alter function public.generate_project_number(uuid) set search_path = public;
alter function public.update_updated_at_column() set search_path = public;
alter function public.get_org_clients(uuid) set search_path = public;
alter function public.generate_job_number(uuid) set search_path = public;