alter table public.documents
  add column if not exists deleted_by uuid references public.profiles(id) on delete set null,
  add column if not exists delete_reason text,
  add column if not exists current_version_number integer not null default 1;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'documents_current_version_number_check'
      and conrelid = 'public.documents'::regclass
  ) then
    alter table public.documents
      add constraint documents_current_version_number_check
      check (current_version_number >= 1);
  end if;
end $$;

create table if not exists public.document_audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  document_id uuid references public.documents(id) on delete set null,
  folder_id uuid references public.document_folders(id) on delete set null,
  actor_id uuid references public.profiles(id) on delete set null,
  event_type text not null,
  event_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'document_audit_events_event_type_check'
      and conrelid = 'public.document_audit_events'::regclass
  ) then
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
        'storage_cleanup'
      ));
  end if;
end $$;

create table if not exists public.document_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  version_number integer not null,
  storage_bucket text not null default 'organization-documents',
  storage_path text not null,
  original_file_name text not null,
  mime_type text,
  size_bytes bigint not null,
  uploaded_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (document_id, version_number)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'document_versions_version_number_check'
      and conrelid = 'public.document_versions'::regclass
  ) then
    alter table public.document_versions
      add constraint document_versions_version_number_check
      check (version_number >= 1);
  end if;
end $$;

create index if not exists documents_deleted_by_idx
  on public.documents (deleted_by)
  where deleted_by is not null;

create index if not exists documents_deleted_at_for_trash_idx
  on public.documents (organization_id, deleted_at)
  where deleted_at is not null;

create index if not exists document_audit_events_organization_created_idx
  on public.document_audit_events (organization_id, created_at desc);

create index if not exists document_audit_events_document_created_idx
  on public.document_audit_events (document_id, created_at desc)
  where document_id is not null;

create index if not exists document_audit_events_actor_idx
  on public.document_audit_events (actor_id)
  where actor_id is not null;

create index if not exists document_versions_document_version_idx
  on public.document_versions (document_id, version_number desc);

create index if not exists document_versions_organization_idx
  on public.document_versions (organization_id);

create index if not exists document_versions_uploaded_by_idx
  on public.document_versions (uploaded_by);

alter table public.document_audit_events enable row level security;
alter table public.document_versions enable row level security;

create policy "Managers can view document audit events"
  on public.document_audit_events
  for select
  to authenticated
  using (app_private.is_document_manager(organization_id, (select auth.uid())));

create policy "Assigned employees can view accessible document audit events"
  on public.document_audit_events
  for select
  to authenticated
  using (
    document_id is not null
    and app_private.can_access_document(document_id, (select auth.uid()))
  );

create policy "Managers can insert document audit events"
  on public.document_audit_events
  for insert
  to authenticated
  with check (app_private.is_document_manager(organization_id, (select auth.uid())));

create policy "Users can view accessible document versions"
  on public.document_versions
  for select
  to authenticated
  using (app_private.can_access_document(document_id, (select auth.uid())));

create policy "Managers can insert document versions"
  on public.document_versions
  for insert
  to authenticated
  with check (app_private.is_document_manager(organization_id, (select auth.uid())));

create policy "Managers can delete document versions"
  on public.document_versions
  for delete
  to authenticated
  using (app_private.is_document_manager(organization_id, (select auth.uid())));

create or replace function app_private.validate_document_version_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  linked_document_org_id uuid;
begin
  select organization_id into linked_document_org_id
  from public.documents
  where id = new.document_id;

  if linked_document_org_id is null or linked_document_org_id <> new.organization_id then
    raise exception 'document version document must belong to the same organization';
  end if;

  if split_part(new.storage_path, '/', 1) <> new.organization_id::text then
    raise exception 'document version storage path must start with organization id';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_document_version_org on public.document_versions;
create trigger validate_document_version_org
  before insert or update on public.document_versions
  for each row
  execute function app_private.validate_document_version_org();