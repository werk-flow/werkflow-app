create or replace function app_private.validate_maintenance_due_evidence()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.maintenance_due_work due_work
    join public.work_artifact_revisions revision
      on revision.id = new.work_artifact_revision_id
     and revision.organization_id = new.organization_id
    join public.work_artifacts artifact
      on artifact.id = revision.artifact_id
     and artifact.organization_id = revision.organization_id
    where due_work.id = new.maintenance_due_work_id
      and due_work.organization_id = new.organization_id
      and due_work.job_id is not null
      and artifact.job_id = due_work.job_id
  ) then raise exception 'maintenance_due_evidence_mismatch'; end if;
  return new;
end;
$$;
