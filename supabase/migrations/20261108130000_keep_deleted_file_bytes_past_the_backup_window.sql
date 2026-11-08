-- Deleted file bytes outlive the backup window (werk-flow/werkflow-planning#286).
-- A database restore brings back rows of up to a week ago; their files must
-- still exist. Permanent deletion of a document and organization deletion
-- remove the rows at once and queue each object for deletion eight days later,
-- one day past the provider's seven days of daily backups (owner's answer on
-- werk-flow/werkflow-planning#24).
--
-- The scheduled purge (app/api/storage-purge/route.ts) claims due entries,
-- deletes their objects and completes them. A claim first releases every due
-- entry whose path a row references again, such as a restored document: it
-- reads every public column whose name ends in `storage_path`, so a new path
-- column is covered by its name. A failed deletion leaves its entry queued
-- with its attempts, and the next run claims it again.
--
-- The queue keeps no foreign key to the organization: its entries outlive an
-- organization deletion. Rows are service-only, like the rate-limit state.
--
-- Prevention: Tier 1 (the queue writes inside the deleting functions), Tier 2
-- supabase/tests/storage_purge.sql.

create table public.storage_purge_queue (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  storage_path text not null unique,
  queued_at timestamptz not null default now(),
  purge_after timestamptz not null,
  attempts integer not null default 0 check (attempts >= 0),
  last_attempt_at timestamptz,
  -- Every key starts with its organization (lib/storage/r2.ts), so the purge
  -- deletes each object inside the organization the entry names.
  constraint storage_purge_queue_path_in_organization
    check (starts_with(storage_path, organization_id::text || '/'))
);

create index storage_purge_queue_purge_after_idx on public.storage_purge_queue (purge_after);

-- RLS without a policy: client roles see no row even if a grant appeared later.
alter table public.storage_purge_queue enable row level security;
revoke all on table public.storage_purge_queue from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.storage_purge_queue to service_role;

-- Queues objects of one organization for deletion after the delay. A path
-- queued again keeps the later date, so each deletion gets its full delay.
create function public.queue_storage_purge(p_organization_id uuid, p_paths text[])
returns void
language sql
security invoker
set search_path to ''
as $$
  insert into public.storage_purge_queue as queued (organization_id, storage_path, purge_after)
  select distinct p_organization_id, path, now() + interval '8 days'
  from unnest(p_paths) as path
  where path is not null
  on conflict (storage_path) do update
    set purge_after = greatest(queued.purge_after, excluded.purge_after);
$$;

-- Releases each due entry whose path a row references, then claims up to
-- p_limit due entries for one hour, so a concurrent run skips them and a
-- failed one waits for the next run.
create function public.claim_storage_purge(p_limit integer)
returns table (id uuid, organization_id uuid, storage_path text)
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_column record;
begin
  for v_column in
    select relation.relname as table_name, attribute.attname as column_name
    from pg_catalog.pg_attribute attribute
    join pg_catalog.pg_class relation on relation.oid = attribute.attrelid
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public' and relation.relkind in ('r', 'p')
      and relation.relname <> 'storage_purge_queue'
      and attribute.attname like '%storage\_path'
      and attribute.attnum > 0 and not attribute.attisdropped
  loop
    execute format(
      'delete from public.storage_purge_queue queued where queued.purge_after <= now()
         and exists (select 1 from public.%I referencing where referencing.%I = queued.storage_path)',
      v_column.table_name, v_column.column_name
    );
  end loop;

  return query
  with due as (
    select queued.id from public.storage_purge_queue queued
    where queued.purge_after <= now()
      and (queued.last_attempt_at is null or queued.last_attempt_at <= now() - interval '1 hour')
    order by queued.purge_after, queued.id
    limit greatest(p_limit, 0)
    for update skip locked
  )
  update public.storage_purge_queue queued
  set attempts = queued.attempts + 1, last_attempt_at = now()
  from due
  where queued.id = due.id
  returning queued.id, queued.organization_id, queued.storage_path;
end;
$$;

-- Removes the entries whose objects the purge deleted.
create function public.complete_storage_purge(p_ids uuid[])
returns void
language sql
security invoker
set search_path to ''
as $$
  delete from public.storage_purge_queue queued where queued.id = any(p_ids);
$$;

revoke all on function public.queue_storage_purge(uuid, text[]) from public, anon, authenticated;
revoke all on function public.claim_storage_purge(integer) from public, anon, authenticated;
revoke all on function public.complete_storage_purge(uuid[]) from public, anon, authenticated;
grant execute on function public.queue_storage_purge(uuid, text[]) to service_role;
grant execute on function public.claim_storage_purge(integer) to service_role;
grant execute on function public.complete_storage_purge(uuid[]) to service_role;

-- Queues the document's paths with the deletion and still returns them, so
-- the previous release's action keeps working. Otherwise as in
-- 20261004140100_write_document_changes_with_their_audit_events.sql.
create or replace function public.permanently_delete_document(
  p_actor_id uuid,
  p_organization_id uuid,
  p_document_id uuid
)
returns text[]
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_document public.documents;
  v_storage_paths text[];
begin
  if not app_private.is_document_manager(p_organization_id, p_actor_id) then
    raise exception 'not_authorized';
  end if;
  select * into v_document from public.documents document
  where document.id = p_document_id and document.organization_id = p_organization_id
    and document.deleted_at is not null
  for update;
  if not found then
    raise exception 'document_not_found';
  end if;
  if exists (
    select 1 from public.document_links link
    where link.organization_id = p_organization_id and link.document_id = p_document_id
      and link.equipment_id is not null
  ) then
    raise exception 'document_has_equipment_history';
  end if;
  v_storage_paths := array[v_document.storage_path] || array(
    select version.storage_path from public.document_versions version
    where version.organization_id = p_organization_id and version.document_id = p_document_id
    order by version.version_number
  );
  delete from public.documents document
  where document.id = p_document_id and document.organization_id = p_organization_id;
  insert into public.document_audit_events (
    organization_id, folder_id, actor_id, event_type, event_payload
  ) values (
    p_organization_id, v_document.folder_id, p_actor_id, 'permanently_deleted',
    jsonb_build_object(
      'documentId', p_document_id, 'displayName', v_document.display_name,
      'storagePaths', to_jsonb(v_storage_paths)
    )
  );
  perform public.queue_storage_purge(p_organization_id, v_storage_paths);
  return v_storage_paths;
end;
$$;

-- Queues every document and version path of the organization with the
-- deletion, so a file whose row the cascade removes is never left behind,
-- even one registered after the server listed the prefix. Otherwise as in
-- 20261108120001_keep_filed_documents_for_their_retention_period.sql.
create or replace function public.delete_organization(
  p_organization_id uuid,
  p_actor_id uuid,
  p_confirmation_name text
)
returns void
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_organization public.organizations%rowtype;
begin
  select * into v_organization
  from public.organizations organization
  where organization.id = p_organization_id
  for update;
  if not found then raise exception 'org_not_found'; end if;

  if p_actor_id is null or v_organization.admin_id <> p_actor_id then
    raise exception 'not_authorized';
  end if;
  if p_confirmation_name is null or btrim(p_confirmation_name) <> v_organization.name then
    raise exception 'name_mismatch';
  end if;

  if exists (select 1 from public.time_entries e where e.organization_id = p_organization_id)
    or exists (select 1 from public.time_sessions s where s.organization_id = p_organization_id)
    or exists (
      select 1 from public.time_period_close_versions v where v.organization_id = p_organization_id
    )
  then raise exception 'has_time_records'; end if;
  -- An upload or a retention change waits on the locked organization row
  -- and then fails, so no period starts after this check.
  if exists (
    select 1 from public.documents d
    where d.organization_id = p_organization_id
      and d.retention_ends_on >= (now() at time zone 'Europe/Berlin')::date
  ) then raise exception 'has_retained_documents'; end if;

  perform public.queue_storage_purge(p_organization_id, array(
    select d.storage_path from public.documents d where d.organization_id = p_organization_id
    union
    select v.storage_path from public.document_versions v where v.organization_id = p_organization_id
  ));

  delete from public.organizations organization where organization.id = p_organization_id;
end;
$$;

-- The owner's deletion with the objects the server listed under the
-- organization's prefix, rows or not (a staging upload, a refused copy): the
-- rows go and every object is queued, or nothing happens.
create function public.delete_organization_with_files(
  p_organization_id uuid,
  p_actor_id uuid,
  p_confirmation_name text,
  p_storage_paths text[]
)
returns void
language plpgsql
security invoker
set search_path to ''
as $$
begin
  perform public.delete_organization(p_organization_id, p_actor_id, p_confirmation_name);
  perform public.queue_storage_purge(p_organization_id, p_storage_paths);
end;
$$;

revoke all on function public.delete_organization_with_files(uuid, uuid, text, text[])
  from public, anon, authenticated;
grant execute on function public.delete_organization_with_files(uuid, uuid, text, text[]) to service_role;
