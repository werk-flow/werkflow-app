-- An employee assigned to a job of a project reads that project's work state
-- and the documents attached to the project itself, read-only (owner decision
-- 2026-10-03). Both read rules lacked the project case:
--
-- * can_view_p1_14_work_target admitted an employee to a job target only, so
--   get_work_lifecycle_snapshot refused the project page's work state with
--   work_snapshot_not_authorized, and the SELECT policies of the project's
--   work events, blockers and dependencies kept Realtime from delivering them.
--   The function decides reads only; every write path (transition, blocker,
--   dependency) keeps its own manager rule for a project target.
-- * can_access_document admitted an employee to job-linked documents only, so
--   Realtime did not deliver changes of project-linked documents that the
--   server reader already shows. Project documents stay read-only for
--   employees: the document actions require a manager for project-level writes.
--
-- Both rules stay inside the organization of the target and keep their
-- signatures, security definer, the empty search_path and their grants.

create or replace function app_private.can_view_p1_14_work_target(
  p_organization_id uuid,
  p_job_id uuid,
  p_project_id uuid,
  p_instruction_item_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select case
    when p_instruction_item_id is not null then
      app_private.can_view_work_instruction_item(p_instruction_item_id, p_user_id)
    else app_private.can_view_work_instruction_target(
      p_organization_id, p_job_id, p_project_id, p_user_id
    ) or (
      p_project_id is not null
      and p_job_id is null
      and exists (
        select 1
        from public.jobs job
        join public.job_assignments assignment on assignment.job_id = job.id
        where job.project_id = p_project_id
          and job.organization_id = p_organization_id
          and assignment.user_id = p_user_id
      )
    )
  end;
$$;

revoke all on function app_private.can_view_p1_14_work_target(uuid, uuid, uuid, uuid, uuid)
from public, anon;
grant execute on function app_private.can_view_p1_14_work_target(uuid, uuid, uuid, uuid, uuid)
to authenticated, service_role;

create or replace function app_private.can_access_document(p_document_id uuid, p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.personnel_documents protected
    where protected.document_id = p_document_id
      and app_private.can_access_personnel_document(protected.id, p_user_id)
  ) or exists (
    select 1 from public.documents document
    where document.id = p_document_id and document.deleted_at is null
      and not exists (
        select 1 from public.personnel_documents protected where protected.document_id = document.id
      )
      and app_private.is_document_manager(document.organization_id, p_user_id)
  ) or exists (
    select 1
    from public.documents document
    join public.document_links link on link.document_id = document.id
    join public.job_assignments assignment on assignment.job_id = link.job_id
    where document.id = p_document_id and document.deleted_at is null
      and not exists (
        select 1 from public.personnel_documents protected where protected.document_id = document.id
      )
      and link.job_id is not null and assignment.user_id = p_user_id
      and app_private.p1_24_has_effective_access(document.organization_id, p_user_id)
  ) or exists (
    select 1
    from public.documents document
    join public.document_links link on link.document_id = document.id
    join public.jobs job on job.project_id = link.project_id
      and job.organization_id = document.organization_id
    join public.job_assignments assignment on assignment.job_id = job.id
    where document.id = p_document_id and document.deleted_at is null
      and not exists (
        select 1 from public.personnel_documents protected where protected.document_id = document.id
      )
      and link.project_id is not null and assignment.user_id = p_user_id
      and app_private.p1_24_has_effective_access(document.organization_id, p_user_id)
  ) or exists (
    select 1
    from public.documents document
    join public.work_artifact_revision_documents relation on relation.document_id = document.id
    join public.work_artifact_revisions revision on revision.id = relation.revision_id
    join public.work_artifacts artifact on artifact.id = revision.artifact_id
    where document.id = p_document_id and document.deleted_at is null
      and not exists (
        select 1 from public.personnel_documents protected where protected.document_id = document.id
      )
      and app_private.p1_24_has_effective_access(document.organization_id, p_user_id)
      and app_private.can_access_work_artifact_target(
        artifact.organization_id, artifact.job_id, artifact.project_id, p_user_id
      )
  );
$$;

revoke all on function app_private.can_access_document(uuid, uuid)
from public, anon;
grant execute on function app_private.can_access_document(uuid, uuid)
to authenticated, service_role;
