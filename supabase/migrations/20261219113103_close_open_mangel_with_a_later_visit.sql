-- Open Mängel of an Anlage stay in its history until a later completed visit
-- closes them (werk-flow/werkflow-planning#484).
--
-- * A finding (maintenance_visit_findings) is open until a resolution row
--   names it. A resolution is append-only and names the completed visit that
--   closed the finding, who completed it and when.
-- * public.complete_maintenance_visit closes, in the same call, every open
--   finding whose visit covered only Anlagen the completed visit covers, or
--   their Vorgänger, when that finding's visit was completed on or before
--   this visit's day. A finding that also names an Anlage this visit did not
--   cover stays open for it. The visit's own finding stays open, so an
--   unfinished visit's Mängel replace the earlier ones. A replay closes
--   nothing again. A missed visit completes nothing and closes nothing.
--   Completions on an Anlage or its Vorgänger run one after another, so each sees the
--   findings the other wrote.
-- * public.list_installed_equipment_lineage names an Anlage and its Vorgänger
--   for the reader and for that lock.
-- * public.list_open_maintenance_visit_findings is the one reader of what is
--   open: the office equipment detail and the technician's field history read
--   through it, and the completion closes what it lists as fully covered.
-- * The previous entry public.complete_maintenance_due_work stays as the
--   deployed build calls it and closes nothing.

-- A resolution names its finding with the organization.
-- @destructive: after release 55088f06f04b: that build never writes maintenance_visit_findings, and its primary key already makes each id unique
alter table public.maintenance_visit_findings
  add constraint maintenance_visit_findings_id_organization_key unique (id, organization_id);

create table public.maintenance_visit_finding_resolutions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  maintenance_visit_finding_id uuid not null,
  resolved_by_due_work_id uuid not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  -- A finding closes once.
  constraint maintenance_visit_finding_resolutions_finding_key
    unique (maintenance_visit_finding_id, organization_id),
  foreign key (maintenance_visit_finding_id, organization_id)
    references public.maintenance_visit_findings(id, organization_id) on delete no action,
  foreign key (resolved_by_due_work_id, organization_id)
    references public.maintenance_due_work(id, organization_id) on delete no action
);
create index maintenance_visit_finding_resolutions_organization_idx
  on public.maintenance_visit_finding_resolutions (organization_id);
create index maintenance_visit_finding_resolutions_resolved_by_idx
  on public.maintenance_visit_finding_resolutions (resolved_by_due_work_id, organization_id);
create index maintenance_visit_finding_resolutions_created_by_idx
  on public.maintenance_visit_finding_resolutions (created_by);

alter table public.maintenance_visit_finding_resolutions enable row level security;
revoke all on table public.maintenance_visit_finding_resolutions from public, anon, authenticated, service_role;
grant select, insert on table public.maintenance_visit_finding_resolutions to service_role;
create trigger maintenance_visit_finding_resolutions_immutable
before update or delete on public.maintenance_visit_finding_resolutions
for each row execute function app_private.prevent_maintenance_history_mutation();

-- The given Anlagen of the organization and all their Vorgänger: the scope
-- of the open findings reader and of the completion's lock.
create function public.list_installed_equipment_lineage(
  p_organization_id uuid,
  p_equipment_ids uuid[]
)
returns setof uuid
language sql stable security invoker set search_path = ''
as $$
  with recursive lineage as (
    select equipment.id as equipment_id, equipment.predecessor_equipment_id, 0 as depth
    from public.installed_equipment equipment
    where equipment.organization_id = p_organization_id
      and equipment.id = any(coalesce(p_equipment_ids, '{}'))
    union all
    select equipment.id, equipment.predecessor_equipment_id, lineage.depth + 1
    from public.installed_equipment equipment
    join lineage on equipment.id = lineage.predecessor_equipment_id
    where equipment.organization_id = p_organization_id
      and lineage.depth < 100
  )
  select distinct lineage.equipment_id from lineage;
$$;

-- The open findings of visits that covered one of the given Anlagen or one of
-- their Vorgänger, newest visit first. `fully_covered` is true when every
-- Anlage of the finding's visit is one of them.
create function public.list_open_maintenance_visit_findings(
  p_organization_id uuid,
  p_equipment_ids uuid[]
)
returns table (
  finding_id uuid,
  maintenance_due_work_id uuid,
  completed_on date,
  scope_outcome public.maintenance_scope_outcome,
  maintenance_plan_id uuid,
  plan_number text,
  job_id uuid,
  defects text[],
  next_action public.maintenance_next_action,
  owner_user_id uuid,
  target_date date,
  note text,
  recorded_at timestamptz,
  fully_covered boolean
)
language sql stable security invoker set search_path = ''
as $$
  with lineage as (
    select equipment_id
    from public.list_installed_equipment_lineage(p_organization_id, p_equipment_ids) as equipment_id
  )
  select finding.id, due_work.id, due_work.completed_on, due_work.scope_outcome,
    plan.id, plan.plan_number, due_work.job_id, finding.defects, finding.next_action,
    finding.owner_user_id, finding.target_date, finding.note, finding.created_at,
    not exists (
      select 1 from public.maintenance_plan_revision_equipment link
      where link.organization_id = p_organization_id
        and link.maintenance_plan_revision_id = due_work.maintenance_plan_revision_id
        and link.equipment_id not in (select lineage.equipment_id from lineage)
    )
  from public.maintenance_visit_findings finding
  join public.maintenance_due_work due_work
    on due_work.id = finding.maintenance_due_work_id
   and due_work.organization_id = finding.organization_id
  join public.maintenance_plans plan
    on plan.id = due_work.maintenance_plan_id
   and plan.organization_id = due_work.organization_id
  where finding.organization_id = p_organization_id
    and exists (
      select 1
      from public.maintenance_plan_revision_equipment link
      join lineage on lineage.equipment_id = link.equipment_id
      where link.organization_id = p_organization_id
        and link.maintenance_plan_revision_id = due_work.maintenance_plan_revision_id
    )
    and not exists (
      select 1 from public.maintenance_visit_finding_resolutions resolution
      where resolution.organization_id = p_organization_id
        and resolution.maintenance_visit_finding_id = finding.id
    )
  order by due_work.completed_on desc, finding.created_at desc, finding.id;
$$;

-- Closes the open findings the completed visit supersedes: those whose visit
-- covered only Anlagen it covers or their Vorgänger, completed on or before
-- its day, except its own. Runs under the entry's manager check and locks.
create function app_private.resolve_open_maintenance_visit_findings(
  p_organization_id uuid,
  p_maintenance_due_work_id uuid,
  p_actor_id uuid
)
returns void
language plpgsql security invoker set search_path = ''
as $$
declare
  v_due_work public.maintenance_due_work%rowtype;
  v_equipment_ids uuid[];
begin
  select * into strict v_due_work from public.maintenance_due_work due_work
  where due_work.id = p_maintenance_due_work_id and due_work.organization_id = p_organization_id;
  select coalesce(array_agg(link.equipment_id), '{}') into v_equipment_ids
  from public.maintenance_plan_revision_equipment link
  where link.organization_id = p_organization_id
    and link.maintenance_plan_revision_id = v_due_work.maintenance_plan_revision_id;
  insert into public.maintenance_visit_finding_resolutions (
    organization_id, maintenance_visit_finding_id, resolved_by_due_work_id, created_by
  )
  select p_organization_id, open_finding.finding_id, v_due_work.id, p_actor_id
  from public.list_open_maintenance_visit_findings(p_organization_id, v_equipment_ids) open_finding
  where open_finding.fully_covered
    and open_finding.maintenance_due_work_id <> v_due_work.id
    and open_finding.completed_on <= v_due_work.completed_on
  -- A concurrent completion that closed the finding first keeps its resolution.
  on conflict (maintenance_visit_finding_id, organization_id) do nothing;
end;
$$;

-- „Wartung abschließen“: as before, and the completion closes the earlier
-- open Mängel of its Anlagen.
create or replace function public.complete_maintenance_visit(
  p_organization_id uuid,
  p_maintenance_due_work_id uuid,
  p_expected_version bigint,
  p_scope_outcome public.maintenance_scope_outcome,
  p_completed_on date,
  p_work_artifact_revision_ids uuid[],
  p_reason text,
  p_defects text[],
  p_next_action public.maintenance_next_action,
  p_next_action_owner_id uuid,
  p_next_action_target_date date,
  p_next_action_note text,
  p_actor_id uuid,
  p_idempotency_key uuid
)
returns public.maintenance_due_work
language plpgsql security definer set search_path = ''
as $$
declare
  v_status_before public.maintenance_due_work.status%type;
  v_after public.maintenance_due_work%rowtype;
begin
  perform app_private.assert_maintenance_manager(p_organization_id, p_actor_id);
  perform app_private.lock_maintenance_operation(p_organization_id, 'due_complete', p_idempotency_key);
  select due_work.status into v_status_before from public.maintenance_due_work due_work
  where due_work.id = p_maintenance_due_work_id and due_work.organization_id = p_organization_id;
  -- Two completions on one Anlage or its Vorgänger would each miss the
  -- finding the other writes: lock the whole lineage the closing reads.
  perform 1 from public.installed_equipment equipment
  where equipment.organization_id = p_organization_id
    and equipment.id in (
      select lineage_id from public.list_installed_equipment_lineage(
        p_organization_id,
        array(
          select link.equipment_id
          from public.maintenance_due_work due_work
          join public.maintenance_plan_revision_equipment link
            on link.maintenance_plan_revision_id = due_work.maintenance_plan_revision_id
           and link.organization_id = due_work.organization_id
          where due_work.id = p_maintenance_due_work_id and due_work.organization_id = p_organization_id
        )
      ) as lineage_id
    )
  order by equipment.id
  for no key update;
  v_after := app_private.complete_maintenance_due_work_with_next_action(
    p_organization_id, p_maintenance_due_work_id, p_expected_version, p_scope_outcome,
    p_completed_on, p_work_artifact_revision_ids, p_reason, p_defects, p_next_action,
    p_next_action_owner_id, p_next_action_target_date, p_next_action_note, p_actor_id, p_idempotency_key,
    false
  );
  -- Only this call's completion closes Mängel; a replay returns the recorded one.
  if v_status_before = 'visit_created' then
    perform app_private.resolve_open_maintenance_visit_findings(
      p_organization_id, p_maintenance_due_work_id, p_actor_id
    );
  end if;
  return v_after;
end;
$$;

-- The closing step runs only inside the entry: no role executes it
-- (docs/technical/security.md, "Add a privileged function", condition a).
revoke all on function app_private.resolve_open_maintenance_visit_findings(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.list_installed_equipment_lineage(uuid, uuid[])
  from public, anon, authenticated;
grant execute on function public.list_installed_equipment_lineage(uuid, uuid[]) to service_role;
revoke all on function public.list_open_maintenance_visit_findings(uuid, uuid[])
  from public, anon, authenticated;
grant execute on function public.list_open_maintenance_visit_findings(uuid, uuid[]) to service_role;
