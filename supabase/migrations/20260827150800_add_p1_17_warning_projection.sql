-- Forward repair for DEV environments that already received the initial P1-17
-- gate wrapper. These facts are warning-only and never change stock, time,
-- planning, dispatch or document ownership.
create or replace function app_private.build_work_gate_snapshot(
  p_organization_id uuid,
  p_job_id uuid,
  p_project_id uuid
)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_snapshot jsonb;
  v_package_state text := 'missing';
  v_incomplete_child_handovers integer := 0;
  v_not_assessable jsonb;
  v_missing_optional_photos integer := 0;
  v_missing_dispatch_context integer := 0;
  v_missing_time_context integer := 0;
  v_missing_material_context integer := 0;
begin
  v_snapshot := app_private.build_work_gate_snapshot_p1_15(
    p_organization_id, p_job_id, p_project_id
  );

  select package.state::text into v_package_state
  from public.work_handover_packages package
  where package.organization_id = p_organization_id
    and ((p_job_id is not null and package.job_id = p_job_id)
      or (p_project_id is not null and package.project_id = p_project_id));
  v_package_state := coalesce(v_package_state, 'missing');

  if p_project_id is not null then
    select count(*) into v_incomplete_child_handovers
    from public.jobs job
    where job.organization_id = p_organization_id
      and job.project_id = p_project_id
      and coalesce(job.execution_state,
        app_private.resolve_legacy_job_execution_state(job.status)) <> 'cancelled'
      and not exists (
        select 1
        from public.work_handover_packages child_package
        where child_package.organization_id = p_organization_id
          and child_package.job_id = job.id
          and child_package.state = 'released'
          and child_package.current_release_id is not null
      );
  end if;

  select coalesce(jsonb_agg(entry.value), '[]'::jsonb) into v_not_assessable
  from jsonb_array_elements(v_snapshot->'notAssessable') entry(value)
  where entry.value <> '"handover_package"'::jsonb;
  v_not_assessable := v_not_assessable
    || jsonb_build_array('billability', 'invoice_readiness');

  select case when exists (
    select 1
    from public.document_links link
    join public.documents document on document.id = link.document_id
    where link.organization_id = p_organization_id
      and document.organization_id = p_organization_id
      and document.deleted_at is null
      and document.mime_type like 'image/%'
      and (
        (p_job_id is not null and link.job_id = p_job_id)
        or (p_project_id is not null and (
          link.project_id = p_project_id
          or link.job_id in (
            select job.id from public.jobs job
            where job.organization_id = p_organization_id
              and job.project_id = p_project_id
          )
        ))
      )
  ) then 0 else 1 end into v_missing_optional_photos;

  select case when exists (
    select 1
    from public.planning_dispatches dispatch
    left join public.planning_occurrences occurrence on occurrence.id = dispatch.occurrence_id
    where dispatch.organization_id = p_organization_id
      and dispatch.status = 'active'
      and (
        (p_job_id is not null and coalesce(dispatch.job_id, occurrence.job_id) = p_job_id)
        or (p_project_id is not null and coalesce(dispatch.job_id, occurrence.job_id) in (
          select job.id from public.jobs job
          where job.organization_id = p_organization_id
            and job.project_id = p_project_id
        ))
      )
  ) then 0 else 1 end into v_missing_dispatch_context;

  select case when exists (
    select 1 from public.time_entries entry
    where entry.organization_id = p_organization_id
      and entry.status not in ('rejected', 'pending_delete')
      and (
        (p_job_id is not null and entry.job_id = p_job_id)
        or (p_project_id is not null and entry.job_id in (
          select job.id from public.jobs job
          where job.organization_id = p_organization_id
            and job.project_id = p_project_id
        ))
      )
  ) then 0 else 1 end into v_missing_time_context;

  select case when exists (
    select 1 from public.job_material_lines line
    where line.organization_id = p_organization_id
      and (
        (p_job_id is not null and line.job_id = p_job_id)
        or (p_project_id is not null and (
          line.project_id = p_project_id
          or line.job_id in (
            select job.id from public.jobs job
            where job.organization_id = p_organization_id
              and job.project_id = p_project_id
          )
        ))
      )
  ) then 0 else 1 end into v_missing_material_context;

  return v_snapshot
    || jsonb_build_object(
      'handoverPackageState', v_package_state,
      'incompleteChildHandovers', v_incomplete_child_handovers,
      'missingOptionalPhotos', v_missing_optional_photos,
      'missingDispatchContext', v_missing_dispatch_context,
      'missingTimeContext', v_missing_time_context,
      'missingMaterialContext', v_missing_material_context,
      'notAssessable', v_not_assessable
    );
end;
$$;
