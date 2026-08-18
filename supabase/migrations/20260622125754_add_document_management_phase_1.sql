insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('organization-documents', 'organization-documents', false, 52428800, null)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types,
  updated_at = now();

create table if not exists public.document_folders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  parent_folder_id uuid references public.document_folders(id) on delete cascade,
  name text not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint document_folders_name_not_blank check (btrim(name) <> ''),
  constraint document_folders_name_length check (char_length(btrim(name)) <= 120)
);

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  folder_id uuid references public.document_folders(id) on delete set null,
  storage_bucket text not null default 'organization-documents',
  storage_path text not null unique,
  original_file_name text not null,
  display_name text not null,
  mime_type text,
  size_bytes bigint not null,
  uploaded_by uuid not null references public.profiles(id),
  copied_from_document_id uuid references public.documents(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint documents_display_name_not_blank check (btrim(display_name) <> ''),
  constraint documents_original_file_name_not_blank check (btrim(original_file_name) <> ''),
  constraint documents_storage_bucket_check check (storage_bucket = 'organization-documents'),
  constraint documents_storage_path_not_blank check (btrim(storage_path) <> ''),
  constraint documents_size_bytes_positive check (size_bytes > 0),
  constraint documents_metadata_is_object check (jsonb_typeof(metadata) = 'object')
);

create table if not exists public.document_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint document_links_exactly_one_target check (num_nonnulls(job_id, project_id) = 1)
);

create index if not exists document_folders_organization_id_idx on public.document_folders (organization_id);
create index if not exists document_folders_parent_folder_id_idx on public.document_folders (parent_folder_id);
create index if not exists document_folders_created_by_idx on public.document_folders (created_by);
create unique index if not exists document_folders_unique_active_name_idx
  on public.document_folders (organization_id, coalesce(parent_folder_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(btrim(name)))
  where deleted_at is null;

create index if not exists documents_organization_id_idx on public.documents (organization_id);
create index if not exists documents_folder_id_idx on public.documents (folder_id);
create index if not exists documents_uploaded_by_idx on public.documents (uploaded_by);
create index if not exists documents_created_at_idx on public.documents (created_at desc);
create index if not exists documents_deleted_at_idx on public.documents (deleted_at) where deleted_at is not null;
create unique index if not exists documents_unique_active_folder_name_idx
  on public.documents (organization_id, coalesce(folder_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(btrim(display_name)))
  where deleted_at is null;

create index if not exists document_links_organization_id_idx on public.document_links (organization_id);
create index if not exists document_links_document_id_idx on public.document_links (document_id);
create index if not exists document_links_job_id_idx on public.document_links (job_id) where job_id is not null;
create index if not exists document_links_project_id_idx on public.document_links (project_id) where project_id is not null;
create unique index if not exists document_links_unique_job_idx on public.document_links (document_id, job_id) where job_id is not null;
create unique index if not exists document_links_unique_project_idx on public.document_links (document_id, project_id) where project_id is not null;

create or replace function app_private.is_document_manager(p_org_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members om
    where om.organization_id = p_org_id
      and om.user_id = p_user_id
      and om.role = any (array['admin'::public.org_role, 'buero'::public.org_role])
  );
$$;

create or replace function app_private.can_access_document(p_document_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.documents d
    where d.id = p_document_id
      and d.deleted_at is null
      and app_private.is_document_manager(d.organization_id, p_user_id)
  )
  or exists (
    select 1
    from public.documents d
    join public.document_links dl on dl.document_id = d.id
    join public.job_assignments ja on ja.job_id = dl.job_id
    where d.id = p_document_id
      and d.deleted_at is null
      and dl.job_id is not null
      and ja.user_id = p_user_id
  );
$$;

create or replace function app_private.validate_document_folder_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent_org_id uuid;
begin
  new.name := btrim(new.name);

  if new.parent_folder_id is not null then
    select organization_id into parent_org_id
    from public.document_folders
    where id = new.parent_folder_id
      and deleted_at is null;

    if parent_org_id is null or parent_org_id <> new.organization_id then
      raise exception 'document folder parent must belong to the same organization';
    end if;
  end if;

  return new;
end;
$$;

create or replace function app_private.validate_document_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  folder_org_id uuid;
begin
  new.display_name := btrim(new.display_name);
  new.original_file_name := btrim(new.original_file_name);

  if new.folder_id is not null then
    select organization_id into folder_org_id
    from public.document_folders
    where id = new.folder_id
      and deleted_at is null;

    if folder_org_id is null or folder_org_id <> new.organization_id then
      raise exception 'document folder must belong to the same organization';
    end if;
  end if;

  if split_part(new.storage_path, '/', 1) <> new.organization_id::text then
    raise exception 'document storage path must start with organization id';
  end if;

  return new;
end;
$$;

create or replace function app_private.validate_document_link_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  linked_document_org_id uuid;
  linked_job_org_id uuid;
  linked_project_org_id uuid;
begin
  select organization_id into linked_document_org_id
  from public.documents
  where id = new.document_id
    and deleted_at is null;

  if linked_document_org_id is null or linked_document_org_id <> new.organization_id then
    raise exception 'document link document must belong to the same organization';
  end if;

  if new.job_id is not null then
    select organization_id into linked_job_org_id
    from public.jobs
    where id = new.job_id;

    if linked_job_org_id is null or linked_job_org_id <> new.organization_id then
      raise exception 'document link job must belong to the same organization';
    end if;
  end if;

  if new.project_id is not null then
    select organization_id into linked_project_org_id
    from public.projects
    where id = new.project_id;

    if linked_project_org_id is null or linked_project_org_id <> new.organization_id then
      raise exception 'document link project must belong to the same organization';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists document_folders_set_updated_at on public.document_folders;
create trigger document_folders_set_updated_at
before update on public.document_folders
for each row execute function public.set_updated_at();

drop trigger if exists documents_set_updated_at on public.documents;
create trigger documents_set_updated_at
before update on public.documents
for each row execute function public.set_updated_at();

drop trigger if exists validate_document_folder_org on public.document_folders;
create trigger validate_document_folder_org
before insert or update on public.document_folders
for each row execute function app_private.validate_document_folder_org();

drop trigger if exists validate_document_org on public.documents;
create trigger validate_document_org
before insert or update on public.documents
for each row execute function app_private.validate_document_org();

drop trigger if exists validate_document_link_org on public.document_links;
create trigger validate_document_link_org
before insert or update on public.document_links
for each row execute function app_private.validate_document_link_org();

alter table public.document_folders enable row level security;
alter table public.documents enable row level security;
alter table public.document_links enable row level security;

drop policy if exists "Managers can view document folders" on public.document_folders;
create policy "Managers can view document folders"
on public.document_folders
for select
to authenticated
using (
  deleted_at is null
  and app_private.is_document_manager(organization_id, (select auth.uid()))
);

drop policy if exists "Managers can insert document folders" on public.document_folders;
create policy "Managers can insert document folders"
on public.document_folders
for insert
to authenticated
with check (app_private.is_document_manager(organization_id, (select auth.uid())));

drop policy if exists "Managers can update document folders" on public.document_folders;
create policy "Managers can update document folders"
on public.document_folders
for update
to authenticated
using (app_private.is_document_manager(organization_id, (select auth.uid())))
with check (app_private.is_document_manager(organization_id, (select auth.uid())));

drop policy if exists "Managers can delete document folders" on public.document_folders;
create policy "Managers can delete document folders"
on public.document_folders
for delete
to authenticated
using (app_private.is_document_manager(organization_id, (select auth.uid())));

drop policy if exists "Users can view permitted documents" on public.documents;
create policy "Users can view permitted documents"
on public.documents
for select
to authenticated
using (app_private.can_access_document(id, (select auth.uid())));

drop policy if exists "Managers can insert documents" on public.documents;
create policy "Managers can insert documents"
on public.documents
for insert
to authenticated
with check (app_private.is_document_manager(organization_id, (select auth.uid())));

drop policy if exists "Managers can update documents" on public.documents;
create policy "Managers can update documents"
on public.documents
for update
to authenticated
using (app_private.is_document_manager(organization_id, (select auth.uid())))
with check (app_private.is_document_manager(organization_id, (select auth.uid())));

drop policy if exists "Managers can delete documents" on public.documents;
create policy "Managers can delete documents"
on public.documents
for delete
to authenticated
using (app_private.is_document_manager(organization_id, (select auth.uid())));

drop policy if exists "Users can view permitted document links" on public.document_links;
create policy "Users can view permitted document links"
on public.document_links
for select
to authenticated
using (app_private.can_access_document(document_id, (select auth.uid())));

drop policy if exists "Managers can insert document links" on public.document_links;
create policy "Managers can insert document links"
on public.document_links
for insert
to authenticated
with check (app_private.is_document_manager(organization_id, (select auth.uid())));

drop policy if exists "Managers can update document links" on public.document_links;
create policy "Managers can update document links"
on public.document_links
for update
to authenticated
using (app_private.is_document_manager(organization_id, (select auth.uid())))
with check (app_private.is_document_manager(organization_id, (select auth.uid())));

drop policy if exists "Managers can delete document links" on public.document_links;
create policy "Managers can delete document links"
on public.document_links
for delete
to authenticated
using (app_private.is_document_manager(organization_id, (select auth.uid())));

drop policy if exists "Managers can select organization document objects" on storage.objects;
create policy "Managers can select organization document objects"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'organization-documents'
  and app_private.is_document_manager((storage.foldername(name))[1]::uuid, (select auth.uid()))
);

drop policy if exists "Managers can insert organization document objects" on storage.objects;
create policy "Managers can insert organization document objects"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'organization-documents'
  and app_private.is_document_manager((storage.foldername(name))[1]::uuid, (select auth.uid()))
);

drop policy if exists "Managers can update organization document objects" on storage.objects;
create policy "Managers can update organization document objects"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'organization-documents'
  and app_private.is_document_manager((storage.foldername(name))[1]::uuid, (select auth.uid()))
)
with check (
  bucket_id = 'organization-documents'
  and app_private.is_document_manager((storage.foldername(name))[1]::uuid, (select auth.uid()))
);

drop policy if exists "Managers can delete organization document objects" on storage.objects;
create policy "Managers can delete organization document objects"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'organization-documents'
  and app_private.is_document_manager((storage.foldername(name))[1]::uuid, (select auth.uid()))
);

drop policy if exists "Assigned employees can read linked document objects" on storage.objects;
create policy "Assigned employees can read linked document objects"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'organization-documents'
  and exists (
    select 1
    from public.documents d
    where d.storage_bucket = bucket_id
      and d.storage_path = name
      and app_private.can_access_document(d.id, (select auth.uid()))
  )
);
