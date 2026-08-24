create or replace function app_private.validate_work_artifact_detail()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_revision public.work_artifact_revisions%rowtype;
  v_required_kind public.work_artifact_kind;
  v_responsible_employee_record_id uuid;
begin
  select * into v_revision from public.work_artifact_revisions revision
  where revision.id = new.revision_id and revision.organization_id = new.organization_id;
  if not found then raise exception 'work_artifact_detail_revision_mismatch'; end if;
  v_required_kind := case tg_table_name
    when 'work_artifact_measurement_lines' then 'measurement'::public.work_artifact_kind
    when 'work_artifact_defect_details' then 'defect'::public.work_artifact_kind
    when 'work_artifact_change_details' then 'change_work'::public.work_artifact_kind
    else null
  end;
  if v_required_kind is null or v_revision.kind is distinct from v_required_kind
  then raise exception 'work_artifact_detail_kind_mismatch'; end if;

  if tg_table_name = 'work_artifact_defect_details' then
    v_responsible_employee_record_id := nullif(
      to_jsonb(new)->>'responsible_employee_record_id', ''
    )::uuid;
    if v_responsible_employee_record_id is not null and not exists (
      select 1 from public.employee_records employee
      where employee.id = v_responsible_employee_record_id
        and employee.organization_id = new.organization_id
    ) then raise exception 'work_artifact_defect_responsible_org_mismatch'; end if;
  end if;
  return new;
end;
$$;
