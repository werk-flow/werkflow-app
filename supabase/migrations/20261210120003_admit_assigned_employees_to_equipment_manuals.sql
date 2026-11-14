-- The technician assigned to a job reads the ordinary documents linked to an
-- Anlage of that job, such as its Bedienungsanleitung
-- (werk-flow/werkflow-planning#468). can_access_document had no branch for
-- document_links.equipment_id, so Realtime refused such a document to the
-- employee that the field history read now lists.
--
-- The new branch admits an employee only while all of these hold:
-- * the document links to an Anlage that is not voided, and that Anlage is
--   linked to a job of the same organization the employee is assigned to now;
--   removing the assignment or the work link ends the read at once;
-- * the document is ordinary: no protected personnel file, no financial
--   paper (an invoice, offer or contract, or any document with a retention
--   class), and no office-only link to a request, a maintenance coverage or an
--   employee;
-- * the employee has effective access (p1_24_has_effective_access).
-- lib/documents/equipment-access.ts holds the same rule (isFieldEquipmentDocument) for
-- the Server Actions. Every other branch is unchanged. The function keeps its
-- signature, security definer, the empty search_path and its grants.

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
    join public.document_links link on link.document_id = document.id
      and link.organization_id = document.organization_id
    join public.installed_equipment equipment on equipment.id = link.equipment_id
      and equipment.organization_id = document.organization_id
    join public.installed_equipment_work_links work_link on work_link.equipment_id = equipment.id
      and work_link.organization_id = document.organization_id
    join public.job_assignments assignment on assignment.job_id = work_link.job_id
      and assignment.organization_id = document.organization_id
    where document.id = p_document_id and document.deleted_at is null
      and link.equipment_id is not null and equipment.voided_at is null
      and work_link.job_id is not null and assignment.user_id = p_user_id
      and document.category not in ('invoice', 'offer', 'contract')
      and document.retention_class is null
      and not exists (
        select 1 from public.personnel_documents protected where protected.document_id = document.id
      )
      and not exists (
        select 1 from public.document_links office_link
        where office_link.document_id = document.id
          and (office_link.request_id is not null
            or office_link.maintenance_coverage_id is not null
            or office_link.employee_id is not null)
      )
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
