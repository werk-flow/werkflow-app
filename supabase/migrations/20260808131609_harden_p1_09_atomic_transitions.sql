
create unique index if not exists employee_capabilities_supersedes_once
  on public.employee_capabilities (supersedes_id)
  where supersedes_id is not null;

alter table public.employee_capabilities
  add constraint employee_capabilities_certification_no_overlap
  exclude using gist (
    employee_record_id with =,
    capability_id with =,
    daterange(valid_from, coalesce(valid_until, 'infinity'::date), '[]') with &&
  )
  where (capability_kind = 'certification' and superseded_at is null);

create or replace function public.renew_employee_capability(
  p_organization_id uuid,
  p_employee_record_id uuid,
  p_capability_id uuid,
  p_valid_from date,
  p_valid_until date,
  p_issuer text,
  p_renewal_due_date date,
  p_confirmation_status text,
  p_evidence_state text,
  p_operational_note text,
  p_supersedes_id uuid,
  p_actor_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  previous_record public.employee_capabilities%rowtype;
  new_record_id uuid;
  transition_time timestamptz := now();
begin
  select *
  into previous_record
  from public.employee_capabilities
  where id = p_supersedes_id
    and organization_id = p_organization_id
    and employee_record_id = p_employee_record_id
    and capability_id = p_capability_id
    and capability_kind = 'certification'
    and superseded_at is null
  for update;

  if previous_record.id is null then
    raise exception 'superseded certification not found or already renewed';
  end if;

  update public.employee_capabilities
  set superseded_at = transition_time,
      updated_by = p_actor_id
  where id = previous_record.id;

  insert into public.employee_capabilities (
    organization_id,
    employee_record_id,
    capability_id,
    capability_kind,
    valid_from,
    valid_until,
    issuer,
    renewal_due_date,
    confirmation_status,
    confirmed_by,
    confirmed_at,
    evidence_state,
    operational_note,
    supersedes_id,
    created_by,
    updated_by
  )
  values (
    p_organization_id,
    p_employee_record_id,
    p_capability_id,
    'certification',
    p_valid_from,
    p_valid_until,
    p_issuer,
    p_renewal_due_date,
    p_confirmation_status,
    case when p_confirmation_status = 'confirmed' then p_actor_id else null end,
    case when p_confirmation_status = 'confirmed' then transition_time else null end,
    p_evidence_state,
    p_operational_note,
    p_supersedes_id,
    p_actor_id,
    p_actor_id
  )
  returning id into new_record_id;

  return new_record_id;
end;
$function$;

revoke all on function public.renew_employee_capability(
  uuid, uuid, uuid, date, date, text, date, text, text, text, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.renew_employee_capability(
  uuid, uuid, uuid, date, date, text, date, text, text, text, uuid, uuid
) to service_role;

create or replace function public.replace_job_assignments_with_assessment(
  p_organization_id uuid,
  p_job_id uuid,
  p_selected_user_ids uuid[],
  p_actor_id uuid,
  p_assessed_for_date date,
  p_selected_employee_record_ids uuid[],
  p_requirements_snapshot jsonb,
  p_coverage_snapshot jsonb,
  p_coverage_fingerprint text,
  p_override_reason text,
  p_team_source_id uuid,
  p_record_assessment boolean
)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  normalized_user_ids uuid[];
begin
  if not exists (
    select 1 from public.jobs
    where id = p_job_id and organization_id = p_organization_id
  ) then
    raise exception 'job organization mismatch';
  end if;

  select coalesce(array_agg(distinct selected_user_id order by selected_user_id), array[]::uuid[])
  into normalized_user_ids
  from unnest(coalesce(p_selected_user_ids, array[]::uuid[])) as selected_user_id;

  if (
    select count(*)
    from public.organization_members
    where organization_id = p_organization_id
      and user_id = any(normalized_user_ids)
  ) <> cardinality(normalized_user_ids) then
    raise exception 'assignment user is not an organization member';
  end if;

  if p_team_source_id is not null and not exists (
    select 1 from public.teams
    where id = p_team_source_id and organization_id = p_organization_id
  ) then
    raise exception 'team source organization mismatch';
  end if;

  delete from public.job_assignments
  where job_id = p_job_id
    and not (user_id = any(normalized_user_ids));

  insert into public.job_assignments (job_id, user_id, assigned_by)
  select p_job_id, selected_user_id, p_actor_id
  from unnest(normalized_user_ids) as selected_user_id
  on conflict (job_id, user_id) do nothing;

  if p_record_assessment then
    insert into public.job_qualification_assessments (
      organization_id,
      job_id,
      assessed_for_date,
      selected_user_ids,
      selected_employee_record_ids,
      requirements_snapshot,
      coverage_snapshot,
      coverage_fingerprint,
      override_reason,
      team_source_id,
      created_by
    )
    values (
      p_organization_id,
      p_job_id,
      p_assessed_for_date,
      normalized_user_ids,
      coalesce(p_selected_employee_record_ids, array[]::uuid[]),
      p_requirements_snapshot,
      p_coverage_snapshot,
      p_coverage_fingerprint,
      p_override_reason,
      p_team_source_id,
      p_actor_id
    );
  end if;
end;
$function$;

revoke all on function public.replace_job_assignments_with_assessment(
  uuid, uuid, uuid[], uuid, date, uuid[], jsonb, jsonb, text, text, uuid, boolean
) from public, anon, authenticated;
grant execute on function public.replace_job_assignments_with_assessment(
  uuid, uuid, uuid[], uuid, date, uuid[], jsonb, jsonb, text, text, uuid, boolean
) to service_role;

create or replace function public.replace_job_capability_requirements(
  p_organization_id uuid,
  p_job_id uuid,
  p_capability_ids uuid[],
  p_require_confirmations boolean[],
  p_actor_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  normalized_capability_ids uuid[];
begin
  if cardinality(coalesce(p_capability_ids, array[]::uuid[])) <>
     cardinality(coalesce(p_require_confirmations, array[]::boolean[])) then
    raise exception 'requirement array length mismatch';
  end if;

  if not exists (
    select 1 from public.jobs
    where id = p_job_id and organization_id = p_organization_id
  ) then
    raise exception 'job organization mismatch';
  end if;

  select coalesce(array_agg(distinct capability_id order by capability_id), array[]::uuid[])
  into normalized_capability_ids
  from unnest(coalesce(p_capability_ids, array[]::uuid[])) as capability_id;

  if cardinality(normalized_capability_ids) <>
     cardinality(coalesce(p_capability_ids, array[]::uuid[])) then
    raise exception 'duplicate capability requirement';
  end if;

  if (
    select count(*)
    from public.organization_capabilities
    where organization_id = p_organization_id
      and retired_at is null
      and id = any(normalized_capability_ids)
  ) <> cardinality(normalized_capability_ids) then
    raise exception 'capability organization mismatch or retired';
  end if;

  delete from public.job_capability_requirements
  where organization_id = p_organization_id
    and job_id = p_job_id
    and not (capability_id = any(normalized_capability_ids));

  insert into public.job_capability_requirements (
    organization_id,
    job_id,
    capability_id,
    require_confirmation,
    created_by,
    updated_by
  )
  select
    p_organization_id,
    p_job_id,
    p_capability_ids[index_value],
    p_require_confirmations[index_value],
    p_actor_id,
    p_actor_id
  from generate_subscripts(coalesce(p_capability_ids, array[]::uuid[]), 1) as index_value
  on conflict (job_id, capability_id)
  do update set
    require_confirmation = excluded.require_confirmation,
    updated_by = excluded.updated_by;
end;
$function$;

revoke all on function public.replace_job_capability_requirements(
  uuid, uuid, uuid[], boolean[], uuid
) from public, anon, authenticated;
grant execute on function public.replace_job_capability_requirements(
  uuid, uuid, uuid[], boolean[], uuid
) to service_role;
