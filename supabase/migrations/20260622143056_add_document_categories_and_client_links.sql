alter table public.documents
  add column if not exists category text not null default 'other';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'documents_category_check'
      and conrelid = 'public.documents'::regclass
  ) then
    alter table public.documents
      add constraint documents_category_check
      check (category in ('photo', 'contract', 'invoice', 'offer', 'report', 'other'));
  end if;
end $$;

alter table public.document_links
  add column if not exists client_id uuid references public.clients(id) on delete cascade;

alter table public.document_links
  drop constraint if exists document_links_exactly_one_target;

alter table public.document_links
  add constraint document_links_exactly_one_target
  check (num_nonnulls(job_id, project_id, client_id) = 1);

create index if not exists documents_category_idx
  on public.documents (organization_id, category)
  where deleted_at is null;

create index if not exists document_links_client_id_idx
  on public.document_links (client_id)
  where client_id is not null;

create unique index if not exists document_links_unique_client_idx
  on public.document_links (document_id, client_id)
  where client_id is not null;

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
  linked_client_org_id uuid;
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

  if new.client_id is not null then
    select organization_id into linked_client_org_id
    from public.clients
    where id = new.client_id;

    if linked_client_org_id is null or linked_client_org_id <> new.organization_id then
      raise exception 'document link client must belong to the same organization';
    end if;
  end if;

  return new;
end;
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