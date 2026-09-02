-- Protected personnel files never become ordinary linked or foldered
-- documents. This database guard keeps direct service-role callers from
-- broadening access by attaching a protected file to operational work.

create or replace function app_private.validate_p1_24_personnel_document_boundary()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  document_folder_id uuid;
begin
  select document.folder_id into document_folder_id
  from public.documents document
  where document.id = new.document_id
    and document.organization_id = new.organization_id;
  if not found then raise exception 'document_organization_mismatch'; end if;
  if document_folder_id is not null then
    raise exception 'personnel_document_must_be_unfoldered';
  end if;
  if exists (
    select 1 from public.document_links link
    where link.document_id = new.document_id
  ) then
    raise exception 'ordinary_document_links_must_be_removed_first';
  end if;
  return new;
end;
$$;

create trigger personnel_documents_boundary_guard
  before insert or update of document_id, organization_id
  on public.personnel_documents
  for each row execute function app_private.validate_p1_24_personnel_document_boundary();

create or replace function app_private.guard_p1_24_ordinary_document_link()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (
    select 1 from public.personnel_documents protected
    where protected.document_id = new.document_id
  ) then
    raise exception 'protected_personnel_document_cannot_be_linked';
  end if;
  return new;
end;
$$;

create trigger document_links_protected_personnel_guard
  before insert or update of document_id on public.document_links
  for each row execute function app_private.guard_p1_24_ordinary_document_link();

create or replace function app_private.guard_p1_24_protected_document_folder()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.folder_id is not null and exists (
    select 1 from public.personnel_documents protected
    where protected.document_id = new.id
  ) then
    raise exception 'protected_personnel_document_must_be_unfoldered';
  end if;
  return new;
end;
$$;

create trigger documents_protected_personnel_folder_guard
  before update of folder_id on public.documents
  for each row execute function app_private.guard_p1_24_protected_document_folder();

revoke all on function app_private.validate_p1_24_personnel_document_boundary()
  from public, anon, authenticated;
revoke all on function app_private.guard_p1_24_ordinary_document_link()
  from public, anon, authenticated;
revoke all on function app_private.guard_p1_24_protected_document_folder()
  from public, anon, authenticated;
grant execute on function app_private.validate_p1_24_personnel_document_boundary()
  to service_role;
grant execute on function app_private.guard_p1_24_ordinary_document_link()
  to service_role;
grant execute on function app_private.guard_p1_24_protected_document_folder()
  to service_role;
