-- The office finds a legacy original by its old number
-- (werk-flow/werkflow-planning#284). A document carries its origin: the
-- system it came from (for example Sykasoft) and the number that system gave
-- it. Admin and Büro set both in the details; the import of legacy archives
-- (werk-flow/werkflow-planning#19) will set them through the same function.
--
-- The trigger documents_retention_guard keeps a filed document's origin
-- fixed: its allowlist of changeable columns names neither column. A client
-- reads documents only through Realtime, whose column grant stays as it is,
-- so the origin reaches a reader only through the server, on a document the
-- server already lets them read.
--
-- Prevention: Tier 1 (the trigger and the column grant), Tier 2
-- supabase/tests/document_origin.sql.

alter table public.documents
  add column source_system text
    check (source_system = btrim(source_system) and char_length(source_system) between 1 and 80),
  add column source_reference text
    check (source_reference = btrim(source_reference) and char_length(source_reference) between 1 and 120);

-- The view selected document.* when it was replaced last; replacing it adds the new columns.
create or replace view public.ordinary_documents
with (security_invoker = true)
as
select document.*
from public.documents document
where not app_private.p1_24_is_protected_document(document.id);

-- @destructive: after release e713fa96: the constraint returns below with every earlier event type and one new one
alter table public.document_audit_events
  drop constraint document_audit_events_event_type_check;
-- @destructive: after release e713fa96: that build writes only event types this list keeps
alter table public.document_audit_events
  add constraint document_audit_events_event_type_check
  check (event_type in (
    'uploaded',
    'renamed',
    'moved',
    'copied',
    'category_changed',
    'linked',
    'unlinked',
    'deleted',
    'restored',
    'version_uploaded',
    'permanently_deleted',
    'storage_cleanup',
    'personnel_classified',
    'personnel_released',
    'personnel_release_revoked',
    'retention_changed',
    'filed',
    'origin_changed'
  ));

-- Sets the source system and the old number of an active, unfiled ordinary
-- document, trimmed, a blank value meaning none, with one audit event when
-- either changes. It shares the archive lock with the retention write: a
-- manager only, no protected personnel document, no filed document.
-- Refusals: invalid_input, not_authorized, document_not_found,
-- protected_document_boundary, document_filed.
create function public.update_document_origin(
  p_actor_id uuid,
  p_organization_id uuid,
  p_document_id uuid,
  p_source_system text,
  p_source_reference text
)
returns public.documents
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_source_system text := nullif(btrim(p_source_system), '');
  v_source_reference text := nullif(btrim(p_source_reference), '');
  v_document public.documents;
  v_updated public.documents;
begin
  if char_length(v_source_system) > 80 or char_length(v_source_reference) > 120 then
    raise exception 'invalid_input';
  end if;
  v_document := app_private.lock_ordinary_document_for_retention(p_actor_id, p_organization_id, p_document_id);
  if v_document.source_system is not distinct from v_source_system
    and v_document.source_reference is not distinct from v_source_reference
  then
    return v_document;
  end if;
  update public.documents document
  set source_system = v_source_system, source_reference = v_source_reference
  where document.id = p_document_id and document.organization_id = p_organization_id
  returning * into v_updated;
  insert into public.document_audit_events (
    organization_id, document_id, folder_id, actor_id, event_type, event_payload
  ) values (
    p_organization_id, p_document_id, v_document.folder_id, p_actor_id, 'origin_changed',
    jsonb_build_object(
      'fromSourceSystem', v_document.source_system, 'toSourceSystem', v_updated.source_system,
      'fromSourceReference', v_document.source_reference, 'toSourceReference', v_updated.source_reference
    )
  );
  return v_updated;
end;
$$;

revoke all on function public.update_document_origin(uuid, uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.update_document_origin(uuid, uuid, uuid, text, text) to service_role;

-- The search also matches the old number exactly and by prefix, ignoring
-- case; a number that only contains the text is no match. Otherwise as in
-- 20260908192618_paginate_operational_lists.sql.
create or replace function public.list_document_page(p_organization_id uuid,p_filters jsonb)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with matching as materialized (
    select d.id,d.display_name,d.created_at,d.updated_at,d.size_bytes,d.mime_type,d.category
    from public.ordinary_documents d where d.organization_id=p_organization_id
      and ((p_filters->>'view'='trash' and d.deleted_at is not null) or (p_filters->>'view'<>'trash' and d.deleted_at is null))
      and (coalesce(p_filters->>'searchQuery','')='' or strpos(lower(d.display_name),lower(p_filters->>'searchQuery'))>0 or strpos(lower(d.original_file_name),lower(p_filters->>'searchQuery'))>0 or starts_with(lower(d.source_reference),lower(p_filters->>'searchQuery')))
      and (coalesce(p_filters->>'category','all')='all' or d.category::text=p_filters->>'category')
      and (p_filters->>'view' not in('photos','contracts','invoices','offers','reports','other') or coalesce(p_filters->>'category','all')<>'all' or d.category::text=case p_filters->>'view' when 'photos' then 'photo' when 'contracts' then 'contract' when 'invoices' then 'invoice' when 'offers' then 'offer' when 'reports' then 'report' else 'other' end)
      and (p_filters->>'view'='trash' or (p_filters->>'view'<>'folders' and coalesce(p_filters->>'folderId','')='') or d.folder_id is not distinct from nullif(p_filters->>'folderId','')::uuid)
      and (p_filters->>'view'<>'unorganized' or (d.folder_id is null and not exists(select 1 from public.document_links l where l.organization_id=p_organization_id and l.document_id=d.id)))
      and (p_filters->>'view' not in('work','jobs','projects','clients','employees') or exists(select 1 from public.document_links l where l.organization_id=p_organization_id and l.document_id=d.id and case p_filters->>'view' when 'work' then l.job_id is not null or l.project_id is not null or l.client_id is not null or l.employee_id is not null when 'jobs' then l.job_id is not null when 'projects' then l.project_id is not null when 'clients' then l.client_id is not null else l.employee_id is not null end))
      and (coalesce(p_filters->>'linkFilter','all')='all' or (p_filters->>'linkFilter'='unlinked' and not exists(select 1 from public.document_links l where l.organization_id=p_organization_id and l.document_id=d.id)) or exists(select 1 from public.document_links l where l.organization_id=p_organization_id and l.document_id=d.id and case p_filters->>'linkFilter' when 'jobs' then l.job_id is not null when 'projects' then l.project_id is not null when 'clients' then l.client_id is not null when 'employees' then l.employee_id is not null else false end))
  ), page as (
    select id from matching order by
      case when p_filters->>'sort'='name' then display_name end collate "de-DE-x-icu" asc,
      case when p_filters->>'sort'='type' then mime_type end asc nulls last,
      case when p_filters->>'sort'='category' then category::text end asc,
      case when p_filters->>'sort'='size_bytes' then size_bytes end desc,
      case when p_filters->>'sort'='updated_at' then updated_at end desc,
      case when p_filters->>'sort'='created_at' then created_at end desc,id
    limit least(greatest(coalesce((p_filters->>'pageSize')::int,50),1),100)
    offset (greatest(coalesce((p_filters->>'page')::bigint,1),1)-1)*least(greatest(coalesce((p_filters->>'pageSize')::int,50),1),100)
  ) select jsonb_build_object('ids',coalesce((select jsonb_agg(id) from page),'[]'),'total',(select count(*) from matching));
$$;
revoke all on function public.list_document_page(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.list_document_page(uuid,jsonb) to service_role;
