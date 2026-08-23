update public.job_instruction_items
set requirement_state = 'required'
where requirement_state is null;
alter table public.job_instruction_items
  alter column requirement_state set default 'required',
  alter column requirement_state set not null;

create or replace function public.update_instruction_item_details(
  p_organization_id uuid,
  p_instruction_item_id uuid,
  p_actor_id uuid,
  p_item_kind text,
  p_requirement_state text,
  p_group_label text default null,
  p_notes text default null,
  p_evidence jsonb default '[]'::jsonb,
  p_predecessor_item_ids uuid[] default '{}'::uuid[]
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_job_id uuid;
  target_project_id uuid;
begin
  perform app_private.assert_work_template_manager(p_organization_id, p_actor_id);
  if p_item_kind not in ('task', 'checklist')
    or p_requirement_state not in ('required', 'optional')
    or length(coalesce(p_group_label, '')) > 120
    or length(coalesce(p_notes, '')) > 2000
    or jsonb_typeof(coalesce(p_evidence, '[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(p_evidence, '[]'::jsonb)) > 100 then
    raise exception 'instruction_item_details_invalid';
  end if;
  select item.job_id, item.project_id into target_job_id, target_project_id
  from public.job_instruction_items item
  where item.id = p_instruction_item_id and item.organization_id = p_organization_id
  for update;
  if not found then raise exception 'item_not_found'; end if;
  if p_instruction_item_id = any(coalesce(p_predecessor_item_ids, '{}'::uuid[])) then
    raise exception 'instruction_dependency_self';
  end if;
  if exists (
    select 1 from unnest(coalesce(p_predecessor_item_ids, '{}'::uuid[])) predecessor_id
    left join public.job_instruction_items predecessor on predecessor.id = predecessor_id
    where predecessor.id is null
       or predecessor.organization_id <> p_organization_id
       or predecessor.job_id is distinct from target_job_id
       or predecessor.project_id is distinct from target_project_id
  ) then raise exception 'instruction_dependency_target_invalid'; end if;

  update public.job_instruction_items
  set item_kind = p_item_kind,
      requirement_state = p_requirement_state,
      group_label = nullif(btrim(coalesce(p_group_label, '')), ''),
      notes = nullif(btrim(coalesce(p_notes, '')), ''),
      updated_at = now()
  where id = p_instruction_item_id;

  delete from public.job_instruction_item_evidence_requirements
  where instruction_item_id = p_instruction_item_id;
  insert into public.job_instruction_item_evidence_requirements (
    id, organization_id, instruction_item_id, description,
    document_category, sort_order, created_by, updated_by
  )
  select evidence.id, p_organization_id, p_instruction_item_id,
    btrim(evidence.description), evidence.document_category,
    evidence.sort_order, p_actor_id, p_actor_id
  from jsonb_to_recordset(coalesce(p_evidence, '[]'::jsonb)) as evidence(
    id uuid, description text, document_category text, sort_order integer
  );

  delete from public.job_instruction_item_dependencies
  where dependent_item_id = p_instruction_item_id;
  insert into public.job_instruction_item_dependencies (
    organization_id, predecessor_item_id, dependent_item_id, created_by
  )
  select p_organization_id, predecessor_id, p_instruction_item_id, p_actor_id
  from unnest(coalesce(p_predecessor_item_ids, '{}'::uuid[])) predecessor_id;

  if exists (
    with recursive walk(start_id, current_id, path, cycle) as (
      select dependency.predecessor_item_id, dependency.dependent_item_id,
        array[dependency.predecessor_item_id, dependency.dependent_item_id],
        dependency.dependent_item_id = dependency.predecessor_item_id
      from public.job_instruction_item_dependencies dependency
      join public.job_instruction_items dependent on dependent.id = dependency.dependent_item_id
      where dependent.organization_id = p_organization_id
        and dependent.job_id is not distinct from target_job_id
        and dependent.project_id is not distinct from target_project_id
      union all
      select walk.start_id, dependency.dependent_item_id,
        walk.path || dependency.dependent_item_id,
        dependency.dependent_item_id = any(walk.path)
      from walk
      join public.job_instruction_item_dependencies dependency
        on dependency.predecessor_item_id = walk.current_id
      where not walk.cycle
    )
    select 1 from walk where cycle
  ) then raise exception 'instruction_dependency_cycle'; end if;
end;
$$;
