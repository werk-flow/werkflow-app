-- Stage B (platform hardening): give job_assignments the organization scope
-- it always implicitly had through its parent job, so the Realtime provider
-- can filter its events server-side instead of broadcasting every
-- organization's assignment changes to every client
-- (docs/plans/platform-hardening.md, enforcement-ladder Tier 1 row).
--
-- A trigger derives the value from the parent job on every write, so no
-- code path (including the planning RPCs that insert assignments) can write
-- a mismatched or missing organization.

alter table public.job_assignments
  add column organization_id uuid
  references public.organizations(id) on delete cascade;

update public.job_assignments ja
set organization_id = j.organization_id
from public.jobs j
where j.id = ja.job_id;

alter table public.job_assignments
  alter column organization_id set not null;

create or replace function public.set_job_assignment_organization()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select organization_id into new.organization_id
  from public.jobs
  where id = new.job_id;

  if new.organization_id is null then
    raise exception 'job_assignments.job_id % has no parent job', new.job_id;
  end if;

  return new;
end;
$$;

create trigger set_job_assignment_organization
before insert or update of job_id, organization_id on public.job_assignments
for each row
execute function public.set_job_assignment_organization();

-- Replica identity via a minimal unique index: DELETE events stay
-- org-filterable server-side while their payload carries only the two ids
-- (postgres_changes applies no RLS to DELETE events — replica identity FULL
-- would hand the complete old row to any crafted subscription; see
-- docs/technical/realtime-and-caching.md, transport posture).
create unique index job_assignments_replident_idx
  on public.job_assignments (id, organization_id);

alter table public.job_assignments
  replica identity using index job_assignments_replident_idx;
