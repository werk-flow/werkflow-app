create or replace function app_private.validate_work_artifact_relation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_revision public.work_artifact_revisions%rowtype;
  v_artifact public.work_artifacts%rowtype;
begin
  select * into v_revision from public.work_artifact_revisions revision
  where revision.id = new.revision_id and revision.organization_id = new.organization_id;
  if not found then raise exception 'work_artifact_relation_revision_mismatch'; end if;
  select * into v_artifact from public.work_artifacts artifact
  where artifact.id = v_revision.artifact_id and artifact.organization_id = new.organization_id;
  if not found then raise exception 'work_artifact_relation_artifact_mismatch'; end if;

  if tg_table_name = 'work_artifact_revision_documents' then
    if not exists (
      select 1
      from public.documents document
      join public.document_links link on link.document_id = document.id
      where document.id = new.document_id
        and document.organization_id = new.organization_id
        and document.deleted_at is null
        and ((v_artifact.job_id is not null and link.job_id = v_artifact.job_id)
          or (v_artifact.project_id is not null and link.project_id = v_artifact.project_id))
    ) then raise exception 'work_artifact_document_target_mismatch'; end if;
  end if;

  if tg_table_name = 'work_artifact_revision_sources' then
    if new.time_entry_id is not null and not exists (
      select 1
      from public.time_entries entry
      left join public.jobs job on job.id = entry.job_id
      where entry.id = new.time_entry_id and entry.organization_id = new.organization_id
        and ((v_artifact.job_id is not null and entry.job_id = v_artifact.job_id)
          or (v_artifact.project_id is not null and job.project_id = v_artifact.project_id))
    ) then raise exception 'work_artifact_time_source_target_mismatch'; end if;
    if new.inventory_movement_id is not null and not exists (
      select 1
      from public.inventory_movements movement
      left join public.jobs job on job.id = movement.job_id
      where movement.id = new.inventory_movement_id
        and movement.organization_id = new.organization_id
        and ((v_artifact.job_id is not null and movement.job_id = v_artifact.job_id)
          or (v_artifact.project_id is not null
            and (movement.project_id = v_artifact.project_id or job.project_id = v_artifact.project_id)))
    ) then raise exception 'work_artifact_inventory_source_target_mismatch'; end if;
  end if;
  return new;
end;
$$;

revoke all on function app_private.validate_work_artifact_relation()
from public, anon, authenticated;
grant execute on function app_private.validate_work_artifact_relation()
to service_role;
