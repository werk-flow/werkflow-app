-- Deleting an organization names what it removes and refuses while the
-- organization holds recorded working time or a closed period (owner decision
-- on werk-flow/werkflow-planning#85). Recorded time, closed periods and the
-- payroll exports built from them fall under retention duties, so one name
-- check must not erase them.
--
-- Division of work: the server action deleteOrganization
-- (lib/org/delete-action.ts) establishes identity and the active organization,
-- checks the owner and the confirmation name, reads the scope below, deletes
-- the stored files and then calls delete_organization. The function locks the
-- organization row, repeats the owner, name and retention checks under that
-- lock, and deletes the row; the foreign-key cascade removes every other row of
-- the organization in the same statement. A new time or period row references
-- the organization, so its insert waits on the lock and fails once the row is
-- gone, and a row that committed before the lock fails the retention check.
--
-- Recorded time means any time entry or time session of the organization, the
-- rule member removal uses (20261004130000). A closed period is any period
-- with a close version, also after a reopen: the closed version and its
-- payroll exports stay. Service-role deletes outside this function (the demo
-- seeder reset, test cleanup) keep the full cascade of 20260823112741.

-- One object of counts, not a set: PostgREST caps a set-returning function
-- without an error, and the server parses this object at its boundary
-- (lib/org/deletion-scope.ts).
create function public.get_organization_deletion_scope(p_organization_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path to ''
as $$
  select jsonb_build_object(
    'members', (select count(*) from public.organization_members m where m.organization_id = p_organization_id),
    'open_invites', (select count(*) from public.organization_invites i
      where i.organization_id = p_organization_id and i.status = 'pending'),
    'clients', (select count(*) from public.clients c where c.organization_id = p_organization_id),
    'projects', (select count(*) from public.projects p where p.organization_id = p_organization_id),
    'jobs', (select count(*) from public.jobs j where j.organization_id = p_organization_id),
    'employee_records', (select count(*) from public.employee_records r where r.organization_id = p_organization_id),
    'documents', (select count(*) from public.documents d where d.organization_id = p_organization_id),
    'time_tracked_people', (select count(*) from (
      select e.user_id from public.time_entries e where e.organization_id = p_organization_id
      union
      select s.user_id from public.time_sessions s where s.organization_id = p_organization_id
    ) people),
    'closed_periods', (select count(distinct v.period_id) from public.time_period_close_versions v
      where v.organization_id = p_organization_id),
    'payroll_exports', (select count(*) from public.payroll_exports x where x.organization_id = p_organization_id)
  );
$$;

create function public.delete_organization(
  p_organization_id uuid,
  p_actor_id uuid,
  p_confirmation_name text
)
returns void
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_organization public.organizations%rowtype;
begin
  select * into v_organization
  from public.organizations organization
  where organization.id = p_organization_id
  for update;
  if not found then raise exception 'org_not_found'; end if;

  if p_actor_id is null or v_organization.admin_id <> p_actor_id then
    raise exception 'not_authorized';
  end if;
  if p_confirmation_name is null or btrim(p_confirmation_name) <> v_organization.name then
    raise exception 'name_mismatch';
  end if;

  if exists (select 1 from public.time_entries e where e.organization_id = p_organization_id)
    or exists (select 1 from public.time_sessions s where s.organization_id = p_organization_id)
    or exists (
      select 1 from public.time_period_close_versions v where v.organization_id = p_organization_id
    )
  then raise exception 'has_time_records'; end if;

  delete from public.organizations organization where organization.id = p_organization_id;
end;
$$;

revoke all on function public.get_organization_deletion_scope(uuid)
from public, anon, authenticated, service_role;
revoke all on function public.delete_organization(uuid, uuid, text)
from public, anon, authenticated, service_role;
grant execute on function public.get_organization_deletion_scope(uuid) to service_role;
grant execute on function public.delete_organization(uuid, uuid, text) to service_role;
